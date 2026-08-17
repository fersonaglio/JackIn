'use client';
import { motion, AnimatePresence } from 'framer-motion';
import type { MediaOption } from '@/lib/api';

interface TorrentOptionRowProps {
  option: MediaOption;
  isDownloading: boolean;
  started?: boolean;
  onDownload: (option: MediaOption) => void;
  /** Séries: quantas temporadas o magnet inclui (ex.: "1 temporada", "T1-T3"). */
  seasonLabel?: string | null;
}

const qualityColors: Record<string, string> = {
  '4K REMUX': 'bg-violet-500/10 border-violet-500/30 text-violet-400',
  '4K Ultra': 'bg-sky-500/10 border-sky-500/30 text-sky-400',
  '1080p': 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
  '720p': 'bg-amber-500/10 border-amber-500/30 text-amber-400',
  'WEBRip': 'bg-teal-500/10 border-teal-500/30 text-teal-400',
};

function getQualityColor(quality: string): string {
  for (const [key, cls] of Object.entries(qualityColors)) {
    if (quality.includes(key)) return cls;
  }
  return 'bg-zinc-800 border-zinc-700 text-zinc-400';
}

function audioBadge(option: MediaOption): { label: string; cls: string } | null {
  const at = option.audioType;
  if (option.ptExcluded) return { label: 'SEM PT', cls: 'bg-red-500/15 border-red-500/40 text-red-300' };
  if (option.ptConfirmed) return { label: 'PT-BR', cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' };
  if (at === 'dual') return { label: 'DUAL', cls: 'bg-purple-500/15 border-purple-500/40 text-purple-300' };
  if (at === 'multi') return { label: 'MULTI', cls: 'bg-teal-500/15 border-teal-500/40 text-teal-300' };
  if (at === 'dub') return { label: 'DUBLADO', cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' };
  if (at === 'unknown') return { label: 'ORIGINAL', cls: 'bg-sky-500/15 border-sky-500/40 text-sky-300' };
  return null;
}

export default function TorrentOptionRow({ option, isDownloading, started = false, onDownload, seasonLabel }: TorrentOptionRowProps) {
  const badge = audioBadge(option);
  const qualityColor = getQualityColor(option.quality);
  const subsBadge = option.hasSubtitles
    ? { label: 'LEGENDADO', cls: 'bg-amber-500/15 border-amber-500/40 text-amber-300' }
    : null;
  const lowSeeds = option.seeders != null && option.seeders > 0 && option.seeders < 10
    ? { label: 'poucos seeders', cls: 'bg-red-500/15 border-red-500/40 text-red-300' }
    : null;

  const details = [option.format, option.audio, option.resolution, option.size, `⚡ ${option.bitrate}`].filter(Boolean);

  return (
    <motion.div
      animate={started ? { boxShadow: ['0 0 0 0 rgba(16,185,129,0)', '0 0 0 4px rgba(16,185,129,0.4)', '0 0 0 0 rgba(16,185,129,0)'] } : {}}
      transition={{ duration: 1.4, ease: 'easeOut' }}
      className={`bg-zinc-900/80 border rounded-2xl p-4 flex flex-col gap-3 md:flex-row md:items-center transition-all duration-200 shadow-md ${
        started ? 'border-emerald-500/50' : 'border-zinc-800/80 hover:border-[#EF9F27]/50'
      }`}
    >
      <div className="flex-1 space-y-2 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-zinc-100 tracking-tight">{option.quality}</span>
          {seasonLabel && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 bg-sky-500/15 border-sky-500/40 text-sky-300" title="Temporadas incluídas no download">
              {seasonLabel}
            </span>
          )}
          {badge && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${badge.cls}`}>
              {badge.label}
            </span>
          )}
          {subsBadge && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${subsBadge.cls}`}>
              {subsBadge.label}
            </span>
          )}
          {lowSeeds && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${lowSeeds.cls}`}>
              {lowSeeds.label}
            </span>
          )}
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${qualityColor}`}>
            {option.badge}
          </span>
        </div>
        <p className="text-[11px] text-zinc-400 font-mono leading-relaxed truncate">{details.join(' • ')}</p>
      </div>

      <button
        type="button"
        disabled={isDownloading || started}
        onClick={() => onDownload(option)}
        className={`md:w-44 shrink-0 active:scale-[0.98] disabled:opacity-100 text-zinc-950 font-black py-2.5 rounded-xl text-xs uppercase tracking-wider transition-colors flex items-center justify-center gap-2 shadow-md ${
          started
            ? 'bg-emerald-500 shadow-emerald-500/25'
            : 'bg-[#EF9F27] hover:bg-[#EF9F27]/90 shadow-[#EF9F27]/10'
        }`}
      >
        <AnimatePresence mode="wait" initial={false}>
          {started ? (
            <motion.span
              key="started"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-2"
            >
              <motion.svg
                viewBox="0 0 24 24"
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.45, ease: 'easeOut' }}
              >
                <path d="M4 12l5 5L20 6" />
              </motion.svg>
              <span>Iniciado</span>
            </motion.span>
          ) : isDownloading ? (
            <motion.span
              key="downloading"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-2"
            >
              <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
              <span>Iniciando...</span>
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="flex items-center gap-2"
            >
              <span>Baixar</span>
              <span className="text-sm">📥</span>
            </motion.span>
          )}
        </AnimatePresence>
      </button>
    </motion.div>
  );
}
