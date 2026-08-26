import type { Project } from './api';
import { seriesBaseTitle } from './seriesSeasons';

// Modelo de progresso de uma série na biblioteca. Um projeto de série pode
// ser:
//  - pack de temporada (episodeNumber == null): "Love, Death & Robots (T3)",
//    criado ao baixar a temporada inteira — vira a linha "Temporada N (completa)".
//  - episódio indexado (episodeNumber != null): cada arquivo do pack vira um
//    projeto próprio para assistir individualmente.

export interface SeasonInfo {
  seasonNumber: number;
  episodes: Project[];
  pack: Project | null;
  /** Temporada pronta para assistir (pack baixado OU todos os episódios prontos). */
  ready: boolean;
  doneCount: number;
  totalCount: number;
  /** Progresso de download da temporada, 0–100. */
  percent: number;
  /** Quantidade de episódios assistidos (>= 90%) na temporada. */
  watchedCount: number;
  /** Porcentagem assistida da temporada, 0–100. */
  watchPercent: number;
  /** Temporada 100% assistida. */
  allWatched: boolean;
  /** Tamanho em bytes da temporada (evita duplicar pack se houver episódios indexados). */
  sizeBytes: number;
}

export interface SeriesBreakdown {
  baseTitle: string;
  packs: Project[];
  episodes: Project[];
  seasons: SeasonInfo[];
  totalSeasons: number;
  readySeasons: number;
  hasEpisodes: boolean;
  /** Unidades de progresso: episódios se existirem, senão packs de temporada. */
  totalUnits: number;
  doneUnits: number;
  /** Linhas prontas para assistir: episódios done + packs done. */
  availableCount: number;
  watchedCount: number;
  /** Porcentagem assistida da série como um todo, 0–100. */
  watchPercent: number;
  /** Série 100% assistida. */
  allWatched: boolean;
  anyDownloading: boolean;
  anyPaused: boolean;
  anyPreparing: boolean;
  allDone: boolean;
  /** Projeto com download/preparação em andamento (para barra e velocidade). */
  activeDownload: Project | null;
  /** % principal: do download ativo, ou da proporção de unidades prontas. */
  currentPercent: number;
  /** Tamanho total consolidado em bytes da série sem duplicações. */
  totalSizeBytes: number;
  /** Texto resumido formatado para exibição nos cards da biblioteca. */
  summaryText: string;
}

export function getProjectWatchPercent(p: Project, defaultDurationSeconds = 2700): number {
  if (p.watched === 1) return 100;
  const prog = p.watchProgress || 0;
  if (prog <= 0) return 0;
  const pct = Math.round((prog / defaultDurationSeconds) * 100);
  return Math.min(89, Math.max(1, pct));
}

function isDone(p: Project): boolean {
  return p.status === 'done';
}

function isActive(p: Project): boolean {
  return p.status === 'downloading' || p.status === 'preparing';
}

