'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { MovieSearchResult, MediaOption, SeriesSeason } from '@/lib/api';
import TorrentOptionRow from './TorrentOptionRow';
import { seasonLabelFromSource } from '@/lib/seriesSeasons';

interface MediaDetailModalProps {
  movie: MovieSearchResult | null;
  isOpen: boolean;
  onClose: () => void;
  downloadingItems: Record<string, boolean>;
  startedItems?: Record<string, boolean>;
  onDownload: (movieTitle: string, option: MediaOption, posterUrl?: string) => void;
  onDownloadAll?: (seriesTitle: string, posterUrl: string | undefined, seasons: { seasonNumber: number; option: MediaOption }[]) => void;
  isSearchingTorrents?: boolean;
  initialAudioFilter?: string;
  ptStrictRequest?: boolean;
  searchError?: string | null;
  onSuggestionClick?: (title: string) => void;
}

const AUDIO_OPTIONS = [
  { value: 'any', label: 'Qualquer' },
  { value: 'dub', label: 'Dublado PT' },
  { value: 'original', label: 'Original' },
  { value: 'legendado', label: 'Legendado' },
];

// Popular titles with a well-established PT-BR dub — offered as suggestions when
// the requested title has no confirmed dublado release yet.
const DUBBED_SUGGESTIONS = [
  'Avatar',
  'Toy Story',
  'Divertida Mente 2',
  'Homem-Aranha',
  'Vingadores: Ultimato',
  'Meu Malvado Favorito',
  'O Rei Leão',
  'Moana',
  'Shrek',
  'Batman: O Cavaleiro das Trevas',
  'Star Wars: O Despertar da Força',
  'Velozes e Furiosos',
];

