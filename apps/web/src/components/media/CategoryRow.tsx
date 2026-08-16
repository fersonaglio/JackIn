'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import MediaCard from './MediaCard';
import type { CatalogItem } from '@/types/media';

interface CategoryRowProps {
  title: string;
  items: CatalogItem[];
  onSelect: (item: CatalogItem) => void;
  badgeType?: 'lancamento' | 'dublado' | 'legendado' | 'filme';
  viewAllHref?: string;
}

export default function CategoryRow({ title, items, onSelect, badgeType, viewAllHref }: CategoryRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  if (items.length === 0) return null;

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setShowLeftArrow(el.scrollLeft > 10);
    setShowRightArrow(el.scrollLeft < el.scrollWidth - el.clientWidth - 10);
  };

  const scroll = (direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const scrollAmount = el.clientWidth * 0.7;
    el.scrollBy({
      left: direction === 'left' ? -scrollAmount : scrollAmount,
      behavior: 'smooth',
    });
  };

  return (
    <div className="space-y-3">
      {/* Pobreflix Red Vertical Bar Section Header */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-5 bg-[#E50914] rounded-full inline-block" />
          <h2 className="text-base md:text-lg font-black text-zinc-100 uppercase tracking-wide">
            {title}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          {viewAllHref ? (
            <Link
              href={viewAllHref}
              className="px-2.5 py-1 rounded bg-[#E50914] hover:bg-[#E50914]/90 text-white font-black text-[10px] uppercase tracking-wider transition-colors"
            >
              VER TODOS
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="px-2.5 py-1 rounded bg-[#E50914] opacity-40 text-white font-black text-[10px] uppercase tracking-wider cursor-default"
            >
              VER TODOS
            </button>
          )}
          <div className="hidden sm:flex items-center gap-1">
            <button
              type="button"
              onClick={() => scroll('left')}
              className="w-7 h-7 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center text-xs transition-colors"
              aria-label="Anterior"
            >
              &#8249;
            </button>
            <button
              type="button"
              onClick={() => scroll('right')}
              className="w-7 h-7 rounded bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center text-xs transition-colors"
              aria-label="Próximo"
            >
              &#8250;
            </button>
          </div>
        </div>
      </div>

      <div className="relative group/row">
        <div
          ref={scrollRef}
          onScroll={checkScroll}
          className="flex gap-4 overflow-x-auto scrollbar-none scroll-smooth pb-3 pt-1 px-1 focus:outline-none"
        >
          {items.map((item, index) => (
            <MediaCard
              key={item.tmdbId}
              item={item}
              onSelect={onSelect}
              priority={index < 4}
              badgeType={badgeType}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
