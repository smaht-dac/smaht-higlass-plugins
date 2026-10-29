import { BgzipIndexedFasta, IndexedFasta } from '@gmod/indexedfasta';
import { RemoteFile } from 'generic-filehandle2';

/**
 * @param {{ fastaUrl: string, faiUrl?: string, gziUrl?: string }} urls
 */
export function openFasta({ fastaUrl, faiUrl, gziUrl }) {
  const fasta = new RemoteFile(fastaUrl);
  const fai = new RemoteFile(faiUrl ?? `${fastaUrl}.fai`);
  return gziUrl
    ? new BgzipIndexedFasta({ fasta, fai, gzi: new RemoteFile(gziUrl) })
    : new IndexedFasta({ fasta, fai });
}

/**
 * Reference sequence for the absolute range `[start, end)`. Ranges that span
 * several chromosomes are joined. Positions that the FASTA doesn't have
 * (unknown or shorter chromosomes) are filled with `N`, so the result always
 * has one character per base of the range that lies within the genome.
 *
 * @param {{ getSequence: (chr: string, min: number, max: number) => Promise<string | undefined> }} fasta
 * @param {{ cumPositions: Array<{ chr: string, pos: number }>, chromLengths: Record<string, number>, totalLength: number }} chromInfo
 * @param {number} start
 * @param {number} end
 */
export async function fetchSequence(fasta, chromInfo, start, end) {
  const pieces = [];
  for (const { chr, pos } of chromInfo.cumPositions) {
    const chrEnd = pos + chromInfo.chromLengths[chr];
    if (chrEnd <= start) continue;
    if (pos >= end) break;

    const from = Math.max(start, pos) - pos;
    const to = Math.min(end, chrEnd) - pos;
    pieces.push(
      fasta
        .getSequence(chr, from, to)
        .then((seq = '') => seq.toUpperCase().padEnd(to - from, 'N')),
    );
  }
  return (await Promise.all(pieces)).join('');
}
