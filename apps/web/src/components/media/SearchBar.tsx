'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useRouter } from 'next/navigation';
import type { CatalogItem } from '@/types/media';
import { buildPosterUrl } from '@/data/media';
import { catalogSearch } from '@/lib/catalogSearch';

export default function SearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const goToSearch = useCallback(
    (value: string) => {
      const q = value.trim();
      if (!q) return;
      setIsOpen(false);
      inputRef.current?.blur();
      router.push(`/search?q=${encodeURIComponent(q)}`);
    },
    [router]
  );

  const handleInputChange = useCallback(
    (value: string) => {
      setQuery(value);

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      if (!value.trim()) {
        abortRef.current?.abort();
        setResults([]);
        setIsOpen(false);
        return;
      }

      debounceRef.current = setTimeout(async () => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setLoading(true);
        try {
          const data = await catalogSearch(value.trim(), controller.signal);
          if (data.length > 0) {
            setResults(data);
          }
          setIsOpen(true);
        } catch {
          // keep previous results, keep dropdown open
        } finally {
          setLoading(false);
        }
      }, 300);
    },
    []
  );

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    goToSearch(query);
  };

  const handleSelect = (item: CatalogItem) => {
    goToSearch(item.title);
  };

  return (
    <div ref={containerRef} className="relative w-full">
      <form onSubmit={handleSubmit}>
        <div className="relative">
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onFocus={() => results.length > 0 && setIsOpen(true)}
            placeholder="Buscar filmes e séries..."
            maxLength={200}
            className="w-full bg-zinc-900/80 border border-zinc-800 focus:border-[#EF9F27]/60 rounded-2xl py-3.5 pl-12 pr-24 text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition-colors"
            aria-label="Buscar filmes e séries"
          />

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                setIsOpen(false);
                inputRef.current?.focus();
              }}
              className="absolute right-12 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EF9F27] rounded"
              aria-label="Limpar busca"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <button
            type="submit"
            className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl bg-[#EF9F27] hover:bg-[#ffb04d] text-black flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            aria-label="Pesquisar"
            title="Pesquisar"
          >
            <svg className="w-4.5 h-4.5" width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </form>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full mt-2 left-0 right-0 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-[420px] overflow-y-auto"
          >
            {loading && (
              <div className="p-4 text-center">
                <div className="w-5 h-5 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin mx-auto" />
              </div>
            )}

            {!loading && results.length === 0 && (
              <p className="p-6 text-center text-sm text-zinc-500">
                Nenhum resultado encontrado.
              </p>
            )}

            {!loading &&
              results.map((item) => (
                <button
                  key={item.tmdbId}
                  type="button"
                  onClick={() => handleSelect(item)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/60 transition-colors text-left"
                >
                  <div className="w-10 h-14 rounded overflow-hidden bg-zinc-800 shrink-0">
                    {item.posterPath && !imgErrors[item.tmdbId] ? (
                      <img
                        src={buildPosterUrl(item.posterPath, 'w300')}
                        alt={item.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => setImgErrors((prev) => ({ ...prev, [item.tmdbId]: true }))}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center bg-zinc-800 text-zinc-500">
                        <span className="text-xs">🎬</span>
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-zinc-100 truncate">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[#EF9F27] font-bold">
                        &#9733; {item.rating}
                      </span>
                      <span className="text-[10px] text-zinc-500">{item.year ?? '—'}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-bold uppercase">
                        {item.type === 'movie' ? 'Filme' : 'Série'}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
