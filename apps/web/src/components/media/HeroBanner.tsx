'use client';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { CatalogItem } from '@/types/media';
import { buildBackdropUrl } from '@/data/media';

interface HeroBannerProps {
  items: CatalogItem[];
  onPlay: (item: CatalogItem) => void;
  onMoreInfo: (item: CatalogItem) => void;
}

export default function HeroBanner({ items, onPlay, onMoreInfo }: HeroBannerProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const prefersReduced = useReducedMotion();

  const nextSlide = useCallback(() => {
    if (items.length > 1) {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }
  }, [items.length]);

  const prevSlide = useCallback(() => {
    if (items.length > 1) {
      setCurrentIndex((prev) => (prev - 1 + items.length) % items.length);
    }
  }, [items.length]);

  useEffect(() => {
    if (isPaused || items.length <= 1) return;
    const timer = setInterval(nextSlide, 8000);
    return () => clearInterval(timer);
  }, [isPaused, items.length, nextSlide]);

  if (items.length === 0) return null;

  const item = items[currentIndex];
  const backdropUrl = buildBackdropUrl(item.backdropPath || item.posterPath, 'w1280');
  const [dynamicBackdrop, setDynamicBackdrop] = useState<string | null>(null);
  const year = item.year ?? '—';

  useEffect(() => {
    setDynamicBackdrop(null);
  }, [currentIndex]);

  const activeBackdrop = dynamicBackdrop || backdropUrl;

  const handleImageError = () => {
    if (!dynamicBackdrop && item?.title) {
      fetch(`/api/itunes?q=${encodeURIComponent(item.title)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.results?.[0]?.posterUrl) {
            setDynamicBackdrop(data.results[0].posterUrl);
          }
        })
        .catch(() => {});
    }
  };

  return (
    <div
      className="relative rounded-3xl overflow-hidden border border-zinc-800/40 shadow-2xl"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setIsPaused(false);
        }
      }}
    >
      <div className="relative h-[420px] md:h-[520px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={item.tmdbId}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0 bg-zinc-900"
          >
            {activeBackdrop && (
              <img
                src={activeBackdrop}
                alt={item.title}
                className="w-full h-full object-cover"
                onError={handleImageError}
                fetchPriority="high"
                decoding="async"
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#09090B] via-[#09090B]/60 to-zinc-950/80" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#09090B]/90 via-[#09090B]/40 to-transparent" />
          </motion.div>
        </AnimatePresence>

        <div className="absolute bottom-0 left-0 right-0 p-8 md:p-12 flex flex-col md:flex-row gap-6 items-start md:items-end">
          <div className="flex-1 max-w-2xl space-y-4">
            <div className="flex items-center gap-3 text-sm font-semibold">
              <span className="px-2.5 py-1 rounded-full bg-[#EF9F27]/15 text-[#EF9F27] text-xs font-black border border-[#EF9F27]/20">
                98% Match
              </span>
              <span className="text-zinc-400">{year}</span>
              <span className="flex items-center gap-1 text-[#EF9F27]">
                <span>&#9733;</span>
                {item.rating}
              </span>
              <span className="px-2 py-0.5 rounded bg-zinc-800/80 text-zinc-400 text-[10px] font-bold uppercase">
                {item.type === 'movie' ? 'Filme' : 'Série'}
              </span>
            </div>

            <motion.h1
              key={`title-${item.tmdbId}`}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="text-3xl md:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight line-clamp-2"
            >
              {item.title}
            </motion.h1>

            <motion.p
              key={`overview-${item.tmdbId}`}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="text-sm md:text-base text-zinc-300 leading-relaxed line-clamp-3 max-w-xl"
            >
              {item.overview}
            </motion.p>

            <motion.div
              key={`actions-${item.tmdbId}`}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="flex items-center gap-3 pt-2"
            >
              <button
                type="button"
                onClick={() => onPlay(item)}
                className="flex items-center gap-2 px-8 py-3 rounded-xl bg-white hover:bg-zinc-200 text-zinc-950 font-black text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Assistir
              </button>

              <button
                type="button"
                onClick={() => onMoreInfo(item)}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-zinc-600/60 hover:bg-zinc-500/60 text-white font-bold text-sm transition-colors border border-zinc-500/30 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                Mais Informações
              </button>
            </motion.div>
          </div>
        </div>

        {/* Navigation arrows (Left and Right) */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                prevSlide();
              }}
              className="absolute left-4 md:left-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/60 hover:bg-[#E50914] text-white flex items-center justify-center backdrop-blur-md border border-white/10 shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914]"
              aria-label="Título anterior"
              title="Anterior"
            >
              <svg className="w-6 h-6 -ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                nextSlide();
              }}
              className="absolute right-4 md:right-6 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-black/60 hover:bg-[#E50914] text-white flex items-center justify-center backdrop-blur-md border border-white/10 shadow-2xl transition-all duration-200 hover:scale-110 active:scale-95 z-20 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#E50914]"
              aria-label="Próximo título"
              title="Próximo"
            >
              <svg className="w-6 h-6 -mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </>
        )}

        {items.length > 1 && (
          <div className="absolute bottom-6 right-8 flex items-center gap-2 z-20">
            {items.map((_, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentIndex(idx)}
                className={`h-1.5 rounded-full transition-all duration-300 focus:outline-none ${
                  idx === currentIndex
                    ? 'w-8 bg-[#E50914]'
                    : 'w-3 bg-zinc-600/70 hover:bg-zinc-400'
                }`}
                aria-label={`Slide ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
