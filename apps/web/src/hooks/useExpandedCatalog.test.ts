import { describe, it, expect } from 'vitest';
import { filterByGenreKey, MOVIE_RECENT_YEAR, SERIES_RECENT_YEAR, type ExpandedCatalogData } from './useExpandedCatalog';

function item(id: number, title: string, year: number | null): any {
  return { tmdbId: id, title, year, overview: '', posterPath: null, backdropPath: null, rating: 8.5, genres: [], type: 'movie' };
}

const data: ExpandedCatalogData = {
  all: [item(1, 'Avatar', 2009), item(2, 'Duna: Parte 2', 2024), item(3, 'Moana 2', 2024)],
  scifi: [item(4, 'Duna: Parte 2', 2024)],
  action: [item(5, 'John Wick 4', 2023)],
  animation: [item(6, 'Moana 2', 2024)],
  loading: false,
  error: null,
  refresh: () => {},
};

describe('filterByGenreKey', () => {
  it('returns the whole deduped set for "all"', () => {
    const r = filterByGenreKey(data, 'all', 'movie');
    expect(r.map((x) => x.tmdbId)).toEqual([1, 2, 3]);
  });

  it('returns only recent titles for "recent" (movies >= 2024)', () => {
    const r = filterByGenreKey(data, 'recent', 'movie');
    expect(r.map((x) => x.tmdbId).sort()).toEqual([2, 3]);
  });

  it('routes to the genre feed for action/scifi/animation', () => {
    expect(filterByGenreKey(data, 'scifi', 'movie').map((x) => x.tmdbId)).toEqual([4]);
    expect(filterByGenreKey(data, 'action', 'movie').map((x) => x.tmdbId)).toEqual([5]);
    expect(filterByGenreKey(data, 'animation', 'movie').map((x) => x.tmdbId)).toEqual([6]);
  });

  it('uses the series recency threshold for tv', () => {
    expect(MOVIE_RECENT_YEAR).toBe(2024);
    expect(SERIES_RECENT_YEAR).toBe(2023);
  });
});
