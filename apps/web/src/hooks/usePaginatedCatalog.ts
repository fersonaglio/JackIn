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
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  setPage: (page: number) => void;
  refresh: () => void;
}

export const CATALOG_PER_PAGE = 15;
const BATCH_PAGES = 8;
// Próximo lote é buscado quando o usuário está a 5 (ou menos) páginas do fim.
const PREFETCH_THRESHOLD = 5;

export function sortByYearThenPopularity(items: CatalogItem[]): CatalogItem[] {
  return [...items].sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (yb !== ya) return yb - ya; // ano desc — recentes primeiro, clássicos no fim
    return (b.popularity ?? 0) - (a.popularity ?? 0); // relevância como desempate
  });
}

// Decide se devemos pré-carregar mais um lote: perto do fim do que já existe,
// com mais conteúdo disponível no TMDB e sem fetch em andamento.
export function shouldPrefetchMore(
  page: number,
  totalPages: number,
  hasMore: boolean,
  loading: boolean,
  loadingMore: boolean
): boolean {
  if (loading || loadingMore || !hasMore || totalPages <= 1) return false;
  return page >= totalPages - PREFETCH_THRESHOLD;
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [nextCursor, setNextCursor] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setLoadingMore(false);
    try {
      const data = await discoverCatalog(type, genreKey, 1, BATCH_PAGES);
      const sorted = sortByYearThenPopularity(data.items || []);
      setAllItems(filter ? sorted.filter(filter) : sorted);
      setNextCursor(data.nextCursor);
      setHasMore(data.hasMore);
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

  // Pré-carregamento: perto do fim do que já foi baixado, busca o próximo lote
  // do TMDB e anexa (reordena ano desc → os clássicos novos entram no fim).
  useEffect(() => {
    if (!shouldPrefetchMore(current, totalPages, hasMore, loading, loadingMore)) return;

    loadMoreAbortRef.current?.abort();
    const ctrl = new AbortController();
    loadMoreAbortRef.current = ctrl;
    setLoadingMore(true);

    discoverCatalog(type, genreKey, nextCursor, BATCH_PAGES)
      .then((data) => {
        if (ctrl.signal.aborted) return;
        setAllItems((prev) => sortByYearThenPopularity([...prev, ...(data.items || [])]));
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setHasMore(false); // evita loop se falhar
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoadingMore(false);
      });

    return () => ctrl.abort();
  }, [current, totalPages, hasMore, nextCursor, loading, loadingMore, type, genreKey]);

  useEffect(() => () => loadMoreAbortRef.current?.abort(), []);

  return {
    page: current,
    totalPages,
    items,
    allItems,
    loading,
    loadingMore,
    error,
    hasMore,
    setPage,
    refresh: load,
  };
}
