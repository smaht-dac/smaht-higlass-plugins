import { describe, expect, it } from 'vitest';

import {
  BASE_COLORS,
  LETTER_COLOR,
  MUTED_BASE_COLOR,
  MUTED_LETTER_COLOR,
  ROW_GAP,
  barRects,
  binVariants,
  sequenceLayout,
} from '../../src/tracks/somatic-variants/layout';
import { MUTATION_CLASSES, mutationClass } from '../../src/utils/mutationTypes';

const variant = (start, ref, alt, pass = true) => ({
  start,
  end: start + ref.length,
  ref,
  alt,
  pass,
  cls: mutationClass(ref, alt),
});

const CT = MUTATION_CLASSES[2];
const TC = MUTATION_CLASSES[4];
const OTHER = MUTATION_CLASSES[6];

describe('binVariants', () => {
  const variants = [
    variant(5, 'C', 'T'),
    variant(15, 'G', 'A'),
    variant(18, 'A', 'G', false),
    variant(40, 'AT', 'A'),
    variant(100, 'C', 'T'),
  ];

  it('counts variants per bin and mutation class', () => {
    const { binSize, counts, totals } = binVariants(variants, 0, 100, 10);
    expect(binSize).toBe(10);
    expect(totals).toEqual([1, 2, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(counts[1][2]).toBe(1); // G>A counts as C>T
    expect(counts[1][4]).toBe(1); // A>G counts as T>C
    expect(counts[4][6]).toBe(1); // deletion
  });

  it('only counts PASS variants if asked to', () => {
    const { totals } = binVariants(variants, 0, 100, 10, { onlyPass: true });
    expect(totals).toEqual([1, 1, 0, 0, 1, 0, 0, 0, 0, 0]);
  });

  it('ignores variants outside of the range', () => {
    const { totals } = binVariants(variants, 10, 20, 1);
    expect(totals).toEqual([2]);
  });
});

describe('barRects', () => {
  it('stacks one block per mutation class', () => {
    const bins = binVariants(
      [variant(1, 'C', 'T'), variant(2, 'C', 'T'), variant(3, 'T', 'C')],
      0,
      20,
      2,
    );
    // 10 px per bin, 10 px per count, bars grow up from y = 100.
    const rects = barRects(
      bins,
      0,
      (x) => x,
      (v) => 100 - 10 * v,
    );
    expect(rects).toEqual([
      { x: 0, y: 80, w: 9, h: 20, color: CT.color },
      { x: 0, y: 70, w: 9, h: 10, color: TC.color },
    ]);
  });
});

describe('sequenceLayout', () => {
  const xScale = (x) => x * 10;
  const base = {
    start: 100,
    end: 110,
    range: [100, 110],
    xScale,
    height: 42,
    letters: true,
  };
  const rowHeight = (42 - ROW_GAP) / 2;
  const sampleRow = (layout) =>
    layout.rects.filter((r) => r.y > 0).map((r) => r.color);
  const sampleLetters = (layout) =>
    layout.letters.filter((l) => l.y > rowHeight).map((l) => l.char);

  it('shows the reference and the greyed out sample sequence', () => {
    const layout = sequenceLayout({
      ...base,
      sequence: 'ACGTACGTAC',
      variants: [],
    });
    expect(layout.rects).toHaveLength(20);
    expect(layout.rects[0]).toEqual({
      x: 1000,
      y: 0,
      w: 9,
      h: rowHeight,
      color: BASE_COLORS.A,
    });
    expect(layout.letters[0]).toEqual({
      x: 1005,
      y: rowHeight / 2,
      char: 'A',
      color: LETTER_COLOR,
    });
    expect(new Set(sampleRow(layout))).toEqual(new Set([MUTED_BASE_COLOR]));
    expect(
      new Set(
        layout.letters.filter((l) => l.y > rowHeight).map((l) => l.color),
      ),
    ).toEqual(new Set([MUTED_LETTER_COLOR]));
  });

  it('colors the ALT base of SNVs and the REF span of other variants', () => {
    const layout = sequenceLayout({
      ...base,
      sequence: 'ACGTACGTAC',
      variants: [variant(101, 'C', 'T'), variant(104, 'AC', 'A')],
    });
    expect(sampleLetters(layout)).toEqual([
      'A',
      'T',
      'G',
      'T',
      'A',
      'C',
      'G',
      'T',
      'A',
      'C',
    ]);
    expect(sampleRow(layout).slice(0, 6)).toEqual([
      MUTED_BASE_COLOR,
      BASE_COLORS.T,
      MUTED_BASE_COLOR,
      MUTED_BASE_COLOR,
      OTHER.color,
      OTHER.color,
    ]);
  });

  it('hides non-PASS variants if asked to', () => {
    const layout = sequenceLayout({
      ...base,
      sequence: 'ACGTACGTAC',
      variants: [variant(101, 'C', 'T', false)],
      onlyPass: true,
    });
    expect(new Set(sampleRow(layout))).toEqual(new Set([MUTED_BASE_COLOR]));
  });

  it('only lays out the visible bases of the tile', () => {
    const layout = sequenceLayout({
      ...base,
      range: [107.5, 200],
      sequence: 'ACGTACGTAC',
      variants: [],
    });
    expect(layout.rects.map((r) => r.x)).toEqual([
      1070, 1070, 1080, 1080, 1090, 1090,
    ]);
  });

  it('shows only the variants without a reference sequence', () => {
    const layout = sequenceLayout({
      ...base,
      variants: [variant(103, 'G', 'A'), variant(120, 'C', 'T')],
    });
    expect(layout.rects).toEqual([
      { x: 1030, y: 0, w: 9, h: rowHeight, color: BASE_COLORS.G },
      {
        x: 1030,
        y: rowHeight + ROW_GAP,
        w: 9,
        h: rowHeight,
        color: BASE_COLORS.A,
      },
    ]);
  });

  it('can leave out the letters', () => {
    const layout = sequenceLayout({
      ...base,
      sequence: 'ACGTACGTAC',
      variants: [],
      letters: false,
    });
    expect(layout.letters).toEqual([]);
  });
});
