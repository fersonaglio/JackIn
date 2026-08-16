'use client';
import { motion } from 'framer-motion';

export type TabId = 'home' | 'movies' | 'series' | '4k' | 'library';

interface CategoryTabsProps {
  active: TabId;
  onChange: (tab: TabId) => void;
  libraryCount?: number;
}

const tabs: { id: TabId; label: string }[] = [
  { id: 'home', label: 'Início' },
  { id: 'movies', label: 'Filmes' },
  { id: 'series', label: 'Séries' },
  { id: '4k', label: '4K Ultra HD' },
  { id: 'library', label: 'Minha Biblioteca' },
];

export default function CategoryTabs({ active, onChange, libraryCount }: CategoryTabsProps) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto pb-1" role="tablist" aria-label="Navegação do catálogo">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onChange(tab.id)}
          className={`relative px-5 py-2.5 rounded-full text-sm font-semibold whitespace-nowrap transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EF9F27] ${
            active === tab.id
              ? 'bg-[#EF9F27] text-zinc-950'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
          }`}
        >
          {tab.label}
          {tab.id === 'library' && libraryCount !== undefined && libraryCount > 0 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-black bg-zinc-950/30 text-zinc-950">
              {libraryCount}
            </span>
          )}
          {active === tab.id && (
            <motion.div
              layoutId="tab-indicator"
              className="absolute inset-0 rounded-full bg-[#EF9F27] -z-10"
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            />
          )}
        </button>
      ))}
    </nav>
  );
}
