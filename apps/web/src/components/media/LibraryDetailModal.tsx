'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { Project } from '@/lib/api';
import { breakdownSeries } from '@/lib/seriesProjects';

export type LibraryDetailTarget =
  | { kind: 'movie'; project: Project }
  | { kind: 'series'; seriesId: string; title: string; episodes: Project[] };

interface LibraryDetailModalProps {
  target: LibraryDetailTarget | null;
  onClose: () => void;
  onWatch: (project: Project, episodeList?: { id: string; title: string; videoUrl: string }[]) => void;
  onDelete: (project: Project) => void;
  onDeleteSeries?: (series: { kind: 'series'; seriesId: string; title: string; episodes: Project[] }) => void;
  onRetry?: (project: Project) => void;
  onToggleWatched?: (project: Project) => void;
}

function cleanTitle(raw: string): { title: string; quality: string } {
  const match = raw.match(/^(.*?)(?:\s*\((.*?)\))?$/);
  return {
    title: match ? match[1] : raw,
    quality: match && match[2] ? match[2] : '4K',
  };
}

function formatProgress(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z');
    if (isNaN(d.getTime())) return dateStr.split(' ')[0] || '—';
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return dateStr.split(' ')[0] || '—';
  }
}

function parseMagnet(magnet?: string): { hash: string; name: string; trackers: string[]; size: string | null } {
  if (!magnet) return { hash: '', name: '', trackers: [], size: null };
  const hashMatch = magnet.match(/urn:btih:([A-Fa-f0-9]{40})/);
  const dnMatch = magnet.match(/[?&]dn=([^&]+)/);
  const trackers = magnet.match(/tr=([^&]+)/g)?.map((t) => t.slice(3)) || [];
  const sizeMatch = magnet.match(/[?&]xl=(\d+)/);
  return {
    hash: hashMatch ? hashMatch[1].toUpperCase() : '',
    name: dnMatch ? decodeURIComponent(dnMatch[1]) : '',
    trackers,
    size: sizeMatch ? formatBytes(parseInt(sizeMatch[1], 10)) : null,
  };
}

