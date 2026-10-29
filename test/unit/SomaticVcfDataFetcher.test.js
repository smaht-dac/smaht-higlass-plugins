// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SomaticVcfDataFetcher, {
  clearCache,
} from '../../src/data-fetchers/somatic-vcf/SomaticVcfDataFetcher';
import { fetchSequence } from '../../src/data-fetchers/somatic-vcf/sequence';
import { chromInfo, fixtureFetch, readFixture } from './helpers';

// The whole fixture genome as one string, in chrom.sizes order.
const genome = readFixture('ref.fa')
  .toString()
  .split('>')
  .slice(1)
  .map((record) => record.split('\n').slice(1).join(''))
  .join('');

const HGC = {
  services: {
    chromInfo: {
      get: async (url) => (url === '/chrom.sizes' ? chromInfo : null),
    },
  },
};

const dataConfig = {
  type: 'smaht-somatic-vcf',
  vcfUrl: '/variants.vcf',
  chromSizesUrl: '/chrom.sizes',
  fastaUrl: '/ref.fa',
};

const fetchTiles = (fetcher, ids) =>
  new Promise((resolve) => fetcher.fetchTilesDebounced(resolve, ids));

beforeEach(() => {
  clearCache();
  vi.stubGlobal('fetch', vi.fn(fixtureFetch()));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SomaticVcfDataFetcher', () => {
  it('has a plugin type', () => {
    expect(SomaticVcfDataFetcher.config.type).toBe('smaht-somatic-vcf');
  });

  it('provides 1D tileset info for the genome', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = new SomaticVcfDataFetcher(HGC, dataConfig);
    expect(fetcher.tilesetInfoLoading).toBe(true);

    const callback = vi.fn();
    const info = await fetcher.tilesetInfo(callback);
    expect(callback).toHaveBeenCalledWith(info);
    expect(fetcher.tilesetInfoLoading).toBe(false);
    expect(info).toEqual({
      tile_size: 1024,
      bins_per_dimension: 1024,
      max_zoom: 2,
      max_width: 4096,
      min_pos: [0],
      max_pos: [4000],
      chromsizes: [
        ['chr1', 2500],
        ['chr2', 1500],
      ],
    });
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('skipped variants'),
      'chrUn',
    );
  });

  it('returns the variants of each tile', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = new SomaticVcfDataFetcher(HGC, dataConfig);
    const tiles = await fetchTiles(fetcher, ['0.0', '1.1', '2.2']);

    expect(tiles['0.0']).toMatchObject({
      tilePositionId: '0.0',
      zoomLevel: 0,
      tilePos: [0],
      start: 0,
      end: 4096,
    });
    expect(tiles['0.0'].variants).toHaveLength(6);
    expect(tiles['0.0'].sequence).toBeUndefined();
    expect(tiles['1.1'].variants.map((v) => v.start)).toEqual([2549, 3899]);
    expect(tiles['2.2'].variants.map((v) => v.start)).toEqual([2549]);
  });

  it('adds the reference sequence to max zoom tiles', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = new SomaticVcfDataFetcher(HGC, dataConfig);
    const tiles = await fetchTiles(fetcher, ['2.0', '2.2', '2.3']);

    expect(tiles['2.0'].sequence).toBe(genome.slice(0, 1024));
    expect(tiles['2.0'].sequence[99]).toBe('C');
    // Spans the end of chr1 at 2500.
    expect(tiles['2.2'].sequence).toBe(genome.slice(2048, 3072));
    expect(tiles['2.2'].sequence.slice(2549 - 2048, 2551 - 2048)).toBe('AT');
    // Ends with the genome.
    expect(tiles['2.3'].sequence).toBe(genome.slice(3072));
    expect(tiles['2.3'].sequence).toHaveLength(928);
  });

  it('includes variants from earlier tiles that reach into a tile', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = new SomaticVcfDataFetcher(HGC, dataConfig);
    const info = await fetcher.tilesetInfo();
    // Tile 2.1 is [2550, 5100), which starts within the deletion at 2549.
    info.max_width = 2550 * 2 ** 2;
    const tiles = await fetchTiles(fetcher, ['2.1']);
    expect(tiles['2.1'].variants.map((v) => v.start)).toEqual([2549, 3899]);
  });

  it('downloads each file only once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await new SomaticVcfDataFetcher(HGC, dataConfig).tilesetInfo();
    await new SomaticVcfDataFetcher(HGC, dataConfig).tilesetInfo();
    const urls = fetch.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url === '/variants.vcf')).toHaveLength(1);
  });

  it('reports missing files as tileset info errors', async () => {
    const missingVcf = new SomaticVcfDataFetcher(HGC, {
      ...dataConfig,
      vcfUrl: '/missing.vcf',
    });
    expect(await missingVcf.tilesetInfo()).toEqual({
      error: 'Could not load /missing.vcf: 404 ',
    });

    const missingSizes = new SomaticVcfDataFetcher(HGC, {
      ...dataConfig,
      chromSizesUrl: '/missing.sizes',
    });
    expect(await missingSizes.tilesetInfo()).toEqual({
      error: 'Could not load /missing.sizes',
    });

    const noUrls = new SomaticVcfDataFetcher(HGC, {
      type: 'smaht-somatic-vcf',
    });
    expect((await noUrls.tilesetInfo()).error).toMatch(/vcfUrl/);
  });

  it('returns tiles without sequence if the FASTA fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = new SomaticVcfDataFetcher(HGC, {
      ...dataConfig,
      fastaUrl: '/missing.fa',
    });
    const tiles = await fetchTiles(fetcher, ['2.0', '2.1']);
    expect(tiles['2.0'].sequence).toBeUndefined();
    expect(tiles['2.0'].variants).toHaveLength(4);
    const fastaWarnings = warn.mock.calls.filter(([msg]) =>
      String(msg).includes('reference sequence'),
    );
    expect(fastaWarnings).toHaveLength(1);
  });
});

describe('fetchSequence', () => {
  it('fills positions that the FASTA does not have with N', async () => {
    const fasta = {
      getSequence: async (chr, min, max) =>
        chr === 'chr1' ? 'acgt'.repeat(1000).slice(min, max - 1) : undefined,
    };
    const sequence = await fetchSequence(fasta, chromInfo, 2496, 2504);
    expect(sequence).toBe('ACGNNNNN');
  });
});
