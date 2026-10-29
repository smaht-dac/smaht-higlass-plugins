import VCF from '@gmod/vcf';

import { mutationClass } from '../../utils/mutationTypes';

/** One ALT allele of a VCF record, positioned on the absolute genome axis. */
class VcfVariant {
  constructor(fields) {
    Object.assign(this, fields);
  }

  /** Fully parsed record (INFO, QUAL, samples), only computed when needed. */
  details() {
    this._details ??= this.parser.parseLine(this.line);
    return this._details;
  }
}

async function gunzip(bytes) {
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Splits BGZF data into its blocks, which are complete gzip members. Returns
 * null for gzip data without BGZF block sizes.
 */
function bgzfBlocks(bytes) {
  const blocks = [];
  let offset = 0;
  while (offset < bytes.length) {
    const isBgzf =
      bytes[offset] === 0x1f &&
      bytes[offset + 1] === 0x8b &&
      bytes[offset + 3] & 4 && // FEXTRA
      bytes[offset + 12] === 0x42 && // 'B'
      bytes[offset + 13] === 0x43; // 'C'
    if (!isBgzf) return null;
    const blockSize = (bytes[offset + 16] | (bytes[offset + 17] << 8)) + 1;
    blocks.push(bytes.subarray(offset, offset + blockSize));
    offset += blockSize;
  }
  return blocks;
}

/**
 * Decompresses gzip or BGZF data with the browser's DecompressionStream, which
 * only reads the first member of multi-member gzip files such as BGZF.
 */
async function decompress(bytes) {
  const blocks = bgzfBlocks(bytes) ?? [bytes];
  const parts = await Promise.all(blocks.map(gunzip));
  const result = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/**
 * Downloads a VCF and decompresses it if it is bgzipped or gzipped. Servers
 * that already decoded a `.gz` file (Content-Encoding) are handled too, because
 * the gzip magic bytes are checked instead of the file name.
 *
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function fetchVcfText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    bytes = await decompress(bytes);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Finds the chromosome in `chromInfo` for a VCF contig name, also trying it
 * with and without a `chr` prefix (`1` <-> `chr1`, `MT` -> `chrM`).
 */
function resolveChrom(name, chrPositions) {
  if (chrPositions[name]) return name;
  const bare = name.replace(/^chr/i, '');
  const candidates = [bare, `chr${bare}`];
  if (bare === 'MT') candidates.push('chrM', 'M');
  return candidates.find((c) => chrPositions[c]);
}

/**
 * Parses a VCF into one variant per ALT allele, sorted by absolute position.
 * Absolute positions are 0-based (`chromOffset + POS - 1`), like other
 * HiGlass 1D tracks.
 *
 * @param {string} text - The whole VCF file
 * @param {{ chrPositions: Record<string, { pos: number }> }} chromInfo
 * @returns {{ variants: VcfVariant[], maxRefLength: number, skippedContigs: string[] }}
 */
export function parseVcf(text, chromInfo) {
  const lines = text.split(/\r?\n/);
  let headerEnd = 0;
  while (headerEnd < lines.length && lines[headerEnd].startsWith('#')) {
    headerEnd += 1;
  }
  if (!lines[headerEnd - 1]?.startsWith('#CHROM')) {
    throw new Error('Not a VCF file: the #CHROM header line is missing');
  }

  const parser = new VCF({ header: lines.slice(0, headerEnd).join('\n') });
  const variants = [];
  const skipped = new Set();
  let maxRefLength = 1;

  for (let i = headerEnd; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const [contig, posStr, id, ref, altStr, , filter] = line.split('\t', 7);
    const chrom = resolveChrom(contig, chromInfo.chrPositions);
    if (!chrom) {
      skipped.add(contig);
      continue;
    }

    maxRefLength = Math.max(maxRefLength, ref.length);
    const pos = +posStr;
    const start = chromInfo.chrPositions[chrom].pos + pos - 1;
    for (const alt of altStr.split(',')) {
      if (alt === '.' || alt === '*') continue;
      variants.push(
        new VcfVariant({
          chrom,
          pos,
          start,
          end: start + ref.length,
          id,
          ref,
          alt,
          filter,
          pass: filter === 'PASS' || filter === '.',
          cls: mutationClass(ref, alt),
          line,
          parser,
        }),
      );
    }
  }

  variants.sort((a, b) => a.start - b.start);
  return { variants, maxRefLength, skippedContigs: [...skipped] };
}

/**
 * Index of the first variant with `start >= position` (binary search).
 *
 * @param {Array<{ start: number }>} variants - Sorted by start
 * @param {number} position
 */
export function lowerBound(variants, position) {
  let lo = 0;
  let hi = variants.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (variants[mid].start < position) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Variants that start in `[start, end)`. */
export function variantsInRange(variants, start, end) {
  return variants.slice(lowerBound(variants, start), lowerBound(variants, end));
}
