// Writes demo/data/synthetic-somatic.vcf.gz: random somatic SNVs on hg38 with
// the same INFO/FORMAT fields as the SMaHT somatic VCFs, but no real data.
// REF bases are read from the public hg38 FASTA, so they match the reference
// sequence shown in the demo.
//
// Usage: node demo/data/make-synthetic-vcf.mjs

import * as fs from 'node:fs';
import * as zlib from 'node:zlib';

const FASTA_URL =
  'https://aveit.s3.amazonaws.com/higlass/data/sequence/hg38.fa';
const OUTPUT = new URL('./synthetic-somatic.vcf.gz', import.meta.url);

const CHROMS = [
  ['chr1', 248956422],
  ['chr2', 242193529],
  ['chr3', 198295559],
  ['chr4', 190214555],
  ['chr5', 181538259],
  ['chr6', 170805979],
  ['chr7', 159345973],
  ['chr8', 145138636],
  ['chr9', 138394717],
  ['chr10', 133797422],
  ['chr11', 135086622],
  ['chr12', 133275309],
  ['chr13', 114364328],
  ['chr14', 107043718],
  ['chr15', 101991189],
  ['chr16', 90338345],
  ['chr17', 83257441],
  ['chr18', 80373285],
  ['chr19', 58617616],
  ['chr20', 64444167],
  ['chr21', 46709983],
  ['chr22', 50818468],
  ['chrX', 156040895],
  ['chrY', 57227415],
  ['chrM', 16569],
];

const SAMPLES = ['SAMPLE_A', 'SAMPLE_B'];
const TISSUES = ['TISSUE_A', 'TISSUE_B', 'TISSUE_C', 'TISSUE_D', 'TISSUE_E'];
const CALLERS = ['RUFUS', 'Strelka2', 'TNhaplotyper2'];

// Mutation classes by pyrimidine reference base, roughly like a typical
// somatic spectrum (C>T dominates).
const SPECTRUM = {
  C: [
    ['A', 0.2],
    ['G', 0.1],
    ['T', 0.7],
  ],
  T: [
    ['A', 0.15],
    ['C', 0.6],
    ['G', 0.25],
  ],
};
const COMPLEMENT = { A: 'T', C: 'G', G: 'C', T: 'A' };

// Seeded PRNG (mulberry32), so the output is reproducible.
let seed = 20261023;
function random() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min, max) => min + Math.floor(random() * (max - min + 1));
const chance = (p) => random() < p;
const pick = (weighted) => {
  let r = random() * weighted.reduce((sum, [, w]) => sum + w, 0);
  for (const [value, weight] of weighted) {
    r -= weight;
    if (r < 0) return value;
  }
  return weighted.at(-1)[0];
};
const fmt = (x) => (x === 0 ? '0' : String(Number(x.toPrecision(6))));
const vaf = (alt, total) => (total ? alt / total : 0);

/** Random positions: spread over the genome, plus two hotspots and a few
 * variants close together for the zoomed in view. */
function positions() {
  const result = [];
  const genome = CHROMS.reduce((sum, [, length]) => sum + length, 0);
  for (const [chrom, length] of CHROMS) {
    if (chrom === 'chrM') continue;
    const n = Math.round((110 * length) / genome);
    for (let i = 0; i < n; i++)
      result.push([chrom, randInt(1e6, length - 1e6)]);
  }
  for (const [chrom, center] of [
    ['chr8', 127_000_000],
    ['chr17', 40_000_000],
  ]) {
    for (let i = 0; i < 10; i++) {
      result.push([chrom, center + randInt(-1_500_000, 1_500_000)]);
    }
  }
  for (const pos of [7_674_221, 7_674_232, 7_674_250, 7_674_263]) {
    result.push(['chr17', pos]);
  }
  return result;
}

