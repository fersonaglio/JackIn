'use client';
import type { CatalogItem } from '@/types/media';
import { buildPosterUrl } from '@/data/media'; interface ITunesResultsGridProps {
  results: CatalogItem[];
  query: string;
  onSelect: (item: CatalogItem) => void;
  onBack: () => void;
}

export default function ITunesResultsGrid({ results, query, onSelect, onBack }: ITunesResultsGridProps) {
  if (results.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition-colors">
            &#8592; Voltar ao Catálogo
          </button>
          <p className="text-zinc-400 text-sm">Nenhum resultado para "{query}"</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={onBack} className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs transition-colors">
          &#8592; Voltar ao Catálogo
        </button>
        <p className="text-zinc-400 text-sm">
          Resultados para <span className="text-zinc-200 font-bold">"{query}"</span> — {results.length} encontrado{results.length > 1 ? 's' : ''}
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {results.map((item) => {
          const poster = buildPosterUrl(item.posterPath);
          return (
            <button
              key={item.tmdbId}
              type="button"
              onClick={() => onSelect(item)}
              className="group relative bg-zinc-900/60 border border-zinc-800/60 hover:border-[#EF9F27]/40 rounded-xl overflow-hidden transition-all text-left"
            >
              <div className="aspect-[2/3] bg-zinc-800">
                {poster ? (
                  <img src={poster} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-3xl">🎬</span>
                  </div>
                )}
              </div>
              <div className="p-3 space-y-1">
                <h4 className="text-xs font-bold text-zinc-200 line-clamp-2">{item.title}</h4>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{item.year ?? '—'}</span>
                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-bold uppercase">{item.type === 'movie' ? 'Filme' : 'Série'}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
