'use client';
import type { MediaOption } from '@/lib/api';

interface TorrentOptionCardProps {
  option: MediaOption;
  isDownloading: boolean;
  onDownload: (option: MediaOption) => void;
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

export default function TorrentOptionCard({ option, isDownloading, onDownload }: TorrentOptionCardProps) {
  const qualityColor = getQualityColor(option.quality);

  return (
    <div className="bg-zinc-900/80 border border-zinc-800/80 hover:border-[#EF9F27]/50 rounded-2xl p-4 flex flex-col justify-between space-y-3 transition-all duration-200 group shadow-md">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-black text-zinc-100 tracking-tight">{option.quality}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${qualityColor}`}>
            {option.badge}
          </span>
        </div>

        <p className="text-[11px] text-zinc-400 font-mono leading-tight truncate">{option.resolution}</p>

        {option.audio && (
          <p className="text-[10px] text-zinc-400 font-mono flex items-center gap-1.5 truncate">
            <span>🎵</span>
            <span className="truncate">{option.audio}</span>
          </p>
        )}

        <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono pt-2 border-t border-zinc-800/60">
          <span className="flex items-center gap-1">
            <span>📦</span>
            <span className="font-semibold">{option.size}</span>
          </span>
          <span className="flex items-center gap-1">
            <span>⚡</span>
            <span>{option.bitrate}</span>
          </span>
        </div>
      </div>

      <button
        type="button"
        disabled={isDownloading}
        onClick={() => onDownload(option)}
        className="w-full bg-[#EF9F27] hover:bg-[#EF9F27]/90 active:scale-[0.98] disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 font-black py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-md shadow-[#EF9F27]/10"
      >
        {isDownloading ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
            <span>Iniciando...</span>
          </>
        ) : (
          <>
            <span>Baixar</span>
            <span className="text-sm">📥</span>
          </>
        )}
      </button>
    </div>
  );
}
