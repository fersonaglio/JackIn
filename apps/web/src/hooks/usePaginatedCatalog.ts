'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { CatalogItem } from '@/types/media';
import { discoverCatalog } from '@/lib/api';
import { buildPosterUrl } from '@/data/media';

export interface PaginatedCatalogState {
  page: number;
  totalPages: number;
  items: CatalogItem[];
  loading: boolean;
  error: string | null;
  setPage: (page: number) => void;
  refresh: () => void;
}

// Tamanho de página do JackIn. A paginação é feita NO SERVIDOR (catalog.ts usa
// o mesmo valor); aqui fica só como referência/teste — o cliente renderiza os
// itens que o servidor devolve, sem fatiar nem acumular.
export const CATALOG_PER_PAGE = 18;

// Garantia de não-mistura: /filmes só mostra movie, /series só mostra tv.
// O servidor já separa, mas o filtro defensivo descarta qualquer item do
// tipo errado que apareça.
export function onlyType(items: CatalogItem[], type: 'movie' | 'tv'): CatalogItem[] {
  return items.filter((i) => i.type === type);
}

// Clamp seguro de página: valores inválidos/não-numéricos → 1; acima do teto →
// última página. Usado para normalizar ?page=800 / ?page=-5 sem travar.
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), Math.max(1, totalPages));
}

interface CacheEntry {
  items: CatalogItem[];
  totalPages: number;
}

export function usePaginatedCatalog(
  type: 'movie' | 'tv',
  genreKey: string
): PaginatedCatalogState {
  const [page, setPageState] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Cache por página: voltar/avançar para uma página já visitada é 0ms.
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
  const abortRef = useRef<AbortController | null>(null);

  const loadPage = useCallback(
    async (p: number) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const key = `${type}:${genreKey}:${p}`;

      const cached = cacheRef.current.get(key);
      if (cached) {
        setItems(cached.items);
        setPageState(p);
        setTotalPages(cached.totalPages);
        setError(null);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const data = await discoverCatalog(type, genreKey, p);
        if (ctrl.signal.aborted) return;
        const typed = onlyType(data.items || [], type);
        cacheRef.current.set(key, { items: typed, totalPages: data.totalPages });
        setItems(typed);
        setPageState(data.page);
        setTotalPages(data.totalPages);
      } catch {
        if (!ctrl.signal.aborted) setError('Não foi possível carregar o catálogo.');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    },
    [type, genreKey]
  );

  useEffect(() => {
    loadPage(1);
    return () => abortRef.current?.abort();
  }, [loadPage]);

  const setPage = useCallback(
    (p: number) => {
      loadPage(clampPage(p, totalPages));
    },
    [loadPage, totalPages]
  );

  const refresh = useCallback(() => loadPage(page), [loadPage, page]);

  // Prefetch em background da próxima página (dados + posters): esquenta o
  // cache e o navegador para que "avançar" seja instantâneo, sem bloquear a
  // página atual e sem o loop de acumulação antigo.
  useEffect(() => {
    const next = page + 1;
    if (next > totalPages) return;
    const key = `${type}:${genreKey}:${next}`;
    if (cacheRef.current.has(key)) return;
    discoverCatalog(type, genreKey, next)
      .then((data) => {
        const typed = onlyType(data.items || [], type);
        cacheRef.current.set(key, { items: typed, totalPages: data.totalPages });
        for (const it of typed) {
          const url = buildPosterUrl(it.posterPath, 'w500');
          if (url) {
            const img = new Image();
            img.src = url;
          }
        }
      })
      .catch(() => {});
  }, [page, totalPages, type, genreKey]);

  return { page, totalPages, items, loading, error, setPage, refresh };
}
