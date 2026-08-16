'use client';
import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { CatalogItem } from '@/types/media';
import {
  useExpandedCatalog,
  filterByGenreKey,
  type ExpandedGenreKey,
} from '@/hooks/useExpandedCatalog';
import { useMediaExplorer } from '@/hooks/useMediaExplorer';
import MediaCard from './MediaCard';
import MediaExplorerOverlays from './MediaExplorerOverlays';

interface CatalogPageProps {
  type: 'movie' | 'tv';
}

const MOVIE_TABS: { key: ExpandedGenreKey; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'action', label: 'Ação' },
  { key: 'scifi', label: 'Ficção Científica' },
  { key: 'animation', label: 'Animação' },
  { key: 'recent', label: 'Lançamentos' },
];

const SERIES_TABS: { key: ExpandedGenreKey; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'recent', label: 'Lançamentos' },
];

function parseGenreParam(value: string | null, tabs: { key: ExpandedGenreKey; label: string }[]): ExpandedGenreKey {
  if (!value) return 'all';
  const match = tabs.find((t) => t.key === value);
  return match ? match.key : 'all';
}

export default function CatalogPage({ type }: CatalogPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const data = useExpandedCatalog(type);
  const explorer = useMediaExplorer();

  const tabs = type === 'movie' ? MOVIE_TABS : SERIES_TABS;
  const activeTab = parseGenreParam(searchParams.get('genre'), tabs);

  const items = useMemo(() => filterByGenreKey(data, activeTab, type), [data, activeTab, type]);

  const handleTab = (key: ExpandedGenreKey) => {
    const base = type === 'movie' ? '/filmes' : '/series';
    router.push(key === 'all' ? base : `${base}?genre=${key}`);
  };

  const handleBack = () => router.push('/media');

  return (
    <div className="relative min-h-screen">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[450px] pointer-events-none overflow-hidden z-0 opacity-15">
        <div className="absolute top-[-100px] left-1/3 w-[600px] h-[600px] rounded-full bg-[#EF9F27]/15 blur-[140px]" />
      </div>

      <div className="relative z-10 px-4 md:px-8 pb-24 max-w-[1920px] mx-auto">
        <div className="space-y-8">
          <div className="flex items-center gap-4 pt-2">
            <button
              onClick={handleBack}
              className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition-colors"
            >
              &#8592; Voltar ao Catálogo
            </button>
            <h1 className="text-xl md:text-2xl font-black uppercase tracking-wide text-zinc-100">
              <span className="text-[#E50914]">{type === 'movie' ? 'Filmes' : 'Séries'}</span>
            </h1>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTab(tab.key)}
                className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold border transition-all ${
                  activeTab === tab.key
                    ? 'bg-[#EF9F27] text-zinc-950 border-[#EF9F27]'
                    : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                }`}
              >
                {tab.label}
              </button>
            ))}

            <span className="mx-1 h-5 w-px bg-zinc-800" />

            <button
              type="button"
              onClick={() => explorer.setAudioPref(explorer.audioPref === 'ptbr' ? 'any' : 'ptbr')}
              className={`px-3.5 py-1.5 rounded-full text-[11px] font-bold border transition-all flex items-center gap-1.5 ${
                explorer.audioPref === 'ptbr'
                  ? 'bg-[#EF9F27] text-zinc-950 border-[#EF9F27]'
                  : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'
              }`}
              title="Filtrar busca para releases confirmados com áudio dublado PT-BR"
            >
              <span>{explorer.audioPref === 'ptbr' ? '✓' : ''}</span>
              Só Dublado PT-BR
            </button>
          </div>

          {data.loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                <div key={i} className="aspect-[2/3] rounded-lg bg-zinc-900 animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
              <span className="text-4xl">🎬</span>
              <p className="text-zinc-300 font-bold text-sm">Nenhum {type === 'movie' ? 'filme' : 'título'} encontrado nesta categoria.</p>
              <p className="text-zinc-500 text-xs">Tente outra aba ou volte ao catálogo.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {items.map((item) => (
                <MediaCard key={item.tmdbId} item={item} onSelect={explorer.handleOpenModal} badgeType={type === 'movie' ? 'dublado' : 'lancamento'} />
              ))}
            </div>
          )}

          <footer className="pt-10 pb-8 border-t border-zinc-800/80 mt-16 text-zinc-400 text-xs space-y-8 bg-[#09090b]/80 backdrop-blur-md rounded-2xl p-6 md:p-8">
            <div className="space-y-3">
              <div className="flex items-center gap-1">
                <span className="text-xl font-black tracking-tight text-[#E50914] uppercase">JACK</span>
                <span className="text-xl font-black tracking-tight text-white uppercase">IN</span>
              </div>
              <p className="text-[11px] leading-relaxed text-zinc-400 max-w-3xl">
                <strong className="text-zinc-200">AVISO LEGAL:</strong> O JackIn opera como um agregador e indexador automatizado de mídias P2P. Nenhum arquivo de vídeo é hospedado em nossos servidores locais. Todos os conteúdos são fornecidos por terceiros via protocolo BitTorrent.
              </p>
            </div>
          </footer>
        </div>
      </div>

      <MediaExplorerOverlays
        projects={explorer.allProjects}
        selectedMovie={explorer.selectedMovie}
        modalOpen={explorer.modalOpen}
        modalSearching={explorer.modalSearching}
        downloadingItems={explorer.downloadingItems}
        startedItems={explorer.startedItems}
        itemToDelete={explorer.itemToDelete}
        cinemaMedia={explorer.cinemaMedia}
        audioPref={explorer.audioPref}
        searchError={explorer.searchError}
        onSuggestionClick={explorer.handleSuggestionClick}
        onCloseModal={() => explorer.setModalOpen(false)}
        onCloseCinema={() => explorer.setCinemaMedia(null)}
        onDownload={explorer.handleStartDownload}
        onWatch={explorer.handleWatch}
        onRetry={explorer.handleRetry}
        onConfirmDelete={explorer.handleDeleteItem}
        onCancelDelete={() => explorer.setItemToDelete(null)}
      />
    </div>
  );
}
