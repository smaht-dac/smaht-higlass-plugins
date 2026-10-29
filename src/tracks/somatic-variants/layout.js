// Pure layout functions shared by the PIXI rendering and the SVG export.
// Coordinates are relative to the track's top left corner.

import { MUTATION_CLASSES, OTHER_CLASS } from '../../utils/mutationTypes';

/** IGV-like nucleotide colors. */
export const BASE_COLORS = {
  A: '#22ca03',
  C: '#0000c7',
  G: '#f6af08',
  T: '#c40003',
  N: '#808080',
};
const UNKNOWN_BASE_COLOR = BASE_COLORS.N;

/** Bases in the sample row without a variant. */
export const MUTED_BASE_COLOR = '#eeeeee';
export const MUTED_LETTER_COLOR = '#b0b0b0';
export const LETTER_COLOR = '#ffffff';

/** Gap between the reference and the sample row (pixels). */
export const ROW_GAP = 2;

const baseColor = (base) => BASE_COLORS[base] ?? UNKNOWN_BASE_COLOR;

const isShown = (variant, onlyPass) => !onlyPass || variant.pass;

/**
 * Counts variants per bin and mutation class. Only variants that start in
 * `[start, end)` are counted.
 *
 * @param {Array<{ start: number, cls: number, pass: boolean }>} variants
 * @param {number} start - Absolute start of the binned range
 * @param {number} end - Absolute end of the binned range
 * @param {number} nBins
 * @param {{ onlyPass?: boolean }} [options]
 * @returns {{ binSize: number, counts: number[][], totals: number[] }}
 */
export function binVariants(variants, start, end, nBins, { onlyPass } = {}) {
  const binSize = (end - start) / nBins;
  const counts = Array.from({ length: nBins }, () =>
    new Array(MUTATION_CLASSES.length).fill(0),
  );
  const totals = new Array(nBins).fill(0);

  for (const variant of variants) {
    if (variant.start < start || variant.start >= end) continue;
    if (!isShown(variant, onlyPass)) continue;
    const bin = Math.floor((variant.start - start) / binSize);
    counts[bin][variant.cls] += 1;
    totals[bin] += 1;
  }
  return { binSize, counts, totals };
}

/**
 * Stacked bars, one per non-empty bin, with one block per mutation class.
 *
 * @param {{ binSize: number, counts: number[][] }} bins
 * @param {number} start - Absolute start of the first bin
 * @param {(x: number) => number} xScale - Absolute position to pixels
 * @param {(value: number) => number} valueScale - Count to pixels from the top
 * @returns {Array<{ x: number, y: number, w: number, h: number, color: string }>}
 */
export function barRects({ binSize, counts }, start, xScale, valueScale) {
  const rects = [];
  counts.forEach((binCounts, i) => {
    const x0 = xScale(start + i * binSize);
    const x1 = xScale(start + (i + 1) * binSize);
    // Leave a 1 px gap between bars that are wide enough.
    const w = Math.max(x1 - x0 - (x1 - x0 > 3 ? 1 : 0), 1);

    let total = 0;
    binCounts.forEach((count, cls) => {
      if (!count) return;
      const y0 = valueScale(total);
      total += count;
      const y1 = valueScale(total);
      rects.push({
        x: x0,
        y: y1,
        w,
        h: y0 - y1,
        color: MUTATION_CLASSES[cls].color,
      });
    });
  });
  return rects;
}

/**
 * Reference row (top) and sample row (bottom) for a range of bases.
 *
 * The reference row shows the reference bases. The sample row shows the same
 * bases greyed out, except at variant positions: SNVs show the ALT base in its
 * color, other variants (indels, MNVs) color their REF span with the "Other"
 * mutation color. Without a reference sequence, only variant positions are
 * drawn and the reference bases come from the VCF.
 *
 * @param {object} params
 * @param {number} params.start - Absolute start of the tile, i.e. of `sequence[0]`
 * @param {number} params.end - Absolute end of the tile
 * @param {string} [params.sequence] - Reference sequence of the tile
 * @param {Array<{ start: number, end: number, ref: string, alt: string, cls: number, pass: boolean }>} params.variants
 * @param {[number, number]} params.range - Absolute range to lay out
 * @param {(x: number) => number} params.xScale - Absolute position to pixels
 * @param {number} params.height - Track height
 * @param {boolean} [params.onlyPass]
 * @param {boolean} [params.letters] - Whether to add letters
 */
export function sequenceLayout({
  start,
  end,
  sequence,
  variants,
  range,
  xScale,
  height,
  onlyPass = false,
  letters = false,
}) {
  const rowHeight = Math.max((height - ROW_GAP) / 2, 1);
  const rows = [0, rowHeight + ROW_GAP];
  const from = Math.max(Math.floor(range[0]), start);
  const to = Math.min(
    Math.ceil(range[1]),
    sequence ? start + sequence.length : end,
  );

  // Variant (and REF base) by absolute position, first ALT allele wins.
  const variantAt = new Map();
  for (const variant of variants) {
    if (!isShown(variant, onlyPass)) continue;
    for (let pos = variant.start; pos < variant.end; pos++) {
      if (pos >= from && pos < to && !variantAt.has(pos)) {
        variantAt.set(pos, variant);
      }
    }
  }

  const rects = [];
  const chars = [];
  const add = (pos, row, char, fill, letterColor) => {
    const x = xScale(pos);
    const w = xScale(pos + 1) - x;
    const y = rows[row];
    // Separate the bases with a 1 px gap once they are wide enough.
    rects.push({ x, y, w: w > 5 ? w - 1 : w, h: rowHeight, color: fill });
    if (letters) {
      chars.push({
        x: x + w / 2,
        y: y + rowHeight / 2,
        char,
        color: letterColor,
      });
    }
  };

  const positions = sequence
    ? Array.from({ length: Math.max(to - from, 0) }, (_, i) => from + i)
    : [...variantAt.keys()].sort((a, b) => a - b);

  for (const pos of positions) {
    const variant = variantAt.get(pos);
    const ref = sequence
      ? sequence[pos - start]
      : variant.ref[pos - variant.start].toUpperCase();

    add(pos, 0, ref, baseColor(ref), LETTER_COLOR);

    if (!variant) {
      add(pos, 1, ref, MUTED_BASE_COLOR, MUTED_LETTER_COLOR);
    } else if (variant.cls === OTHER_CLASS) {
      add(pos, 1, ref, MUTATION_CLASSES[OTHER_CLASS].color, LETTER_COLOR);
    } else {
      const alt = variant.alt.toUpperCase();
      add(pos, 1, alt, baseColor(alt), LETTER_COLOR);
    }
  }

  return { rects, letters: chars, rowHeight };
}
