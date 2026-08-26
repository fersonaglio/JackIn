'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  listProjects,
  deleteProject,
  deleteSeries,
  searchMediaSources,
  downloadMediaMovie,
  retryMediaDownload,
  markWatched,
  type MovieSearchResult,
  type MediaOption,
  type Project,
} from '@/lib/api';
import type { CatalogItem } from '@/types/media';
import { buildPosterUrl, buildBackdropUrl } from '@/data/media';
import { groupSeriesSeasons } from '@/lib/seriesSeasons';
import { buildAltSourceUrls } from '@/lib/mediaOptions';

const APPROX_MIN_SCORE = 0.5;

export interface DeleteTarget {
  id: string;
  title: string;
  isSeries?: boolean;
  seriesId?: string;
  count?: number;
}

const TMDB_GENRE_NAMES: Record<string, string> = {
  '28': 'Ação',
  '12': 'Aventura',
  '16': 'Animação',
  '35': 'Comédia',
  '80': 'Crime',
  '99': 'Documentário',
  '18': 'Drama',
  '10751': 'Família',
  '14': 'Fantasia',
  '36': 'História',
  '27': 'Terror',
  '10402': 'Música',
  '9648': 'Mistério',
  '10749': 'Romance',
  '878': 'Ficção Científica',
  '10770': 'Cinema TV',
  '53': 'Suspense',
  '10752': 'Guerra',
  '37': 'Faroeste',
  '10759': 'Ação & Aventura',
  '10762': 'Infantil',
  '10763': 'Notícias',
  '10764': 'Reality Show',
  '10765': 'Ficção Científica & Fantasia',
  '10766': 'Novela',
  '10767': 'Talk Show',
  '10768': 'Guerra & Política',
};

