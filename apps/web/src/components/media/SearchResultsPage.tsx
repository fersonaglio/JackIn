'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CatalogItem } from '@/types/media';
import { catalogSearch } from '@/lib/catalogSearch';
import ITunesResultsGrid from './ITunesResultsGrid';
import SearchLoading from './SearchLoading';
import SearchBar from './SearchBar';
import { useMediaExplorer } from '@/hooks/useMediaExplorer';
import MediaExplorerOverlays from './MediaExplorerOverlays';

export default function SearchResultsPage({ query }: { query: string }) {
  const router = useRouter();
  const [results, setResults] = useState<CatalogItem[] | null>(null);
  const [error, setError] = useState<'offline' | 'generic' | null>(null);
  const explorer = useMediaExplorer();

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    setResults(null);
    setError(null);
    const timer = setTimeout(async () => {
      try {
        const items = await catalogSearch(query, ctrl.signal);
        if (!cancelled) setResults(items);
      } catch (e) {
        if (!cancelled && !ctrl.signal.aborted) {
          setError((e as Error).message === 'API_OFFLINE' ? 'offline' : 'generic');
        }
      }
    }, 300);
    return () => {
      cancelled = true;
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [query]);

  const handleBack = () => router.push('/media');

  return (
    <div className="relative min-h-screen">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[450px] pointer-events-none overflow-hidden z-0 opacity-15">
        <div className="absolute top-[-100px] left-1/3 w-[600px] h-[600px] rounded-full bg-[#EF9F27]/15 blur-[140px]" />
      </div>

      <div className="relative z-10 px-4 md:px-8 pt-8 pb-40 max-w-[1920px] mx-auto">
        <div className="space-y-6">
          <div className="w-full max-w-3xl mx-auto">
            <SearchBar />
          </div>
          {results === null ? (
            <SearchLoading query={query} />
          ) : error === 'offline' ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
              <span className="text-4xl">🔌</span>
              <p className="text-zinc-300 font-bold text-sm">
                O servidor local está offline.
              </p>
              <p className="text-zinc-500 text-xs max-w-md">
                Inicie a API do JackIn (na pasta do projeto: <code className="text-zinc-400">npm run dev:server</code> ou <code className="text-zinc-400">npm run dev:all</code>) e tente buscar de novo.
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition-colors"
                >
                  &#8592; Voltar ao Catálogo
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="px-4 py-2 rounded-xl bg-[#EF9F27] hover:bg-[#ffb04d] text-black font-bold text-xs transition-colors"
                >
                  &#8635; Tentar de novo
                </button>
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
              <span className="text-4xl">📡</span>
              <p className="text-zinc-300 font-bold text-sm">
                Não foi possível buscar <span className="text-[#EF9F27]">“{query}”</span> agora.
              </p>
              <p className="text-zinc-500 text-xs">Verifique sua conexão e tente novamente.</p>
              <button
                onClick={handleBack}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition-colors"
              >
                &#8592; Voltar ao Catálogo
              </button>
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
              <span className="text-4xl">🕵️</span>
              <p className="text-zinc-300 font-bold text-sm">
                Nada encontrado para <span className="text-[#EF9F27]">"{query}"</span>
              </p>
              <p className="text-zinc-500 text-xs">Tente outro nome ou busque diretamente nos sites de torrents.</p>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleBack}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition-colors"
                >
                  &#8592; Voltar ao Catálogo
                </button>
                <button
                  onClick={() => explorer.handleSuggestionClick(query)}
                  className="px-4 py-2 rounded-xl bg-[#EF9F27] hover:bg-[#ffb04d] text-black font-bold text-xs transition-colors"
                >
                  &#9881; Buscar nos sites de torrents
                </button>
              </div>
            </div>
          ) : (
            <ITunesResultsGrid
              results={results}
              query={query}
              onSelect={explorer.handleOpenModal}
              onBack={handleBack}
            />
          )}
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
        onCloseModal={() => explorer.setModalOpen(false)}
        onCloseCinema={explorer.handleCloseCinema}
        onDownload={explorer.handleStartDownload}
        onDownloadAll={explorer.handleDownloadAllSeasons}
        onWatch={explorer.handleWatch}
        onRetry={explorer.handleRetry}
        onConfirmDelete={explorer.handleDeleteItem}
        onCancelDelete={() => explorer.setItemToDelete(null)}
      />
    </div>
  );
}
