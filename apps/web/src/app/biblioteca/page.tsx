'use client';

import { useState } from 'react';
import { LibraryGrid, MediaExplorerOverlays } from '@/components/media';
import { useMediaExplorer } from '@/hooks/useMediaExplorer';

export default function BibliotecaPage() {
  const explorer = useMediaExplorer();
  const [libraryFilter, setLibraryFilter] = useState('');

  return (
    <div className="relative min-h-screen">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[450px] pointer-events-none overflow-hidden z-0 opacity-15">
        <div className="absolute top-[-100px] left-1/3 w-[600px] h-[600px] rounded-full bg-[#EF9F27]/15 blur-[140px]" />
      </div>

      <div className="relative z-10 px-4 md:px-8 pt-6 pb-24 max-w-[1920px] mx-auto space-y-6">
        <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
          <div>
            <h1 className="text-2xl md:text-3xl font-black uppercase tracking-tight text-white">
              Minha <span className="text-[#E50914]">Biblioteca</span>
            </h1>
            <p className="text-xs text-zinc-400 mt-1">
              Gerencie seus downloads, reproduções recentes e mídias salvas localmente.
            </p>
          </div>
        </div>

        <LibraryGrid
          projects={explorer.movieProjects}
          filter={libraryFilter}
          onFilterChange={setLibraryFilter}
          onWatch={explorer.handleWatch}
          onDelete={(p) => explorer.setItemToDelete({ id: p.id, title: p.title || 'Mídia' })}
          onDeleteSeries={(s) =>
            explorer.setItemToDelete({
              id: s.seriesId,
              title: s.title || 'Série',
              isSeries: true,
              seriesId: s.seriesId,
              count: s.episodes.length,
            })
          }
          onRetry={explorer.handleRetry}
          onToggleWatched={explorer.handleToggleWatched}
          onRedownload={(title) =>
            explorer.handleOpenModal({
              tmdbId: 0 as any,
              title,
              overview: '',
              posterPath: '',
              backdropPath: '',
              year: 2024,
              rating: 0,
              genres: [],
              type: 'movie',
            })
          }
        />
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
