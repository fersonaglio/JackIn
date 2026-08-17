'use client';
import type { MovieSearchResult, MediaOption, Project } from '@/lib/api';
import type { DeleteTarget } from '@/hooks/useMediaExplorer';
import DownloadDock from './DownloadDock';
import MediaDetailModal from './MediaDetailModal';
import CinemaPlayer from './CinemaPlayer';
import DeleteDialog from '@/components/ui/DeleteDialog';

interface MediaExplorerOverlaysProps {
  projects: Project[];
  selectedMovie: MovieSearchResult | null;
  modalOpen: boolean;
  modalSearching: boolean;
  downloadingItems: Record<string, boolean>;
  startedItems: Record<string, boolean>;
  itemToDelete: DeleteTarget | null;
  cinemaMedia: { title: string; videoUrl: string; projectId: string; episodeList?: { id: string; title: string; videoUrl: string }[] } | null;
  audioPref?: string;
  searchError?: string | null;
  onCloseModal: () => void;
  onCloseCinema: () => void;
  onDownload: (movieTitle: string, option: MediaOption, posterUrl?: string) => void;
  onDownloadAll?: (seriesTitle: string, posterUrl: string | undefined, seasons: { seasonNumber: number; option: MediaOption }[]) => void;
  onWatch: (project: Project, episodeList?: { id: string; title: string; videoUrl: string }[]) => void;
  onRetry: (project: Project) => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onSuggestionClick?: (title: string) => void;
}

export default function MediaExplorerOverlays({
  projects,
  selectedMovie,
  modalOpen,
  modalSearching,
  downloadingItems,
  startedItems,
  itemToDelete,
  cinemaMedia,
  audioPref = 'any',
  searchError,
  onCloseModal,
  onCloseCinema,
  onDownload,
  onDownloadAll,
  onWatch,
  onRetry,
  onConfirmDelete,
  onCancelDelete,
  onSuggestionClick,
}: MediaExplorerOverlaysProps) {
  return (
    <>
      <DownloadDock projects={projects} onWatch={onWatch} onRetry={onRetry} />

      <MediaDetailModal
        movie={selectedMovie}
        isOpen={modalOpen}
        onClose={onCloseModal}
        downloadingItems={downloadingItems}
        startedItems={startedItems}
        onDownload={onDownload}
        onDownloadAll={onDownloadAll}
        isSearchingTorrents={modalSearching}
        initialAudioFilter="any"
        ptStrictRequest={audioPref === 'ptbr'}
        onSuggestionClick={onSuggestionClick}
        searchError={searchError}
      />

      <CinemaPlayer
        isOpen={cinemaMedia !== null}
        title={cinemaMedia?.title || ''}
        videoUrl={cinemaMedia?.videoUrl || ''}
        projectId={cinemaMedia?.projectId || ''}
        onClose={onCloseCinema}
        episodeList={cinemaMedia?.episodeList}
        onEpisodeChange={(episodeId) => {
          const ep = cinemaMedia?.episodeList?.find(e => e.id === episodeId);
          if (ep) onWatch({ id: ep.id, title: ep.title, youtubeUrl: '', status: 'done' } as Project);
        }}
      />

      <DeleteDialog
        open={itemToDelete !== null}
        title={itemToDelete?.title || ''}
        customTitle={itemToDelete?.isSeries ? 'Excluir Série' : 'Excluir Mídia'}
        customMessage={
          itemToDelete?.isSeries
            ? `Tem certeza que deseja excluir todos os ${itemToDelete.count ? `${itemToDelete.count} ` : ''}episódios de "${itemToDelete?.title || ''}"? Esta ação removerá os arquivos e não pode ser desfeita.`
            : `Tem certeza que deseja excluir "${itemToDelete?.title || ''}"? Esta ação removerá os arquivos e não pode ser desfeita.`
        }
        onConfirm={onConfirmDelete}
        onCancel={onCancelDelete}
      />
    </>
  );
}
