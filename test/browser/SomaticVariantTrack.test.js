import { viewer } from 'higlass';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerPlugins } from '../../src';
import { clearCache } from '../../src/data-fetchers/somatic-vcf/SomaticVcfDataFetcher';
import { BASE_COLORS } from '../../src/tracks/somatic-variants/layout';
import { MUTATION_CLASSES } from '../../src/utils/mutationTypes';

const FIXTURES = '/test/fixtures';
const VIEW_UID = 'view';
const TRACK_UID = 'somatic';

const viewConfig = (options = {}) => ({
  editable: false,
  views: [
    {
      uid: VIEW_UID,
      layout: { w: 12, h: 6, x: 0, y: 0 },
      initialXDomain: [0, 4000],
      chromInfoPath: `${FIXTURES}/chrom.sizes`,
      tracks: {
        top: [
          {
            uid: TRACK_UID,
            type: 'smaht-somatic-variants',
            height: 100,
            data: {
              type: 'smaht-somatic-vcf',
              vcfUrl: `${FIXTURES}/variants.vcf`,
              chromSizesUrl: `${FIXTURES}/chrom.sizes`,
              fastaUrl: `${FIXTURES}/ref.fa`,
            },
            options,
          },
        ],
      },
    },
  ],
});

// React 18 warnings that HiGlass 2.x itself logs.
const KNOWN_HIGLASS_ERRORS = [
  /importing createRoot from "react-dom"/,
  /ReactDOM.render is no longer supported/,
];

let api = null;
let div = null;
let errorSpy = null;

beforeEach(() => {
  clearCache();
  registerPlugins();
  errorSpy = vi.spyOn(console, 'error');
  // The fixture VCF has a variant on an unknown contig.
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  const errors = errorSpy.mock.calls.filter(
    ([msg]) => !KNOWN_HIGLASS_ERRORS.some((re) => re.test(String(msg))),
  );
  expect(errors).toEqual([]);

  api?.destroy();
  div?.remove();
  api = null;
  div = null;
  delete window.higlassTracksByType;
  delete window.higlassDataFetchersByType;
  vi.restoreAllMocks();
});

async function mount(options) {
  div = document.createElement('div');
  div.style.width = '800px';
  div.style.height = '300px';
  document.body.appendChild(div);
  api = await viewer(div, viewConfig(options), { bounded: true });
}

const getTrack = () => {
  const track = api.getTrackObject(VIEW_UID, TRACK_UID);
  return track?.originalTrack ?? track;
};

/** Waits until the track is drawn in the given mode. */
const drawn = (mode, check = () => true) =>
  vi.waitFor(
    () => {
      const track = getTrack();
      if (track?.mode !== mode || !track.drawnRects.length || !check(track)) {
        throw new Error(`Track not drawn in ${mode} mode yet`);
      }
      return track;
    },
    { timeout: 10000 },
  );

const colors = (rects) => new Set(rects.map((r) => r.color));
const CT = MUTATION_CLASSES[2].color;

describe('SomaticVariantTrack in HiGlass', () => {
  it('shows stacked bars when zoomed out', { timeout: 20000 }, async () => {
    await mount();
    const track = await drawn('bars');

    expect(track.options.barWidth).toBe(8);
    expect(track.valueScale.domain()).toEqual([0, 2]);
    // 5 variants in 4 bins, the multi-allelic site has 2 blocks
    expect(track.drawnRects).toHaveLength(6);
    expect(colors(track.drawnRects)).toEqual(
      new Set(
        ['C>T', 'T>G', 'T>C', 'Other'].map(
          (name) => MUTATION_CLASSES.find((c) => c.name === name).color,
        ),
      ),
    );
    expect(track.legendLayout.map((l) => l.name)).toContain('Other');

    // Mouse over the C>T bar at chr1:100.
    const bar = track.drawnRects.find((r) => r.color === CT);
    const html = track.getMouseOverHtml(bar.x + 1, bar.y + 1);
    expect(html).toContain('1 variant');
    expect(html).toContain('C&gt;T: 1');
    expect(track.getMouseOverHtml(bar.x + 1, 1)).toBe('');
  });

  it('can hide non-PASS variants', { timeout: 20000 }, async () => {
    await mount({ onlyPass: true });
    const track = await drawn('bars');
    expect(track.drawnRects).toHaveLength(4);
  });

  it('shows the sequence when zoomed in', { timeout: 20000 }, async () => {
    await mount();
    await drawn('bars');

    // chr1:80-160, the C>T variant at chr1:100 is at 99.
    api.zoomTo(VIEW_UID, 80, 160, 80, 160, 0);
    const track = await drawn('sequence', (t) => t.drawnLetters.length);

    const rowHeight = track.dimensions[1] / 2;
    const at = (pos, row) =>
      track.drawnRects.find(
        (r) =>
          Math.abs(r.x - track._xScale(pos)) < 0.5 &&
          (row === 0 ? r.y === 0 : r.y > rowHeight / 2),
      );
    expect(at(99, 0).color).toBe(BASE_COLORS.C);
    expect(at(99, 1).color).toBe(BASE_COLORS.T);
    expect(at(98, 1).color).toBe('#eeeeee');

    const sampleLetters = track.drawnLetters.filter((l) => l.y > rowHeight);
    const letterAt = (pos) =>
      sampleLetters.find((l) => Math.abs(l.x - track._xScale(pos + 0.5)) < 0.5);
    expect(letterAt(99)).toMatchObject({ char: 'T', color: '#ffffff' });

    const html = track.getMouseOverHtml(
      track._xScale(99.5),
      track.dimensions[1] * 0.75,
    );
    expect(html).toContain('chr1:100');
    expect(html).toContain('Reference: C');
    expect(html).toContain('C &gt; T');
    expect(html).toContain('ID: rs1');
    expect(html).toContain('SOMATIC');

    const svg = await api.exportAsSvg();
    expect(svg).toContain(`fill="${BASE_COLORS.T}"`);
    expect(svg).toMatch(/>T<\/text>/);
  });
});