export function formatGenre(genre?: string): string {
  if (!genre) return '';
  return TMDB_GENRE_NAMES[genre] || genre;
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
    genre: formatGenre(item.genres[0]),
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
  const [audioPref, setAudioPref] = useState<string>('ptbr');
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
          genre: formatGenre(item.genres[0]),
        }, ptTitleIfDifferent);
        const results = data.results || [];
        const withOptions = results.filter((r) => r.options && r.options.length > 0);
        // Filtra por tipo do item do catálogo: um filme NÃO deve usar resultados
        // de série (e vice-versa). A engine às vezes retorna um "series" falso
        // para filme (magnets com "Temporada 1/2" de outro título) — sem este
        // filtro, o agrupamento por temporada engole o filme dublado real e o
        // modal só mostra as opções ORIGINAL da série fake.
        const byType =
          item.type === 'tv'
            ? withOptions.filter((r) => r.mediaType === 'series' || r.mediaType === 'tv')
            : withOptions.filter((r) => r.mediaType !== 'series' && r.mediaType !== 'tv');
        // Se o filtro esvaziou, usa o que a engine achou (melhor que nada).
        const usable = byType.length > 0 ? byType : withOptions;
        // Prefer a result carrying a confirmed PT-BR option (the dubbed release),
        // so the modal never shows only the 4K MULTI while hiding the real dub.
        const ptResult = usable.find((r) => r.options.some((o) => o.ptConfirmed));
        const top = ptResult || usable[0] || null;
        // Séries: agrupa TODAS as temporadas retornadas (a busca traz um
        // resultado por temporada) em vez de mostrar só a primeira.
        const seasons = groupSeriesSeasons(usable);
        if (top) {
          if (top.exactMatch) {
            setSelectedMovie({ ...preview, options: top.options, ptUnavailable: top.ptUnavailable, seasons });
          } else if ((top.matchScore ?? 0) >= APPROX_MIN_SCORE) {
            setSelectedMovie({
              ...preview,
              options: top.options,
              approximate: true,
              approximateTitle: top.title,
              ptUnavailable: top.ptUnavailable,
              seasons,
            });
          } else {
            setSelectedMovie({ ...preview, options: [], ptUnavailable: top.ptUnavailable, seasons });
          }
        } else {
          setSelectedMovie({ ...preview, options: [], seasons });
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
        const requirePt = option.ptConfirmed === true || option.audioType === 'dub' || option.audioType === 'dual' || option.audioType === 'multi' || audioPref === 'ptbr';
        const altSourceUrls = buildAltSourceUrls(selectedMovie?.options ?? [], option.sourceUrl, requirePt);
        await downloadMediaMovie(movieTitle, option.quality, option.sourceUrl, finalPosterUrl, altSourceUrls, undefined, undefined, requirePt);
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

  // Baixa uma temporada como projeto de série (agrupado na biblioteca).
  const startSeasonDownload = useCallback(
    async (seriesTitle: string, seasonNumber: number, option: MediaOption, posterUrl?: string) => {
      if (!isValidSourceUrl(option.sourceUrl)) return;
      const key = `${seriesTitle}-S${seasonNumber}-${option.id}`;
      setDownloadingItems((prev) => ({ ...prev, [key]: true }));
      try {
        const finalPosterUrl = posterUrl || selectedMovie?.posterUrl;
        await downloadMediaMovie(
          seriesTitle,
          option.quality,
          option.sourceUrl,
          finalPosterUrl,
          undefined,
          seriesTitle,
          seasonNumber,
          option.ptConfirmed === true
        );
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

  // Baixa todas as temporadas EM SEQUÊNCIA (uma de cada vez, não em paralelo)
  // para não sobrecarregar com N workers simultâneos.
  const handleDownloadAllSeasons = useCallback(
    async (seriesTitle: string, posterUrl: string | undefined, seasons: { seasonNumber: number; option: MediaOption }[]) => {
      for (const s of seasons) {
        await startSeasonDownload(seriesTitle, s.seasonNumber, s.option, posterUrl);
        // Pequena pausa entre temporadas para o servidor processar.
        await new Promise((r) => setTimeout(r, 1200));
      }
      pollActiveProjects();
    },
    [startSeasonDownload, pollActiveProjects]
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

  // Marca/desmarca um filme ou episódio como assistido manualmente.
  const handleToggleWatched = useCallback(
    async (project: Project) => {
      try {
        await markWatched(project.id, project.watched !== 1);
        pollActiveProjects();
      } catch (e) {
        console.error('Failed to toggle watched:', e);
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
    // Persiste "tocando agora" no sessionStorage DESTA aba. O sessionStorage é
    // por-tab: só a janela que está assistindo guarda — outras janelas/tabs
    // ficam limpas. Se esta janela recarregar (F5/HMR), o player restaura e
    // retoma de onde parou (veja o efeito de restore abaixo).
    try {
      sessionStorage.setItem(
        'jackin_now_playing',
        JSON.stringify({
          id: project.id,
          title: project.title || 'Filme',
          episodeList: episodeList ?? null,
        })
      );
    } catch {}
    setCinemaMedia({
      title: project.title || 'Filme',
      videoUrl: `${baseUrl}/projects/${project.id}/video`,
      projectId: project.id,
      episodeList,
    });
  }, []);

  // Fechar o player remove o "tocando agora" — um reload depois de fechar não
  // reabre o filme. (Não usar efeito em cinemaMedia===null: no mount de uma
  // aba recarregada isso apagaria a chave ANTES do restore ler.)
  const handleCloseCinema = useCallback(() => {
    try {
      sessionStorage.removeItem('jackin_now_playing');
    } catch {}
    setCinemaMedia(null);
  }, []);

  // Restaura o player APENAS quando esta aba foi RECARREGADA (F5 ou reload de
  // HMR do next dev): navigation type 'reload'/'back_forward'. Abas novas e
  // navegação SPA (type 'navigate') não restauram — é isso que permite usar
  // 2+ janelas ao mesmo tempo sem o filme reabrir em lugar indevido.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || allProjects.length === 0) return;
    if (typeof window === 'undefined') return;

    let navType = 'navigate';
    try {
      const nav = performance.getEntriesByType?.('navigation')?.[0] as { type?: string } | undefined;
      if (nav?.type) navType = nav.type;
    } catch {}
    if (navType !== 'reload' && navType !== 'back_forward') return;

    let saved: { id?: string; title?: string; episodeList?: { id: string; title: string; videoUrl: string }[] | null } | null = null;
    try {
      const raw = sessionStorage.getItem('jackin_now_playing');
      if (raw) saved = JSON.parse(raw);
    } catch {}
    if (!saved?.id) return;

    const proj = allProjects.find((p) => p.id === saved!.id);
    if (!proj) return;

    restoredRef.current = true;
    handleWatch(proj, saved.episodeList ?? undefined);
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
    handleDownloadAllSeasons,
    handleDeleteItem,
    handleDeleteSeries,
    handleToggleWatched,
    handleRetry,
    handleWatch,
    handleCloseCinema,
    setModalOpen,
    setItemToDelete,
    setCinemaMedia,
    pollActiveProjects,
  };
}

export type MediaExplorer = ReturnType<typeof useMediaExplorer>;
