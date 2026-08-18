import type { MediaOption, MovieSearchResult, SeriesSeason } from './api';

// Extrai o número da temporada do título do resultado da busca.
// Formatos aceitos: "Season 2", "S02", "Temporada 1", "T1".
const SEASON_RE = /\b(?:season|temporada)\s*(\d{1,3})\b|\b[Ss](\d{1,3})\b(?!E)/i;

export function seasonNumberFromTitle(title: string): number | null {
  const m = title.match(SEASON_RE);
  if (!m) return null;
  const raw = m[1] ?? m[2];
  return raw ? parseInt(raw, 10) : null;
}

// Remove o marcador de temporada/episódio do título, sobrando o título base
// da série ("Love Death and Robots Season 2" -> "Love Death and Robots").
export function seriesBaseTitle(title: string): string {
  return title
    .replace(/\b(?:season|temporada)\s*\d{1,3}\b/gi, ' ')
    .replace(/\b[Ss]\d{1,3}([Ee]\d{1,3})?\b/g, ' ')
    .replace(/\s*\(T\d+\)\s*$/i, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Quais temporadas um magnet contém, extraídas do dn do magnet:
//   "Show S01"               -> { seasons: [1] }
//   "Show S01 COMPLETE"      -> { seasons: [1] }
//   "Show S01E01"            -> { seasons: [1] }
//   "Show S01-S02"           -> { seasons: [1,2] }
//   "Show Complete Series"   -> { all: true }
//   "Show Season 3"          -> { seasons: [3] }
// Retorna null se o magnet não indicar temporada (ex.: filme, pack sem marca).
const S_TOKEN_RE = /\b[Ss](\d{1,3})(?:-([Ss]?)(\d{1,3}))?(?!\d)|\b(?:season|temporada)\s*(\d{1,3})\b|(\d{1,3})[ºªo]?\s*[Tt]emporada/gi;

export interface MagnetSeasonInfo {
  /** Temporadas individuais detectadas (ex.: [1], [1,2]). */
  seasons: number[];
  /** Torrent que cobre a série inteira ("Complete Series", "All Seasons"). */
  all: boolean;
  /** True quando o magnet é um episódio avulso (ex.: S02E02). */
  isSingleEpisode?: boolean;
}

export function seasonInfoFromSource(sourceUrl: string): MagnetSeasonInfo {
  const dn = decodeURIComponent(sourceUrl || '');
  const isSingle =
    /\bS\d{1,2}E\d{1,3}\b|\b(?:episode|episodio|ep)[\s.\-_]*\d{1,3}\b/i.test(dn) &&
    !/\b(complete|completa|temporada\s+completa|all\s+seasons|s[eé]rie\s+completa)\b/i.test(dn);
  const info: MagnetSeasonInfo = { seasons: [], all: false, isSingleEpisode: isSingle };

  if (/\b(complete\s+series|all\s+seasons|s[eé]rie\s+completa|todas\s+as\s+temporadas)\b/i.test(dn)) {
    info.all = true;
    return info;
  }

  const seen = new Set<number>();
  for (const m of dn.matchAll(S_TOKEN_RE)) {
    const a = m[1] ?? m[4] ?? m[5];
    const b = m[3];
    if (!a) continue;
    const sA = parseInt(a, 10);
    seen.add(sA);
    if (b) {
      // Range "S01-S03"
      const sB = parseInt(b, 10);
      for (let s = Math.min(sA, sB); s <= Math.max(sA, sB); s++) seen.add(s);
    }
  }
  info.seasons = [...seen].sort((x, y) => x - y);
  return info;
}

/** Rótulo curto das temporadas de um magnet ("1 temporada", "T1-T3", "Série completa"). */
export function seasonLabelFromSource(sourceUrl: string): string | null {
  const info = seasonInfoFromSource(sourceUrl);
  if (info.all) return 'Série completa';
  if (info.seasons.length === 0) return null;
  if (info.seasons.length === 1) return `Temporada ${info.seasons[0]}`;
  const range = `${info.seasons[0]}-${info.seasons[info.seasons.length - 1]}`;
  return `T${range} (${info.seasons.length} temp.)`;
}

// Agrupa os resultados de uma série em temporadas ordenadas. Resultados de
// filme (sem temporada) retornam undefined.
export function groupSeriesSeasons(results: MovieSearchResult[]): SeriesSeason[] | undefined {
  const seasons = new Map<number, SeriesSeason>();
  let sawSeries = false;

  const addOption = (seasonNum: number, baseTitle: string, o: MediaOption) => {
    const existing = seasons.get(seasonNum);
    if (existing) {
      // Mescla opções da mesma temporada (dedup por magnet).
      const seen = new Set(existing.options.map((x) => x.sourceUrl));
      if (!seen.has(o.sourceUrl)) existing.options.push(o);
    } else {
      seasons.set(seasonNum, { seasonNumber: seasonNum, title: baseTitle, options: [o] });
    }
  };

  for (const r of results) {
    const titleSeason = seasonNumberFromTitle(r.title);
    const isSeries = r.mediaType === 'series' || titleSeason !== null;
    if (!isSeries) continue;
    sawSeries = true;

    const base = seriesBaseTitle(r.title) || r.title;
    const hasTitleSeason = titleSeason !== null;

    for (const o of r.options || []) {
      if (hasTitleSeason) {
        // Resultado já etiquetado com temporada no título (ex.: "Season 2").
        addOption(titleSeason as number, base, o);
      } else {
        // Resultado único de série com opções de várias temporadas misturadas
        // (engine /search): extrai a temporada do próprio magnet (S01, S04...).
        const info = seasonInfoFromSource(o.sourceUrl);
        if (info.all) {
          // "Complete Series" — sem temporada específica; mantém como temporada 1.
          addOption(1, base, o);
        } else if (info.seasons.length === 1) {
          addOption(info.seasons[0], base, o);
        } else {
          // Magnet sem marcador (ou range): mantém na temporada do título ou 1.
          addOption(1, base, o);
        }
      }
    }
  }

  if (!sawSeries) return undefined;

  return [...seasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => s)
    .filter((s) => s.options.length > 0);
}