export default function MediaDetailModal({
  movie,
  isOpen,
  onClose,
  downloadingItems,
  startedItems = {},
  onDownload,
  onDownloadAll,
  isSearchingTorrents = false,  initialAudioFilter = 'any',
  ptStrictRequest = false,
  searchError,
  onSuggestionClick,
}: MediaDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const [confirmedApprox, setConfirmedApprox] = useState(false);
  const [audioFilter, setAudioFilter] = useState(initialAudioFilter);
  // 0 = todas as temporadas; senão o número da temporada ativa.
  const [activeSeason, setActiveSeason] = useState<number>(0);

  const seasons = movie?.seasons && movie.seasons.length > 0 ? movie.seasons : undefined;
  const activeSeasonData: SeriesSeason | undefined = activeSeason > 0
    ? seasons?.find((s) => s.seasonNumber === activeSeason)
    : seasons?.[0];

  useEffect(() => {
    setConfirmedApprox(false);
    setAudioFilter(initialAudioFilter);
    // Reset do seletor de temporada ao abrir um novo conteúdo: mostra todas.
    setActiveSeason(0);
  }, [movie, initialAudioFilter]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleDownload = (option: MediaOption) => {
    if (!movie) return;
    if (movie.approximate && !confirmedApprox) return;
    onDownload(movie.title, option, movie.posterUrl);
  };

  // Séries: filtra as opções da temporada ativa. Filmes: todas as opções.
  // Quando activeSeason === 0 ("Todas"), concatena todas as temporadas.
  const seasonOptions = seasons && activeSeason > 0
    ? (activeSeasonData?.options ?? [])
    : seasons
      ? seasons.flatMap((s) => s.options)
      : movie?.options ?? [];

  const filteredOptions = movie
    ? seasonOptions.filter((o) =>
        audioFilter === 'any'
          ? true
          : movie.ptUnavailable
            ? true
            : audioFilter === 'dub'
              ? !o.ptExcluded && (o.audioType === 'dub' || o.audioType === 'dual' || o.audioType === 'multi')
              : audioFilter === 'original'
                ? o.audioType === 'unknown' || o.audioType === 'original' || o.audioType === 'multi'
                : audioFilter === 'legendado'
                  ? !!o.hasSubtitles
                  : true
      )
    : [];

  const hasMatchingAudio = audioFilter === 'any' || filteredOptions.length > 0;
  const showAudioNotice =
    !!movie && audioFilter !== 'any' && seasonOptions.length > 0 && filteredOptions.length === 0 && !isSearchingTorrents && !movie.ptUnavailable;

  // "Baixar todas": uma opção por temporada (a de maior qualidade/seeders),
  // respeitando o filtro de áudio ativo. Baixado EM SEQUÊNCIA pelo hook.
  const handleDownloadAll = () => {
    if (!movie || !seasons) return;
    const pickBest = (opts: MediaOption[]): MediaOption | null => {
      const pool = audioFilter === 'any' ? opts : filteredOptions.filter((o) => opts.some((x) => x.id === o.id));
      if (pool.length === 0) return null;
      return [...pool].sort((a, b) => {
        const q = (x: MediaOption) => {
          if (x.quality.includes('4K')) return 4;
          if (x.quality.includes('1080')) return 3;
          if (x.quality.includes('720')) return 2;
          return 1;
        };
        return q(b) - q(a) || (b.seeders || 0) - (a.seeders || 0);
      })[0];
    };
    const list = seasons
      .map((s) => {
        const best = pickBest(s.options);
        return best ? { seasonNumber: s.seasonNumber, option: best } : null;
      })
      .filter((x): x is { seasonNumber: number; option: MediaOption } => x !== null);
    if (list.length === 0) return;
    onDownloadAll?.(movie.title, movie.posterUrl, list);
  };

  // "Só Dublado PT-BR" (ptStrictRequest) triggers the stronger amber notice;
  // a plain catalog search gets a subtle info box instead.
  const strictPtRequest = ptStrictRequest && !!movie?.ptUnavailable;

  return (
    <AnimatePresence>
      {isOpen && movie && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex flex-col bg-[#0a0a0b]"
        >
          <motion.div
            ref={modalRef}
            initial={{ scale: 0.98, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.98, opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            className="relative w-full h-full bg-zinc-950 overflow-hidden flex flex-col"
          >
            <div className="flex items-center justify-between p-4 md:px-10 md:pt-6 border-b border-zinc-800/80 shrink-0 bg-zinc-950">
              <div className="flex items-center gap-2">
                <span className="text-xl">🎬</span>
                <span className="text-xs font-black uppercase tracking-wider text-[#EF9F27]">Detalhes &amp; Downloads</span>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-10 h-10 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-zinc-300 hover:text-white hover:border-zinc-500 hover:bg-zinc-800 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EF9F27]"
                aria-label="Fechar"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-6">
              <div className="flex flex-col md:flex-row gap-6">
                <div className="w-32 md:w-48 h-48 md:h-72 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-zinc-700 shadow-xl relative z-10">
                  {movie.posterUrl ? (
                    <img
                      src={movie.posterUrl}
                      alt={movie.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-4xl">
                      🎬
                    </div>
                  )}
                </div>

                <div className="flex-1 space-y-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-400 text-[10px] font-mono font-semibold uppercase">
                        {movie.genre}
                      </span>
                      <span className="text-xs text-zinc-500">{movie.year}</span>
                      <span className="flex items-center gap-1 text-[#EF9F27] text-sm font-bold">
                        &#9733; {movie.rating}
                      </span>
                    </div>
                    <h2 id="modal-title" className="text-2xl md:text-4xl font-black text-zinc-100 tracking-tight">
                      {movie.title}
                    </h2>
                    {movie.originalTitle && movie.originalTitle !== movie.title && (
                      <p className="text-xs text-zinc-500">{movie.originalTitle}</p>
                    )}
                  </div>

                  <p className="text-sm md:text-base text-zinc-400 leading-relaxed max-w-3xl">
                    {movie.overview}
                  </p>
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-6 space-y-4">
                {movie.approximate && !confirmedApprox && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 space-y-3">
                    <div className="flex items-start gap-3">
                      <span className="text-xl">⚠️</span>
                      <div className="space-y-1">
                        <p className="text-sm font-bold text-amber-300">Melhor aproximação encontrada</p>
                        <p className="text-xs text-amber-200/80 leading-relaxed">
                          Não encontramos fonte exata para <strong>{movie.title}</strong>. O resultado abaixo corresponde a{' '}
                          <strong>{movie.approximateTitle || 'outro título'}</strong>. Confirme que é o conteúdo desejado antes de baixar.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConfirmedApprox(true)}
                      className="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-zinc-950 font-black py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all"
                    >
                      Sim, é este o conteúdo — mostrar opções
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Áudio:</span>
                  {AUDIO_OPTIONS.map((opt) => {
                    const unavailableDub = movie.ptUnavailable && opt.value === 'dub';
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setAudioFilter(opt.value)}
                        title={unavailableDub ? 'Sem release dublado PT-BR confirmado para este título' : undefined}
                        className={`px-3 py-1.5 rounded-full text-[11px] font-bold border transition-all ${
                          audioFilter === opt.value
                            ? 'bg-[#EF9F27] text-zinc-950 border-[#EF9F27]'
                            : unavailableDub
                              ? 'bg-zinc-900/40 text-zinc-500 border-zinc-800/60 cursor-not-allowed line-through'
                              : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>

                <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-300">
                  Opções de Download
                </h3>

                {seasons && seasons.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
                        {seasons.length > 1 ? `Temporadas disponíveis (${seasons.length})` : 'Temporada disponível'}
                      </span>
                    </div>
                    {seasons.length > 1 ? (
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => setActiveSeason(0)}
                          className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                            activeSeason === 0
                              ? 'bg-[#EF9F27] text-zinc-950 border-[#EF9F27]'
                              : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                          }`}
                        >
                          Todas
                        </button>
                        {seasons.map((s) => (
                          <button
                            key={s.seasonNumber}
                            type="button"
                            onClick={() => setActiveSeason(s.seasonNumber)}
                            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition-all ${
                              activeSeason === s.seasonNumber
                                ? 'bg-[#EF9F27] text-zinc-950 border-[#EF9F27]'
                                : 'bg-zinc-900 text-zinc-300 border-zinc-700 hover:border-zinc-500'
                            }`}
                          >
                            T{s.seasonNumber}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500">1 temporada</p>
                    )}
                    <p className="text-[11px] text-zinc-500">
                      Selecione <strong>Todas</strong> para ver e baixar as temporadas juntas, ou uma temporada específica.
                    </p>
                    {activeSeason === 0 && seasons.length > 1 && onDownloadAll && (
                      <button
                        type="button"
                        onClick={handleDownloadAll}
                        disabled={isSearchingTorrents || filteredOptions.length === 0}
                        className="w-full bg-[#EF9F27] hover:bg-[#EF9F27]/90 active:scale-[0.99] disabled:opacity-50 text-zinc-950 font-black py-2.5 rounded-xl text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-md shadow-[#EF9F27]/15"
                      >
                        <span>Baixar todas as temporadas ({seasons.length})</span>
                        <span>📥</span>
                      </button>
                    )}
                  </div>
                )}

                {showAudioNotice && (
                  <div className="bg-sky-500/10 border border-sky-500/30 rounded-2xl px-4 py-3">
                    <p className="text-xs text-sky-300">
                      Não encontramos versão <strong>{AUDIO_OPTIONS.find((a) => a.value === audioFilter)?.label}</strong>.
                      Mostrando as demais versões disponíveis.
                    </p>
                  </div>
                )}

                {movie.ptUnavailable && strictPtRequest && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl px-4 py-3 space-y-1">
                    <p className="text-xs font-bold text-amber-300">
                      Sem versão dublada PT-BR confirmada ainda
                    </p>
                    <p className="text-[11px] text-amber-200/80 leading-relaxed">
                      Este título ainda não possui release com áudio dublado em português brasileiro confirmado.
                      As fontes abaixo estão em outros idiomas. Você pode baixar e depois usar{' '}
                      <strong>Buscar legenda PT-BR</strong> no player, ou buscar novamente quando o dublado existir.
                    </p>
                  </div>
                )}

                {movie.ptUnavailable && !strictPtRequest && (
                  <div className="bg-zinc-800/50 border border-zinc-700/60 rounded-2xl px-4 py-3 space-y-2">
                    <p className="text-[11px] text-zinc-400 leading-relaxed flex items-start gap-2">
                      <span className="text-base leading-none">ℹ️</span>
                      <span>
                        Este título ainda não tem versão dublada PT-BR confirmada — as fontes abaixo estão em
                        outros idiomas (original). Quer dublado? Baixe e use{' '}
                        <strong className="text-zinc-300">Buscar legenda PT-BR</strong> no player.
                      </span>
                    </p>
                    {onSuggestionClick && (
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 self-center">
                          Títulos com dublado disponível:
                        </span>
                        {DUBBED_SUGGESTIONS.slice(0, 6).map((title) => (
                          <button
                            key={title}
                            type="button"
                            onClick={() => onSuggestionClick(title)}
                            className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-[#EF9F27] hover:text-[#EF9F27] transition-colors"
                          >
                            {title}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {searchError && !isSearchingTorrents && (
                  <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3">
                    <p className="text-xs text-red-300">{searchError}</p>
                  </div>
                )}

                {isSearchingTorrents ? (
                  <div className="flex items-center gap-3 py-6">
                    <div className="w-5 h-5 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
                    <p className="text-sm text-zinc-400">Buscando torrents na rede P2P...</p>
                  </div>
                ) : seasonOptions.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-6 text-center">
                    <span className="text-3xl">🔍</span>
                    <div>
                      <p className="text-sm text-zinc-300 font-bold">Nenhuma fonte P2P encontrada</p>
                      <p className="text-xs text-zinc-500 mt-1 max-w-md">
                        Este título ainda não tem fontes P2P disponíveis (pode ser muito recente ou sem seeders).
                        Tente novamente mais tarde ou escolha outro título.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredOptions.map((opt) => {
                      const downloadKey = `${movie.title}-${opt.id}`;
                      const isDownloading = downloadingItems[downloadKey];
                      const started = !!startedItems[downloadKey];
                      return (
                        <TorrentOptionRow
                          key={opt.id}
                          option={opt}
                          isDownloading={!!isDownloading}
                          started={started}
                          onDownload={handleDownload}
                          seasonLabel={seasons ? seasonLabelFromSource(opt.sourceUrl) : undefined}
                        />
                      );
                    })}
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
