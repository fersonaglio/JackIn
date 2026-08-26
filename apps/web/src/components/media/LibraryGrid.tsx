'use client';
import { useState, useMemo, useEffect } from 'react';
import type { Project, WatchHistoryItem } from '@/lib/api';
import { getSeriesEpisodes, getWatchHistory, deleteWatchHistoryItem, deleteSeries } from '@/lib/api';
import DeleteDialog from '@/components/ui/DeleteDialog';
import LibraryDetailModal, { type LibraryDetailTarget } from './LibraryDetailModal';
import { breakdownSeries, getProjectWatchPercent } from '@/lib/seriesProjects';
import { seriesBaseTitle } from '@/lib/seriesSeasons';

function formatHistoryDate(dateStr?: string | null): string {
  if (!dateStr) return 'Recentemente';
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface LibraryGridProps {
  projects: Project[];
  filter: string;
  onFilterChange: (value: string) => void;
  onWatch: (project: Project, episodeList?: { id: string; title: string; videoUrl: string }[]) => void;
  onDelete: (project: Project) => void;
  onDeleteSeries?: (series: { title: string; seriesId: string; episodes: Project[] }) => void;
  onRetry?: (project: Project) => void;
  onRedownload?: (title: string) => void;
  onOpenDetails?: (target: LibraryDetailTarget) => void;
  onToggleWatched?: (project: Project) => void;
}

// Mostra um rótulo claro para o estado do download em vez de um percentual
// enganoso quando o worker está entre tentativas (procurando seeders, retry).
function statusLabel(progressStatus?: string | null): string | null {
  if (!progressStatus) return null;
  const lower = progressStatus.toLowerCase();
  if (lower.includes('tentando') || lower.includes('falha transit')) return 'tentando novamente…';
  if (lower.includes('seeders') || lower.includes('metadados') || lower.includes('conectando')) return 'procurando seeders…';
  if (lower.includes('corrompido')) return 'corrompido — nova fonte…';
  if (lower.includes('retomando')) return 'retomando…';
  return null;
}

function LibraryCard({
  project,
  onWatch,
  onDelete,
  onRetry,
  onOpenDetails,
}: {
  project: Project;
  onWatch: (p: Project, episodeList?: { id: string; title: string; videoUrl: string }[]) => void;
  onDelete: (p: Project) => void;
  onRetry?: (p: Project) => void;
  onOpenDetails: (p: Project) => void;
}) {
  const [imageError, setImageError] = useState(false);
  const [dynamicPoster, setDynamicPoster] = useState<string | null>(null);
  const isDone = project.status === 'done';
  const isDownloading = project.status === 'downloading';
  const isPreparing = project.status === 'preparing';
  const isWatched = project.watched === 1;
  const hasProgress = !isWatched && (project.watchProgress || 0) > 0;
  // Clean title & quality parsing
  const rawTitle = project.title || 'Mídia 4K';
  const match = rawTitle.match(/^(.*?)(?:\s*\((.*?)\))?$/);
  const cleanTitle = match ? match[1] : rawTitle;
  const rawQuality = match && match[2] ? match[2] : '4K';

  const posterExternal = project.facelessConfig?.posterUrl;
  const thumbnailUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'}/projects/${project.id}/thumbnail`;

  useEffect(() => {
    if ((imageError || !posterExternal) && cleanTitle && !dynamicPoster) {
      let isMounted = true;
      fetch(`/api/itunes?q=${encodeURIComponent(cleanTitle)}`)
        .then((res) => res.json())
        .then((data) => {
          if (isMounted && data.results?.[0]?.posterUrl) {
            setDynamicPoster(data.results[0].posterUrl);
          }
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }
  }, [imageError, posterExternal, cleanTitle, dynamicPoster]);

  const activePoster = dynamicPoster || (posterExternal || (!imageError ? thumbnailUrl : null));

  return (
    <div
      className="group relative bg-zinc-950/90 border border-zinc-800/80 hover:border-[#EF9F27]/60 rounded-2xl overflow-hidden transition-all duration-300 shadow-xl flex flex-col justify-between cursor-pointer"
      onClick={() => onOpenDetails(project)}
    >
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] bg-zinc-900 overflow-hidden">
        {activePoster ? (
          <img
            src={activePoster}
            alt={cleanTitle}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              if (posterExternal && e.currentTarget.src !== thumbnailUrl && thumbnailUrl) {
                e.currentTarget.src = thumbnailUrl;
              } else {
                setImageError(true);
              }
            }}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-4 flex flex-col justify-between relative overflow-hidden">
            <div className="flex items-center justify-between z-10">
              <span className="text-2xl">🎬</span>
            </div>
            <div className="space-y-1 z-10 pb-2">
              <p className="text-[10px] text-[#EF9F27] font-mono font-bold uppercase tracking-wider">
                JackIn Library
              </p>
            </div>
          </div>
        )}

        {/* Top-Right Status Badge */}
        <div className="absolute top-2.5 right-2.5 z-20">
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider backdrop-blur-md shadow-md border ${
              isWatched
                ? 'bg-purple-500/30 border-purple-500/60 text-purple-300'
                : hasProgress
                  ? 'bg-amber-500/25 border-amber-500/60 text-amber-300'
                  : isDone
                    ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400'
                    : isDownloading
                      ? 'bg-[#EF9F27]/20 border-[#EF9F27]/50 text-[#EF9F27] animate-pulse'
                      : isPreparing
                        ? 'bg-sky-500/20 border-sky-500/50 text-sky-300 animate-pulse'
                        : 'bg-red-500/20 border-red-500/50 text-red-400'
            }`}
          >
            {isWatched ? '✓ 100% Visto' : hasProgress ? `Continuar (${getProjectWatchPercent(project, 5400)}%)` : isDone ? 'Pronto' : isDownloading ? `${project.progressPct || 0}%` : isPreparing ? 'Preparando' : 'Erro'}
          </span>
        </div>

        {/* Watch Progress Bar / Downloading Progress Bar Overlay */}
        {isDownloading ? (
          <div className="absolute bottom-0 inset-x-0 bg-zinc-950/90 p-2.5 backdrop-blur-md border-t border-zinc-800/80 space-y-1.5 z-20">
            <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[#EF9F27] h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.max(5, project.progressPct || 0)}%` }}
              />
            </div>
            <p className="text-[10px] text-[#EF9F27] font-mono text-center font-bold">
              {statusLabel(project.progressStatus) || `Baixando ${project.progressPct || 0}%`}
            </p>
          </div>
        ) : isPreparing ? (
          <div className="absolute bottom-0 inset-x-0 bg-zinc-950/90 p-2.5 backdrop-blur-md border-t border-zinc-800/80 space-y-1.5 z-20">
            <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
              <div className="bg-sky-500 h-full rounded-full animate-pulse transition-all duration-300" style={{ width: '60%' }} />
            </div>
            <p className="text-[10px] text-sky-400 font-mono text-center font-bold">
              Preparando para assistir…
            </p>
          </div>
        ) : hasProgress ? (
          <div className="absolute bottom-0 inset-x-0 bg-zinc-950/90 p-2 backdrop-blur-md border-t border-zinc-800/80 z-20">
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[#EF9F27] h-full rounded-full transition-all duration-300"
                style={{ width: `${getProjectWatchPercent(project, 5400)}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer Info & Actions */}
      <div className="p-3.5 space-y-3 bg-zinc-950 border-t border-zinc-800/80">
        <div>
          <h4 className="text-xs font-black text-zinc-100 truncate" title={cleanTitle}>
            {cleanTitle}
          </h4>
          <p className="text-[10px] text-zinc-500 font-mono font-semibold truncate">
            {rawQuality}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isDone && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onWatch(project); }}
              className={`flex-1 py-2 px-3 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-1.5 ${
                isWatched
                  ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 shadow-zinc-900'
                  : 'bg-[#EF9F27] hover:bg-[#EF9F27]/90 active:scale-95 text-zinc-950 shadow-[#EF9F27]/15'
              }`}
            >
              <span>{isWatched ? 'Rever' : hasProgress ? 'Continuar' : 'Assistir'}</span>
              <span className="text-xs">▶</span>
            </button>
          )}

          {!isDone && !isDownloading && !isPreparing && onRetry && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRetry(project); }}
              className="flex-1 py-2 px-3 bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 border border-amber-500/30 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-1.5"
              title="Tentar baixar novamente"
            >
              <span>Tentar novamente</span>
              <span className="text-xs">↻</span>
            </button>
          )}

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(project); }}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors"
            title="Excluir da biblioteca"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function SeriesCard({
  series,
  onWatch,
  onDeleteSeries,
  onOpenDetails,
}: {
  series: { title: string; seriesId: string; episodes: Project[] };
  onWatch: (p: Project, episodeList?: { id: string; title: string; videoUrl: string }[]) => void;
  onDeleteSeries: (series: { title: string; seriesId: string; episodes: Project[] }) => void;
  onOpenDetails: (target: LibraryDetailTarget) => void;
}) {
  const [imageError, setImageError] = useState(false);
  const [dynamicPoster, setDynamicPoster] = useState<string | null>(null);
  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

  const b = breakdownSeries(series.episodes);
  const ready = b.episodes.filter((e) => e.status === 'done');
  const watchedCount = b.watchedCount;
  const posterExternal = series.episodes.find((e) => e.facelessConfig?.posterUrl)?.facelessConfig?.posterUrl;
  const posterId = series.seriesId || ready[0]?.id || series.episodes[0]?.id;
  const thumbnailUrl = posterId ? `${apiBase}/projects/${posterId}/thumbnail` : '';
  const firstPlay = ready.find((e) => e.watched !== 1) || ready[0];

  useEffect(() => {
    if ((imageError || !posterExternal) && series.title && !dynamicPoster) {
      let isMounted = true;
      fetch(`/api/itunes?q=${encodeURIComponent(series.title)}`)
        .then((res) => res.json())
        .then((data) => {
          if (isMounted && data.results?.[0]?.posterUrl) {
            setDynamicPoster(data.results[0].posterUrl);
          }
        })
        .catch(() => {});
      return () => {
        isMounted = false;
      };
    }
  }, [imageError, posterExternal, series.title, dynamicPoster]);

  const activePoster = dynamicPoster || (posterExternal || (!imageError ? thumbnailUrl : null));

  const badge =
    b.allWatched
      ? { text: '✓ 100% Visto', cls: 'bg-purple-500/30 border-purple-500/60 text-purple-300' }
      : b.watchPercent > 0
        ? { text: `Assistido ${b.watchPercent}%`, cls: 'bg-purple-500/20 border-purple-500/40 text-purple-300' }
        : b.allDone
          ? { text: '✓ Pronto', cls: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400' }
          : b.anyDownloading
            ? {
                text: b.anyPreparing && !series.episodes.some((e) => e.status === 'downloading')
                  ? `Preparando${b.doneUnits > 0 ? ` (${b.doneUnits} prontos)` : ''}`
                  : `Baixando${b.doneUnits > 0 ? `… ${b.doneUnits} prontos` : ''}`,
                cls: 'bg-[#EF9F27]/20 border-[#EF9F27]/50 text-[#EF9F27] animate-pulse',
              }
            : b.anyPaused
              ? { text: 'Pausado', cls: 'bg-sky-500/20 border-sky-500/50 text-sky-300' }
              : { text: '📺 Série', cls: 'bg-purple-500/30 border-purple-500/60 text-purple-300' };

  const footerLine = b.hasEpisodes
    ? `${b.episodes.length} episódio${b.episodes.length !== 1 ? 's' : ''}${b.totalSeasons > 1 ? ` · ${b.totalSeasons} temporadas` : ''}${b.watchPercent > 0 ? ` · ${b.watchPercent}% assistido` : ''}`
    : `${b.totalSeasons} temporada${b.totalSeasons !== 1 ? 's' : ''}${b.readySeasons > 0 && !b.allDone ? ` · ${b.readySeasons}/${b.totalSeasons} prontas` : ''}`;

  const play = () => {
    if (!firstPlay) return;
    const episodeList = ready.map((e) => ({
      id: e.id,
      title: e.title || `Ep ${e.episodeNumber}`,
      videoUrl: `${apiBase}/projects/${e.id}/video`,
    }));
    onWatch(firstPlay, episodeList);
  };

  return (
    <div
      className="group relative bg-zinc-950/90 border border-zinc-800/80 hover:border-[#EF9F27]/60 rounded-2xl overflow-hidden transition-all duration-300 shadow-xl flex flex-col justify-between cursor-pointer"
      onClick={() => onOpenDetails({ kind: 'series', seriesId: series.seriesId, title: series.title, episodes: series.episodes })}
    >
      {/* Poster Image Container */}
      <div className="relative aspect-[2/3] bg-zinc-900 overflow-hidden">
        {activePoster ? (
          <img
            src={activePoster}
            alt={series.title}
            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
            onError={(e) => {
              if (posterExternal && e.currentTarget.src !== thumbnailUrl && thumbnailUrl) {
                e.currentTarget.src = thumbnailUrl;
              } else {
                setImageError(true);
              }
            }}
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-b from-zinc-900 via-zinc-950 to-black p-4 flex flex-col justify-between relative overflow-hidden">
            <div className="flex items-center justify-between z-10">
              <span className="text-2xl">📺</span>
            </div>
            <div className="space-y-1 z-10 pb-2">
              <p className="text-[10px] text-[#EF9F27] font-mono font-bold uppercase tracking-wider">Série</p>
            </div>
          </div>
        )}

        {/* Top-Right Badge */}
        <div className="absolute top-2.5 right-2.5 z-20">
          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider backdrop-blur-md shadow-md border ${badge.cls}`}>
            {badge.text}
          </span>
        </div>

        {/* Download progress overlay while seasons are being fetched */}
        {b.anyDownloading && !b.allDone ? (
          <div className="absolute bottom-0 inset-x-0 bg-zinc-950/90 p-2.5 backdrop-blur-md border-t border-zinc-800/80 space-y-1.5 z-20">
            <div className="w-full bg-zinc-900 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-[#EF9F27] h-full rounded-full transition-all duration-300"
                style={{ width: `${Math.max(5, b.currentPercent)}%` }}
              />
            </div>
            <p className="text-[10px] text-[#EF9F27] font-mono text-center font-bold">
              {b.hasEpisodes
                ? b.doneUnits === b.totalUnits
                  ? `${b.doneUnits} episódios prontos (baixando mais…)`
                  : `${b.doneUnits}/${b.totalUnits} episódios prontos`
                : `${b.readySeasons}/${b.totalSeasons} temporadas prontas`}
            </p>
          </div>
        ) : b.watchPercent > 0 ? (
          <div className="absolute bottom-0 inset-x-0 bg-zinc-950/90 p-2 backdrop-blur-md border-t border-zinc-800/80 z-20">
            <div className="w-full bg-zinc-800 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-purple-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${b.watchPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      {/* Footer Info & Actions */}
      <div className="p-3.5 space-y-3 bg-zinc-950 border-t border-zinc-800/80">
        <div>
          <h4 className="text-xs font-black text-zinc-100 truncate" title={series.title}>
            {series.title}
          </h4>
          <p className="text-[10px] text-zinc-500 font-mono font-semibold truncate">
            {footerLine}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {firstPlay && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); play(); }}
              className="flex-1 py-2 px-3 font-black rounded-xl text-[10px] uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-1.5 bg-[#EF9F27] hover:bg-[#EF9F27]/90 active:scale-95 text-zinc-950 shadow-[#EF9F27]/15"
            >
              <span>{watchedCount > 0 ? 'Continuar' : 'Assistir'}</span>
              <span className="text-xs">▶</span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onOpenDetails({ kind: 'series', seriesId: series.seriesId, title: series.title, episodes: series.episodes }); }}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-purple-400 hover:border-purple-500/40 transition-colors"
            title="Detalhes da série"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDeleteSeries(series); }}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors"
            title="Excluir série completa"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function LibraryGrid({
  projects,
  filter,
  onFilterChange,
  onWatch,
  onDelete,
  onDeleteSeries,
  onRetry,
  onRedownload,
  onOpenDetails,
  onToggleWatched,
}: LibraryGridProps) {
  const [subTab, setSubTab] = useState<'downloads' | 'history'>('downloads');
  const [historyItems, setHistoryItems] = useState<WatchHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyItemToDelete, setHistoryItemToDelete] = useState<WatchHistoryItem | null>(null);
  const [seriesToDelete, setSeriesToDelete] = useState<{ title: string; seriesId: string; episodes: Project[] } | null>(null);
  const [detailTarget, setDetailTarget] = useState<LibraryDetailTarget | null>(null);
  // Séries expandidas no histórico (mostram os episódios individuais).
  const [expandedSeries, setExpandedSeries] = useState<Set<string>>(new Set());

  const toggleSeriesExpand = (key: string) => {
    setExpandedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  useEffect(() => {
    if (subTab === 'history') {
      setLoadingHistory(true);
      getWatchHistory()
        .then(setHistoryItems)
        .catch(() => setHistoryItems([]))
        .finally(() => setLoadingHistory(false));
    }
  }, [subTab]);

  const handleDeleteSeries = async (series: { title: string; seriesId: string; episodes: Project[] }) => {
    setSeriesToDelete(null);
    if (onDeleteSeries) {
      onDeleteSeries(series);
    } else {
      try {
        await deleteSeries(series.seriesId);
      } catch {
        for (const ep of series.episodes) {
          onDelete(ep);
        }
      }
    }
  };

  const handleDeleteHistory = async (id: string) => {
    setHistoryItemToDelete(null);
    try {
      await deleteWatchHistoryItem(id);
      setHistoryItems(prev => prev.filter(h => h.id !== id));
    } catch (e) {
      console.error('Failed to delete history item:', e);
    }
  };

  const filtered = projects.filter((p) =>
    (p.title || '').toLowerCase().includes(filter.toLowerCase())
  );

  const filteredHistory = historyItems.filter((h) =>
    (h.title || '').toLowerCase().includes(filter.toLowerCase())
  );

  // Histórico agrupado: episódios de série viram UMA entrada da série (com a
  // lista de episódios expandível); filmes permanecem como entradas únicas.
  const historyGroups = useMemo(() => {
    const movies: WatchHistoryItem[] = [];
    const seriesMap = new Map<string, { key: string; title: string; items: WatchHistoryItem[] }>();
    for (const h of filteredHistory) {
      const isSeries = !!h.seriesId || h.seasonNumber != null;
      if (!isSeries) {
        movies.push(h);
        continue;
      }
      const key = h.seriesId || `hist-${seriesBaseTitle(h.title)}-${h.seasonNumber ?? 0}`;
      let group = seriesMap.get(key);
      if (!group) {
        group = { key, title: seriesBaseTitle(h.title) || h.title || 'Série', items: [] };
        seriesMap.set(key, group);
      }
      group.items.push(h);
    }
    const series = [...seriesMap.values()].map((g) => ({
      ...g,
      items: g.items.sort(
        (a, b) => new Date(b.watchedAt || 0).getTime() - new Date(a.watchedAt || 0).getTime()
      ),
    }));
    // Séries ordenadas pela última vez assistida (decrescente), depois filmes.
    const all = [
      ...series.map((s) => ({ kind: 'series' as const, group: s })),
      ...movies.map((m) => ({ kind: 'movie' as const, item: m })),
    ].sort((a, b) => {
      const ta =
        a.kind === 'series' ? a.group.items[0]?.watchedAt : a.item.watchedAt;
      const tb =
        b.kind === 'series' ? b.group.items[0]?.watchedAt : b.item.watchedAt;
      return new Date(tb || 0).getTime() - new Date(ta || 0).getTime();
    });
    return all;
  }, [filteredHistory]);

  const groupedProjects = useMemo(() => {
    const singles: Project[] = [];
    const seriesMap = new Map<string, { title: string; episodes: Project[]; seriesId: string }>();
    
    for (const p of projects) {
      if (p.seriesId) {
        const key = p.seriesId;
        if (!seriesMap.has(key)) {
          const name = seriesBaseTitle(p.title || '');
          seriesMap.set(key, { title: name || 'Série', episodes: [], seriesId: key });
        }
        seriesMap.get(key)!.episodes.push(p);
      } else {
        singles.push(p);
      }
    }
    
    for (const [, s] of seriesMap) {
      s.episodes.sort((a, b) => {
        const sA = a.seasonNumber ?? 0;
        const sB = b.seasonNumber ?? 0;
        if (sA !== sB) return sA - sB;
        return (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0);
      });
    }
    
    return { singles, series: Array.from(seriesMap.values()) };
  }, [projects]);

  return (
    <div className="space-y-6">
      {/* View Switcher & Search Filter Bar */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-2xl p-1 shrink-0">
          <button
            type="button"
            onClick={() => setSubTab('downloads')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              subTab === 'downloads'
                ? 'bg-[#EF9F27] text-zinc-950 shadow-md'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>🍿 Baixados</span>
            <span className="px-2 py-0.5 rounded-full bg-black/20 text-[10px] font-mono">
              {groupedProjects.singles.length + groupedProjects.series.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setSubTab('history')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${
              subTab === 'history'
                ? 'bg-purple-600 text-white shadow-md shadow-purple-600/20'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>📜 Histórico de Assistidos</span>
            {historyItems.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-black/30 text-[10px] font-mono">
                {historyItems.length}
              </span>
            )}
          </button>
        </div>

        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            placeholder={subTab === 'downloads' ? "Filtrar mídias baixadas na biblioteca..." : "Pesquisar histórico..."}
            value={filter}
            onChange={(e) => onFilterChange(e.target.value)}
            className="w-full bg-zinc-950/80 border border-zinc-800/80 focus:border-[#EF9F27]/70 rounded-2xl px-4 py-2.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none transition-all shadow-inner"
          />
          {filter && (
            <button
              onClick={() => onFilterChange('')}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-200 text-xs font-bold bg-zinc-800 rounded-full w-4 h-4 flex items-center justify-center"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {subTab === 'history' ? (
        /* History Log View */
        <div className="space-y-4">
          {loadingHistory ? (
            <div className="flex items-center justify-center py-20 text-zinc-500 text-xs font-mono">
              Carregando histórico de assistidos...
            </div>
          ) : historyGroups.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 space-y-4 text-center bg-zinc-950/40 border border-dashed border-zinc-800/60 rounded-3xl">
              <span className="text-5xl">📜</span>
              <div className="space-y-1">
                <h4 className="text-base font-bold text-zinc-200">Nenhum histórico registrado</h4>
                <p className="text-xs text-zinc-500 max-w-sm">
                  {filter
                    ? `Nenhum histórico encontrado para "${filter}".`
                    : 'Filmes e séries assistidos aparecerão aqui automaticamente, mesmo se o arquivo for excluído.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {historyGroups.map((entry) => {
                if (entry.kind === 'movie') {
                  const item = entry.item;
                  const formattedDate = formatHistoryDate(item.watchedAt);
                  const matchedProject = projects.find(p => p.id === item.projectId || p.title === item.title);
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 bg-[#0A0B0D] border border-[#202226] hover:border-purple-500/30 rounded-2xl p-4 transition-all"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 text-lg shrink-0">
                          🎬
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-bold text-zinc-100 truncate">{item.title}</p>
                          <p className="text-[11px] text-zinc-500 font-mono">Assistido em {formattedDate}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        {item.isDownloaded || matchedProject ? (
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                              ✓ No HD
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                if (matchedProject) onWatch(matchedProject);
                              }}
                              className="px-3.5 py-1.5 rounded-xl bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 text-xs font-bold transition-all shadow-md"
                            >
                              Assistir ▶
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-1 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px] font-bold uppercase tracking-wider">
                              🗑️ Arquivo Excluído
                            </span>
                            {onRedownload && (
                              <button
                                type="button"
                                onClick={() => onRedownload(item.title)}
                                className="px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-bold transition-all flex items-center gap-1.5"
                                title="Buscar torrent para baixar novamente"
                              >
                                <span>Baixar de novo</span>
                                <span>🔍</span>
                              </button>
                            )}
                          </div>
                        )}

                        <button
                          type="button"
                          onClick={() => setHistoryItemToDelete(item)}
                          className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                          title="Remover do histórico"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  );
                }

                // Série agrupada: uma entrada para a série inteira, com a lista
                // de episódios expandível.
                const g = entry.group;
                const last = g.items[0];
                const expanded = expandedSeries.has(g.key);
                const matchedLast = projects.find(p => p.id === last.projectId || p.title === last.title);

                return (
                  <div
                    key={g.key}
                    className="bg-[#0A0B0D] border border-[#202226] hover:border-purple-500/30 rounded-2xl overflow-hidden transition-all"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSeriesExpand(g.key)}
                      className="w-full flex items-center justify-between gap-4 p-4 text-left"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 text-lg shrink-0">
                          📺
                        </div>
                        <div className="min-w-0 space-y-0.5">
                          <p className="text-sm font-bold text-zinc-100 truncate">{g.title}</p>
                          <p className="text-[11px] text-zinc-500 font-mono">
                            {g.items.length} episódio{g.items.length !== 1 ? 's' : ''} · Última vez {formatHistoryDate(last.watchedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {matchedLast && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onWatch(matchedLast);
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 text-xs font-bold transition-all shadow-md"
                          >
                            Assistir ▶
                          </button>
                        )}
                        <span className={`text-zinc-500 text-sm shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}>
                          ▾
                        </span>
                      </div>
                    </button>

                    {expanded && (
                      <div className="border-t border-[#202226]/70 divide-y divide-[#202226]/50">
                        {g.items.map((item) => {
                          const epDate = formatHistoryDate(item.watchedAt);
                          const matchedProject = projects.find(p => p.id === item.projectId || p.title === item.title);
                          return (
                            <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-[10px] text-purple-400 font-mono shrink-0 w-16 text-right">
                                  S{String(item.seasonNumber ?? 0).padStart(2, '0')}E{String(item.episodeNumber ?? 0).padStart(2, '0')}
                                </span>
                                <p className="text-xs text-zinc-300 truncate">{item.title}</p>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[9px] text-zinc-600 font-mono">{epDate}</span>
                                {item.isDownloaded || matchedProject ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (matchedProject) onWatch(matchedProject);
                                    }}
                                    className="px-3 py-1 rounded-lg bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 text-[10px] font-bold transition-all"
                                  >
                                    Assistir ▶
                                  </button>
                                ) : onRedownload ? (
                                  <button
                                    type="button"
                                    onClick={() => onRedownload(item.title)}
                                    className="px-3 py-1 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-[10px] font-bold transition-all"
                                  >
                                    Baixar de novo 🔍
                                  </button>
                                ) : (
                                  <span className="text-[9px] text-zinc-600">🗑️ Excluído</span>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setHistoryItemToDelete(item)}
                                  className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                                  title="Remover do histórico"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                  </svg>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        /* Downloads Grid View */
        filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 space-y-4 text-center bg-zinc-950/40 border border-dashed border-zinc-800/60 rounded-3xl">
            <span className="text-5xl">🍿</span>
            <div className="space-y-1">
              <h4 className="text-base font-bold text-zinc-200">Sua biblioteca está vazia</h4>
              <p className="text-xs text-zinc-500 max-w-sm">
                {filter
                  ? `Nenhum resultado encontrado para "${filter}".`
                  : 'Pesquise e baixe filmes no Explorador de Mídias para assistir off-line!'}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Grid de pôsteres: séries (como filmes) + filmes soltos */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
              {groupedProjects.series.filter(s => {
                if (!filter) return true;
                return s.title.toLowerCase().includes(filter.toLowerCase());
              }).map(series => (
                <SeriesCard
                  key={series.seriesId}
                  series={series}
                  onWatch={onWatch}
                  onDeleteSeries={(s) => (onDeleteSeries ? onDeleteSeries(s) : setSeriesToDelete(s))}
                  onOpenDetails={(target) => {
                    if (onOpenDetails) {
                      onOpenDetails(target);
                    } else {
                      setDetailTarget(target);
                    }
                  }}
                />
              ))}
              {groupedProjects.singles.filter(p => {
                if (!filter) return true;
                return (p.title || '').toLowerCase().includes(filter.toLowerCase());
              }).map(project => (
                <LibraryCard
                  key={project.id}
                  project={project}
                  onWatch={onWatch}
                  onDelete={onDelete}
                  onRetry={onRetry}
                  onOpenDetails={(p) => {
                    if (onOpenDetails) {
                      onOpenDetails({ kind: 'movie', project: p });
                    } else {
                      setDetailTarget({ kind: 'movie', project: p });
                    }
                  }}
                />
              ))}
            </div>
          </div>
        )
      )}

      <DeleteDialog
        open={historyItemToDelete !== null}
        title={historyItemToDelete?.title || ''}
        customTitle="Remover do histórico"
        customMessage={`Tem certeza que deseja remover "${historyItemToDelete?.title || ''}" do histórico de assistidos? Esta ação não pode ser desfeita.`}
        onConfirm={() => historyItemToDelete && handleDeleteHistory(historyItemToDelete.id)}
        onCancel={() => setHistoryItemToDelete(null)}
      />

      <DeleteDialog
        open={seriesToDelete !== null}
        title={seriesToDelete?.title || ''}
        customTitle="Excluir série da biblioteca"
        customMessage={`Tem certeza que deseja excluir todos os ${seriesToDelete?.episodes.length || 0} episódios de "${seriesToDelete?.title || ''}"? Esta ação removerá os arquivos e não pode ser desfeita.`}
        onConfirm={() => seriesToDelete && handleDeleteSeries(seriesToDelete)}
        onCancel={() => setSeriesToDelete(null)}
      />

      <LibraryDetailModal
        target={detailTarget}
        onClose={() => setDetailTarget(null)}
        onWatch={onWatch}
        onDelete={onDelete}
        onDeleteSeries={(s) => (onDeleteSeries ? onDeleteSeries(s) : setSeriesToDelete(s))}
        onRetry={onRetry}
        onToggleWatched={onToggleWatched}
      />
    </div>
  );
}
