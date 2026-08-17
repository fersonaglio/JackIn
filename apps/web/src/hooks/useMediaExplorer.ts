'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listProjects,
  deleteProject,
  deleteSeries,
  searchMediaSources,
  downloadMediaMovie,
  retryMediaDownload,
  type MovieSearchResult,
  type MediaOption,
  type Project,
} from '@/lib/api';
import type { CatalogItem } from '@/types/media';
import { buildPosterUrl, buildBackdropUrl } from '@/data/media';

const APPROX_MIN_SCORE = 0.5;

export interface DeleteTarget {
  id: string;
  title: string;
  isSeries?: boolean;
  seriesId?: string;
  count?: number;
}

export function catalogToPreview(item: CatalogItem): MovieSearchResult {
  return {
    id: String(item.tmdbId),
    title: item.title,
    originalTitle: item.originalTitle || item.title,
    year: String(item.year ?? '—'),
    overview: item.overview,
    posterUrl: buildPosterUrl(item.posterPath, 'w500'),
    backdropUrl: buildBackdropUrl(item.backdropPath, 'w1280'),
    genre: item.genres[0] || '',
    rating: String(item.rating),
    options: [],
  };
}

function isValidSourceUrl(url: string): boolean {
  if (url.startsWith('magnet:')) return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Shared media-explorer behavior (modal + torrent search + download + cinema +
 * library management) used by both the /media catalog and the /search page so
 * the two screens never drift apart.
 */
export function useMediaExplorer() {
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [cinemaMedia, setCinemaMedia] = useState<{ title: string; videoUrl: string; projectId: string; episodeList?: { id: string; title: string; videoUrl: string }[] } | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<MovieSearchResult | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSearching, setModalSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [audioPref, setAudioPref] = useState<string>('any');
  const [downloadingItems, setDownloadingItems] = useState<Record<string, boolean>>({});
  const [startedItems, setStartedItems] = useState<Record<string, boolean>>({});
  const [itemToDelete, setItemToDelete] = useState<DeleteTarget | null>(null);
  // Guards against double-clicks / rapid spam on "Tentar" — the server re-search
  // is slow, so without this a burst of clicks used to spawn duplicate workers.
  const retryInFlightRef = useRef<string | null>(null);

  const pollActiveProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      setAllProjects(list || []);
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    pollActiveProjects();
    const interval = setInterval(pollActiveProjects, 1500);
    return () => clearInterval(interval);
  }, [pollActiveProjects]);

  const runSearch = useCallback(
    async (item: CatalogItem, preview: MovieSearchResult) => {
      setModalSearching(true);
      setSearchError(null);
      try {
        const searchQuery = item.originalTitle || item.title;
        const ptTitleIfDifferent = item.title && item.originalTitle && item.title !== item.originalTitle ? item.title : undefined;
        const data = await searchMediaSources(searchQuery, audioPref === 'any' ? undefined : audioPref, {
          year: item.year,
          posterUrl: buildPosterUrl(item.posterPath, 'w500'),
          overview: item.overview,
          genre: item.genres[0] || '',
        }, ptTitleIfDifferent);
        const results = data.results || [];
        const withOptions = results.filter((r) => r.options && r.options.length > 0);
        // Prefer a result carrying a confirmed PT-BR option (the dubbed release),
        // so the modal never shows only the 4K MULTI while hiding the real dub.
        const ptResult = withOptions.find((r) => r.options.some((o) => o.ptConfirmed));
        const top = ptResult || withOptions[0] || null;
        if (top) {
          if (top.exactMatch) {
            setSelectedMovie({ ...preview, options: top.options, ptUnavailable: top.ptUnavailable });
          } else if ((top.matchScore ?? 0) >= APPROX_MIN_SCORE) {
            setSelectedMovie({
              ...preview,
              options: top.options,
              approximate: true,
              approximateTitle: top.title,
              ptUnavailable: top.ptUnavailable,
            });
          } else {
            setSelectedMovie({ ...preview, options: [], ptUnavailable: top.ptUnavailable });
          }
        } else {
          setSelectedMovie({ ...preview, options: [] });
        }
      } catch {
        setSelectedMovie(preview);
        setSearchError('A busca de torrents demorou ou falhou. O servidor local pode estar ocupado — tente novamente.');
      } finally {
        setModalSearching(false);
      }
    },
    [audioPref]
  );

  const handleOpenModal = useCallback(
    async (item: CatalogItem) => {
      const preview = catalogToPreview(item);
      setSelectedMovie(preview);
      setSearchError(null);
      setModalOpen(true);
      await runSearch(item, preview);
    },
    [runSearch]
  );

  const handleSuggestionClick = useCallback(
    async (title: string) => {
      const preview: MovieSearchResult = {
        id: `suggestion-${title}`,
        title,
        originalTitle: title,
        year: '—',
        overview: '',
        posterUrl: '',
        genre: '',
        rating: '',
        options: [],
      };
      setSelectedMovie(preview);
      setModalOpen(true);
      setModalSearching(true);
      try {
        const data = await searchMediaSources(title, 'ptbr');
        const top = (data.results || []).find((r) => r.options && r.options.length > 0);
        if (top) {
          setSelectedMovie({
            ...preview,
            options: top.options,
            exactMatch: top.exactMatch,
            matchScore: top.matchScore,
            ptUnavailable: top.ptUnavailable,
          });
        }
      } catch {
        // keep the bare preview (no options) — modal shows "no sources"
      } finally {
        setModalSearching(false);
      }
    },
    []
  );

  const handleStartDownload = useCallback(
    async (movieTitle: string, option: MediaOption, posterUrl?: string) => {
      if (!isValidSourceUrl(option.sourceUrl)) return;
      const key = `${movieTitle}-${option.id}`;
      setDownloadingItems((prev) => ({ ...prev, [key]: true }));
      try {
        const finalPosterUrl = posterUrl || selectedMovie?.posterUrl;
        const altSourceUrls = (selectedMovie?.options ?? [])
          .map((o) => o.sourceUrl)
          .filter((u: string): u is string => !!u && u !== option.sourceUrl);
        await downloadMediaMovie(movieTitle, option.quality, option.sourceUrl, finalPosterUrl, altSourceUrls);
        pollActiveProjects();
        setStartedItems((prev) => ({ ...prev, [key]: true }));
        setTimeout(() => {
          setStartedItems((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }, 3200);
      } catch {
        // silent
      } finally {
        setDownloadingItems((prev) => ({ ...prev, [key]: false }));
      }
    },
    [selectedMovie, pollActiveProjects]
  );

  const handleDeleteItem = useCallback(async () => {
    if (!itemToDelete) return;
    try {
      if (itemToDelete.isSeries && itemToDelete.seriesId) {
        await deleteSeries(itemToDelete.seriesId);
      } else {
        await deleteProject(itemToDelete.id);
      }
      pollActiveProjects();
    } catch (e) {
      console.error('Failed to delete item:', e);
    } finally {
      setItemToDelete(null);
    }
  }, [itemToDelete, pollActiveProjects]);

  const handleDeleteSeries = useCallback(
    async (series: { title: string; seriesId: string; episodes: Project[] }) => {
      try {
        await deleteSeries(series.seriesId);
        pollActiveProjects();
      } catch (e) {
        console.error('Failed to delete series:', e);
      }
    },
    [pollActiveProjects]
  );

  const handleRetry = useCallback(
    async (project: Project) => {
      if (retryInFlightRef.current === project.id) return;
      retryInFlightRef.current = project.id;
      try {
        await retryMediaDownload(project.id);
      } catch {
        // Conflict (already downloading) or failure — refresh so the UI shows
        // the real server state instead of a stale card.
      } finally {
        retryInFlightRef.current = null;
        pollActiveProjects();
      }
    },
    [pollActiveProjects]
  );

  const handleWatch = useCallback((project: Project, episodeList?: { id: string; title: string; videoUrl: string }[]) => {
    const baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
    setCinemaMedia({
      title: project.title || 'Filme',
      videoUrl: `${baseUrl}/projects/${project.id}/video`,
      projectId: project.id,
      episodeList,
    });
  }, []);

  // Abre automaticamente em nova janela se o parâmetro ?watch= estiver na URL
  const hasAutoWatchedRef = useRef(false);
  useEffect(() => {
    if (hasAutoWatchedRef.current || allProjects.length === 0) return;
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const watchId = params.get('watch');
      if (watchId) {
        const proj = allProjects.find((p) => p.id === watchId);
        if (proj) {
          hasAutoWatchedRef.current = true;
          handleWatch(proj);
        }
      }
    }
  }, [allProjects, handleWatch]);

  // Biblioteca do JackIn: filmes + episódios de séries (agrupados por seriesId).
  const flixProjects = allProjects.filter((p) => p.projectType === 'movie' || p.projectType === 'series');

  // Contagem da biblioteca: cada série conta como UM item (não por episódio).
  const libraryCount =
    flixProjects.filter((p) => p.projectType === 'movie').length +
    new Set(flixProjects.filter((p) => p.seriesId).map((p) => p.seriesId)).size;

  return {
    allProjects,
    flixProjects,
    movieProjects: flixProjects,
    libraryCount,
    cinemaMedia,
    selectedMovie,
    modalOpen,
    modalSearching,
    searchError,
    audioPref,
    setAudioPref,
    downloadingItems,
    startedItems,
    itemToDelete,
    handleOpenModal,
    handleSuggestionClick,
    handleStartDownload,
    handleDeleteItem,
    handleDeleteSeries,
    handleRetry,
    handleWatch,
    setModalOpen,
    setItemToDelete,
    setCinemaMedia,
    pollActiveProjects,
  };
}

export type MediaExplorer = ReturnType<typeof useMediaExplorer>;
