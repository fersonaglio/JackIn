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
      const ready = pack ? isDone(pack) : eps.length > 0 && doneEpisodes === eps.length;
      let percent: number;
      if (pack) {
        percent = isDone(pack) ? 100 : (pack.progressPct ?? 0);
      } else if (eps.length > 0) {
        percent = Math.round((doneEpisodes / eps.length) * 100);
      } else {
        percent = 0;
      }

      const seasonWatchedCount = eps.filter((e) => e.watched === 1).length;
      const seasonEpisodesWatchSum = eps.reduce((sum, ep) => sum + getProjectWatchPercent(ep), 0);
      const seasonWatchPercent = eps.length > 0
        ? Math.round(seasonEpisodesWatchSum / eps.length)
        : (pack ? getProjectWatchPercent(pack, 5400) : 0);
      const seasonAllWatched = eps.length > 0 ? (eps.length > 0 && eps.every((e) => e.watched === 1)) : (pack ? pack.watched === 1 : false);

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

  // Barra principal: enquanto houver transferência real em andamento, mostra o
  // % do download ativo. Na fase de preparação (pós-download) o % do pack já é
  // 100 mas nada está pronto ainda — aí mostra a proporção de unidades prontas.
  const activeDownload =
    sorted.find((p) => p.status === 'downloading') ||
    sorted.find((p) => p.status === 'preparing') ||
    null;
  const currentPercent =
    activeDownload && activeDownload.status === 'downloading'
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
  };
}

/** Chip curto de progresso por temporada para a dock: "T1 29 · T2 100". */
export function seasonChips(seasons: SeasonInfo[]): string {
  return seasons
    .map((s) => (s.percent >= 100 ? `T${s.seasonNumber} ✓` : `T${s.seasonNumber} ${s.percent}`))
    .join(' · ');
}
