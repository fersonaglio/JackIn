import { describe, it, expect } from 'vitest';
import { expandGluedQuery } from './catalogSearch';

describe('expandGluedQuery', () => {
  it('expands glued franchise queries', () => {
    expect(expandGluedQuery('starwars')).toBe('star wars');
    expect(expandGluedQuery('homemdeferro')).toBe('homem de ferro');
    expect(expandGluedQuery('piratasdocaribe')).toBe('piratas do caribe');
    expect(expandGluedQuery('senhordosaneis')).toBe('senhor dos aneis');
  });

  it('is case/space/accent insensitive', () => {
    expect(expandGluedQuery('Star Wars')).toBe('star wars');
    expect(expandGluedQuery('star wars')).toBe('star wars');
    expect(expandGluedQuery('STARWARS')).toBe('star wars');
    expect(expandGluedQuery('homem-de-ferro')).toBe('homem de ferro');
  });

  it('leaves unknown queries untouched', () => {
    expect(expandGluedQuery('oppenheimer')).toBe('oppenheimer');
    expect(expandGluedQuery('')).toBe('');
    expect(expandGluedQuery('um sonho de liberdade')).toBe('um sonho de liberdade');
  });
});
