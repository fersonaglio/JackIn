import { Router, Request, Response } from 'express';

const router = Router();

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const ITUNES_RSS_URL = 'https://itunes.apple.com/us/rss';
const CACHE_HEADERS = { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' };

// Tabs do catálogo → IDs de gênero do TMDB.
const MOVIE_GENRE_IDS: Record<string, string> = {
  action: '28',
  comedy: '35',
  scifi: '878',
  horror: '27',
  animation: '16',
  thriller: '53',
  drama: '18',
  adventure: '12',
};

const TV_GENRE_IDS: Record<string, string> = {
  action: '10759',
  comedy: '35',
  scifi: '10765',
  drama: '18',
  mystery: '9648',
  crime: '80',
  animation: '16',
  documentary: '99',
};

const TMDB_GENRE_NAMES: Record<string, string> = {
  '28': 'Ação',
  '12': 'Aventura',
  '16': 'Animação',
  '35': 'Comédia',
  '80': 'Crime',
  '99': 'Documentário',
  '18': 'Drama',
  '10751': 'Família',
  '14': 'Fantasia',
  '36': 'História',
  '27': 'Terror',
  '10402': 'Música',
  '9648': 'Mistério',
  '10749': 'Romance',
  '878': 'Ficção Científica',
  '10770': 'Cinema TV',
  '53': 'Suspense',
  '10752': 'Guerra',
  '37': 'Faroeste',
  '10759': 'Ação & Aventura',
  '10762': 'Infantil',
  '10763': 'Notícias',
  '10764': 'Reality Show',
  '10765': 'Ficção Científica & Fantasia',
  '10766': 'Novela',
  '10767': 'Talk Show',
  '10768': 'Guerra & Política',
};

const DEFAULT_BATCH_PAGES = 8;
const TMDB_PER_PAGE = 20;
const MAX_BATCH_PAGES = 20;

export interface CatalogItem {
  tmdbId: number;
  title: string;
  originalTitle?: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  year: number | null;
  releaseDate: string | null;
  rating: number;
  genres: string[];
  type: 'movie' | 'tv';
  popularity: number;
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

// Descobre o catálogo no TMDB: traz os títulos mais relevantes (popularidade
// desc, todas as eras) já lançados e com votos; o cliente reordena por ano desc
// (recentes primeiro → clássicos no fim). Cursor-based: `startPage` é a página
// do TMDB onde começar e `pages` quantas páginas de 20 buscar por lote.
// Retorna `nextCursor` (próxima página do TMDB) e `hasMore`.
async function fetchTmdbDiscover(
  type: 'movie' | 'tv',
  genreId: string,
  startPage: number,
  pages: number
): Promise<{ items: CatalogItem[]; nextCursor: number; hasMore: boolean }> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { items: [], nextCursor: startPage, hasMore: false };

  const today = new Date().toISOString().slice(0, 10);
  const items: CatalogItem[] = [];
  let lastLoadedPage = startPage - 1;
  let totalPages = 0;
  let failed = false;

  for (let page = startPage; page < startPage + pages; page += 1) {
    const params = new URLSearchParams({
      api_key: apiKey,
      sort_by: 'popularity.desc',
      vote_count_gte: '50',
      include_adult: 'false',
      page: String(page),
    });
    if (type === 'movie') params.set('primary_release_date.lte', today);
    else params.set('first_air_date.lte', today);
    if (genreId) params.set('with_genres', genreId);

    const res = await fetch(`${TMDB_BASE}/discover/${type}?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      failed = true;
      break;
    }
    const data = await res.json();
    totalPages = data.total_pages || 0;
    const rows: any[] = data.results || [];
    if (rows.length === 0) break;

    for (const r of rows) {
      const releaseDate = type === 'movie' ? (r.release_date || '') : (r.first_air_date || '');
      items.push({
        tmdbId: r.id,
        title: r.title || r.name || '',
        originalTitle: r.original_title || r.original_name || r.title || r.name || '',
        overview: r.overview || '',
        posterPath: r.poster_path ? `${TMDB_IMG}/w500${r.poster_path}` : null,
        backdropPath: r.backdrop_path ? `${TMDB_IMG}/w1280${r.backdrop_path}` : null,
        year: releaseDate ? Number(releaseDate.slice(0, 4)) || null : null,
        releaseDate: releaseDate || null,
        rating: r.vote_average || 0,
        genres: (r.genre_ids || []).map((g: number) => TMDB_GENRE_NAMES[String(g)] || String(g)),
        type,
        popularity: r.popularity || 0,
      });
    }
    lastLoadedPage = page;
  }
  return {
    items,
    nextCursor: lastLoadedPage + 1,
    hasMore: !failed && lastLoadedPage < totalPages,
  };
}

// Fallback sem chave TMDB (ou falha): feed iTunes RSS, mesmo shape.
async function fetchItunes(type: 'movie' | 'tv', limit: number): Promise<CatalogItem[]> {
  const feed = type === 'movie' ? 'topmovies' : 'toptvseasons';
  const url = `${ITUNES_RSS_URL}/${feed}/limit=${Math.min(limit, 100)}/json`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const entries: any[] = data.feed?.entry || [];
  return entries.map((e) => {
    const images = e['im:image'] || [];
    const art = images[images.length - 1]?.label || '';
    const date = e['im:releaseDate']?.label || '';
    const href = e.link?.[0]?.attributes?.href || '';
    const idMatch = href.match(/\/id(\d+)/);
    return {
      tmdbId: idMatch ? parseInt(idMatch[1], 10) : hashCode(e['im:name']?.label || art),
      title: e['im:name']?.label || '',
      overview: e.summary?.label || '',
      posterPath: art ? resizeArt(art, '600x600bb') : null,
      backdropPath: art ? resizeArt(art, '1000x1000bb') : null,
      year: date ? Number(date.slice(0, 4)) || null : null,
      releaseDate: date || null,
      rating: 8.5,
      genres: [],
      type,
      popularity: 0,
    };
  });
}

// GET /api/catalog/discover?type=movie|tv&genre=action|comedy|scifi|...&cursor=1&pages=8
router.get('/discover', async (req: Request, res: Response) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const genreKey = String(req.query.genre || '');
  const genreMap = type === 'tv' ? TV_GENRE_IDS : MOVIE_GENRE_IDS;
  const genreId = genreMap[genreKey] || '';
  const cursor = Math.max(Number(req.query.cursor) || 1, 1);
  const pages = Math.min(Math.max(Number(req.query.pages) || DEFAULT_BATCH_PAGES, 1), MAX_BATCH_PAGES);

  try {
    let result = await fetchTmdbDiscover(type, genreId, cursor, pages);
    let source = 'tmdb';
    // Sem chave TMDB (ou falha) no primeiro lote → fallback iTunes (catálogo único).
    if (result.items.length === 0 && cursor <= 1) {
      const items = await fetchItunes(type, 100);
      result = { items, nextCursor: 2, hasMore: false };
      source = 'itunes';
    }
    res.set(CACHE_HEADERS);
    res.json({
      source,
      items: result.items,
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      totalResults: result.items.length,
    });
  } catch (err) {
    res.status(500).json({ error: 'catalog_error', message: (err as Error).message });
  }
});

export default router;
