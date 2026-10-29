import { describe, expect, it } from 'vitest';

import {
  MUTATION_CLASSES,
  OTHER_CLASS,
  mutationClass,
} from '../../src/utils/mutationTypes';

const name = (ref, alt) => MUTATION_CLASSES[mutationClass(ref, alt)].name;

describe('mutationClass', () => {
  it('keeps substitutions of pyrimidine reference bases', () => {
    expect(name('C', 'A')).toBe('C>A');
    expect(name('C', 'G')).toBe('C>G');
    expect(name('C', 'T')).toBe('C>T');
    expect(name('T', 'A')).toBe('T>A');
    expect(name('T', 'C')).toBe('T>C');
    expect(name('T', 'G')).toBe('T>G');
  });

  it('collapses purine reference bases onto the other strand', () => {
    expect(name('G', 'A')).toBe('C>T');
    expect(name('G', 'T')).toBe('C>A');
    expect(name('G', 'C')).toBe('C>G');
    expect(name('A', 'G')).toBe('T>C');
    expect(name('A', 'C')).toBe('T>G');
    expect(name('A', 'T')).toBe('T>A');
  });

  it('is case insensitive', () => {
    expect(name('g', 'a')).toBe('C>T');
  });

  it('puts everything else into "Other"', () => {
    for (const [ref, alt] of [
      ['AT', 'A'],
      ['A', 'AT'],
      ['AC', 'GT'],
      ['N', 'A'],
      ['C', '<DEL>'],
      ['C', 'C'],
    ]) {
      expect(mutationClass(ref, alt)).toBe(OTHER_CLASS);
    }
    expect(MUTATION_CLASSES[OTHER_CLASS].name).toBe('Other');
  });
});
