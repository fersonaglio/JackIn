'use client';

import { useState } from 'react';
import { MediaCatalog, LibraryGrid, MediaExplorerOverlays } from '@/components/media';
import { useMediaExplorer } from '@/hooks/useMediaExplorer';

export default function MediaExplorerPage() {
  const explorer = useMediaExplorer();
  const [libraryFilter, setLibraryFilter] = useState('');

  return (
    <div className="relative min-h-screen">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-[450px] pointer-events-none overflow-hidden z-0 opacity-15">
        <div className="absolute top-[-100px] left-1/3 w-[600px] h-[600px] rounded-full bg-[#EF9F27]/15 blur-[140px]" />
      </div>

      <div className="relative z-10 px-4 md:px-8 pb-24 max-w-[1920px] mx-auto">
        <MediaCatalog
          onSelectItem={explorer.handleOpenModal}
          onSelectPt={(item) => {
            explorer.setAudioPref('ptbr');
            explorer.handleOpenModal(item);
          }}
          libraryCount={explorer.libraryCount}
        >
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
        </MediaCatalog>
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
