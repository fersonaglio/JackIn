'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CatalogItem } from '@/types/media';

export type ExpandedGenreKey = 'all' | 'recent' | 'action' | 'scifi' | 'animation';

export interface ExpandedCatalogData {
  all: CatalogItem[];
  scifi: CatalogItem[];
  action: CatalogItem[];
  animation: CatalogItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const EMPTY: ExpandedCatalogData = {
  all: [],
  scifi: [],
  action: [],
  animation: [],
  loading: true,
  error: null,
  refresh: () => {},
};

const MOVIE_RECENT_YEAR = 2024;
const SERIES_RECENT_YEAR = 2023;

async function fetchFeed(feed: string, genre?: string): Promise<CatalogItem[]> {
  const url = `/api/itunes?feed=${feed}${genre ? `&genre=${genre}` : ''}&limit=100`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Falha ao carregar feed ${feed}`);
  const data = await res.json();
  const isTv = feed === 'toptvseasons';
  return (data.results || []).map((r: any) => ({
    tmdbId: Number(r.id) || 0,
    title: r.title || '',
    originalTitle: r.originalTitle || '',
    overview: r.overview || '',
    posterPath: r.posterUrl || null,
    backdropPath: r.backdropUrl || r.posterUrl || null,
    year: r.year ? parseInt(String(r.year), 10) : null,
    rating: r.rating || 8.5,
    genres: r.genre ? [r.genre] : [],
    type: isTv ? ('tv' as const) : ('movie' as const),
  }));
}

const fetchSafe = (feed: string, genre?: string) => fetchFeed(feed, genre).catch(() => []);

function dedupByTitle(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function recent(items: CatalogItem[], year: number): CatalogItem[] {
  return dedupByTitle(items.filter((i) => i.year !== null && i.year >= year));
}

export function useExpandedCatalog(type: 'movie' | 'tv'): ExpandedCatalogData {
  const [data, setData] = useState<ExpandedCatalogData>(EMPTY);

  const load = useCallback(async () => {
    setData((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const movieFeed = type === 'movie' ? 'topmovies' : 'toptvseasons';
      const [all, scifi, action, animation] = await Promise.all([
        fetchSafe(movieFeed),
        type === 'movie' ? fetchSafe('topmovies', '4413') : Promise.resolve([]),
        type === 'movie' ? fetchSafe('topmovies', '4401') : Promise.resolve([]),
        type === 'movie' ? fetchSafe('topmovies', '4402') : Promise.resolve([]),
      ]);

      const recentYear = type === 'movie' ? MOVIE_RECENT_YEAR : SERIES_RECENT_YEAR;
      setData({
        all: dedupByTitle(all),
        scifi: dedupByTitle(scifi),
        action: dedupByTitle(action),
        animation: dedupByTitle(animation),
        loading: false,
        error: null,
        refresh: load,
      });
    } finally {
      setData((prev) => ({ ...prev, loading: false }));
    }
  }, [type]);

  useEffect(() => {
    load();
  }, [load]);

  return data;
}

export function filterByGenreKey(data: ExpandedCatalogData, key: ExpandedGenreKey, type: 'movie' | 'tv'): CatalogItem[] {
  const recentYear = type === 'movie' ? MOVIE_RECENT_YEAR : SERIES_RECENT_YEAR;
  if (key === 'action') return data.action;
  if (key === 'scifi') return data.scifi;
  if (key === 'animation') return data.animation;
  if (key === 'recent') return recent(data.all, recentYear);
  return dedupByTitle(data.all);
}

export { MOVIE_RECENT_YEAR, SERIES_RECENT_YEAR };
