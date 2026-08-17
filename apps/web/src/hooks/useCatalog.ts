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
    releaseDate: r.releaseDate || null,
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

      const dedupedMovies = dedupByTitle(movies);
      const dedupedSeries = dedupByTitle(series);

      // Sort by newest release date / year descending
      const sortByNewest = (items: CatalogItem[]) =>
        [...items].sort((a, b) => {
          const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : (a.year || 0) * 10000;
          const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : (b.year || 0) * 10000;
          return dateB - dateA;
        });

      const recentMovies = sortByNewest(dedupedMovies);
      const recentSeries = sortByNewest(dedupedSeries);

      // Prefer 2026 and recent 2025 releases
      const currentYear = new Date().getFullYear();
      const isRecentRelease = (it: CatalogItem) => {
        if (!it.year) return false;
        return it.year >= currentYear - 1;
      };

      const filteredMovies = recentMovies.filter(isRecentRelease);
      const filteredSeries = recentSeries.filter(isRecentRelease);

      const poolMovies = filteredMovies.length > 0 ? filteredMovies : recentMovies;
      const poolSeries = filteredSeries.length > 0 ? filteredSeries : recentSeries;

      const top10Featured: CatalogItem[] = [];
      const maxLen = Math.max(poolMovies.length, poolSeries.length);
      for (let i = 0; i < maxLen && top10Featured.length < 10; i++) {
        if (poolMovies[i]) top10Featured.push(poolMovies[i]);
        if (poolSeries[i] && top10Featured.length < 10) top10Featured.push(poolSeries[i]);
      }

      const nextData: CatalogData = {
        trending: top10Featured.length > 0 ? top10Featured : dedupedMovies.slice(0, 10),
        trendingTV: dedupedSeries.slice(0, 12),
        popularMovies: dedupedMovies.slice(0, 15),
        scifi: dedupByTitle(scifi).slice(0, 12),
        action: dedupByTitle(action).slice(0, 12),
        animation: dedupByTitle(animation).slice(0, 12),
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
