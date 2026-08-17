'use client';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { CatalogItem } from '@/types/media';
import { discoverCatalog } from '@/lib/api';

export interface PaginatedCatalogState {
  page: number;
  totalPages: number;
  items: CatalogItem[];
  allItems: CatalogItem[];
  loading: boolean;
  error: string | null;
  setPage: (page: number) => void;
  refresh: () => void;
}

export const CATALOG_PER_PAGE = 15;

export function sortByYearThenPopularity(items: CatalogItem[]): CatalogItem[] {
  return [...items].sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (yb !== ya) return yb - ya; // ano desc — recentes primeiro, clássicos no fim
    return (b.popularity ?? 0) - (a.popularity ?? 0); // relevância como desempate
  });
}

function buildPageItems(allItems: CatalogItem[], page: number): CatalogItem[] {
  const start = (page - 1) * CATALOG_PER_PAGE;
  return allItems.slice(start, start + CATALOG_PER_PAGE);
}

export function usePaginatedCatalog(
  type: 'movie' | 'tv',
  genreKey: string,
  filter?: (item: CatalogItem) => boolean
): PaginatedCatalogState {
  const [allItems, setAllItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const data = await discoverCatalog(type, genreKey);
      const sorted = sortByYearThenPopularity(data.items || []);
      setAllItems(filter ? sorted.filter(filter) : sorted);
      setPage(1);
    } catch {
      if (!ctrl.signal.aborted) setError('Não foi possível carregar o catálogo.');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [type, genreKey, filter]);

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(allItems.length / CATALOG_PER_PAGE));
  const current = Math.min(page, totalPages);
  const items = useMemo(() => buildPageItems(allItems, current), [allItems, current]);

  return { page: current, totalPages, items, allItems, loading, error, setPage, refresh: load };
}
