import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

const FIXTURES = new URL('../fixtures/', import.meta.url);

export const readFixture = (name) => fs.readFileSync(new URL(name, FIXTURES));

/** Parses a chrom.sizes file like HiGlass' chromInfo service. */
export function parseChromSizes(text) {
  const cumPositions = [];
  const chrPositions = {};
  const chromLengths = {};
  let totalLength = 0;
  text
    .trim()
    .split('\n')
    .forEach((line, id) => {
      const [chr, length] = line.split('\t');
      const entry = { id, chr, pos: totalLength };
      cumPositions.push(entry);
      chrPositions[chr] = entry;
      chromLengths[chr] = +length;
      totalLength += +length;
    });
  return { cumPositions, chrPositions, chromLengths, totalLength };
}

export const chromInfo = parseChromSizes(readFixture('chrom.sizes').toString());

/** Minimal BGZF writer: gzip members with the BGZF extra field + EOF block. */
export function bgzip(data, blockSize = 200) {
  const block = (chunk) => {
    const cdata = zlib.deflateRawSync(chunk);
    const header = Buffer.from([
      31, 139, 8, 4, 0, 0, 0, 0, 0, 255, 6, 0, 66, 67, 2, 0, 0, 0,
    ]);
    header.writeUInt16LE(header.length + cdata.length + 8 - 1, 16);
    const footer = Buffer.alloc(8);
    footer.writeUInt32LE(zlib.crc32(chunk), 0);
    footer.writeUInt32LE(chunk.length, 4);
    return Buffer.concat([header, cdata, footer]);
  };
  const blocks = [];
  for (let i = 0; i < data.length; i += blockSize) {
    blocks.push(block(data.subarray(i, i + blockSize)));
  }
  blocks.push(block(Buffer.alloc(0)));
  return Buffer.concat(blocks);
}

/**
 * Stubs `fetch` with files from `test/fixtures/` (by URL path), including
 * HTTP range requests as used by the indexed FASTA reader.
 *
 * @param {Record<string, Buffer>} [extra] - Additional files by URL path
 */
export function fixtureFetch(extra = {}) {
  return async (url, options = {}) => {
    const path = new URL(url, 'http://test/').pathname;
    let body = extra[path];
    if (!body) {
      try {
        body = readFixture(path.replace(/^\//, ''));
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }
    const range = new Headers(options.headers).get('range');
    if (range) {
      const [, start, end] = range.match(/bytes=(\d+)-(\d+)/).map(Number);
      return new Response(body.subarray(start, end + 1), {
        status: 206,
        headers: {
          'content-range': `bytes ${start}-${end}/${body.length}`,
        },
      });
    }
    return new Response(body);
  };
}
