import { MUTATION_CLASSES } from '../../utils/mutationTypes';
import {
  BASE_COLORS,
  ROW_GAP,
  barRects,
  binVariants,
  sequenceLayout,
} from './layout';

/** Show the sequence once bases are at least this wide (pixels). */
const MIN_BASE_WIDTH = 1;
const LETTER_FONT_SIZE = 12;
const LETTER_FONT_FAMILY = 'Arial';
// Letter textures are rendered at a higher resolution and scaled down.
const LETTER_TEXTURE_SCALE = 2;
// Letters shrink down to this fraction of their size when bases get narrow.
const MIN_LETTER_SCALE = 0.6;
// Space above the bars, so that the legend doesn't overlap the axis labels.
const LEGEND_HEIGHT = 22;
const LEGEND_Y = 9;
const LEGEND_FONT_SIZE = 10;

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );

const swatch = (color) =>
  `<span style="display:inline-block;width:10px;height:10px;margin-right:4px;background:${color}"></span>`;

// Must be a regular function (not an arrow function): HiGlass calls it with `new`.
function SomaticVariantTrack(HGC, ...args) {
  if (!new.target) {
    throw new Error(
      'Uncaught TypeError: Class constructor cannot be invoked without "new"',
    );
  }

  const { PIXI } = HGC.libraries;
  const { scaleLinear } = HGC.libraries.d3Scale;
  const { absToChr, colorToHex } = HGC.utils;

  class SomaticVariantTrackClass extends HGC.tracks.HorizontalTiled1DPixiTrack {
    constructor(context, options) {
      super(context, options);
      this.initOptions(options);

      this.mode = 'bars';
      this.drawnRects = [];
      this.drawnLetters = [];

      this.legendGraphics = new PIXI.Graphics();
      this.pForeground.addChild(this.legendGraphics);
      this.legendTexts = [];

      this.letterTexts = {};
      for (const letter of Object.keys(BASE_COLORS)) {
        const text = new PIXI.Text(letter, {
          fontSize: LETTER_FONT_SIZE * LETTER_TEXTURE_SCALE,
          fontFamily: LETTER_FONT_FAMILY,
          fontWeight: 'bold',
          fill: 0xffffff,
        });
        text.updateText(false);
        this.letterTexts[letter] = text;
      }
      const sizes = Object.values(this.letterTexts);
      this.maxLetterWidth =
        Math.max(...sizes.map((t) => t.texture.width)) / LETTER_TEXTURE_SCALE;
      this.maxLetterHeight =
        Math.max(...sizes.map((t) => t.texture.height)) / LETTER_TEXTURE_SCALE;
    }

    /**
     * Track options are normally merged with `defaultOptions` by HiGlass, but
     * not when the track is only passed via `options.pluginTracks`.
     */
    initOptions(options) {
      this.options = {
        ...SomaticVariantTrack.config.defaultOptions,
        ...options,
      };
    }

    rerender(options, force) {
      const strOptions = JSON.stringify(options);
      if (!force && strOptions === this.prevOptions) return;

      super.rerender(
        {
          ...SomaticVariantTrack.config.defaultOptions,
          ...options,
        },
        force,
      );
      this.prevOptions = strOptions;
      this.draw();
    }

    setPosition(newPosition) {
      super.setPosition(newPosition);
      [this.pMain.position.x, this.pMain.position.y] = this.position;
      [this.pMouseOver.position.x, this.pMouseOver.position.y] = this.position;
    }

    setDimensions(newDimensions) {
      super.setDimensions(newDimensions);
      this.draw();
    }

    zoomed(newXScale, newYScale) {
      this.xScale(newXScale);
      this.yScale(newYScale);
      // Tiles are local, so they are requested right away instead of debounced.
      this.refreshTiles();
      this.draw();
    }

    initTile(tile) {
      tile.letters = new PIXI.Container();
      tile.graphics.addChild(tile.letters);
    }

    destroyTile(tile) {
      tile.letters?.destroy({ children: true });
      tile.letters = null;
    }

    // Tiles are drawn together in draw() because they share the value scale.
    drawTile() {}

    /**
     * Bars only use the visible tiles, which are all on the same zoom level.
     * The sequence also uses other max zoom tiles that are still loaded, so it
     * doesn't flicker while new tiles are fetched.
     */
    tilesToDraw() {
      if (this.mode === 'bars') return this.visibleAndFetchedTiles();
      return Object.values(this.fetchedTiles).filter(
        (tile) => tile.tileData?.zoomLevel === +this.tilesetInfo.max_zoom,
      );
    }

    /** Whether bases are wide enough to show the sequence. */
    isSequenceMode() {
      const [d0, d1] = this._xScale.domain();
      const [r0, r1] = this._xScale.range();
      return (
        this.zoomLevel === +this.tilesetInfo.max_zoom &&
        (r1 - r0) / (d1 - d0) >= MIN_BASE_WIDTH
      );
    }

    /** Bins of a tile for the current options, cached on the tile. */
    getBins(tile) {
      const nBins = Math.max(
        Math.round(this.tilesetInfo.tile_size / (+this.options.barWidth || 8)),
        1,
      );
      const key = `${nBins}:${!!this.options.onlyPass}`;
      if (tile.binsKey !== key) {
        const { start, end, variants } = tile.tileData;
        tile.bins = binVariants(variants, start, end, nBins, {
          onlyPass: this.options.onlyPass,
        });
        tile.binsKey = key;
      }
      return tile.bins;
    }

    /** Largest stacked bar in the visible range. */
    maxVisibleTotal() {
      const [d0, d1] = this._xScale.domain();
      let max = 0;
      for (const tile of this.visibleAndFetchedTiles()) {
        const { binSize, totals } = this.getBins(tile);
        totals.forEach((total, i) => {
          const binStart = tile.tileData.start + i * binSize;
          if (binStart + binSize > d0 && binStart < d1) {
            max = Math.max(max, total);
          }
        });
      }
      return max;
    }

    minVisibleValue() {
      return 0;
    }

    maxVisibleValue() {
      return this.tilesetInfo ? this.maxVisibleTotal() : 0;
    }

    makeCountScale(max) {
      const top = this.options.showLegend ? LEGEND_HEIGHT : 2;
      const scale = scaleLinear()
        .domain([0, Math.max(max, 1)])
        .range([this.dimensions[1], Math.min(top, this.dimensions[1])]);
      // Counts are integers, so are the axis ticks.
      const { ticks } = scale;
      scale.ticks = (...a) => ticks.apply(scale, a).filter(Number.isInteger);
      return scale;
    }

    draw() {
      super.draw();
      // draw() can be called before the constructor has finished.
      if (!this.tilesetInfo || !this._xScale || !this.legendGraphics) return;

      for (const tile of Object.values(this.fetchedTiles)) {
        tile.graphics?.clear();
        if (tile.letters) tile.letters.visible = false;
      }

      this.mode = this.isSequenceMode() ? 'sequence' : 'bars';
      if (this.mode === 'sequence') this.drawSequence();
      else this.drawBars();
      this.drawLegend();
    }

    drawBars() {
      this.valueScale = this.makeCountScale(this.maxVisibleTotal());
      this.drawAxis(this.valueScale);

      this.drawnRects = [];
      this.drawnLetters = [];
      for (const tile of this.tilesToDraw()) {
        const rects = barRects(
          this.getBins(tile),
          tile.tileData.start,
          this._xScale,
          this.valueScale,
        );
        this.fillRects(tile.graphics, rects);
        this.drawnRects.push(...rects);
      }
    }

    drawSequence() {
      this.axis.clearAxis();
      this.valueScale = null;

      const range = this._xScale.domain();
      const baseWidth = this._xScale(range[0] + 1) - this._xScale(range[0]);
      const rowHeight = (this.dimensions[1] - ROW_GAP) / 2;
      this.letterScale = Math.min(
        1,
        (baseWidth - 2) / this.maxLetterWidth,
        (rowHeight - 2) / this.maxLetterHeight,
      );
      const letters = this.letterScale >= MIN_LETTER_SCALE;

      this.drawnRects = [];
      this.drawnLetters = [];
      for (const tile of this.tilesToDraw()) {
        const layout = sequenceLayout({
          ...tile.tileData,
          range,
          xScale: this._xScale,
          height: this.dimensions[1],
          onlyPass: this.options.onlyPass,
          letters,
        });
        this.fillRects(tile.graphics, layout.rects);
        this.placeLetters(tile.letters, layout.letters);
        this.drawnRects.push(...layout.rects);
        this.drawnLetters.push(...layout.letters);
      }
    }

    fillRects(graphics, rects) {
      for (const { x, y, w, h, color } of rects) {
        graphics.beginFill(colorToHex(color));
        graphics.drawRect(x, y, w, h);
        graphics.endFill();
      }
    }

    placeLetters(container, letters) {
      container.visible = true;
      const sprites = container.children;
      letters.forEach(({ x, y, char, color }, i) => {
        const texture = (this.letterTexts[char] ?? this.letterTexts.N).texture;
        let sprite = sprites[i];
        if (!sprite) {
          sprite = new PIXI.Sprite(texture);
          sprite.anchor.set(0.5);
          container.addChild(sprite);
        }
        sprite.scale.set(this.letterScale / LETTER_TEXTURE_SCALE);
        sprite.texture = texture;
        sprite.tint = colorToHex(color);
        sprite.position.set(x, y);
        sprite.visible = true;
      });
      for (let i = letters.length; i < sprites.length; i++) {
        sprites[i].visible = false;
      }
    }

    /** Legend entries: the SBS classes, plus "Other" if there are any. */
    legendItems() {
      const hasOther = this.visibleAndFetchedTiles().some((tile) =>
        this.getBins(tile).counts.some((c) => c[c.length - 1]),
      );
      return MUTATION_CLASSES.filter(
        (_, i) => hasOther || i < MUTATION_CLASSES.length - 1,
      );
    }

    drawLegend() {
      const graphics = this.legendGraphics;
      graphics.clear();
      for (const text of this.legendTexts) text.visible = false;
      this.legendLayout = [];
      if (this.mode !== 'bars' || !this.options.showLegend) return;

      let x = 4;
      this.legendItems().forEach(({ name, color }, i) => {
        let text = this.legendTexts[i];
        if (!text) {
          text = new PIXI.Text('', {
            fontSize: `${LEGEND_FONT_SIZE}px`,
            fontFamily: 'Arial',
            fill: 0x333333,
          });
          text.anchor.set(0, 0.5);
          graphics.addChild(text);
          this.legendTexts.push(text);
        }
        text.text = name;
        text.visible = true;
        text.position.set(x + 12, LEGEND_Y);

        graphics.beginFill(colorToHex(color));
        graphics.drawRect(x, LEGEND_Y - 4, 8, 8);
        graphics.endFill();
        this.legendLayout.push({ x, name, color });

        x += 12 + text.width + 8;
      });
    }

    /** Absolute position to "chr1:1,234" (1-based). */
    formatPosition(absPos) {
      const [chr, pos] = absToChr(absPos, this.chromInfo) ?? ['?', absPos];
      return `${chr}:${(pos + 1).toLocaleString('en-US')}`;
    }

    getMouseOverHtml(trackX, trackY) {
      if (!this.tilesetInfo || !this._xScale) return '';
      const absX = this._xScale.invert(trackX);
      const tileWidth = this.tilesetInfo.max_width / 2 ** this.zoomLevel;
      const tile =
        this.fetchedTiles[`${this.zoomLevel}.${Math.floor(absX / tileWidth)}`];
      if (!tile?.tileData) return '';

      return this.mode === 'sequence'
        ? this.sequenceMouseOver(tile, Math.floor(absX), trackY)
        : this.barMouseOver(tile, absX, trackY);
    }

    barMouseOver(tile, absX, trackY) {
      const { binSize, counts, totals } = this.getBins(tile);
      const bin = Math.floor((absX - tile.tileData.start) / binSize);
      const total = totals[bin];
      if (!total || trackY < this.valueScale(total) - 2) return '';

      const binStart = tile.tileData.start + bin * binSize;
      const rows = counts[bin]
        .map((count, cls) =>
          count
            ? `<div>${swatch(MUTATION_CLASSES[cls].color)}${escapeHtml(MUTATION_CLASSES[cls].name)}: ${count}</div>`
            : '',
        )
        .join('');
      return (
        `<div><b>${escapeHtml(this.formatPosition(binStart))} – ${escapeHtml(this.formatPosition(binStart + binSize - 1))}</b></div>` +
        `<div>${total} variant${total === 1 ? '' : 's'}</div>${rows}`
      );
    }

    sequenceMouseOver(tile, pos, trackY) {
      const { start, sequence, variants } = tile.tileData;
      const shown = variants.filter(
        (v) =>
          v.start <= pos && pos < v.end && (!this.options.onlyPass || v.pass),
      );
      const ref = sequence?.[pos - start];
      if (!ref && !shown.length) return '';

      let html = `<div><b>${escapeHtml(this.formatPosition(pos))}</b></div>`;
      if (ref) html += `<div>Reference: ${escapeHtml(ref)}</div>`;
      for (const variant of shown) {
        html += this.variantHtml(variant);
      }
      return html;
    }

    variantHtml(variant) {
      const { color, name } = MUTATION_CLASSES[variant.cls];
      const details = variant.details();
      const info = Object.entries(details.INFO ?? {})
        .map(([key, value]) =>
          value === true
            ? escapeHtml(key)
            : `${escapeHtml(key)}=${escapeHtml([].concat(value).join(','))}`,
        )
        .join('<br>');
      const field = (label, value) =>
        value !== undefined && value !== null && value !== ''
          ? `<div>${label}: ${escapeHtml(value)}</div>`
          : '';

      return [
        '<hr style="margin:4px 0">',
        `<div>${swatch(color)}<b>${escapeHtml(variant.ref)} &gt; ${escapeHtml(variant.alt)}</b> (${escapeHtml(name)})</div>`,
        field('ID', details.ID?.join(',')),
        field('Filter', [].concat(details.FILTER ?? variant.filter).join(',')),
        field('Qual', details.QUAL),
        info ? `<div style="font-size:11px;margin-top:2px">${info}</div>` : '',
      ].join('');
    }

    remove() {
      for (const text of Object.values(this.letterTexts)) text.destroy(true);
      for (const tile of Object.values(this.fetchedTiles))
        this.destroyTile(tile);
      this.legendGraphics.destroy({ children: true });
      super.remove();
    }

    exportSVG() {
      const [base, track] = super.exportSVG();

      const output = document.createElement('g');
      output.setAttribute(
        'transform',
        `translate(${this.position[0]},${this.position[1]})`,
      );
      track.appendChild(output);

      for (const { x, y, w, h, color } of this.drawnRects) {
        const rect = document.createElement('rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', w);
        rect.setAttribute('height', h);
        rect.setAttribute('fill', color);
        output.appendChild(rect);
      }

      const text = (x, y, content, color, anchor = 'middle') => {
        const t = document.createElement('text');
        t.setAttribute('x', x);
        t.setAttribute('y', y);
        t.setAttribute('text-anchor', anchor);
        t.setAttribute('dominant-baseline', 'central');
        t.setAttribute('font-family', LETTER_FONT_FAMILY);
        t.setAttribute('fill', color);
        t.textContent = content;
        output.appendChild(t);
        return t;
      };

      for (const { x, y, char, color } of this.drawnLetters) {
        const t = text(x, y, char, color);
        t.setAttribute('font-size', `${LETTER_FONT_SIZE * this.letterScale}px`);
        t.setAttribute('font-weight', 'bold');
      }

      for (const { x, name, color } of this.legendLayout ?? []) {
        const rect = document.createElement('rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', LEGEND_Y - 4);
        rect.setAttribute('width', 8);
        rect.setAttribute('height', 8);
        rect.setAttribute('fill', color);
        output.appendChild(rect);
        const t = text(x + 12, LEGEND_Y, name, '#333333', 'start');
        t.setAttribute('font-size', `${LEGEND_FONT_SIZE}px`);
      }

      if (this.valueScale && this.options.axisPositionHorizontal) {
        const gAxis = document.createElement('g');
        gAxis.setAttribute(
          'transform',
          `translate(${this.axis.pAxis.position.x},${this.axis.pAxis.position.y})`,
        );
        // Same mapping as HiGlass' own 1D tracks.
        const position = this.options.axisPositionHorizontal;
        if (position === 'left') {
          gAxis.appendChild(
            this.axis.exportAxisLeftSVG(this.valueScale, this.dimensions[1]),
          );
        } else if (position === 'right') {
          gAxis.appendChild(
            this.axis.exportAxisRightSVG(this.valueScale, this.dimensions[1]),
          );
        }
        base.appendChild(gAxis);
      }

      return [base, track];
    }
  }

  return new SomaticVariantTrackClass(...args);
}

