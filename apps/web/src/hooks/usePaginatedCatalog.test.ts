import { describe, it, expect } from 'vitest';
import { onlyType, clampPage, CATALOG_PER_PAGE } from './usePaginatedCatalog';

function item(partial: { title: string; type?: 'movie' | 'tv' }) {
  return {
    tmdbId: 1,
    title: partial.title,
    overview: '',
    posterPath: null,
    backdropPath: null,
    year: 2020,
    rating: 8.5,
    genres: [],
    type: partial.type ?? ('movie' as const),
    popularity: 0,
  };
}

describe('CATALOG_PER_PAGE', () => {
  it('é 18 por página', () => {
    expect(CATALOG_PER_PAGE).toBe(18);
  });
});

describe('onlyType (garantia filme/série não misturam)', () => {
  it('mantém só os itens do tipo pedido', () => {
    const mixed = [
      item({ title: 'filme', type: 'movie' }),
      item({ title: 'série', type: 'tv' }),
      item({ title: 'outra série', type: 'tv' }),
    ];
    expect(onlyType(mixed, 'movie').map((i) => i.title)).toEqual(['filme']);
    expect(onlyType(mixed, 'tv').map((i) => i.title)).toEqual(['série', 'outra série']);
  });

  it('não muta o array original', () => {
    const input = [item({ title: 'filme', type: 'movie' }), item({ title: 'série', type: 'tv' })];
    onlyType(input, 'movie');
    expect(input).toHaveLength(2);
  });
});

describe('clampPage (normalização de ?page=N)', () => {
  it('clampa páginas acima do teto para a última', () => {
    expect(clampPage(800, 556)).toBe(556);
    expect(clampPage(250, 556)).toBe(250);
  });

  it('clampa valores inválidos e negativos para 1', () => {
    expect(clampPage(-5, 556)).toBe(1);
    expect(clampPage(NaN, 556)).toBe(1);
    expect(clampPage(0, 556)).toBe(1);
  });

  it('respeita teto 1 em catálogo vazio', () => {
    expect(clampPage(10, 1)).toBe(1);
  });
});
