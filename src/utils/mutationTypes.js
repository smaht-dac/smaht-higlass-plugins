/**
 * Single base substitution (SBS) classes, collapsed onto the pyrimidine
 * reference base, plus a catch-all for everything else (indels, MNVs,
 * symbolic alleles). Colors follow the COSMIC SBS signature plots.
 */
export const MUTATION_CLASSES = [
  { name: 'C>A', color: '#1ebff0' },
  { name: 'C>G', color: '#050708' },
  { name: 'C>T', color: '#e62725' },
  { name: 'T>A', color: '#cbcacb' },
  { name: 'T>C', color: '#a1cf64' },
  { name: 'T>G', color: '#edc8c5' },
  { name: 'Other', color: '#7f3c8d' },
];

export const OTHER_CLASS = MUTATION_CLASSES.length - 1;

const CLASS_INDEX = Object.fromEntries(
  MUTATION_CLASSES.map(({ name }, i) => [name, i]),
);

const COMPLEMENT = { A: 'T', C: 'G', G: 'C', T: 'A' };

/**
 * @param {string} ref
 * @param {string} alt
 * @returns {number} Index into `MUTATION_CLASSES`
 */
export function mutationClass(ref, alt) {
  let r = ref.toUpperCase();
  let a = alt.toUpperCase();
  if (!COMPLEMENT[r] || !COMPLEMENT[a] || r === a) return OTHER_CLASS;
  if (r === 'G' || r === 'A') {
    r = COMPLEMENT[r];
    a = COMPLEMENT[a];
  }
  return CLASS_INDEX[`${r}>${a}`];
}
