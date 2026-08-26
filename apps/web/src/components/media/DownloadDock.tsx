'use client';
import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Project } from '@/lib/api';
import { pauseMediaDownload, resumeMediaDownload, cancelProjectDownload } from '@/lib/api';
import { breakdownSeries, seasonChips } from '@/lib/seriesProjects';

interface DownloadDockProps {
  projects: Project[];
  onWatch?: (project: Project) => void;
  onRetry?: (project: Project) => void;
}

function parseDownloadInfo(progressStatus: string | null | undefined): { speed: string; eta: string | null; stage: string | null } {
  if (!progressStatus) return { speed: '0.0 MB/s', eta: null, stage: null };

  let speed = '0.0 MB/s';
  let eta: string | null = null;

  // Extract speed (e.g. 15MiB/s, 15.2 MB/s, ⚡ 14MB/s)
  const speedMatch = progressStatus.match(/([\d.]+)\s*(MiB|MB|KiB|KB|GB|B)\/?s?/i);
  if (speedMatch) {
    speed = normalizeSpeed(parseFloat(speedMatch[1]), speedMatch[2]);
  }

  // Extract ETA (e.g. ETA: 1m45s or ETA: 30s)
  const etaMatch = progressStatus.match(/ETA:?\s*([\w\d]+)/i);
  if (etaMatch) {
    eta = etaMatch[1];
  }

  const lower = progressStatus.toLowerCase();
  let stage: string | null = null;
  if (lower.includes('remux') || lower.includes('otimizando')) stage = 'Otimizando áudio/vídeo';
  else if (lower.includes('verificando') || lower.includes('validand')) stage = 'Verificando integridade';
  else if (lower.includes('extraindo')) stage = 'Extraindo legendas';
  else if (lower.includes('metadados') || lower.includes('seeders') || lower.includes('conectando')) stage = 'Procurando seeders';
  else if (lower.includes('tentando') || lower.includes('retomando') || lower.includes('falha transit')) stage = 'Tentando novamente';
  else if (lower.includes('conclu') || lower.includes('pronto')) stage = 'Pronto';

  return { speed, eta, stage };
}

// aria2 reports binary units (MiB = 1,048,576 bytes). Convert to decimal MB/s
function normalizeSpeed(value: number, unit: string): string {
  const u = unit.toLowerCase();
  const bytes =
    u === 'mib' ? value * 1048576 :
    u === 'kib' ? value * 1024 :
    u === 'b' ? value :
    u === 'kb' ? value * 1000 :
    u === 'mb' ? value * 1000000 :
    u === 'gb' ? value * 1000000000 :
    value * 1048576;
  const mbps = bytes / 1000000;
  if (mbps >= 1000) return `${(mbps / 1000).toFixed(1)} GB/s`;
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  return `${(mbps * 1000).toFixed(0)} KB/s`;
}

