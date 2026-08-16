import { searchCatalog } from '@/lib/wikipedia';

const ITUNES_RSS_URL = 'https://itunes.apple.com/us/rss';

const ALLOWED_GENRES = new Set(['4413', '4401', '4402']);
const MAX_FEED_LIMIT = 100;

const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

interface RssEntry {
  'im:name'?: { label?: string };
  'im:releaseDate'?: { label?: string };
  'im:image'?: { label?: string }[];
  category?: { attributes?: { label?: string } };
  summary?: { label?: string };
  link?: { attributes?: { href?: string } }[];
}

function resizeArt(url: string, size: string): string {
  return url.replace(/\/\d+x\d+bb\.(png|jpg)$/, `/${size}.$1`);
}

function hashCode(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

// Canonical merge key: folds case/accents/articles/punctuation so the English
// Wikipedia entry and the PT-BR TMDB row for the SAME film collide (e.g.
// "Pirates of the Caribbean: On Stranger Tides" vs "Piratas do Caribe:
// Navegando em Águas Misteriosas" both key on the EN original title).
function titleKey(title: string): string {
  return (title || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|o|os|a|as|el|la|los|las)\s+/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export { titleKey };

function entryToResult(entry: RssEntry, fallbackGenre: string) {
  const images = entry['im:image'] || [];
  const art = images[images.length - 1]?.label || '';
  const date = entry['im:releaseDate']?.label || '';
  const href = entry.link?.[0]?.attributes?.href || '';
  const idMatch = href.match(/\/id(\d+)/);
  const id = idMatch ? parseInt(idMatch[1], 10) : hashCode(entry['im:name']?.label || art);

  return {
    id,
    title: entry['im:name']?.label || '',
    overview: entry.summary?.label || '',
    posterUrl: art ? resizeArt(art, '600x600bb') : '',
    backdropUrl: art ? resizeArt(art, '1000x1000bb') : '',
    year: date ? Number(date.slice(0, 4)) || null : null,
    genre: entry.category?.attributes?.label || fallbackGenre,
    rating: 8.5,
  };
}

async function fetchRssFeed(feed: string, genre?: string, limit = 50) {
  let url: string;
  if (feed === 'topmovies') {
    url = genre
      ? `${ITUNES_RSS_URL}/topmovies/genre=${genre}/limit=${limit}/json`
      : `${ITUNES_RSS_URL}/topmovies/limit=${limit}/json`;
  } else if (feed === 'toptvseasons') {
    url = `${ITUNES_RSS_URL}/toptvseasons/limit=${limit}/json`;
  } else {
    return [];
  }

  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const entries: RssEntry[] = data.feed?.entry || [];
  const fallbackGenre = feed === 'toptvseasons' ? 'Série' : 'Filme';
  return entries.map((e) => entryToResult(e, fallbackGenre));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const feed = searchParams.get('feed');

  if (feed) {
    const rawGenre = searchParams.get('genre') || undefined;
    const genre = rawGenre && ALLOWED_GENRES.has(rawGenre) ? rawGenre : undefined;
    const limit = Math.min(Math.max(Number(searchParams.get('limit')) || 50, 1), MAX_FEED_LIMIT);
    try {
      const results = await fetchRssFeed(feed, genre, limit);
      return Response.json({ query: feed, results }, { headers: CACHE_HEADERS });
    } catch {
      return Response.json({ results: [] });
    }
  }

  const query = searchParams.get('q');

  if (!query || !query.trim()) {
    return Response.json({ results: [] });
  }

  const rawQuery = query.trim();

  try {
    // Run Wikipedia catalog + torrent engine in PARALLEL.
    // Wikipedia works for English titles; torrent engine (with LLM
    // interpretation) handles Portuguese/regional queries. Merge both
    // so the UI always gets results regardless of language.
    const [wikiItems, torrentItems] = await Promise.allSettled([
      searchCatalog(rawQuery),
      torrentSearchFallback(rawQuery),
    ]);

    const wikiResults = wikiItems.status === 'fulfilled'
      ? wikiItems.value.map((it) => ({
          id: it.id,
          title: it.title,
          overview: it.overview,
          posterUrl: it.posterUrl,
          backdropUrl: it.backdropUrl,
          year: it.year,
          genre: it.genre,
          rating: it.rating,
          type: it.type,
        }))
      : [];

    const torrentResults = torrentItems.status === 'fulfilled' ? torrentItems.value : [];

    // Merge Wikipedia + torrent rows for the same film. Keyed by the EN original
    // title (TMDB provides it) so a PT-BR torrent row and the EN Wikipedia entry
    // collapse into ONE card. When they collide, the row carrying download
    // options (torrent/PT, with TMDB backdrop) WINS and the wiki entry only
    // fills poster/overview gaps — so the hero never picks the EN wiki variant.
    const merged: any[] = [];
    const seenTitles = new Map<string, number>();

    for (const r of [...wikiResults, ...torrentResults]) {
      const type = r.type === 'tv' ? 'tv' : 'movie';
      const key = `${type}:${titleKey(r.originalTitle || r.title)}`;
      const idx = seenTitles.get(key);
      if (idx === undefined) {
        seenTitles.set(key, merged.length);
        merged.push(r);
        continue;
      }

      const existing = merged[idx];
      const existingHasOpts = !!(existing.options && existing.options.length > 0);
      const incomingHasOpts = !!(r.options && r.options.length > 0);

      // Prefer the row with download options (torrent/PT + TMDB backdrop).
      let keeper = existing;
      let mergedFrom = r;
      if (incomingHasOpts && !existingHasOpts) {
        keeper = r;
        mergedFrom = existing;
        merged[idx] = r;
      }

      const keepOpts = keeper.options || [];
      for (const o of mergedFrom.options || []) {
        if (!keepOpts.some((x: any) => x.sourceUrl === o.sourceUrl)) keepOpts.push(o);
      }
      keeper.options = keepOpts;
      if (mergedFrom.ptUnavailable !== undefined && keeper.ptUnavailable === undefined) {
        keeper.ptUnavailable = mergedFrom.ptUnavailable;
      }
      if (!keeper.posterUrl && mergedFrom.posterUrl) {
        keeper.posterUrl = mergedFrom.posterUrl;
        keeper.backdropUrl = mergedFrom.backdropUrl;
        keeper.overview = mergedFrom.overview;
      }
    }

    // Pass 2 — collapse franchise duplicates where Wikipedia and TMDB disagree
    // on the type. A franchise page is classified as a "series" by Wikipedia
    // (e.g. "Guerra nas Estrelas" as Série) while TMDB returns the same title
    // as a movie with a year. When two rows share a titleKey but differ only in
    // type AND one of them has no year, keep the specific (year-bearing) row and
    // drop the generic franchise page.
    {
      const byTitle = new Map<string, number>();
      let i = 0;
      while (i < merged.length) {
        const tkey = titleKey(merged[i].title);
        const prevIdx = byTitle.get(tkey);
        if (prevIdx !== undefined) {
          const a = merged[prevIdx];
          const b = merged[i];
          const aYear = a.year != null && a.year !== '';
          const bYear = b.year != null && b.year !== '';
          if (aYear !== bYear) {
            const specificIdx = aYear ? prevIdx : i;
            const genericIdx = aYear ? i : prevIdx;
            const specific = merged[specificIdx];
            const generic = merged[genericIdx];
            const keepOpts = specific.options || [];
            for (const o of generic.options || []) {
              if (!keepOpts.some((x: any) => x.sourceUrl === o.sourceUrl)) keepOpts.push(o);
            }
            specific.options = keepOpts;
            if (!specific.posterUrl && generic.posterUrl) {
              specific.posterUrl = generic.posterUrl;
              specific.backdropUrl = generic.backdropUrl;
            }
            merged.splice(genericIdx, 1);
            // Indices shifted → rebuild the map and restart the scan.
            byTitle.clear();
            merged.forEach((m, idx) => {
              const k = titleKey(m.title);
              if (!byTitle.has(k)) byTitle.set(k, idx);
            });
            i = 0;
            continue;
          }
        } else {
          byTitle.set(tkey, i);
        }
        i += 1;
      }
    }

    // Pass 3 — dedup rows that are the SAME film from different sources (the
    // engine row with EN originalTitle "Iron Man" and the PT Wikipedia row
    // "Homem de Ferro" share the display title + year but not the pass-1 key).
    // Merge by (type, titleKey, year), keeping the row that has download
    // options (real match) and folding the other's options/posters into it.
    {
      const seen = new Map<string, number>();
      const out: any[] = [];
      for (const r of merged) {
        const type = r.type === 'tv' ? 'tv' : 'movie';
        const tkey = titleKey(r.title);
        const year = r.year != null && r.year !== '' ? String(r.year) : '';
        const key = `${type}:${tkey}:${year}`;
        const idx = seen.get(key);
        if (idx === undefined) {
          seen.set(key, out.length);
          out.push(r);
          continue;
        }
        const existing = out[idx];
        const keep = (existing.options && existing.options.length > 0) ? existing : r;
        const drop = keep === existing ? r : existing;
        const keepOpts = keep.options || [];
        for (const o of drop.options || []) {
          if (!keepOpts.some((x: any) => x.sourceUrl === o.sourceUrl)) keepOpts.push(o);
        }
        keep.options = keepOpts;
        if (!keep.posterUrl && drop.posterUrl) {
          keep.posterUrl = drop.posterUrl;
          keep.backdropUrl = drop.backdropUrl;
          keep.overview = drop.overview;
        }
        if (keep !== existing) out[idx] = keep;
      }
      merged.length = 0;
      merged.push(...out);
    }

    // Drop wiki-only rows (no download options) that a strict multi-token match
    // would reject — mirroring the Python engine's strong-match. The query must
    // be a PREFIX of the row's title (base title) or the row may only add
    // neutral tokens (numbers/filler). This removes "Tetsuo: The Iron Man" for
    // an "iron man" query (query is an embedded subtitle, not the base) while
    // keeping "Iron Man 2", "Iron Man (1994)" and the saga entries. Rows with
    // torrent options (real matches) are always kept. Single-word queries skip.
    const qTokens = titleKey(query).split(' ').filter((t) => t.length > 1);
    if (qTokens.length >= 2) {
      const NEUTRAL = new Set([
        'the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'for', 'to', 'at',
        'de', 'do', 'da', 'dos', 'das', 'e', 'o', 'as', 'os', 'um', 'uma',
        'part', 'parte', 'vol', 'volume', 'ep', 'episode', 'capitulo',
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      ]);
      const qset = new Set(qTokens);
      const strongMatch = (rTokens: string[]): boolean => {
        if (rTokens.length >= qTokens.length && rTokens.slice(0, qTokens.length).join(' ') === qTokens.join(' ')) {
          return true; // query is the base-title prefix
        }
        const nset = new Set(rTokens);
        for (const t of qset) if (!nset.has(t)) return false;
        for (const t of nset) {
          if (qset.has(t)) continue;
          if (/^\d+$/.test(t) || NEUTRAL.has(t)) continue;
          return false; // meaningful extra token → different work
        }
        return true;
      };
      const filtered = merged.filter((r: any) => {
        if (r.options && r.options.length > 0) return true;
        return strongMatch(titleKey(r.title).split(' ').filter((t) => t.length > 1));
      });
      merged.length = 0;
      merged.push(...filtered);
    }

    return Response.json({ results: merged }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return Response.json({ results: [] }, { headers: { 'Cache-Control': 'no-store' } });
  }
}

// Fallback catalog search via the local torrent engine (Express :3001). It
// translates PT titles and surfaces Brazilian releases; results are shaped as
// CatalogItems so the UI opens the same download modal on selection.
async function torrentSearchFallback(rawQuery: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
  try {
    // Use the enhanced endpoint (LLM interpretation of free-form queries +
    // noise filtering). It degrades silently to the plain engine if the LLM
    // is unavailable, so this stays safe for catalog searches.
    const res = await fetch(`${apiUrl}/media-search/enhanced?q=${encodeURIComponent(rawQuery)}`, {
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const results = data.results || [];
    return results
      .filter((r: any) => r.options && r.options.length > 0)
      .map((r: any) => ({
        id: r.id,
        title: r.title,
        originalTitle: r.originalTitle || '',
        overview: r.overview || '',
        posterUrl: r.posterUrl || '',
        backdropUrl: r.backdropUrl || '',
        year: r.year ? Number(r.year) || null : null,
        genre: r.genre || 'Filme',
        rating: 8.5,
        type: r.mediaType === 'series' ? 'tv' : 'movie',
        // Carries the dubbed/PT info so the modal opens with the right options.
        options: r.options,
        ptUnavailable: r.ptUnavailable,
      }));
  } catch {
    return [];
  }
}
