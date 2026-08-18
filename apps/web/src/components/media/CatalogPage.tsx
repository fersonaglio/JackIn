'use client';
import { useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { buildPosterUrl } from '@/data/media';
import { usePaginatedCatalog, CATALOG_PER_PAGE } from '@/hooks/usePaginatedCatalog';
import { useMediaExplorer } from '@/hooks/useMediaExplorer';
import MediaCard from './MediaCard';
import Pagination from './Pagination';
import MediaExplorerOverlays from './MediaExplorerOverlays';

interface CatalogPageProps {
  type: 'movie' | 'tv';
}

const MOVIE_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'action', label: 'Ação' },
  { key: 'comedy', label: 'Comédia' },
  { key: 'scifi', label: 'Ficção Científica' },
  { key: 'horror', label: 'Terror' },
  { key: 'animation', label: 'Animação' },
  { key: 'thriller', label: 'Suspense' },
  { key: 'drama', label: 'Drama' },
  { key: 'adventure', label: 'Aventura' },
];

const SERIES_TABS: { key: string; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'action', label: 'Ação & Aventura' },
  { key: 'comedy', label: 'Comédia' },
  { key: 'scifi', label: 'Ficção & Fantasia' },
  { key: 'drama', label: 'Drama' },
  { key: 'mystery', label: 'Mistério' },
  { key: 'crime', label: 'Crime' },
  { key: 'animation', label: 'Animação' },
  { key: 'documentary', label: 'Documentário' },
];

function parseGenreParam(value: string | null, tabs: { key: string; label: string }[]): string {
  if (!value) return 'all';
  const match = tabs.find((t) => t.key === value);
  return match ? match.key : 'all';
}

export default function CatalogPage({ type }: CatalogPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const explorer = useMediaExplorer();

  const tabs = type === 'movie' ? MOVIE_TABS : SERIES_TABS;
  const activeTab = parseGenreParam(searchParams.get('genre'), tabs);
  const pageParam = searchParams.get('page');

  const genreKey = activeTab === 'all' ? '' : activeTab;
  const catalog = usePaginatedCatalog(type, genreKey);
  const { page, totalPages, items, loading, loadingMore, error, setPage } = catalog;

  // Aplica o ?page=N vindo da URL assim que os dados carregam. Quando ainda há
  // mais conteúdo no servidor (hasMore), a página N da URL é respeitada além
  // do que já foi carregado (o clique em "próxima" na borda dispara o lote).
  const appliedUrlPageRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const parsed = pageParam ? parseInt(pageParam, 10) : 1;
    const numeric = Number.isFinite(parsed) ? parsed : 1;
    const target = catalog.hasMore
      ? Math.max(numeric, 1)
      : Math.min(Math.max(numeric, 1), totalPages);
    if (appliedUrlPageRef.current !== pageParam) {
      appliedUrlPageRef.current = pageParam;
      if (target !== page) setPage(target);
    }
  }, [loading, pageParam, totalPages, page, setPage, catalog.hasMore]);

  // Prefetch dos posters da próxima página (dados já estão em memória para
  // todas as páginas; só as imagens da página seguinte são aquecidas para a
  // navegação ser instantânea sem sobrecarregar a rede).
  useEffect(() => {
    const nextStart = page * CATALOG_PER_PAGE;
    const next = catalog.allItems.slice(nextStart, nextStart + CATALOG_PER_PAGE);
    for (const it of next) {
      const url = buildPosterUrl(it.posterPath, 'w500');
      if (url) {
        const img = new Image();
        img.src = url;
      }
    }
  }, [page, catalog.allItems]);

  const handleTab = (key: string) => {
    appliedUrlPageRef.current = null;
    const base = type === 'movie' ? '/filmes' : '/series';
    router.push(key === 'all' ? base : `${base}?genre=${key}`);
  };

  const handlePageChange = (p: number) => {
    setPage(p);
    appliedUrlPageRef.current = String(p);
    const base = type === 'movie' ? '/filmes' : '/series';
    const qs = new URLSearchParams();
    if (activeTab !== 'all') qs.set('genre', activeTab);
    if (p > 1) qs.set('page', String(p));
    router.replace(`${base}${qs.toString() ? `?${qs}` : ''}`);
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
            {!loading && totalPages > 0 && (
              <span className="text-[11px] font-mono text-zinc-500">
                {totalPages} página{totalPages > 1 ? 's' : ''} · {items.length} título{items.length !== 1 ? 's' : ''}
              </span>
            )}
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
          </div>

          {loading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                <div key={i} className="aspect-[2/3] rounded-lg bg-zinc-900 animate-pulse" />
              ))}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
              <span className="text-4xl">⚠️</span>
              <p className="text-zinc-300 font-bold text-sm">{error}</p>
              <button
                onClick={catalog.refresh}
                className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-bold text-xs transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4 text-center">
              <span className="text-4xl">🎬</span>
              <p className="text-zinc-300 font-bold text-sm">Nenhum {type === 'movie' ? 'filme' : 'título'} encontrado nesta categoria.</p>
              <p className="text-zinc-500 text-xs">Tente outra aba ou volte ao catálogo.</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {items.map((item) => (
                  <MediaCard key={item.tmdbId} item={item} onSelect={explorer.handleOpenModal} badgeType="lancamento" />
                ))}
              </div>
              <Pagination page={page} totalPages={totalPages} hasMore={catalog.hasMore} onChange={handlePageChange} />
              {loadingMore && (
                <div className="flex items-center justify-center gap-2 mt-4 text-zinc-400 text-xs">
                  <span className="w-4 h-4 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
                  Carregando mais títulos…
                </div>
              )}
            </>
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