export default function DownloadDock({ projects, onRetry }: DownloadDockProps) {
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('jackin_dismissed_downloads');
        return saved ? new Set(JSON.parse(saved)) : new Set();
      } catch {
        return new Set();
      }
    }
    return new Set();
  });

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('jackin_dismissed_downloads', JSON.stringify(Array.from(next)));
        } catch {}
      }
      return next;
    });
  };

  const handlePause = async (p: Project) => {
    try { await pauseMediaDownload(p.id); } catch {}
  };
  const handleResume = async (p: Project) => {
    try { await resumeMediaDownload(p.id); } catch {}
  };
  const handleCancelOrDismiss = async (p: any) => {
    if (p.episodes?.length) {
      p.episodes.forEach((e: Project) => handleDismiss(e.id));
      for (const ep of p.episodes) {
        if (ep.status === 'downloading' || ep.status === 'preparing' || ep.status === 'paused') {
          cancelProjectDownload(ep.id).catch(() => {});
        }
      }
    } else {
      handleDismiss(p.id);
      if (p.status === 'downloading' || p.status === 'preparing' || p.status === 'paused') {
        cancelProjectDownload(p.id).catch(() => {});
      }
    }
  };

  const visibleDownloads = projects.filter((p) => !dismissedIds.has(p.id));
  const downloadingItems = visibleDownloads.filter((p) => p.status === 'downloading' || p.status === 'preparing');

  const groupedDownloads = useMemo(() => {
    const seriesMap = new Map<string, Project[]>();
    const singles: Project[] = [];
    for (const p of visibleDownloads) {
      if (p.seriesId) {
        const list = seriesMap.get(p.seriesId) || [];
        list.push(p);
        seriesMap.set(p.seriesId, list);
      } else {
        singles.push(p);
      }
    }
    const seriesGroups = Array.from(seriesMap.values()).map((eps) => {
      const b = breakdownSeries(eps);
      const statuses = new Set(eps.map((e) => e.status));
      const isDone = b.allDone;
      const isDownloading = b.anyDownloading;
      const isPaused = !isDownloading && statuses.has('paused');
      const status = isDone ? 'done' : isDownloading ? 'downloading' : isPaused ? 'paused' : 'error';
      return {
        id: `series-${eps[0]?.seriesId || ''}`,
        title: b.baseTitle,
        countLabel: b.hasEpisodes
          ? `${b.doneUnits}/${b.totalUnits} episódios`
          : `${b.readySeasons}/${b.totalSeasons} temporadas`,
        chips: b.totalSeasons > 1 ? seasonChips(b.seasons) : '',
        status,
        progressPct: b.currentPercent,
        progressStatus: b.activeDownload?.progressStatus ?? null,
        hasActiveDownload: eps.some((e) => e.status === 'downloading'),
        hasPreparing: eps.some((e) => e.status === 'preparing'),
        breakdown: b,
        episodes: eps,
        baseTitle: b.baseTitle,
      };
    });
    return { singles, series: seriesGroups };
  }, [visibleDownloads]);

  const hasActiveDownloads = downloadingItems.length > 0;
  const [userMinimized, setUserMinimized] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  const dockItemCount = groupedDownloads.singles.length + groupedDownloads.series.length;
  const activeDockCount = dockItemCount;

  useEffect(() => {
    if (hasActiveDownloads && !userMinimized) {
      setIsExpanded(true);
    }
  }, [hasActiveDownloads, userMinimized]);

  const handleMinimize = () => {
    setUserMinimized(true);
    setIsExpanded(false);
  };

  if (visibleDownloads.length === 0) return null;

  if (!isExpanded) {
    return (
      <motion.button
        type="button"
        initial={{ scale: 0.85, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.85, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        onClick={() => {
          setUserMinimized(false);
          setIsExpanded(true);
        }}
        className="fixed bottom-6 right-6 z-45 h-12 px-4 rounded-2xl bg-zinc-950/95 hover:bg-zinc-900 border border-[#EF9F27]/40 hover:border-[#EF9F27] text-white flex items-center gap-2.5 shadow-2xl shadow-black/90 backdrop-blur-2xl cursor-pointer transition-all active:scale-95 group"
        title="Abrir gerenciador de downloads"
        aria-label="Abrir gerenciador de downloads"
      >
        {/* Animated Cinema Download Icon */}
        <div className="relative flex items-center justify-center w-6 h-6 text-[#EF9F27]">
          {hasActiveDownloads && (
            <span className="absolute inset-0 rounded-full bg-[#EF9F27]/25 animate-ping" />
          )}
          <svg
            className="w-5 h-5 transition-transform group-hover:translate-y-0.5 duration-200"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
        </div>

        <div className="flex items-center gap-2 font-mono text-xs">
          <span className="font-black text-zinc-100 uppercase tracking-wider text-[11px]">Downloads</span>
          <span className="px-2 py-0.5 rounded-full bg-[#EF9F27] text-zinc-950 font-black text-[10px] shadow-sm">
            {activeDockCount}
          </span>
        </div>
      </motion.button>
    );
  }

  return (
    <div className="fixed bottom-6 inset-x-0 z-45 px-4 md:px-8 flex justify-center pointer-events-none">
      <motion.div
        initial={{ y: 80, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        className="pointer-events-auto bg-zinc-950/95 backdrop-blur-2xl border border-zinc-800/90 rounded-2xl px-5 py-3.5 shadow-2xl shadow-black/90 flex flex-col md:flex-row md:items-center gap-4 max-w-6xl w-full overflow-hidden relative"
      >
        {/* Header Section */}
        <div className="flex items-center justify-between md:justify-start gap-3 border-b md:border-b-0 md:border-r border-zinc-800/80 pb-2 md:pb-0 pr-0 md:pr-5 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className={`${hasActiveDownloads ? 'animate-ping' : ''} absolute inline-flex h-full w-full rounded-full bg-[#EF9F27] opacity-75`} />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-[#EF9F27]" />
            </span>
            <span className="text-xs font-black text-zinc-100 uppercase tracking-widest">
              DOWNLOADS
            </span>
            <span className="text-[11px] font-bold text-zinc-400 bg-zinc-900 border border-zinc-800 px-2.5 py-0.5 rounded-full">
              {activeDockCount}
            </span>
          </div>

          <button
            type="button"
            onClick={handleMinimize}
            className="md:hidden text-zinc-500 hover:text-zinc-300 p-1 cursor-pointer"
            title="Minimizar barra"
            aria-label="Minimizar barra"
          >
            ✕
          </button>
        </div>

        {/* Scrollable / Spread Items Container */}
        <div className="flex items-center gap-3 overflow-x-auto py-1 no-scrollbar flex-1">
          <AnimatePresence>
            {[...groupedDownloads.singles, ...groupedDownloads.series].map((p: any) => {
              const isDone = p.status === 'done';
              const isDownloading = p.status === 'downloading';
              const isPreparing = p.status === 'preparing';
              const isPaused = p.status === 'paused';
              const isSeriesGroup = !!p.breakdown;

              const info = parseDownloadInfo(p.progressStatus);
              const pct = p.progressPct != null ? Math.round(p.progressPct) : (isDone ? 100 : 0);

              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className={`shrink-0 flex items-center justify-between gap-4 rounded-xl px-4 py-2.5 border transition-all min-w-[280px] md:min-w-[340px] max-w-[440px] flex-1 ${
                    isDone
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : isDownloading
                        ? 'bg-[#EF9F27]/10 border-[#EF9F27]/30 text-[#EF9F27]'
                        : isPreparing
                          ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                          : isPaused
                            ? 'bg-zinc-800/40 border-zinc-700/50 text-zinc-300'
                            : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}
                >
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-black text-zinc-100 truncate" title={p.title || ''}>
                        {p.title || 'Mídia'}
                      </p>
                      <span className="text-[10px] font-mono font-bold shrink-0">
                        {isDone ? '✓ 100%' : isPaused ? 'Pausado' : isPreparing ? 'Preparando' : `${pct}%`}
                      </span>
                    </div>

                    {/* Horizontal Progress Bar */}
                    {(isDownloading || isPreparing || isPaused) && (
                      <div className="w-full bg-zinc-900/80 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`${isPaused ? 'bg-zinc-500' : isPreparing ? 'bg-sky-400 animate-pulse' : 'bg-[#EF9F27]'} h-full rounded-full transition-all duration-300`}
                          style={{ width: `${Math.max(5, pct)}%` }}
                        />
                      </div>
                    )}

                    {/* Metadata Line: Speed, ETA, Stage */}
                    <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-400 truncate">
                      {isDone ? (
                        <span className="text-emerald-400 font-bold">✓ Pronto para assistir</span>
                      ) : isDownloading ? (
                        <>
                          <span className="text-[#EF9F27] font-bold shrink-0">⚡ {info.speed}</span>
                          {info.eta && (
                            <span className="text-zinc-400 shrink-0">⏱ ETA: {info.eta}</span>
                          )}
                          {info.stage && (
                            <span className="text-zinc-500 truncate">• {info.stage}</span>
                          )}
                        </>
                      ) : isPreparing ? (
                        <span className="text-sky-300 font-bold">⚙️ {info.stage || 'Otimizando para reprodução…'}</span>
                      ) : isPaused ? (
                        <span className="text-zinc-400">Download em pausa</span>
                      ) : (
                        <span className="text-red-400">Falha no download</span>
                      )}
                    </div>

                    {isSeriesGroup && (
                      <p className="text-[9px] font-mono text-zinc-500 truncate">
                        {p.countLabel} {p.chips ? `• ${p.chips}` : ''}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    {isDone ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (p.episodes?.length) p.episodes.forEach((e: Project) => handleDismiss(e.id));
                          else handleDismiss(p.id);
                        }}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-zinc-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all shadow-md shadow-emerald-500/20 flex items-center gap-1 cursor-pointer"
                        title="Concluído - Fechar da barra"
                      >
                        <span>OK</span>
                        <span>✓</span>
                      </button>
                    ) : isDownloading || isPreparing ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (p.episodes?.length) p.episodes.forEach((e: Project) => handlePause(e));
                          else handlePause(p);
                        }}
                        className="p-2 bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 border border-amber-500/30 font-black rounded-lg text-xs transition-all flex items-center justify-center cursor-pointer"
                        title="Pausar download"
                      >
                        ⏸
                      </button>
                    ) : isPaused ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (p.episodes?.length) p.episodes.forEach((e: Project) => handleResume(e));
                          else handleResume(p);
                        }}
                        className="p-2 bg-sky-500/15 hover:bg-sky-500/25 active:scale-95 text-sky-300 border border-sky-500/30 font-black rounded-lg text-xs transition-all flex items-center justify-center cursor-pointer"
                        title="Retomar download"
                      >
                        ▶
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (p.episodes?.length) p.episodes.forEach((e: Project) => onRetry?.(e));
                          else onRetry?.(p);
                        }}
                        className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 border border-amber-500/30 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
                        title="Tentar baixar novamente"
                      >
                        <span>↻ Tentar</span>
                      </button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Desktop Collapse Button */}
        <button
          type="button"
          onClick={handleMinimize}
          className="hidden md:block text-zinc-500 hover:text-zinc-300 p-1.5 hover:bg-zinc-900 rounded-lg transition-colors pointer-events-auto ml-auto cursor-pointer shrink-0"
          title="Minimizar barra"
          aria-label="Minimizar barra"
        >
          ✕
        </button>
      </motion.div>
    </div>
  );
}

