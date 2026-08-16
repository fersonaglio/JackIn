'use client';
import type { MovieSearchResult, MediaOption } from '@/lib/api';
import TorrentOptionCard from './TorrentOptionCard';

interface SearchResultsGridProps {
  results: MovieSearchResult[];
  downloadingItems: Record<string, boolean>;
  onDownload: (movieTitle: string, option: MediaOption, posterUrl?: string) => void;
}

export default function SearchResultsGrid({
  results,
  downloadingItems,
  onDownload,
}: SearchResultsGridProps) {
  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
        <span className="text-4xl">🎬</span>
        <p className="text-zinc-400 font-semibold text-sm">Nenhum resultado encontrado para esta busca.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-xl font-black text-zinc-100 tracking-tight">
          Resultados da Busca P2P
          <span className="text-xs text-zinc-400 font-bold ml-2.5 bg-zinc-900 border border-zinc-800 px-2.5 py-1 rounded-full">
            {results.length} encontrado{results.length !== 1 ? 's' : ''}
          </span>
        </h3>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {results.map((movie) => (
          <div
            key={movie.id}
            className="bg-zinc-950/90 border border-zinc-800/80 hover:border-zinc-700/80 rounded-3xl p-6 space-y-6 transition-all shadow-xl"
          >
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="w-36 md:w-44 h-52 md:h-64 rounded-2xl overflow-hidden bg-zinc-900 shrink-0 border border-zinc-700/50 shadow-2xl">
                <img
                  src={movie.posterUrl}
                  alt={movie.title}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>

              <div className="flex-1 space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[10px] font-mono font-bold uppercase">
                      {movie.genre}
                    </span>
                    <span className="text-xs text-zinc-500 font-semibold">{movie.year}</span>
                    <span className="flex items-center gap-1 text-[#EF9F27] text-xs font-bold">
                      ★ {movie.rating}
                    </span>
                  </div>
                  <h4 className="text-2xl md:text-3xl font-black text-zinc-100 tracking-tight">
                    {movie.title}
                  </h4>
                  {movie.originalTitle && movie.originalTitle !== movie.title && (
                    <p className="text-xs text-zinc-500">{movie.originalTitle}</p>
                  )}
                </div>

                <p className="text-sm text-zinc-400 leading-relaxed max-w-3xl">
                  {movie.overview}
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-800/70 space-y-3">
              <h5 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                Opções de Download P2P
              </h5>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {movie.options.map((opt) => {
                  const downloadKey = `${movie.title}-${opt.id}`;
                  return (
                    <TorrentOptionCard
                      key={opt.id}
                      option={opt}
                      isDownloading={!!downloadingItems[downloadKey]}
                      onDownload={() => onDownload(movie.title, opt, movie.posterUrl)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
