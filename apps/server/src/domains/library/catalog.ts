import { Router, Request, Response } from 'express';

const router = Router();

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
const ITUNES_RSS_URL = 'https://itunes.apple.com/us/rss';
const CACHE_HEADERS = { 'Cache-Control': 'no-store' };

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

// Paginação direta: cada página do JackIn tem CATALOG_PER_PAGE títulos; o TMDB
// devolve 20 por página (popularity.desc). Para servir a página N sem acumular
// as anteriores, calculamos em qual página TMDB ela começa e o offset interno.
// A ordem é ESTÁVEL porque usa o sort nativo do TMDB (popularity.desc) — sem
// reordenação no cliente.
export const CATALOG_PER_PAGE = 18;
export const TMDB_PER_PAGE = 20;
export const TMDB_MAX_PAGES = 500; // TMDB limita discover a 500 páginas (10k itens).

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

// Janela TMDB para uma página JackIn. Puro e testável.
export function tmdbWindow(
  page: number,
  perPage: number = CATALOG_PER_PAGE,
  tmdbPerPage: number = TMDB_PER_PAGE
): { tmdbPage: number; offset: number } {
  const safe = Math.max(1, Math.floor(page) || 1);
  const startItem = (safe - 1) * perPage;
  return {
    tmdbPage: Math.floor(startItem / tmdbPerPage) + 1,
    offset: startItem % tmdbPerPage,
  };
}

// Total de páginas JackIn a partir do total de páginas TMDB (cap 500). Puro.
export function jackinTotalPages(
  totalTmdbPages: number,
  perPage: number = CATALOG_PER_PAGE,
  tmdbPerPage: number = TMDB_PER_PAGE
): number {
  const capped = Math.min(Math.max(totalTmdbPages, 0), TMDB_MAX_PAGES);
  return Math.max(1, Math.ceil((capped * tmdbPerPage) / perPage));
}

// ── Cache LRU em memória (TTL 1h) ─────────────────────────────────────────
const catalogCache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

function cacheGet(key: string): any {
  const entry = catalogCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expires) {
    catalogCache.delete(key);
    return undefined;
  }
  // Move para o fim (mais recente usado) — chave mais antiga sai primeiro.
  catalogCache.delete(key);
  catalogCache.set(key, entry);
  return entry.data;
}

