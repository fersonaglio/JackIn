import { describe, it, expect } from 'vitest';
import { tmdbWindow, jackinTotalPages, CATALOG_PER_PAGE, TMDB_PER_PAGE, TMDB_MAX_PAGES } from './catalog.js';

describe('tmdbWindow (salto direto TMDB para página JackIn)', () => {
  it('página 1 → TMDB página 1, offset 0', () => {
    expect(tmdbWindow(1)).toEqual({ tmdbPage: 1, offset: 0 });
  });

  it('página 2 (start item 18) → TMDB página 1, offset 18', () => {
    expect(tmdbWindow(2)).toEqual({ tmdbPage: 1, offset: 18 });
  });

  it('página 3 (start item 36) → TMDB página 2, offset 16', () => {
    expect(tmdbWindow(3)).toEqual({ tmdbPage: 2, offset: 16 });
  });

  it('página 250 → TMDB página 225 (start item 4482)', () => {
    const { tmdbPage, offset } = tmdbWindow(250);
    expect(tmdbPage).toBe(Math.floor((250 - 1) * 18 / 20) + 1);
    expect(tmdbPage).toBe(225);
    expect(offset).toBe((250 - 1) * 18 % 20);
  });

  it('valores inválidos (0/NaN) caem para página 1', () => {
    expect(tmdbWindow(0)).toEqual({ tmdbPage: 1, offset: 0 });
    expect(tmdbWindow(NaN)).toEqual({ tmdbPage: 1, offset: 0 });
  });
});

describe('jackinTotalPages (teto de páginas do JackIn)', () => {
  it('10k resultados TMDB (500 páginas de 20) → 556 páginas de 18', () => {
    expect(jackinTotalPages(500)).toBe(Math.ceil(500 * 20 / 18));
    expect(jackinTotalPages(500)).toBe(556);
  });

  it('catálogo pequeno → mínimo 1 página', () => {
    expect(jackinTotalPages(0)).toBe(1);
    expect(jackinTotalPages(1)).toBe(2); // 20 itens = 2 páginas de 18
  });

  it('cap no máximo TMDB_MAX_PAGES mesmo se o valor vier maior', () => {
    expect(jackinTotalPages(9999)).toBe(jackinTotalPages(TMDB_MAX_PAGES));
  });
});

describe('constantes de paginação', () => {
  it('mantém 18 por página e 20 por página TMDB em sincronia', () => {
    expect(CATALOG_PER_PAGE).toBe(18);
    expect(TMDB_PER_PAGE).toBe(20);
    expect(TMDB_MAX_PAGES).toBe(500);
  });
});