async function readFai() {
  const text = await (await fetch(`${FASTA_URL}.fai`)).text();
  return Object.fromEntries(
    text
      .trim()
      .split('\n')
      .map((line) => {
        const [name, , offset, lineBases, lineBytes] = line.split('\t');
        return [
          name,
          { offset: +offset, lineBases: +lineBases, lineBytes: +lineBytes },
        ];
      }),
  );
}

async function refBase(fai, chrom, pos) {
  const { offset, lineBases, lineBytes } = fai[chrom];
  const i = pos - 1;
  const byte = offset + Math.floor(i / lineBases) * lineBytes + (i % lineBases);
  const response = await fetch(FASTA_URL, {
    headers: { Range: `bytes=${byte}-${byte}` },
  });
  return (await response.text()).toUpperCase();
}

/** Forward and reverse (REF,ALT) depths. */
function strandDepths(depth, alt) {
  const altF = randInt(0, alt);
  const refF = Math.round(depth / 2) + randInt(-15, 15);
  return [
    [refF, altF],
    [depth - refF, alt - altF],
  ];
}

function sampleColumn(called) {
  const depth = randInt(140, 260);
  const alt = called ? randInt(2, 8) : randInt(0, 2);
  const [adf, adr] = strandDepths(depth, alt);
  // Called samples mostly have a single caller.
  const nCallers = called
    ? pick([
        [1, 0.75],
        [2, 0.15],
        [3, 0.1],
      ])
    : 0;
  const callers = [...CALLERS]
    .sort(() => random() - 0.5)
    .slice(0, nCallers)
    .sort();
  return { called, adf, adr, alt, depth: depth + alt, callers };
}

function formatSample({ called, adf, adr, alt, depth, callers }) {
  return [
    called ? '0/1' : '0/0',
    'SR',
    adf.join(','),
    adr.join(','),
    '.,.',
    '.,.',
    fmt(vaf(alt, depth)),
    '.',
    called ? 1 : 0,
    callers.length ? callers.join(',') : '.',
  ].join(':');
}

function record(chrom, pos, ref) {
  const pyrimidine = ref === 'C' || ref === 'T' ? ref : COMPLEMENT[ref];
  const altPyrimidine = pick(SPECTRUM[pyrimidine]);
  const alt = ref === pyrimidine ? altPyrimidine : COMPLEMENT[altPyrimidine];

  // Per sample short read evidence, plus the sum of both samples.
  const calledA = chance(0.5);
  const a = sampleColumn(calledA);
  const b = sampleColumn(!calledA || chance(0.3));
  const merged = {
    called: true,
    adf: [a.adf[0] + b.adf[0], a.adf[1] + b.adf[1]],
    adr: [a.adr[0] + b.adr[0], a.adr[1] + b.adr[1]],
    alt: a.alt + b.alt,
    depth: a.depth + b.depth,
    callers: CALLERS.filter(
      (c) => a.callers.includes(c) || b.callers.includes(c),
    ),
  };

  // Pooled long read evidence.
  const pbAlt = chance(0.4) ? randInt(1, 8) : 0;
  const ontAlt = chance(0.5) ? randInt(1, 12) : 0;
  const [pbF, pbR] = strandDepths(randInt(300, 480), pbAlt);
  const [ontF, ontR] = strandDepths(randInt(560, 680), ontAlt);
  const pbDepth = pbF[0] + pbF[1] + pbR[0] + pbR[1];
  const ontDepth = ontF[0] + ontF[1] + ontR[0] + ontR[1];

  const flags = {
    CrossCaller: merged.callers.length >= 2,
    CrossCore: a.called && b.called,
    CrossTech: pbAlt >= 2,
    CrossTissue: chance(0.2),
  };
  const score = Object.values(flags).filter(Boolean).length;
  const tissues = TISSUES.filter(() => chance(0.3));
  if (flags.CrossTissue && !tissues.length) tissues.push(TISSUES[0]);

  const germline = { SR: 0 };
  if (pbAlt) germline.PB = chance(0.9) ? 0 : random() * 1e-3;
  if (ontAlt) germline.ONT = chance(0.9) ? 0 : random() * 1e-3;

  const info = [
    `EvidenceScore=${score}`,
    ...Object.keys(flags).filter((flag) => flags[flag]),
    `POOLED_PB_VAF=${fmt(vaf(pbAlt, pbDepth))}`,
    `POOLED_ONT_VAF=${fmt(vaf(ontAlt, ontDepth))}`,
    `POOLED_PB_ADF=${pbF.join(',')}`,
    `POOLED_PB_ADR=${pbR.join(',')}`,
    `POOLED_ONT_ADF=${ontF.join(',')}`,
    `POOLED_ONT_ADR=${ontR.join(',')}`,
    ...Object.entries(germline).map(
      ([src, p]) => `GERMLINE_PVAL_${src}=${fmt(p)}`,
    ),
    `GERMLINE_PVAL=${fmt(Math.min(...Object.values(germline)))}`,
    `SB_PVAL=${fmt(random())}`,
    `SB_SRC=${pbAlt >= 2 ? 'PB' : 'SR'}`,
  ];
  if (tissues.length) info.push(`SR_TISSUE_PRESENCE=${tissues.join('|')}`);

  return [
    chrom,
    pos,
    '.',
    ref,
    alt,
    '.',
    score ? 'PASS' : 'LowEvidence',
    info.join(';'),
    'GT:TECH:SR_ADF:SR_ADR:PB_ADF:PB_ADR:SR_VAF:PB_VAF:ALT_SUPPORT_PASS:CALLERS',
    formatSample(a),
    formatSample(b),
    formatSample(merged),
  ].join('\t');
}