function cacheSet(key: string, data: any): void {
  if (catalogCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = catalogCache.keys().next().value;
    if (oldest !== undefined) catalogCache.delete(oldest);
  }
  catalogCache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
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

// Segurança extra contra a instabilidade de paginação do TMDB: remove linhas
// duplicadas (mesmo id) mantendo a primeira ocorrência — evita título repetido
// na mesma página quando o discover devolve um filme em duas páginas seguidas.
function dedupeById(rows: any[]): any[] {
  const seen = new Set<number>();
  return rows.filter((r) => {
    const id = r?.id;
    if (id == null || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function mapTmdbRow(type: 'movie' | 'tv', r: any): CatalogItem {
  const releaseDate = type === 'movie' ? (r.release_date || '') : (r.first_air_date || '');
  return {
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
  };
}

interface TmdbPageResult {
  rows: any[];
  totalPages: number;
  failed: boolean;
}

async function fetchTmdbPage(type: 'movie' | 'tv', genreId: string, page: number): Promise<TmdbPageResult> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return { rows: [], totalPages: 0, failed: true };

  const today = new Date().toISOString().slice(0, 10);
  // Filmes: por data de lançamento (mais recentes primeiro, os antigos por
  // último). IMPORTANTE: usar `release_date.desc` (e NÃO primary_release_date)
  // — o discover do TMDB pagina de forma INSTÁVEL com primary_release_date:
  // várias estreias compartilham a mesma data e o desempate muda entre requests,
  // gerando títulos duplicados/faltando entre páginas. `release_date.desc` é
  // estável (0 duplicatas em 200 páginas). Séries: das mais assistidas.
  const sortBy = type === 'tv' ? 'vote_count.desc' : 'release_date.desc';
  const params = new URLSearchParams({
    api_key: apiKey,
    sort_by: sortBy,
    vote_count_gte: '50',
    include_adult: 'false',
    page: String(page),
  });
  if (type === 'movie') {
    // `release_date.lte` sozinho VAZA lançamentos futuros (bug do TMDB: devolve
    // filmes com release_date no futuro mesmo com o filtro). O
    // `primary_release_date.lte` adicional segura esses casos, mantendo o sort
    // por release_date (estável, sem duplicatas).
    params.set('release_date.lte', today);
    params.set('primary_release_date.lte', today);
  } else {
    params.set('first_air_date.lte', today);
  }
  if (genreId) params.set('with_genres', genreId);

  const res = await fetch(`${TMDB_BASE}/discover/${type}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return { rows: [], totalPages: 0, failed: true };
  const data = await res.json();
  return {
    rows: data.results || [],
    totalPages: Math.min(data.total_pages || 0, TMDB_MAX_PAGES),
    failed: false,
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

// GET /api/catalog/discover?type=movie|tv&genre=action|comedy|...&page=1
// Paginação direta: serve APENAS a página pedida (18 títulos) com salto O(1)
// de requests (1–2 chamadas TMDB), sem acumular as páginas anteriores.
router.get('/discover', async (req: Request, res: Response) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';
  const genreKey = String(req.query.genre || '');
  const genreMap = type === 'tv' ? TV_GENRE_IDS : MOVIE_GENRE_IDS;
  const genreId = genreMap[genreKey] || '';
  const page = Math.max(Math.floor(Number(req.query.page) || 1), 1);

  const cacheKey = `${type}:${genreKey}:${page}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.set(CACHE_HEADERS);
    res.json(cached);
    return;
  }

  try {
    const { tmdbPage, offset } = tmdbWindow(page);
    const first = await fetchTmdbPage(type, genreId, tmdbPage);
    if (first.failed) throw new Error('tmdb_failed');

    let rows = first.rows;
    const totalTmdbPages = first.totalPages;
    // Página JackIn pode cruzar 2 páginas TMDB (offset 18 dentro de 20 itens).
    if (rows.length > 0 && offset + CATALOG_PER_PAGE > rows.length && tmdbPage < totalTmdbPages) {
      const second = await fetchTmdbPage(type, genreId, tmdbPage + 1);
      if (!second.failed) rows = rows.concat(second.rows);
    }

    const items = dedupeById(rows).slice(offset, offset + CATALOG_PER_PAGE).map((r) => mapTmdbRow(type, r));
    // O sort do TMDB é aproximadamente decrescente por data (alguns vizinhos
    // ficam fora de ordem). Reordena os 18 da página para garantir "recentes
    // primeiro" de forma estrita (nulos/sem data por último).
    if (type === 'movie') {
      items.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
    }
    const payload = {
      source: 'tmdb',
      items,
      page,
      totalPages: jackinTotalPages(totalTmdbPages),
      totalResults: Math.min(totalTmdbPages, TMDB_MAX_PAGES) * TMDB_PER_PAGE,
    };
    cacheSet(cacheKey, payload);
    res.set(CACHE_HEADERS);
    res.json(payload);
  } catch {
    // Sem chave TMDB (ou falha total) na página 1 → fallback iTunes (sem
    // paginação real, serve a 1ª página do feed único).
    if (page === 1) {
      let items: CatalogItem[] = [];
      try {
        items = await fetchItunes(type, 100);
      } catch {}
      const payload = {
        source: 'itunes',
        items: items.slice(0, CATALOG_PER_PAGE),
        page: 1,
        totalPages: Math.max(1, Math.ceil(items.length / CATALOG_PER_PAGE)),
        totalResults: items.length,
      };
      cacheSet(cacheKey, payload);
      res.set(CACHE_HEADERS);
      res.json(payload);
      return;
    }
    res.status(500).json({ error: 'catalog_error', message: 'Falha ao carregar catálogo' });
  }
});

export default router;