// Stacked bars in the mutation class colors.
const icon = `<svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><rect x="0.5" y="0.5" width="19" height="19" rx="3" fill="#ffffff" stroke="#999999"/><rect x="3" y="11" width="3" height="6" fill="#e62725"/><rect x="3" y="8" width="3" height="3" fill="#1ebff0"/><rect x="8.5" y="6" width="3" height="11" fill="#e62725"/><rect x="8.5" y="3" width="3" height="3" fill="#a1cf64"/><rect x="14" y="13" width="3" height="4" fill="#1ebff0"/></svg>`;

let thumbnail;

const booleanOptions = {
  yes: { name: 'Yes', value: true },
  no: { name: 'No', value: false },
};

SomaticVariantTrack.config = {
  type: 'smaht-somatic-variants',
  datatype: ['vcf'],
  // Needs a `data` config, so it can't be added without a dataset.
  local: false,
  orientation: '1d-horizontal',
  // Created lazily so that the module can be imported outside of a browser.
  get thumbnail() {
    if (thumbnail === undefined && typeof DOMParser !== 'undefined') {
      thumbnail = new DOMParser().parseFromString(
        icon,
        'text/xml',
      ).documentElement;
    }
    return thumbnail ?? null;
  },
  availableOptions: [
    'onlyPass',
    'barWidth',
    'showLegend',
    'axisPositionHorizontal',
    'labelPosition',
    'labelColor',
    'labelTextOpacity',
    'labelBackgroundOpacity',
    'backgroundColor',
    'trackBorderWidth',
    'trackBorderColor',
    'showMousePosition',
  ],
  optionsInfo: {
    onlyPass: {
      name: 'Only PASS Variants',
      inlineOptions: booleanOptions,
    },
    barWidth: {
      name: 'Bar Width',
      inlineOptions: Object.fromEntries(
        [2, 4, 8, 16, 32, 64].map((v) => [v, { name: `~${v}px`, value: v }]),
      ),
    },
    showLegend: {
      name: 'Show Legend',
      inlineOptions: booleanOptions,
    },
  },
  defaultOptions: {
    onlyPass: false,
    barWidth: 8,
    showLegend: true,
    axisPositionHorizontal: 'left',
    labelPosition: 'topRight',
    labelColor: 'black',
    labelTextOpacity: 0.4,
    labelBackgroundOpacity: 0.6,
    backgroundColor: 'white',
    trackBorderWidth: 0,
    trackBorderColor: 'black',
    showMousePosition: false,
  },
};

export default SomaticVariantTrack;