const HEADER = `##fileformat=VCFv4.2
##FILTER=<ID=PASS,Description="All filters passed">
${CHROMS.map(([id, length]) => `##contig=<ID=${id},length=${length}>`).join('\n')}
##FORMAT=<ID=GT,Number=1,Type=String,Description="Genotype: 0/1=called+passed all filters, 0/0=did not pass filtering">
##FORMAT=<ID=TECH,Number=1,Type=String,Description="Sequencing technology of this core: SR=short-read, PB=PacBio/long-read">
##FORMAT=<ID=SR_ADF,Number=2,Type=Integer,Description="Per-core short-read forward depths (REF,ALT)">
##FORMAT=<ID=SR_ADR,Number=2,Type=Integer,Description="Per-core short-read reverse depths (REF,ALT)">
##FORMAT=<ID=PB_ADF,Number=2,Type=Integer,Description="Per-core tissue-matched PacBio forward depths (REF,ALT)">
##FORMAT=<ID=PB_ADR,Number=2,Type=Integer,Description="Per-core tissue-matched PacBio reverse depths (REF,ALT)">
##FORMAT=<ID=SR_VAF,Number=1,Type=Float,Description="Per-core short-read variant allele fraction">
##FORMAT=<ID=PB_VAF,Number=1,Type=Float,Description="Per-core tissue-matched PacBio variant allele fraction">
##FORMAT=<ID=ALT_SUPPORT_PASS,Number=1,Type=Integer,Description="1 if this core's ALT reads meet the standalone read cutoff for its coverage, 0 otherwise">
##FORMAT=<ID=CALLERS,Number=.,Type=String,Description="Callers that reported this variant for this core">
##INFO=<ID=EvidenceScore,Number=1,Type=Integer,Description="Count of cross-evidence labels present (CrossTech, CrossCaller, CrossTissue, CrossCore)">
##INFO=<ID=CrossCaller,Number=0,Type=Flag,Description="Alt found in 2+ unique callers across all cores">
##INFO=<ID=CrossCore,Number=0,Type=Flag,Description="Variant has GT=0/1 in more than one core">
##INFO=<ID=CrossTech,Number=0,Type=Flag,Description="Alt supported in both short read and tissue-matched PacBio at or above combined thresholds">
##INFO=<ID=CrossTissue,Number=0,Type=Flag,Description="Variant has VAF > 0 in another tissue">
##INFO=<ID=POOLED_PB_VAF,Number=1,Type=Float,Description="PacBio VAF pooled across all of a donor's tissues">
##INFO=<ID=POOLED_ONT_VAF,Number=1,Type=Float,Description="ONT VAF pooled across all of a donor's tissues">
##INFO=<ID=POOLED_PB_ADF,Number=2,Type=Integer,Description="PacBio forward depths pooled across all of a donor's tissues (REF,ALT)">
##INFO=<ID=POOLED_PB_ADR,Number=2,Type=Integer,Description="PacBio reverse depths pooled across all of a donor's tissues (REF,ALT)">
##INFO=<ID=POOLED_ONT_ADF,Number=2,Type=Integer,Description="ONT forward depths pooled across all of a donor's tissues (REF,ALT)">
##INFO=<ID=POOLED_ONT_ADR,Number=2,Type=Integer,Description="ONT reverse depths pooled across all of a donor's tissues (REF,ALT)">
##INFO=<ID=GERMLINE_PVAL,Number=1,Type=Float,Description="Min binomial p-value for germline deviation across pooled platforms (tissue-level SR; donor-level PB and ONT)">
##INFO=<ID=GERMLINE_PVAL_SR,Number=1,Type=Float,Description="Binomial p-value for germline deviation in pooled SR data (tissue-level)">
##INFO=<ID=GERMLINE_PVAL_PB,Number=1,Type=Float,Description="Binomial p-value for germline deviation in pooled PacBio data across all of a donor's tissues">
##INFO=<ID=GERMLINE_PVAL_ONT,Number=1,Type=Float,Description="Binomial p-value for germline deviation in pooled ONT data across all of a donor's tissues">
##INFO=<ID=SB_PVAL,Number=1,Type=Float,Description="Fisher exact test p-value for strand balance on pooled counts">
##INFO=<ID=SB_SRC,Number=1,Type=String,Description="Platform used for pooled Fisher strand test: SR or PB">
##INFO=<ID=SR_TISSUE_PRESENCE,Number=.,Type=String,Description="Tissues from this donor with short-read support for this variant based on pileups (BQ>30)">
##FILTER=<ID=LowEvidence,Description="No cross-evidence: lacks CrossTech, CrossCaller, CrossTissue, and CrossCore">
#CHROM\tPOS\tID\tREF\tALT\tQUAL\tFILTER\tINFO\tFORMAT\t${[...SAMPLES, SAMPLES.join('-')].join('\t')}
`;

/** BGZF: gzip blocks of at most 64 KiB with the block size in an extra field. */
function bgzip(data) {
  const block = (chunk) => {
    const cdata = zlib.deflateRawSync(chunk, { level: 9 });
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
  for (let i = 0; i < data.length; i += 65280) {
    blocks.push(block(data.subarray(i, i + 65280)));
  }
  blocks.push(block(Buffer.alloc(0)));
  return Buffer.concat(blocks);
}

const fai = await readFai();
const chromOrder = Object.fromEntries(CHROMS.map(([chrom], i) => [chrom, i]));
const sites = positions().sort(
  (a, b) => chromOrder[a[0]] - chromOrder[b[0]] || a[1] - b[1],
);

const lines = [];
for (const [chrom, pos] of sites) {
  const ref = await refBase(fai, chrom, pos);
  if (!COMPLEMENT[ref]) continue; // N
  lines.push(record(chrom, pos, ref));
}

fs.writeFileSync(OUTPUT, bgzip(Buffer.from(`${HEADER}${lines.join('\n')}\n`)));
process.stdout.write(`Wrote ${lines.length} variants to ${OUTPUT.pathname}\n`);