export function breakdownSeries(projects: Project[]): SeriesBreakdown {
  const sorted = [...projects].sort(
    (a, b) =>
      (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) ||
      (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
  );

  const packs = sorted.filter((p) => p.episodeNumber == null);
  const episodes = sorted.filter((p) => p.episodeNumber != null);
  const baseTitle = seriesBaseTitle(sorted[0]?.title || 'Série') || 'Série';

  const bySeason = new Map<number, { episodes: Project[]; pack: Project | null }>();
  for (const ep of episodes) {
    const n = ep.seasonNumber ?? 1;
    const entry = bySeason.get(n) || { episodes: [], pack: null };
    entry.episodes.push(ep);
    bySeason.set(n, entry);
  }
  for (const p of packs) {
    const n = p.seasonNumber ?? 1;
    const entry = bySeason.get(n) || { episodes: [], pack: null };
    if (!entry.pack) entry.pack = p;
    bySeason.set(n, entry);
  }

  const seasons: SeasonInfo[] = Array.from(bySeason.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([n, { episodes: eps, pack }]) => {
      const doneEpisodes = eps.filter(isDone).length;
      const ready = pack ? isDone(pack) : (eps.length > 0 && doneEpisodes === eps.length);

      let percent: number;
      if (pack && isDone(pack)) {
        percent = 100;
      } else if (eps.length > 0) {
        percent = Math.round((doneEpisodes / eps.length) * 100);
      } else if (pack) {
        percent = pack.progressPct ?? 0;
      } else {
        percent = 0;
      }

      const seasonWatchedCount = eps.filter((e) => e.watched === 1).length;
      const seasonEpisodesWatchSum = eps.reduce((sum, ep) => sum + getProjectWatchPercent(ep), 0);
      const seasonWatchPercent = eps.length > 0
        ? Math.round(seasonEpisodesWatchSum / eps.length)
        : (pack ? getProjectWatchPercent(pack, 5400) : 0);
      const seasonAllWatched = eps.length > 0 ? (eps.length > 0 && eps.every((e) => e.watched === 1)) : (pack ? pack.watched === 1 : false);

      // Se há episódios indexados na temporada, usa a soma dos episódios para
      // não duplicar o tamanho do pack com os episódios no disco.
      const seasonSizeBytes = eps.length > 0
        ? eps.reduce((sum, ep) => sum + (ep.sizeBytes || 0), 0)
        : (pack?.sizeBytes || 0);

      return {
        seasonNumber: n,
        episodes: eps,
        pack,
        ready,
        doneCount: eps.length > 0 ? doneEpisodes : (pack ? (isDone(pack) ? 1 : 0) : 0),
        totalCount: eps.length > 0 ? eps.length : (pack ? 1 : 0),
        percent,
        watchedCount: seasonWatchedCount,
        watchPercent: seasonWatchPercent,
        allWatched: seasonAllWatched,
        sizeBytes: seasonSizeBytes,
      };
    });

  const hasEpisodes = episodes.length > 0;
  const donePacks = packs.filter(isDone).length;
  const totalSeasons = seasons.length;
  const readySeasons = seasons.filter((s) => s.ready).length;
  const availableCount = episodes.filter(isDone).length + donePacks;
  const watchedCount = episodes.filter((e) => e.watched === 1).length;

  const totalUnits = hasEpisodes ? episodes.length : packs.length;
  const doneUnits = hasEpisodes ? episodes.filter(isDone).length : donePacks;

  const totalEpisodesWatchSum = episodes.reduce((sum, ep) => sum + getProjectWatchPercent(ep), 0);
  const watchPercent = hasEpisodes
    ? (episodes.length > 0 ? Math.round(totalEpisodesWatchSum / episodes.length) : 0)
    : (packs.length > 0 ? Math.round(packs.reduce((sum, p) => sum + getProjectWatchPercent(p, 5400), 0) / packs.length) : 0);
  const allWatched = hasEpisodes
    ? (episodes.length > 0 && episodes.every((e) => e.watched === 1))
    : (packs.length > 0 && packs.every((p) => p.watched === 1));

  // Tamanho total sem duplicação
  const totalSizeBytes = seasons.reduce((sum, s) => sum + s.sizeBytes, 0);

  // Texto resumido
  let summaryText = '';
  if (totalSeasons > 0) {
    if (!hasEpisodes) {
      summaryText = `${totalSeasons} temporada${totalSeasons !== 1 ? 's' : ''}${readySeasons > 0 && doneUnits < totalUnits ? ` · ${readySeasons}/${totalSeasons} prontas` : ''}`;
    } else {
      const allSeasonsHaveEpisodes = seasons.every((s) => s.episodes.length > 0);
      if (allSeasonsHaveEpisodes) {
        summaryText = `${episodes.length} episódio${episodes.length !== 1 ? 's' : ''}${totalSeasons > 1 ? ` · ${totalSeasons} temporadas` : ''}`;
      } else {
        summaryText = `${totalSeasons} temporadas · ${episodes.length} ep${episodes.length !== 1 ? 's' : ''} indexado${episodes.length !== 1 ? 's' : ''}`;
      }
    }
  }

  // Barra principal: enquanto houver transferência real em andamento de pack sem episódios,
  // mostra o % do download ativo. Quando há episódios, mostra a proporção de unidades prontas.
  const activeDownload =
    sorted.find((p) => p.status === 'downloading') ||
    sorted.find((p) => p.status === 'preparing') ||
    null;
  const currentPercent =
    activeDownload && activeDownload.status === 'downloading' && !hasEpisodes
      ? (activeDownload.progressPct ?? 0)
      : totalUnits > 0
        ? Math.round((doneUnits / totalUnits) * 100)
        : 0;

  return {
    baseTitle,
    packs,
    episodes,
    seasons,
    totalSeasons,
    readySeasons,
    hasEpisodes,
    totalUnits,
    doneUnits,
    availableCount,
    watchedCount,
    watchPercent,
    allWatched,
    anyDownloading: sorted.some(isActive),
    anyPaused: sorted.some((p) => p.status === 'paused'),
    anyPreparing: sorted.some((p) => p.status === 'preparing'),
    allDone: totalUnits > 0 && doneUnits === totalUnits && !sorted.some(isActive),
    activeDownload,
    currentPercent,
    totalSizeBytes,
    summaryText,
  };
}

/** Chip curto de progresso por temporada para a dock: "T1 29% · T2 ✓" ou "T1 (3/6) · T2 ✓". */
export function seasonChips(seasons: SeasonInfo[]): string {
  return seasons
    .map((s) => {
      if (s.ready || s.percent >= 100) return `T${s.seasonNumber} ✓`;
      if (s.episodes.length > 0) {
        return `T${s.seasonNumber} (${s.doneCount}/${s.totalCount})`;
      }
      return `T${s.seasonNumber} ${s.percent}%`;
    })
    .join(' · ');
}
