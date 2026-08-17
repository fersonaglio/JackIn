'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Project } from '@/lib/api';
import { pauseMediaDownload, resumeMediaDownload } from '@/lib/api';

interface DownloadDockProps {
  projects: Project[];
  onWatch?: (project: Project) => void;
  onRetry?: (project: Project) => void;
}

function parseSpeed(progressStatus: string | null | undefined): string {
  if (!progressStatus) return '0.0 MB/s';

  // Format 1 (aria2): "... 80.0% (⚡ 35.0MiB/s) [SD:2 CN:4]"
  if (progressStatus.includes('⚡')) {
    const after = progressStatus.split('⚡')[1] || '';
    const m = after.match(/([\d.]+)\s*(MiB|MB|KiB|KB|B)\/?s?/);
    if (m) return normalizeSpeed(parseFloat(m[1]), m[2]);
  }

  // Format 2 (direct HTTP): "... 512.0 MB / 2048.0 MB (5.2 MB/s)"
  const mb = progressStatus.match(/\(([\d.]+)\s*MB\/s\)/);
  if (mb) return `${mb[1]} MB/s`;

  // Processing stages carry no speed — label the stage instead of a fake 0.
  const lower = progressStatus.toLowerCase();
  if (lower.includes('remux')) return 'processando';
  if (lower.includes('verificando') || lower.includes('validand')) return 'verificando';
  if (lower.includes('extraindo')) return 'extraindo';
  if (lower.includes('metadados') || lower.includes('seeders') || lower.includes('conectando')) return 'procurando seeders';
  if (lower.includes('tentando') || lower.includes('retomando') || lower.includes('falha transit')) return 'tentando novamente';
  if (lower.includes('conclu')) return 'concluído';

  return '0.0 MB/s';
}

