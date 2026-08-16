'use client';
import { useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Project } from '@/lib/api';

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
}: LibraryDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [target, onClose]);

  const seasons = useMemo(() => {
    if (!target || target.kind !== 'series') return [];
    const map = new Map<number, Project[]>();
    for (const ep of target.episodes) {
      const s = ep.seasonNumber ?? 1;
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(ep);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([num, eps]) => ({
        num,
        eps: eps.sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)),
      }));
  }, [target]);

  const seriesStats = useMemo(() => {
    if (!target || target.kind !== 'series') return { total: 0, watched: 0, done: 0 };
    const total = target.episodes.length;
    const watched = target.episodes.filter((e) => e.watched === 1).length;
    const done = target.episodes.filter((e) => e.status === 'done').length;
    return { total, watched, done };
  }, [target]);

  const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  const thumb = (id: string) => `${apiBase}/projects/${id}/thumbnail`;

  if (!target) return null;

  const buildEpisodeList = (eps: Project[]) =>
    eps
      .filter((e) => e.status === 'done')
      .map((e) => ({ id: e.id, title: e.title || `Ep ${e.episodeNumber}`, videoUrl: `${apiBase}/projects/${e.id}/video` }));

  const movie = target.kind === 'movie' ? target.project : null;
  const { title: cleanName, quality } = cleanTitle(movie?.title || (target.kind === 'series' ? target.title : '') || 'Mídia');

  const isMovieDone = !!movie && movie.status === 'done';
  const movieWatched = !!movie && movie.watched === 1;
  const movieProgress = movie?.watchProgress || 0;

  const sourceMagnet = (target.kind === 'movie' ? movie?.facelessConfig?.sourceUrl : undefined) || (target.kind === 'movie' ? movie?.youtubeUrl : undefined);
  const torrentInfo = parseMagnet(sourceMagnet);
  const sizeBytes = target.kind === 'movie' ? movie?.sizeBytes : undefined;
  const downloadDate = target.kind === 'movie' ? movie?.createdAt : undefined;
  const qualityLabel = (target.kind === 'movie' ? movie?.facelessConfig?.quality : undefined) || quality;
  const posterExternal = target.kind === 'movie' ? movie?.facelessConfig?.posterUrl : undefined;

  const posterId = target.kind === 'movie' ? movie!.id : target.episodes[0]?.id || '';

  return (
    <AnimatePresence>
      {target && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:p-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <motion.div
            className="absolute inset-0 bg-black/85 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          <motion.div
            ref={modalRef}
            initial={{ scale: 0.95, opacity: 0, y: 20 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 20 }}
            transition={{ duration: 0.2, ease: [0.25, 1, 0.5, 1] }}
            className="relative w-full max-w-4xl bg-[#0A0B0D] border border-[#202226] rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col md:flex-row z-10"
          >
            {/* Banner / Poster — left side */}
            <div className="relative md:w-[300px] md:shrink-0 shrink-0 bg-[#0A0B0D] p-2 md:p-2.5">
              <div className="relative aspect-[2/3] w-full rounded-xl overflow-hidden border border-zinc-800/80">
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

                {/* Mobile title overlay */}
                <div className="absolute bottom-3 left-4 right-4 md:hidden">
                  <h3 className="text-lg font-black text-white truncate">{cleanName}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="px-2 py-0.5 rounded-full bg-[#E50914]/90 text-white text-[9px] font-black uppercase tracking-wider">
                      {target.kind === 'series' ? 'Série' : 'Filme'}
                    </span>
                    <span className="text-[11px] text-zinc-300 font-mono">{qualityLabel}</span>
                  </div>
                </div>

                {/* Mobile close */}
                <button
                  type="button"
                  onClick={onClose}
                  className="absolute top-3 right-3 md:hidden w-8 h-8 flex items-center justify-center rounded-full bg-black/60 hover:bg-black/80 border border-zinc-700/80 text-zinc-300 hover:text-white text-sm transition-all z-10"
                  title="Fechar"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Info — right side */}
            <div className="flex-1 min-w-0 flex flex-col">
              {/* Header (desktop) */}
              <div className="hidden md:flex items-start justify-between gap-4 px-6 pt-6 pb-4 border-b border-[#202226]">
                <div className="min-w-0">
                  <h3 className="text-xl font-black text-white truncate">{cleanName}</h3>
                  <div className="flex items-center gap-2 mt-1.5 text-[11px] font-mono">
                    <span className="px-2 py-0.5 rounded-full bg-[#E50914]/15 border border-[#E50914]/40 text-red-400 font-black uppercase tracking-wider">
                      {target.kind === 'series' ? 'Série' : 'Filme'}
                    </span>
                    <span className="text-zinc-400">{qualityLabel}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-9 h-9 shrink-0 flex items-center justify-center rounded-full bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700/80 text-zinc-300 hover:text-white text-sm transition-all"
                  title="Fechar"
                >
                  ✕
                </button>
              </div>

              <div className="p-6 pt-4 md:pt-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
                {/* Stats row */}
                <div className="grid grid-cols-3 gap-3">
                  {target.kind === 'series' ? (
                    <>
                      <div className="bg-[#121317] border border-[#202226] rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-zinc-100 tabular-nums">{seriesStats.total}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Episódios</p>
                      </div>
                      <div className="bg-[#121317] border border-[#202226] rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-purple-400 tabular-nums">{seriesStats.watched}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Assistidos</p>
                      </div>
                      <div className="bg-[#121317] border border-[#202226] rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-emerald-400 tabular-nums">{seriesStats.done}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Disponíveis</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="bg-[#121317] border border-[#202226] rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-zinc-100 tabular-nums">{movieWatched ? '✓' : movieProgress > 0 ? formatProgress(movieProgress) : '—'}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">
                          {movieWatched ? 'Visto' : movieProgress > 0 ? 'Progresso' : 'Status'}
                        </p>
                      </div>
                      <div className="bg-[#121317] border border-[#202226] rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-emerald-400 tabular-nums">{isMovieDone ? 'Pronto' : movie?.status === 'downloading' ? `${movie?.progressPct || 0}%` : movie?.status === 'error' ? 'Erro' : 'Pendente'}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Download</p>
                      </div>
                      <div className="bg-[#121317] border border-[#202226] rounded-xl p-3 text-center">
                        <p className="text-xl font-black text-zinc-100 tabular-nums">{quality}</p>
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">Qualidade</p>
                      </div>
                    </>
                  )}
                </div>

                {/* Movie progress bar */}
                {target.kind === 'movie' && isMovieDone && !movieWatched && movieProgress > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                      <span>Você parou em {formatProgress(movieProgress)}</span>
                      <span>{movieProgress >= 3600 ? 'Restando ~' + formatProgress(Math.max(0, 5400 - movieProgress)) : ''}</span>
                    </div>
                    <div className="w-full h-2 bg-[#1A1B20] rounded-full overflow-hidden">
                      <div className="h-full bg-[#EF9F27] rounded-full" style={{ width: `${Math.min(100, (movieProgress / 5400) * 100)}%` }} />
                    </div>
                  </div>
                )}

                {/* Series overall progress */}
                {target.kind === 'series' && seriesStats.total > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono">
                      <span>{seriesStats.watched} de {seriesStats.total} episódios assistidos</span>
                      <span>{Math.round((seriesStats.watched / seriesStats.total) * 100)}%</span>
                    </div>
                    <div className="w-full h-2 bg-[#1A1B20] rounded-full overflow-hidden">
                      <div className="h-full bg-purple-500 rounded-full" style={{ width: `${(seriesStats.watched / seriesStats.total) * 100}%` }} />
                    </div>
                  </div>
                )}

                {/* Detailed info — size, torrent, date */}
                {(target.kind === 'movie' || target.episodes[0]) && (
                  <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                      <span className="w-3.5 h-3.5 rounded-full bg-zinc-800 flex items-center justify-center text-[8px]">ℹ️</span>
                      Informações do Arquivo
                    </h4>

                    <div className="grid grid-cols-2 gap-2.5">
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
                        <div className="bg-[#121317] border border-[#202226] rounded-xl px-3.5 py-2.5">
                          <p className="text-[9px] text-zinc-500 uppercase tracking-wider font-bold">Validação</p>
                          <p className="text-[11px] font-bold text-emerald-400 mt-0.5 leading-snug">{movie.progressStatus}</p>
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
                            <p className="text-[11px] text-zinc-200 font-mono break-words leading-snug">{torrentInfo.name}</p>
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
                            className="inline-flex items-center gap-1.5 text-[10px] font-bold text-[#EF9F27] hover:text-amber-400 transition-colors pt-1"
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
                  <div className="flex items-center gap-3 flex-wrap">
                    {isMovieDone ? (
                      <button
                        type="button"
                        onClick={() => onWatch(movie!)}
                        className="flex-1 min-w-[160px] py-3 bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-[#EF9F27]/10 flex items-center justify-center gap-2"
                      >
                        <span>{movieWatched ? 'Rever' : movieProgress > 0 ? 'Continuar Assistindo' : 'Assistir'}</span>
                        <span>▶</span>
                      </button>
                    ) : movie?.status === 'downloading' ? (
                      <div className="flex-1 min-w-[160px] py-3 bg-[#EF9F27]/10 border border-[#EF9F27]/30 text-[#EF9F27] font-black rounded-xl text-xs uppercase tracking-wider flex items-center justify-center gap-2">
                        <span className="w-3.5 h-3.5 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
                        Baixando {movie?.progressPct || 0}%
                      </div>
                    ) : movie?.status === 'error' && onRetry ? (
                      <button
                        type="button"
                        onClick={() => onRetry(movie!)}
                        className="flex-1 min-w-[160px] py-3 bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 font-black rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                      >
                        <span>Tentar novamente</span>
                        <span>↻</span>
                      </button>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => {
                        if (movie) onDelete(movie);
                        onClose();
                      }}
                      className="px-4 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors text-xs font-bold flex items-center gap-2"
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
                {target.kind === 'series' && (
                  <div className="flex items-center gap-3 flex-wrap">
                    {seriesStats.done > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const next = target.episodes
                            .filter((e) => e.status === 'done' && e.watched !== 1)
                            .sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))[0]
                            || target.episodes.filter((e) => e.status === 'done').sort((a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))[0];
                          if (next) {
                            const episodeList = buildEpisodeList(target.episodes);
                            onWatch(next, episodeList);
                          }
                        }}
                        className="flex-1 min-w-[160px] py-3 bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 font-black rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-[#EF9F27]/10 flex items-center justify-center gap-2"
                      >
                        <span>{seriesStats.watched > 0 ? 'Continuar Série' : 'Começar Série'}</span>
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
                      className="px-4 py-3 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors text-xs font-bold flex items-center gap-2"
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
                {target.kind === 'series' && (
                  <div className="space-y-4">
                    {seasons.length === 0 ? (
                      <p className="text-xs text-zinc-500">Nenhum episódio disponível nesta série.</p>
                    ) : (
                      seasons.map((season) => {
                        const watched = season.eps.filter((e) => e.watched === 1).length;
                        return (
                          <div key={season.num} className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <h4 className="text-[11px] font-black text-zinc-300 uppercase tracking-wider">
                                Temporada {season.num}
                              </h4>
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {watched}/{season.eps.length} assistidos
                              </span>
                            </div>

                            <div className="space-y-1.5">
                              {season.eps.map((ep) => {
                                const epWatched = ep.watched === 1;
                                const epProgress = ep.watchProgress || 0;
                                const epTitle = ep.title || `Episódio ${ep.episodeNumber || '?'}`;
                                const epDone = ep.status === 'done';

                                return (
                                  <div
                                    key={ep.id}
                                    className="flex items-center gap-3 bg-[#121317] border border-[#202226] rounded-xl p-3 hover:border-[#EF9F27]/25 transition-all"
                                  >
                                    <span className="text-[10px] font-bold text-zinc-600 w-12 text-right tabular-nums shrink-0">
                                      {ep.seasonNumber ? `S${String(ep.seasonNumber).padStart(2, '0')}` : ''}
                                      {ep.episodeNumber ? `E${String(ep.episodeNumber).padStart(2, '0')}` : ''}
                                    </span>

                                    <div className="flex-1 min-w-0">
                                      <p className={`text-xs truncate ${epWatched ? 'text-zinc-500' : 'text-zinc-200 font-medium'}`}>
                                        {epTitle}
                                      </p>
                                      {!epWatched && epProgress > 0 && epDone && (
                                        <div className="w-full h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                                          <div className="h-full bg-[#EF9F27] rounded-full" style={{ width: `${Math.min(100, (epProgress / 1800) * 100)}%` }} />
                                        </div>
                                      )}
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                      {epWatched ? (
                                        <span className="text-[10px] text-emerald-500 font-bold">✓ Visto</span>
                                      ) : epProgress > 0 && epDone ? (
                                        <span className="text-[10px] text-[#EF9F27] font-bold">Continuar</span>
                                      ) : null}

                                      {epDone ? (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const episodeList = buildEpisodeList(season.eps);
                                            onWatch(ep, episodeList);
                                          }}
                                          className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${epWatched ? 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700' : 'bg-[#EF9F27] text-black hover:bg-[#ffb04d]'}`}
                                        >
                                          {epWatched ? 'Rever' : epProgress > 0 ? 'Continuar' : 'Assistir'}
                                        </button>
                                      ) : ep.status === 'downloading' ? (
                                        <span className="text-[10px] text-zinc-500 px-2 py-1 bg-zinc-800 rounded-lg">
                                          {ep.progressPct || 0}%
                                        </span>
                                      ) : ep.status === 'error' && onRetry ? (
                                        <button
                                          type="button"
                                          onClick={() => onRetry(ep)}
                                          className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
                                        >
                                          Tentar novamente
                                        </button>
                                      ) : (
                                        <span className="text-[10px] text-zinc-600">Pendente</span>
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
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
