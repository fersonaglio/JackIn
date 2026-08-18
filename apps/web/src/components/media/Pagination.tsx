'use client';

interface PaginationProps {
  page: number;
  totalPages: number;
  /** Há mais conteúdo além do que já foi carregado (catálogo continua). */
  hasMore?: boolean;
  onChange: (page: number) => void;
  siblings?: number;
}

function pageWindow(page: number, total: number, siblings: number): (number | 'ellipsis')[] {
  const start = Math.max(1, page - siblings);
  const end = Math.min(total, page + siblings);
  const pages: (number | 'ellipsis')[] = [];
  if (start > 1) {
    pages.push(1);
    if (start > 2) pages.push('ellipsis');
  }
  for (let p = start; p <= end; p += 1) pages.push(p);
  if (end < total) {
    if (end < total - 1) pages.push('ellipsis');
    pages.push(total);
  }
  return pages;
}

const BTN_BASE =
  'min-w-[38px] h-10 px-2 flex items-center justify-center rounded-xl text-sm font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_IDLE = 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-300 hover:border-zinc-500';
const BTN_ACTIVE = 'bg-[#EF9F27] text-zinc-950 border-[#EF9F27]';

export default function Pagination({ page, totalPages, hasMore = false, onChange, siblings = 5 }: PaginationProps) {
  if (totalPages <= 1 && !hasMore) return null;

  const pages = pageWindow(page, totalPages, siblings);
  // Na borda do que foi carregado, com mais conteúdo vindo do servidor, os
  // botões de avançar ficam ativos — clicar dispara o carregamento do próximo
  // lote (o catálogo cresce e a página avança).
  const nextDisabled = page >= totalPages && !hasMore;
  const atEdgeWithMore = page >= totalPages && hasMore;

  return (
    <nav aria-label="Paginação" className="flex items-center justify-center gap-1.5 flex-wrap mt-10">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(1)}
        className={`${BTN_BASE} ${BTN_IDLE}`}
        title="Primeira página"
      >
        «
      </button>
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className={`${BTN_BASE} ${BTN_IDLE}`}
        title="Página anterior"
      >
        ‹
      </button>

      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`e-${i}`} className="min-w-[24px] text-center text-zinc-600 font-bold">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            aria-current={p === page ? 'page' : undefined}
            className={`${BTN_BASE} ${p === page ? BTN_ACTIVE : BTN_IDLE}`}
          >
            {p}
          </button>
        )
      )}

      <button
        type="button"
        disabled={nextDisabled}
        onClick={() => onChange(page + 1)}
        className={`${BTN_BASE} ${BTN_IDLE}`}
        title={atEdgeWithMore ? 'Carregar mais títulos e avançar' : 'Próxima página'}
      >
        ›
      </button>
      <button
        type="button"
        disabled={nextDisabled}
        onClick={() => onChange(atEdgeWithMore ? page + 1 : totalPages)}
        className={`${BTN_BASE} ${BTN_IDLE}`}
        title={atEdgeWithMore ? 'Carregar mais títulos' : 'Última página'}
      >
        »
      </button>
    </nav>
  );
}
