'use client';
import { useState, useEffect, useCallback } from 'react';
import type { CatalogData, CatalogItem } from '@/types/media';

interface UseCatalogReturn {
  data: CatalogData;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const EMPTY_DATA: CatalogData = {
  trending: [],
  trendingTV: [],
  popularMovies: [],
  scifi: [],
  action: [],
  animation: [],
};

const MOVIE_RECENT_YEAR = 2025;
const SERIES_RECENT_YEAR = 2024;

async function fetchFeed(feed: string, genre?: string): Promise<CatalogItem[]> {
  const url = `/api/itunes?feed=${feed}${genre ? `&genre=${genre}` : ''}&limit=50`;
  const res = await fetch(url);
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

export function useCatalog(): UseCatalogReturn {
  const [data, setData] = useState<CatalogData>(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [movies, series, scifi, action, animation] = await Promise.all([
        fetchSafe('topmovies'),
        fetchSafe('toptvseasons'),
        fetchSafe('topmovies', '4413'),
        fetchSafe('topmovies', '4401'),
        fetchSafe('topmovies', '4402'),
      ]);

      const nextData: CatalogData = {
        trending: dedupByTitle(movies).filter((m) => m.year !== null && m.year >= MOVIE_RECENT_YEAR).slice(0, 8),
        trendingTV: dedupByTitle(series).filter((s) => s.year !== null && s.year >= SERIES_RECENT_YEAR).slice(0, 8),
        popularMovies: dedupByTitle(movies).slice(0, 12),
        scifi: dedupByTitle(scifi).slice(0, 8),
        action: dedupByTitle(action).slice(0, 8),
        animation: dedupByTitle(animation).slice(0, 8),
      };

      setData(nextData);
      const hasContent = Object.values(nextData).some((list) => list.length > 0);
      if (!hasContent) setError('Sem conexão com a internet');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
