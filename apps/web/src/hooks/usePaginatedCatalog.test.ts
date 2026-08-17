import { describe, it, expect } from 'vitest';
import { sortByYearThenPopularity, CATALOG_PER_PAGE, shouldPrefetchMore } from './usePaginatedCatalog';

function item(partial: { title: string; year: number | null; popularity?: number }) {
  return {
    tmdbId: 1,
    title: partial.title,
    overview: '',
    posterPath: null,
    backdropPath: null,
    year: partial.year,
    rating: 8.5,
    genres: [],
    type: 'movie' as const,
    popularity: partial.popularity ?? 0,
  };
}

describe('sortByYearThenPopularity', () => {
  it('ordena por ano desc (recentes primeiro, clássicos no fim)', () => {
    const sorted = sortByYearThenPopularity([
      item({ title: 'clássico', year: 1972 }),
      item({ title: 'recente', year: 2026 }),
      item({ title: 'meio', year: 2001 }),
    ]);
    expect(sorted.map((i) => i.title)).toEqual(['recente', 'meio', 'clássico']);
  });

  it('usa popularidade como desempate dentro do mesmo ano', () => {
    const sorted = sortByYearThenPopularity([
      item({ title: 'pouco popular', year: 2026, popularity: 5 }),
      item({ title: 'muito popular', year: 2026, popularity: 900 }),
    ]);
    expect(sorted.map((i) => i.title)).toEqual(['muito popular', 'pouco popular']);
  });

  it('coloca itens sem ano no fim (nulls last)', () => {
    const sorted = sortByYearThenPopularity([
      item({ title: 'sem ano', year: null }),
      item({ title: 'com ano', year: 2000 }),
    ]);
    expect(sorted.map((i) => i.title)).toEqual(['com ano', 'sem ano']);
  });

  it('não muta o array original (imutabilidade)', () => {
    const input = [item({ title: 'b', year: 2000 }), item({ title: 'a', year: 2026 })];
    const copy = [...input];
    sortByYearThenPopularity(input);
    expect(input.map((i) => i.title)).toEqual(copy.map((i) => i.title));
  });
});

describe('CATALOG_PER_PAGE', () => {
  it('é 15 por página', () => {
    expect(CATALOG_PER_PAGE).toBe(15);
  });
});

describe('shouldPrefetchMore', () => {
  it('dispara quando está a ≤5 páginas do fim com mais conteúdo', () => {
    expect(shouldPrefetchMore(7, 11, true, false, false)).toBe(true);
    expect(shouldPrefetchMore(11, 11, true, false, false)).toBe(true);
    expect(shouldPrefetchMore(2, 11, true, false, false)).toBe(false);
  });

  it('não dispara sem mais conteúdo ou com fetch em andamento', () => {
    expect(shouldPrefetchMore(10, 11, false, false, false)).toBe(false);
    expect(shouldPrefetchMore(10, 11, true, true, false)).toBe(false);
    expect(shouldPrefetchMore(10, 11, true, false, true)).toBe(false);
  });

  it('cresce mesmo em catálogo pequeno quando há mais conteúdo; sem mais → para', () => {
    expect(shouldPrefetchMore(1, 2, true, false, false)).toBe(true); // perto do fim → busca mais
    expect(shouldPrefetchMore(1, 2, false, false, false)).toBe(false); // sem mais no TMDB → não busca
  });
});