// aria2 reports binary units (MiB = 1,048,576 bytes). Convert to decimal MB/s
// (1,000,000 bytes) so the UI matches the metric the user expects.
function normalizeSpeed(value: number, unit: string): string {
  const bytes =
    unit === 'MiB' ? value * 1048576 :
    unit === 'KiB' ? value * 1024 :
    unit === 'B' ? value :
    unit === 'KB' ? value * 1000 :
    unit === 'MB' ? value * 1000000 :
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

  // Pause/resume are handled here; the project list polls every ~1.5s so the
  // new status (paused / downloading) shows up automatically.
  const handlePause = async (p: Project) => {
    try { await pauseMediaDownload(p.id); } catch {}
  };
  const handleResume = async (p: Project) => {
    try { await resumeMediaDownload(p.id); } catch {}
  };

  const visibleDownloads = projects.filter((p) => p.projectType === 'movie' && !dismissedIds.has(p.id));
  const downloadingItems = visibleDownloads.filter((p) => p.status === 'downloading' || p.status === 'preparing');

  const hasActiveDownloads = downloadingItems.length > 0;
  const [isExpanded, setIsExpanded] = useState(false);

  // Auto-expand when a new download starts
  useEffect(() => {
    if (hasActiveDownloads) {
      setIsExpanded(true);
    }
  }, [hasActiveDownloads]);

  if (visibleDownloads.length === 0) return null;

  // Render floating button if collapsed and no active downloads
  if (!isExpanded && !hasActiveDownloads) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="fixed bottom-6 right-6 z-40 w-12 h-12 rounded-full bg-zinc-950/90 hover:bg-zinc-900 border border-zinc-800 text-amber-500 hover:text-amber-400 flex items-center justify-center shadow-2xl backdrop-blur-md cursor-pointer transition-all active:scale-95 group"
        title="Downloads"
      >
        <span className="text-xl">📥</span>
        {downloadingItems.length > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-600 border border-zinc-950 text-white text-[10px] font-black rounded-full flex items-center justify-center px-1">
            {downloadingItems.length}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-45 max-w-4xl w-full px-4 flex justify-center pointer-events-none">
      <motion.div
        initial={{ y: 80, opacity: 0, scale: 0.95 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        className="pointer-events-auto bg-zinc-950/90 backdrop-blur-2xl border border-zinc-800/90 rounded-2xl px-5 py-3 shadow-2xl shadow-black/80 flex flex-wrap items-center gap-4 max-w-full overflow-hidden relative"
      >
        <div className="flex items-center gap-2 border-r border-zinc-800/80 pr-4 shrink-0">
          <span className="relative flex h-2.5 w-2.5">
            <span className={`${hasActiveDownloads ? 'animate-ping' : ''} absolute inline-flex h-full w-full rounded-full bg-[#EF9F27] opacity-75`} />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#EF9F27]" />
          </span>
          <span className="text-xs font-black text-zinc-100 uppercase tracking-wide">
            DOWNLOADS
          </span>
          <span className="text-[10px] font-bold text-zinc-500 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded-full">
            {downloadingItems.length}
          </span>
        </div>

        <div className="flex items-center gap-3 overflow-x-auto py-0.5 no-scrollbar pr-6">
          <AnimatePresence>
            {visibleDownloads.map((p) => {
              const isDone = p.status === 'done';
              const isDownloading = p.status === 'downloading';
              const isPreparing = p.status === 'preparing';
              const isPaused = p.status === 'paused';
              const speed = parseSpeed(p.progressStatus);

              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className={`shrink-0 flex items-center gap-3 rounded-xl px-3.5 py-2 border transition-all ${
                    isDone
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : isDownloading
                        ? 'bg-[#EF9F27]/10 border-[#EF9F27]/30 text-[#EF9F27]'
                        : isPreparing
                          ? 'bg-[#EF9F27]/10 border-[#EF9F27]/30 text-[#EF9F27]'
                          : isPaused
                            ? 'bg-sky-500/10 border-sky-500/30 text-sky-400'
                            : 'bg-red-500/10 border-red-500/30 text-red-400'
                  }`}
                >
                  <div className="space-y-0.5 max-w-[150px]">
                    <p className="text-xs font-extrabold text-zinc-100 truncate" title={p.title || ''}>
                      {p.title || 'Mídia'}
                    </p>
                    <div className="flex items-center gap-2">
                      {(isDownloading || isPreparing || isPaused) && (
                        <div className="w-16 bg-zinc-900 h-1.5 rounded-full overflow-hidden shrink-0">
                          <div
                            className={`${isPaused ? 'bg-sky-500' : 'bg-[#EF9F27]'} h-full rounded-full transition-all duration-300`}
                            style={{ width: `${Math.max(5, p.progressPct || 0)}%` }}
                          />
                        </div>
                      )}
                      <span className="text-[10px] font-mono font-bold">
                        {isDone ? 'Concluído' : isPaused ? 'Pausado' : isPreparing ? 'Preparando' : isDownloading ? `${p.progressPct || 0}%` : 'Erro'}
                      </span>
                    </div>
                  </div>

                  {isDone ? (
                    <button
                      type="button"
                      onClick={() => handleDismiss(p.id)}
                      className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-zinc-950 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all shadow-md shadow-emerald-500/20 flex items-center gap-1 cursor-pointer"
                      title="Concluído - Remover da barra"
                    >
                      <span>OK</span>
                      <span>✓</span>
                    </button>
                  ) : isDownloading || isPreparing ? (
                    <>
                      <span className="text-[9px] font-mono text-zinc-500 shrink-0">
                        ⚡ {speed}
                      </span>
                      <button
                        type="button"
                        onClick={() => handlePause(p)}
                        className="px-2.5 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 border border-amber-500/30 font-black rounded-lg text-[10px] transition-all flex items-center gap-1 cursor-pointer"
                        title="Pausar download"
                      >
                        <span>⏸</span>
                      </button>
                    </>
                  ) : isPaused ? (
                    <button
                      type="button"
                      onClick={() => handleResume(p)}
                      className="px-2.5 py-1.5 bg-sky-500/15 hover:bg-sky-500/25 active:scale-95 text-sky-300 border border-sky-500/30 font-black rounded-lg text-[10px] transition-all flex items-center gap-1 cursor-pointer"
                      title="Retomar download"
                    >
                      <span>▶</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onRetry?.(p)}
                      className="px-3 py-1.5 bg-amber-500/15 hover:bg-amber-500/25 active:scale-95 text-amber-300 border border-amber-500/30 font-black rounded-lg text-[10px] uppercase tracking-wider transition-all flex items-center gap-1 cursor-pointer"
                      title="Tentar baixar novamente"
                    >
                      <span>Tentar</span>
                      <span>↻</span>
                    </button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Collapse Button */}
        {!hasActiveDownloads && (
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="text-zinc-500 hover:text-zinc-300 p-1 transition-colors pointer-events-auto ml-auto cursor-pointer"
            title="Minimizar"
          >
            ✕
          </button>
        )}
      </motion.div>
    </div>
  );
}

