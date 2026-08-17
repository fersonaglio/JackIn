'use client';

import { MediaCatalog, MediaExplorerOverlays } from '@/components/media';
import { useMediaExplorer } from '@/hooks/useMediaExplorer';

export default function MediaExplorerPage() {
  const explorer = useMediaExplorer();

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
