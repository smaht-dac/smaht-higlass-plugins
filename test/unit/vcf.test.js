// @vitest-environment node
import * as zlib from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchVcfText,
  lowerBound,
  parseVcf,
  variantsInRange,
} from '../../src/data-fetchers/somatic-vcf/vcf';
import { MUTATION_CLASSES } from '../../src/utils/mutationTypes';
import { bgzip, chromInfo, readFixture } from './helpers';

const vcf = readFixture('variants.vcf');
const className = (v) => MUTATION_CLASSES[v.cls].name;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseVcf', () => {
  const { variants, maxRefLength, skippedContigs } = parseVcf(
    vcf.toString(),
    chromInfo,
  );

  it('returns one variant per ALT allele, sorted by absolute position', () => {
    expect(variants.map((v) => [v.chrom, v.pos, v.start, v.alt])).toEqual([
      ['chr1', 100, 99, 'T'],
      ['chr1', 200, 199, 'A'],
      ['chr1', 300, 299, 'C'],
      ['chr1', 300, 299, 'G'],
      ['chr2', 50, 2549, 'A'],
      ['chr2', 1400, 3899, 'T'],
    ]);
  });

  it('classifies the mutations', () => {
    expect(variants.map(className)).toEqual([
      'C>T',
      'C>T',
      'T>G',
      'T>C',
      'Other',
      'C>T',
    ]);
  });

  it('keeps the REF span, FILTER and record details', () => {
    const deletion = variants[4];
    expect(deletion.end - deletion.start).toBe(2);
    expect(maxRefLength).toBe(2);

    expect(variants.map((v) => v.pass)).toEqual([
      true,
      true,
      false,
      false,
      true,
      true,
    ]);

    const details = variants[0].details();
    expect(details.ID).toEqual(['rs1']);
    expect(details.QUAL).toBe(50);
    expect(details.INFO).toEqual({ DP: [10], SOMATIC: true });
    expect(variants[0].details()).toBe(details);
  });

  it('matches contigs with and without "chr" and skips unknown ones', () => {
    expect(variants[2].chrom).toBe('chr1');
    expect(skippedContigs).toEqual(['chrUn']);
  });

  it('rejects files without a #CHROM header', () => {
    expect(() => parseVcf('chr1\t1\t.\tA\tC\n', chromInfo)).toThrow(/#CHROM/);
  });
});

describe('variantsInRange', () => {
  const { variants } = parseVcf(vcf.toString(), chromInfo);

  it('finds the variants that start in a range', () => {
    expect(lowerBound(variants, 0)).toBe(0);
    expect(lowerBound(variants, 200)).toBe(2);
    expect(lowerBound(variants, 5000)).toBe(variants.length);
    expect(variantsInRange(variants, 199, 300).map((v) => v.start)).toEqual([
      199, 299, 299,
    ]);
  });
});

describe('fetchVcfText', () => {
  const stubFetch = (body) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body)),
    );

  it.each([
    ['plain', vcf],
    ['gzip', zlib.gzipSync(vcf)],
    ['bgzip', bgzip(vcf)],
  ])('reads %s files', async (_, body) => {
    stubFetch(body);
    expect(await fetchVcfText('/x.vcf.gz')).toBe(vcf.toString());
  });

  it('reports HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404, statusText: 'Nope' })),
    );
    await expect(fetchVcfText('/missing.vcf')).rejects.toThrow('404 Nope');
  });
});