export default function LibraryDetailModal({
  target,
  onClose,
  onWatch,
  onDelete,
  onDeleteSeries,
  onRetry,
  onToggleWatched,
}: LibraryDetailModalProps) {
  const [mounted, setMounted] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!target) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = originalOverflow;
    };
  }, [target, onClose]);

  // Progresso da série: separa packs de temporada (episodeNumber null) dos
  // episódios indexados e calcula temporadas prontas/disponíveis/assistidas.
  const seriesBreakdown = useMemo(() => {
    if (!target || target.kind !== 'series') return null;
    return breakdownSeries(target.episodes);
  }, [target]);

  // Rótulo de status de download para linhas (pack ou episódio).
  const statusBadge = (ep: Project) => {
    if (ep.status === 'done') return null;
    if (ep.status === 'downloading')
      return { text: `${ep.progressPct ?? 0}%`, cls: 'text-[#EF9F27] bg-[#EF9F27]/10 border border-[#EF9F27]/20' };
    if (ep.status === 'preparing') return { text: 'Preparando…', cls: 'text-[#EF9F27] bg-[#EF9F27]/10 border border-[#EF9F27]/20' };
    if (ep.status === 'paused') return { text: 'Pausado', cls: 'text-sky-400 bg-sky-500/10 border border-sky-500/20' };
    if (ep.status === 'error') return { text: 'Erro', cls: 'text-red-400 bg-red-500/10 border border-red-500/20' };
    return { text: 'Pendente', cls: 'text-zinc-600 bg-zinc-800/40 border border-zinc-800' };
  };

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  const thumb = (id: string) => `${apiBase}/projects/${id}/thumbnail`;

  const buildEpisodeList = (eps: Project[]) =>
    eps
      .filter((e) => e.status === 'done')
      .map((e) => ({ id: e.id, title: e.title || `Ep ${e.episodeNumber}`, videoUrl: `${apiBase}/projects/${e.id}/video` }));

  const movie = target?.kind === 'movie' ? target.project : null;
  const { title: cleanName, quality } = cleanTitle(
    movie?.title || (target?.kind === 'series' ? target.title : '') || 'Mídia'
  );

  const isMovieDone = !!movie && movie.status === 'done';
  const movieWatched = !!movie && movie.watched === 1;
  const movieProgress = movie?.watchProgress || 0;

  const sourceMagnet =
    (target?.kind === 'movie' ? movie?.facelessConfig?.sourceUrl : undefined) ||
    (target?.kind === 'movie' ? movie?.youtubeUrl : undefined);
  const torrentInfo = parseMagnet(sourceMagnet);
  const sizeBytes = target?.kind === 'movie' ? movie?.sizeBytes : undefined;
  const downloadDate = target?.kind === 'movie' ? movie?.createdAt : undefined;
  // Série não tem "qualidade" única — oculta o badge para não mostrar "T1" etc.
  const qualityLabel = (target?.kind === 'movie' ? movie?.facelessConfig?.quality : undefined) || quality;
  const posterExternal =
    target?.kind === 'movie'
      ? movie?.facelessConfig?.posterUrl
      : target?.episodes?.find((e) => e.facelessConfig?.posterUrl)?.facelessConfig?.posterUrl;
  const posterId =
    target?.kind === 'movie'
      ? movie!.id
      : target?.seriesId || target?.episodes?.[0]?.id || '';

  const modalContent = (
    <AnimatePresence>
      {target && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col bg-black/80 backdrop-blur-md"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            ref={modalRef}
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            className="relative w-full h-full bg-[#09090B] overflow-hidden flex flex-col"
          >
            {/* Header (desktop + mobile unificado) */}
            <div className="flex items-center justify-between gap-4 px-4 md:px-10 py-4 border-b border-zinc-800/80 shrink-0 bg-[#09090B]/95 backdrop-blur-xl z-20">
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-2xl shrink-0">🎬</span>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-wider text-[#EF9F27]">
                    {target.kind === 'series' ? 'Série' : 'Filme'}
                  </p>
                  <h3 className="text-base md:text-xl font-black text-white truncate">{cleanName}</h3>
                </div>
                {qualityLabel && (
                  <span className="px-2.5 py-0.5 rounded-full bg-[#E50914]/15 border border-[#E50914]/40 text-red-400 font-black uppercase tracking-wider text-[10px] shrink-0 hidden sm:inline-flex">
                    {qualityLabel}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-300 hover:text-white text-sm font-bold transition-all shadow-md active:scale-95"
                title="Fechar (Esc)"
                aria-label="Fechar"
              >
                ✕
              </button>
            </div>

            <div className="flex-1 min-w-0 flex flex-col md:flex-row overflow-hidden">
              {/* Banner / Poster — left side */}
              <div className="relative md:w-[280px] lg:w-[320px] md:shrink-0 shrink-0 bg-[#0c0d10] p-4 md:p-6 md:overflow-y-auto border-r border-zinc-800/60">
                <div className="relative aspect-[2/3] w-full rounded-2xl overflow-hidden border border-zinc-800/80 shadow-2xl bg-zinc-900">
                  <img
                    src={posterExternal || thumb(posterId)}
                    alt={cleanName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      const el = e.currentTarget as HTMLImageElement;
                      if (posterExternal && el.src !== thumb(posterId)) {
                        el.src = thumb(posterId);
                      } else {
                        el.style.opacity = '0';
                      }
                    }}
                  />
                </div>

                {/* Série: navegação por temporada */}
                {target.kind === 'series' && seriesBreakdown && seriesBreakdown.seasons.length > 1 && (
                  <div className="mt-4 space-y-1.5">
                    <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider px-1">Temporadas</p>
                    {seriesBreakdown.seasons.map((season) => (
                      <button
                        key={season.seasonNumber}
                        type="button"
                        onClick={() => {
                          document.querySelector(`[data-season-scroll="${season.seasonNumber}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-zinc-900/80 border border-zinc-800/80 text-zinc-300 hover:border-[#EF9F27]/60 hover:text-[#EF9F27] text-xs font-bold transition-all text-left flex items-center justify-between"
                      >
                        <span>Temporada {season.seasonNumber}</span>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          {season.episodes.length > 0 ? `(${season.episodes.length} eps)` : season.pack ? (season.ready ? 'pronto' : `${season.percent}%`) : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Info — right side */}
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden bg-[#09090B]">
                <div className="p-4 md:p-8 space-y-6 overflow-y-auto custom-scrollbar flex-1">
                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3">
                    {target.kind === 'series' && seriesBreakdown ? (
                      <>
                        <div className="bg-[#121317] border border-[#202226] rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-zinc-100 tabular-nums">{seriesBreakdown.totalSeasons}</p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Temporadas</p>
                        </div>
                        <div className="bg-[#121317] border border-[#202226] rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-emerald-400 tabular-nums">{seriesBreakdown.availableCount}</p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Disponíveis</p>
                        </div>
                        <div className="bg-[#121317] border border-[#202226] rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-purple-400 tabular-nums">{seriesBreakdown.watchedCount}</p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Assistidos</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="bg-[#121317] border border-[#202226] rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-zinc-100 tabular-nums">
                            {movieWatched ? '✓' : movieProgress > 0 ? formatProgress(movieProgress) : '—'}
                          </p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">
                            {movieWatched ? 'Visto' : movieProgress > 0 ? 'Progresso' : 'Status'}
                          </p>
                        </div>
                        <div className="bg-[#121317] border border-[#202226] rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-emerald-400 tabular-nums">
                            {isMovieDone
                              ? 'Pronto'
                              : movie?.status === 'downloading'
                                ? `${movie?.progressPct || 0}%`
                                : movie?.status === 'error'
                                  ? 'Erro'
                                  : 'Pendente'}
                          </p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Download</p>
                        </div>
                        <div className="bg-[#121317] border border-[#202226] rounded-2xl p-4 text-center">
                          <p className="text-2xl font-black text-zinc-100 tabular-nums">{quality}</p>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Qualidade</p>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Movie progress bar */}
                  {target.kind === 'movie' && isMovieDone && !movieWatched && movieProgress > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                        <span>Você parou em {formatProgress(movieProgress)}</span>
                        <span>{movieProgress >= 3600 ? 'Restando ~' + formatProgress(Math.max(0, 5400 - movieProgress)) : ''}</span>
                      </div>
                      <div className="w-full h-2 bg-[#1A1B20] rounded-full overflow-hidden">
                        <div className="h-full bg-[#EF9F27] rounded-full" style={{ width: `${Math.min(100, (movieProgress / 5400) * 100)}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Series download progress */}
                  {target.kind === 'series' && seriesBreakdown && !seriesBreakdown.allDone && seriesBreakdown.totalSeasons > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                        <span>
                          {seriesBreakdown.hasEpisodes
                            ? `${seriesBreakdown.doneUnits} de ${seriesBreakdown.totalUnits} episódios prontos`
                            : `${seriesBreakdown.readySeasons} de ${seriesBreakdown.totalSeasons} temporadas prontas`}
                        </span>
                        <span>{seriesBreakdown.currentPercent}%</span>
                      </div>
                      <div className="w-full h-2 bg-[#1A1B20] rounded-full overflow-hidden">
                        <div className="h-full bg-[#EF9F27] rounded-full" style={{ width: `${Math.min(100, Math.max(4, seriesBreakdown.currentPercent))}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Series watched progress (episodes only) */}
                  {target.kind === 'series' && seriesBreakdown && seriesBreakdown.episodes.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono">
                        <span>{seriesBreakdown.watchedCount} de {seriesBreakdown.episodes.length} episódios assistidos</span>
                        <span>{Math.round((seriesBreakdown.watchedCount / seriesBreakdown.episodes.length) * 100)}%</span>
                      </div>
                      <div className="w-full h-2 bg-[#1A1B20] rounded-full overflow-hidden">
                        <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(seriesBreakdown.watchedCount / seriesBreakdown.episodes.length) * 100}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Detailed info — size, torrent, date */}
                  {(target.kind === 'movie' || target.episodes[0]) && (
                    <div className="space-y-3">
                      <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                        <span className="w-4 h-4 rounded-full bg-zinc-800 flex items-center justify-center text-[9px]">ℹ️</span>
                        Informações do Arquivo
                      </h4>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {sizeBytes !== undefined && (
                          <div className="bg-[#121317] border border-[#202226] rounded-xl px-3.5 py-2.5">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Tamanho</p>
                            <p className="text-xs font-bold text-zinc-100 mt-0.5 tabular-nums">{formatBytes(sizeBytes)}</p>
                          </div>
                        )}
                        {target.kind === 'movie' && movie?.status === 'done' && (
                          <div className="bg-[#121317] border border-[#202226] rounded-xl px-3.5 py-2.5">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Qualidade</p>
                            <p className="text-xs font-bold text-zinc-100 mt-0.5 truncate">{qualityLabel}</p>
                          </div>
                        )}
                        {downloadDate && (
                          <div className="bg-[#121317] border border-[#202226] rounded-xl px-3.5 py-2.5">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Baixado em</p>
                            <p className="text-xs font-bold text-zinc-100 mt-0.5">{formatDate(downloadDate)}</p>
                          </div>
                        )}
                        {movie?.progressStatus && (
                          <div className="bg-[#121317] border border-[#202226] rounded-xl px-3.5 py-2.5 col-span-2 sm:col-span-3">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Validação</p>
                            <p className="text-xs font-bold text-emerald-400 mt-0.5 leading-snug">{movie.progressStatus}</p>
                          </div>
                        )}
                      </div>

                      {torrentInfo.hash && (
                        <div className="bg-[#121317] border border-[#202226] rounded-xl p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Informações do Torrent</p>
                            {torrentInfo.size && (
                              <span className="text-[10px] text-zinc-400 font-mono">{torrentInfo.size}</span>
                            )}
                          </div>

                          {torrentInfo.name && (
                            <div>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold mb-0.5">Nome</p>
                              <p className="text-xs text-zinc-200 font-mono break-words leading-snug">{torrentInfo.name}</p>
                            </div>
                          )}

                          <div>
                            <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold mb-0.5">Hash</p>
                            <p className="text-[10px] text-zinc-300 font-mono break-all select-all">{torrentInfo.hash}</p>
                          </div>

                          {torrentInfo.trackers.length > 0 && (
                            <div>
                              <p className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold mb-1">
                                Trackers ({torrentInfo.trackers.length})
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {torrentInfo.trackers.slice(0, 4).map((tr) => (
                                  <span key={tr} className="text-[9px] font-mono text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-1.5 py-0.5 truncate max-w-full">
                                    {tr.replace(/^[a-z]+:\/\//, '').split(':')[0]}
                                  </span>
                                ))}
                                {torrentInfo.trackers.length > 4 && (
                                  <span className="text-[9px] font-mono text-zinc-600">+{torrentInfo.trackers.length - 4}</span>
                                )}
                              </div>
                            </div>
                          )}

                          {sourceMagnet && (
                            <a
                              href={sourceMagnet}
                              className="inline-flex items-center gap-1.5 text-[11px] font-bold text-[#EF9F27] hover:text-amber-400 transition-colors pt-1"
                              title="Copiar magnet"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75" />
                              </svg>
                              Abrir magnet
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Movie actions */}
                  {target.kind === 'movie' && (
                    <div className="flex items-center gap-3 flex-wrap pt-2">
                      {isMovieDone ? (
                        <button
                          type="button"
                          onClick={() => {
                            onWatch(movie!);
                            onClose();
                          }}
                          className="flex-1 min-w-[180px] py-3.5 bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-[#EF9F27]/10 flex items-center justify-center gap-2 active:scale-98"
                        >
                          <span>{movieWatched ? 'Rever' : movieProgress > 0 ? 'Continuar Assistindo' : 'Assistir'}</span>
                          <span>▶</span>
                        </button>
                      ) : movie?.status === 'downloading' ? (
                        <div className="flex-1 min-w-[180px] py-3.5 bg-[#EF9F27]/10 border border-[#EF9F27]/30 text-[#EF9F27] font-black rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                          <span className="w-4 h-4 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
                          Baixando {movie?.progressPct || 0}%
                        </div>
                      ) : movie?.status === 'error' && onRetry ? (
                        <button
                          type="button"
                          onClick={() => onRetry(movie!)}
                          className="flex-1 min-w-[180px] py-3.5 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-black rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                        >
                          <span>Tentar novamente</span>
                          <span>↻</span>
                        </button>
                      ) : null}

                      {movie && onToggleWatched && (
                        <button
                          type="button"
                          onClick={() => onToggleWatched(movie)}
                          className={`px-5 py-3.5 rounded-xl border transition-colors text-xs font-bold flex items-center gap-2 ${
                            movieWatched
                              ? 'bg-purple-500/15 hover:bg-purple-500/25 border-purple-500/40 text-purple-300'
                              : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-400 hover:text-purple-300 hover:border-purple-500/40'
                          }`}
                          title={movieWatched ? 'Marcar como não visto' : 'Marcar como visto'}
                        >
                          <span>{movieWatched ? '✓' : '○'}</span>
                          {movieWatched ? 'Visto' : 'Marcar visto'}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (movie) onDelete(movie);
                          onClose();
                        }}
                        className="px-5 py-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors text-xs font-bold flex items-center gap-2"
                        title="Excluir da biblioteca"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Excluir
                      </button>
                    </div>
                  )}

                  {/* Series primary actions */}
                  {target.kind === 'series' && seriesBreakdown && (
                    <div className="flex items-center gap-3 flex-wrap pt-2">
                      {seriesBreakdown.availableCount > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next =
                              target.episodes
                                .filter((e) => e.status === 'done' && e.watched !== 1)
                                .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))[0] ||
                              target.episodes
                                .filter((e) => e.status === 'done')
                                .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))[0];
                            if (next) {
                              const episodeList = buildEpisodeList(target.episodes);
                              onWatch(next, episodeList);
                              onClose();
                            }
                          }}
                          className="flex-1 min-w-[180px] py-3.5 bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-[#EF9F27]/10 flex items-center justify-center gap-2 active:scale-98"
                        >
                          <span>{seriesBreakdown.watchedCount > 0 ? 'Continuar Série' : 'Começar Série'}</span>
                          <span>▶</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          if (onDeleteSeries) {
                            onDeleteSeries(target);
                          } else {
                            for (const ep of target.episodes) {
                              onDelete(ep);
                            }
                          }
                          onClose();
                        }}
                        className="px-5 py-3.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors text-xs font-bold flex items-center gap-2"
                        title="Excluir todos os episódios desta série"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Excluir Série
                      </button>
                    </div>
                  )}

                  {/* Series seasons */}
                  {target.kind === 'series' && seriesBreakdown && (
                    <div className="space-y-6 pt-2">
                      {seriesBreakdown.seasons.length === 0 ? (
                        <p className="text-xs text-zinc-500">Nenhum episódio disponível nesta série.</p>
                      ) : (
                        seriesBreakdown.seasons.map((season) => {
                          const seasonWatched = season.episodes.filter((e) => e.watched === 1).length;
                          const pack = season.pack;
                          return (
                            <div key={season.seasonNumber} data-season-scroll={season.seasonNumber} className="space-y-2">
                              <div className="flex items-center justify-between pb-1 border-b border-zinc-800/60">
                                <h4 className="text-xs font-black text-zinc-200 uppercase tracking-wider">
                                  Temporada {season.seasonNumber}
                                </h4>
                                <span className="text-[10px] text-zinc-500 font-mono">
                                  {season.episodes.length > 0
                                    ? `${seasonWatched}/${season.episodes.length} assistidos`
                                    : pack
                                      ? pack.status === 'done'
                                        ? 'pronto'
                                        : pack.status === 'downloading'
                                          ? `baixando ${pack.progressPct ?? 0}%`
                                          : pack.status === 'preparing'
                                            ? 'preparando…'
                                            : pack.status === 'paused'
                                              ? 'pausado'
                                              : 'erro'
                                      : ''}
                                </span>
                              </div>

                              <div className="space-y-2">
                                {/* Pack da temporada (ex.: "Love, Death & Robots (T1)") */}
                                {pack && (
                                  <div className="flex items-center gap-3 bg-[#15161B] border border-[#EF9F27]/15 rounded-xl p-3">
                                    <span className="text-[10px] font-bold text-zinc-400 w-12 text-right tabular-nums shrink-0 font-mono">
                                      S{String(pack.seasonNumber ?? 1).padStart(2, '0')}
                                    </span>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs text-zinc-300 font-medium truncate">
                                        Temporada {pack.seasonNumber} (completa)
                                      </p>
                                      {pack.status === 'downloading' && (
                                        <div className="w-full h-1 bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                                          <div className="h-full bg-[#EF9F27] rounded-full" style={{ width: `${Math.min(100, Math.max(4, pack.progressPct || 0))}%` }} />
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      {pack.status === 'done' ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const episodeList = buildEpisodeList(season.episodes);
                                            onWatch(pack, episodeList);
                                            onClose();
                                          }}
                                          className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-[#EF9F27] text-black hover:bg-[#ffb04d] shadow-sm"
                                        >
                                          Assistir
                                        </button>
                                      ) : pack.status === 'error' && onRetry ? (
                                        <button
                                          type="button"
                                          onClick={() => onRetry(pack)}
                                          className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                        >
                                          Tentar novamente
                                        </button>
                                      ) : (
                                        (() => {
                                          const sb = statusBadge(pack);
                                          return sb ? (
                                            <span className={`text-[10px] px-2.5 py-1 rounded-lg font-mono ${sb.cls}`}>
                                              {sb.text}
                                            </span>
                                          ) : null;
                                        })()
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Episódios indexados */}
                                {season.episodes.map((ep) => {
                                  const epWatched = ep.watched === 1;
                                  const epProgress = ep.watchProgress || 0;
                                  const epTitle = ep.title || `Episódio ${ep.episodeNumber || '?'}`;
                                  const epDone = ep.status === 'done';
                                  const sb = statusBadge(ep);

                                  return (
                                    <div
                                      key={ep.id}
                                      className="flex items-center gap-3 bg-[#121317] border border-[#202226] rounded-xl p-3 hover:border-[#EF9F27]/30 transition-all"
                                    >
                                      <span className="text-[10px] font-bold text-zinc-500 w-12 text-right tabular-nums shrink-0 font-mono">
                                        {ep.seasonNumber ? `S${String(ep.seasonNumber).padStart(2, '0')}` : ''}
                                        {ep.episodeNumber ? `E${String(ep.episodeNumber).padStart(2, '0')}` : ''}
                                      </span>

                                      <div className="flex-1 min-w-0">
                                        <p className={`text-xs truncate ${epWatched ? 'text-zinc-500' : 'text-zinc-200 font-medium'}`}>
                                          {epTitle}
                                        </p>
                                        {!epWatched && epProgress > 0 && epDone && (
                                          <div className="w-full h-1 bg-zinc-800 rounded-full mt-1.5 overflow-hidden">
                                            <div className="h-full bg-[#EF9F27] rounded-full" style={{ width: `${Math.min(100, (epProgress / 1800) * 100)}%` }} />
                                          </div>
                                        )}
                                      </div>

                                      <div className="flex items-center gap-2 shrink-0">
                                        {epWatched ? (
                                          <span className="text-[10px] text-emerald-400 font-bold px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">✓ Visto</span>
                                        ) : epProgress > 0 && epDone ? (
                                          <span className="text-[10px] text-[#EF9F27] font-bold px-2 py-0.5 rounded bg-[#EF9F27]/10 border border-[#EF9F27]/20">Continuar</span>
                                        ) : null}

                                        {epDone ? (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              const episodeList = buildEpisodeList(season.episodes);
                                              onWatch(ep, episodeList);
                                              onClose();
                                            }}
                                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                                              epWatched
                                                ? 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
                                                : 'bg-[#EF9F27] text-black hover:bg-[#ffb04d] shadow-sm'
                                            }`}
                                          >
                                            {epWatched ? 'Rever' : epProgress > 0 ? 'Continuar' : 'Assistir'}
                                          </button>
                                        ) : ep.status === 'error' && onRetry ? (
                                          <button
                                            type="button"
                                            onClick={() => onRetry(ep)}
                                            className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
                                          >
                                            Tentar novamente
                                          </button>
                                        ) : sb ? (
                                          <span className={`text-[10px] px-2.5 py-1 rounded-lg font-mono ${sb.cls}`}>
                                            {sb.text}
                                          </span>
                                        ) : null}

                                        {onToggleWatched && (
                                          <button
                                            type="button"
                                            onClick={() => onToggleWatched(ep)}
                                            className={`p-1.5 rounded-lg border transition-colors ${
                                              epWatched
                                                ? 'bg-purple-500/15 border-purple-500/40 text-purple-300 hover:bg-purple-500/25'
                                                : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-800 text-zinc-500 hover:text-purple-300 hover:border-purple-500/40'
                                            }`}
                                            title={epWatched ? 'Marcar como não visto' : 'Marcar como visto'}
                                          >
                                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                          </button>
                                        )}

                                        <button
                                          type="button"
                                          onClick={() => onDelete(ep)}
                                          className="p-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-500 hover:text-red-400 hover:border-red-500/40 transition-colors"
                                          title={`Excluir ${epTitle}`}
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
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
