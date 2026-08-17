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
    .replace(/\s+/g, ' ')
    .trim();
}

// Detecta episódios únicos (S01E01, 1x01, "Episode 5") nos magnets de uma
// temporada. Retorna o maior número de episódio encontrado (estimativa) e a
// contagem de episódios distintos.
const EPISODE_NUM_RE = /[Ee](\d{1,3})\b|\b(\d{1,3})x(\d{1,3})\b|\b(?:episode|epis[oó]dio)\s*(\d{1,3})\b/i;

export function episodeInfoFromOptions(options: MediaOption[]): { count: number; maxEpisode: number } {
  const eps = new Set<number>();
  for (const o of options) {
    const dn = o.sourceUrl || '';
    const m = dn.match(EPISODE_NUM_RE);
    if (!m) continue;
    const raw = m[1] ?? m[3] ?? m[4];
    if (raw) eps.add(parseInt(raw, 10));
  }
  if (eps.size === 0) return { count: 0, maxEpisode: 0 };
  return { count: eps.size, maxEpisode: Math.max(...eps) };
}

// Agrupa os resultados de uma série em temporadas ordenadas. Resultados de
// filme (sem temporada) retornam undefined.
export function groupSeriesSeasons(results: MovieSearchResult[]): SeriesSeason[] | undefined {
  const seasons = new Map<number, SeriesSeason>();
  let sawSeries = false;

  for (const r of results) {
    const isSeries = r.mediaType === 'series' || seasonNumberFromTitle(r.title) !== null;
    if (!isSeries) continue;
    sawSeries = true;

    const season = seasonNumberFromTitle(r.title) ?? 1;
    const existing = seasons.get(season);
    if (existing) {
      // Mescla opções da mesma temporada (dedup por magnet).
      const seen = new Set(existing.options.map((o) => o.sourceUrl));
      for (const o of r.options) {
        if (!seen.has(o.sourceUrl)) existing.options.push(o);
      }
    } else {
      seasons.set(season, {
        seasonNumber: season,
        title: seriesBaseTitle(r.title) || r.title,
        options: [...r.options],
      });
    }
  }

  if (!sawSeries) return undefined;

  const list = [...seasons.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => {
      const info = episodeInfoFromOptions(s.options);
      return { ...s, episodeCount: info.maxEpisode > 0 ? info.maxEpisode : undefined };
    });

  // Apenas expõe temporadas que realmente têm opções.
  return list.filter((s) => s.options.length > 0);
}
