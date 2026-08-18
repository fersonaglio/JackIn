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

export const CATALOG_PER_PAGE = 18;
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

// Garantia de não-mistura: /filmes só mostra movie, /series só mostra tv.
// O servidor já separa, mas o filtro defensivo descarta qualquer item do
// tipo errado que apareça em algum lote.
export function onlyType(items: CatalogItem[], type: 'movie' | 'tv'): CatalogItem[] {
  return items.filter((i) => i.type === type);
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
  // Um load-more em andamento (evita disparos duplicados sem abortar o fetch).
  const prefetchingRef = useRef(false);
  // Timestamp até o qual retries de load-more ficam em espera (backoff).
  const loadMoreRetryAtRef = useRef(0);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    setLoadingMore(false);
    try {
      const data = await discoverCatalog(type, genreKey, 1, BATCH_PAGES);
      const typed = onlyType(data.items || [], type);
      const sorted = sortByYearThenPopularity(typed);
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
  // Guard `prefetchingRef` em vez de abort no change de dep: `setLoadingMore`
  // é dependência DESTE effect — sem o guard, o re-render disparado por ele
  // rodava o cleanup (ctrl.abort()) no fetch recém-iniciado, o .catch/.finally
  // pulavam (guard !aborted) e o loadingMore ficava preso em true para sempre,
  // congelando o catálogo na última página carregada.
  useEffect(() => {
    if (prefetchingRef.current) return;
    if (Date.now() < loadMoreRetryAtRef.current) return;
    if (!shouldPrefetchMore(page, totalPages, hasMore, loading, loadingMore)) return;

    prefetchingRef.current = true;
    setLoadingMore(true);

    discoverCatalog(type, genreKey, nextCursor, BATCH_PAGES)
      .then((data) => {
        setAllItems((prev) => {
          const added = onlyType(data.items || [], type);
          const merged = [...prev, ...added];
          return sortByYearThenPopularity(filter ? merged.filter(filter) : merged);
        });
        setNextCursor(data.nextCursor);
        setHasMore(data.hasMore);
      })
      .catch(() => {
        // Falha transitória: NÃO mata o hasMore. Espera um backoff curto e
        // tenta de novo na próxima mudança de página/estado.
        loadMoreRetryAtRef.current = Date.now() + 6000;
      })
      .finally(() => {
        prefetchingRef.current = false;
        setLoadingMore(false);
      });
  }, [page, totalPages, hasMore, nextCursor, loading, loadingMore, type, genreKey, filter]);

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
