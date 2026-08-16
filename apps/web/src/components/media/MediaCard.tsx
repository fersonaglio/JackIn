'use client';
import { useState, useEffect } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { CatalogItem } from '@/types/media';
import { buildPosterUrl } from '@/data/media';

interface MediaCardProps {
  item: CatalogItem;
  onSelect: (item: CatalogItem) => void;
  priority?: boolean;
  badgeType?: 'lancamento' | 'dublado' | 'legendado' | 'filme';
}

export default function MediaCard({ item, onSelect, priority = false, badgeType }: MediaCardProps) {
  const posterUrl = buildPosterUrl(item.posterPath, 'w500');
  const year = item.year ?? '—';
  const [imageError, setImageError] = useState(false);
  const [dynamicPoster, setDynamicPoster] = useState<string | null>(null);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if ((imageError || !posterUrl) && !dynamicPoster) {
      let isMounted = true;
      fetch(`/api/itunes?q=${encodeURIComponent(item.title)}`)
        .then((res) => res.json())
        .then((data) => {
          if (isMounted && data.results?.[0]?.posterUrl) {
            setDynamicPoster(data.results[0].posterUrl);
          }
        })
        .catch(() => {});
      return () => { isMounted = false; };
    }
  }, [imageError, posterUrl, item.title, dynamicPoster]);

  const activePoster = dynamicPoster || (imageError ? null : posterUrl);

  const hoverProps = prefersReduced ? {} : { scale: 1.04, y: -4 };
  const tapProps = prefersReduced ? {} : { scale: 0.97 };

  const isRecentRelease = Boolean(item.year && item.year >= 2024);
  const isDublado = (item.tmdbId % 2 === 0);
  const badgeLabel = badgeType === 'lancamento'
    ? (isRecentRelease ? 'LANÇAMENTO' : isDublado ? 'DUBLADO' : 'LEGENDADO')
    : badgeType === 'dublado'
    ? 'DUBLADO'
    : badgeType === 'legendado'
    ? 'LEGENDADO'
    : isRecentRelease
    ? 'LANÇAMENTO'
    : isDublado
    ? 'DUBLADO'
    : 'LEGENDADO';

  const badgeBg = badgeLabel === 'LANÇAMENTO' || badgeLabel === 'DUBLADO' 
    ? 'bg-[#E50914] text-white font-black' 
    : 'bg-[#8B0000] text-zinc-100 font-bold';

  return (
    <div className="flex flex-col shrink-0 w-[150px] sm:w-[170px] md:w-[190px] group cursor-pointer" onClick={() => onSelect(item)}>
      <motion.div
        whileHover={hoverProps}
        whileTap={tapProps}
        transition={{ duration: 0.2 }}
        className="relative w-full aspect-[2/3] rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800/80 shadow-md group-hover:border-red-600/50 group-hover:shadow-red-950/40 group-hover:shadow-xl transition-all"
      >
        {/* Poster Image */}
        {activePoster ? (
          <img
            src={activePoster}
            alt={item.title}
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={() => {
              if (!dynamicPoster) setImageError(true);
            }}
          />
        ) : (
          <div className="w-full h-full flex flex-col justify-between p-3 bg-gradient-to-br from-zinc-900 via-zinc-950 to-black relative">
            <div className="flex items-center justify-between">
              <span className="text-base">🎬</span>
              <span className="text-[10px] font-mono text-zinc-400">{item.year || '4K'}</span>
            </div>
            <div>
              <h4 className="text-xs font-bold text-zinc-200 line-clamp-2 leading-tight">
                {item.title}
              </h4>
            </div>
          </div>
        )}

        {/* Top-Left Red Ribbon Badge */}
        <div className="absolute top-2 left-2 z-10">
          <span className={`px-2 py-0.5 rounded text-[8.5px] tracking-wider uppercase shadow-md ${badgeBg}`}>
            {badgeLabel}
          </span>
        </div>

        {/* Top-Right Year Pill (Pobreflix style) */}
        {year && year !== '—' && (
          <div className="absolute top-2 right-2 z-10">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-black/75 text-amber-400 border border-amber-500/20 backdrop-blur-md">
              {year}
            </span>
          </div>
        )}

        {/* Dark Hover Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-3">
          <p className="text-[11px] text-zinc-300 line-clamp-3 leading-relaxed mb-2">
            {item.overview || 'Mídia em qualidade 4K Ultra HD com áudio multicanal e dublagem PT-BR.'}
          </p>
          <div className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
            <span>★</span>
            <span>{item.rating} / 10</span>
          </div>
        </div>
      </motion.div>

      {/* Under-Card Title & Meta Text (Pobreflix style) */}
      <div className="mt-2 space-y-0.5 px-0.5 text-left">
        <h4 className="text-xs md:text-sm font-bold text-zinc-100 group-hover:text-red-500 transition-colors line-clamp-1 leading-snug">
          {item.title}
        </h4>
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 font-medium">
          <span>{year}</span>
          <span>&middot;</span>
          <span className="flex items-center gap-0.5 text-amber-400/90 font-bold">
            ★ {item.rating}
          </span>
        </div>
      </div>
    </div>
  );
}
