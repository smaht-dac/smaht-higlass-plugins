import { fetchSequence, openFasta } from './sequence';
import { fetchVcfText, parseVcf, variantsInRange } from './vcf';

const TILE_SIZE = 1024;

// Shared by all fetcher instances, so that tracks and views showing the same
// files download and parse them only once.
const cache = new Map();

function cached(key, load) {
  if (!cache.has(key)) {
    cache.set(
      key,
      load().catch((error) => {
        cache.delete(key);
        throw error;
      }),
    );
  }
  return cache.get(key);
}

/** Clears the download cache (used by the tests). */
export function clearCache() {
  cache.clear();
}

/**
 * HiGlass data fetcher for a small VCF of somatic variants that is loaded
 * completely in the browser, plus an optional indexed FASTA reference.
 *
 * Track data config:
 * ```
 * {
 *   type: 'smaht-somatic-vcf',
 *   vcfUrl,          // .vcf, .vcf.gz (bgzip or gzip)
 *   chromSizesUrl,   // same assembly and chromosome order as the view
 *   fastaUrl,        // optional reference sequence
 *   faiUrl,          // optional, defaults to `${fastaUrl}.fai`
 *   gziUrl,          // only for bgzipped FASTA files
 * }
 * ```
 *
 * Tiles contain the variants that overlap them. Tiles at the highest zoom level
 * (1024 bp) also contain the reference `sequence` when a FASTA is configured.
 */
export default class SomaticVcfDataFetcher {
  constructor(HGC, dataConfig) {
    this.dataConfig = dataConfig;
    this.tilesetInfoLoading = true;
    this.ready = this.load(HGC.services.chromInfo);
    // Errors are reported through tilesetInfo().
    this.ready.catch(() => {});
  }

  async load(chromInfoService) {
    const { vcfUrl, chromSizesUrl, fastaUrl } = this.dataConfig;
    if (!vcfUrl || !chromSizesUrl) {
      throw new Error('The track data needs a vcfUrl and a chromSizesUrl');
    }

    const chromInfo = await cached(`chromsizes:${chromSizesUrl}`, async () => {
      const info = await chromInfoService.get(chromSizesUrl);
      if (!info) throw new Error(`Could not load ${chromSizesUrl}`);
      return info;
    });

    const vcf = await cached(`vcf:${vcfUrl}:${chromSizesUrl}`, async () => {
      const text = await fetchVcfText(vcfUrl).catch((error) => {
        throw new Error(`Could not load ${vcfUrl}: ${error.message}`);
      });
      const parsed = parseVcf(text, chromInfo);
      if (parsed.skippedContigs.length) {
        console.warn(
          `${vcfUrl}: skipped variants on contigs that are not in ${chromSizesUrl}:`,
          parsed.skippedContigs.join(', '),
        );
      }
      return parsed;
    });

    const fasta = fastaUrl
      ? await cached(`fasta:${fastaUrl}`, async () =>
          openFasta(this.dataConfig),
        )
      : null;

    const maxZoom = Math.max(
      0,
      Math.ceil(Math.log2(chromInfo.totalLength / TILE_SIZE)),
    );

    const tilesetInfo = {
      tile_size: TILE_SIZE,
      bins_per_dimension: TILE_SIZE,
      max_zoom: maxZoom,
      max_width: TILE_SIZE * 2 ** maxZoom,
      min_pos: [0],
      max_pos: [chromInfo.totalLength],
      chromsizes: chromInfo.cumPositions.map(({ chr }) => [
        chr,
        chromInfo.chromLengths[chr],
      ]),
    };

    return { chromInfo, vcf, fasta, tilesetInfo };
  }

  tilesetInfo(callback) {
    return this.ready.then(
      ({ tilesetInfo }) => {
        this.tilesetInfoLoading = false;
        callback?.(tilesetInfo);
        return tilesetInfo;
      },
      (error) => {
        this.tilesetInfoLoading = false;
        const info = { error: error.message };
        callback?.(info);
        return info;
      },
    );
  }

  async fetchTilesDebounced(receivedTiles, tileIds) {
    const data = await this.ready;
    const tiles = await Promise.all(tileIds.map((id) => this.tile(data, id)));
    receivedTiles(Object.fromEntries(tileIds.map((id, i) => [id, tiles[i]])));
  }

  async tile({ chromInfo, vcf, fasta, tilesetInfo }, tileId) {
    const [z, x] = tileId.split('.').map(Number);
    const tileWidth = tilesetInfo.max_width / 2 ** z;
    const start = x * tileWidth;
    const end = start + tileWidth;

    const tile = {
      tilePositionId: tileId,
      zoomLevel: z,
      tilePos: [x],
      start,
      end,
      // Includes variants that start in an earlier tile but reach into this one.
      variants: variantsInRange(
        vcf.variants,
        start - vcf.maxRefLength + 1,
        end,
      ),
    };

    if (fasta && z === tilesetInfo.max_zoom) {
      try {
        tile.sequence = await fetchSequence(fasta, chromInfo, start, end);
      } catch (error) {
        if (!this.sequenceErrorShown) {
          this.sequenceErrorShown = true;
          console.warn(
            `Could not load the reference sequence from ${this.dataConfig.fastaUrl}:`,
            error,
          );
        }
      }
    }
    return tile;
  }
}

SomaticVcfDataFetcher.config = { type: 'smaht-somatic-vcf' };
