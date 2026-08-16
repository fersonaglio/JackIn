const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const WIKI_REST = 'https://en.wikipedia.org/api/rest_v1';
const WIKI_PT_API = 'https://pt.wikipedia.org/w/api.php';
const WIKI_PT_REST = 'https://pt.wikipedia.org/api/rest_v1';
const USER_AGENT = 'JackIn/1.0 (media catalog; local dev)';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 300;
const SEARCH_LIMIT = 8;
const SUMMARY_LIMIT = 6;
const RETRY_AFTER_MAX_MS = 4000;

const DISAMBIG_RE = /(disambiguation|topics referred to by the same term)/i;

// Keep bare "series"/"manga" OUT so franchise/manga pages don't leak in.
const FILM_TV_DESC_RE =
  /(film|movie|television series|tv series|television film|miniseries|animated series|sitcom|web series|docuseries|anthology series|comedy series|drama series|reality television|reality series|documentary|anime)/i;

const DISAMBIG_SUFFIX_RE =
  /\(([^)]*)\)\s*$/;
const DISAMBIG_SUFFIX_TERMS =
  /film|movie|tv series|television series|television film|miniseries|serial|animated series|anime|sitcom|web series|docuseries|anthology series|comedy series|drama series|documentary|franchise|film series|video game|soundtrack|album|novel|novella|musical|opera|game|anime series|animated film/;

const TV_DESC_RE =
  /(television series|tv series|sitcom|miniseries|animated series|web series|docuseries|anthology series|comedy series|drama series|reality television|anime television series|telenovela|soap opera)/i;

// Conceptual/non-media Wikipedia pages that slip past isFilmOrTv because their
// description mentions "film". These are franchise/catalog/chronology pages, not
// a single playable work.
const CONCEPTUAL_TITLE_RE =
  /\b(sequel trilogy|film series|franchise|chronolog|list of|universe|series of films|anthology film|remake series|media franchise)\b/i;

// Biography pages: a person's name title whose description describes a role
// (actor/director/writer...) rather than a film. "Is a Brazilian film about a
// director" still passes because the person role must appear at the phrase
// start ("is an American actor", "was an Italian filmmaker").
const PERSON_ROLE_RE =
  /(?:is an?|was an?)\s+(?:[\w\s.,'-]*?\s)?(?:actor|actress|director|filmmaker|film director|producer|screenwriter|writer|comedian|author|cinematographer|film editor|animator)\b/i;

const GENRES: ReadonlyArray<[string, string]> = [
  ['science fiction', 'Ficção Científica'],
  ['sci-fi', 'Ficção Científica'],
  ['action', 'Ação'],
  ['thriller', 'Suspense'],
  ['comedy', 'Comédia'],
  ['drama', 'Drama'],
  ['fantasy', 'Fantasia'],
  ['horror', 'Terror'],
  ['romance', 'Romance'],
  ['documentary', 'Documentário'],
  ['animation', 'Animação'],
  ['musical', 'Musical'],
  ['biographical', 'Biografia'],
  ['crime', 'Crime'],
  ['mystery', 'Mistério'],
  ['western', 'Faroeste'],
  ['adventure', 'Aventura'],
  ['superhero', 'Herói'],
  ['sitcom', 'Sitcom'],
  ['anime', 'Anime'],
  ['epic', 'Épico'],
];

export interface WikiCatalogItem {
  id: number;
  title: string;
  rawTitle: string;
  url: string;
  overview: string;
  posterUrl: string;
  backdropUrl: string;
  year: number | null;
  genre: string;
  rating: number;
  type: 'movie' | 'tv';
}

interface WikiPage {
  pageid: number;
  title: string;
  description: string;
  extract: string;
  index?: number;
}

interface WikiSummary {
  posterUrl: string;
  extract: string;
  description: string;
}

interface CacheEntry {
  value: unknown;
  ts: number;
}

const cache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<unknown>>();

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, { value, ts: Date.now() });
  if (cache.size > CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function memoized<T>(
  key: string,
  fn: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true
): Promise<T> {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return Promise.resolve(hit);
  const inflight = pending.get(key) as Promise<T> | undefined;
  if (inflight) return inflight;
  const promise = fn()
    .then((value) => {
      // Only cache successes so a transient rate-limit failure (empty search,
      // missing poster) does not get pinned for the whole TTL.
      if (shouldCache(value)) cacheSet(key, value);
      return value;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
}

async function wikiFetch(url: string): Promise<Response | null> {
  const attempt = async (): Promise<Response | null> => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      return null;
    }
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after')) || 3;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter * 1000, RETRY_AFTER_MAX_MS)));
      return null;
    }
    if (!res.ok) return null;
    return res;
  };
  const first = await attempt();
  if (first) return first;
  await new Promise((r) => setTimeout(r, 250));
  return attempt();
}

function isBiographyPage(page: WikiPage): boolean {
  const desc = (page.description || '').toLowerCase();
  const title = page.title;
  if (!PERSON_ROLE_RE.test(desc)) return false;
  // Title must look like a person's name (2-5 capitalized words, no year and
  // not a "(film)"-style suffix), so movie pages about a director pass through.
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  if (!words.every((w) => /^[A-ZÀ-Ý][a-zà-ÿ']*$/.test(w))) return false;
  if (/\b(19\d\d|20\d\d)\b/.test(title)) return false;
  if (DISAMBIG_SUFFIX_RE.test(title) && DISAMBIG_SUFFIX_TERMS.test(title)) return false;
  return true;
}

function isFilmOrTv(page: WikiPage): boolean {
  const title = page.title;
  const desc = page.description.toLowerCase();
  const titleLower = title.toLowerCase();
  if (DISAMBIG_RE.test(titleLower) || DISAMBIG_RE.test(desc)) return false;
  if (CONCEPTUAL_TITLE_RE.test(titleLower)) return false;
  if (isBiographyPage(page)) return false;
  if (DISAMBIG_SUFFIX_RE.test(titleLower) && DISAMBIG_SUFFIX_TERMS.test(titleLower)) return true;
  if (/^documentary/.test(titleLower) || /\(documentary\)$/.test(titleLower)) return true;
  return FILM_TV_DESC_RE.test(desc);
}

function stripDisambiguation(title: string): string {
  const match = title.match(DISAMBIG_SUFFIX_RE);
  if (!match) return title;
  if (DISAMBIG_SUFFIX_TERMS.test(match[1].toLowerCase())) {
    return title.slice(0, match.index).trim();
  }
  return title;
}

function parseYear(title: string, description: string, extract = ''): number | null {
  const match = `${description} ${title} ${extract}`.match(/\b(19\d{2}|20\d{2})\b/);
  return match ? Number(match[0]) : null;
}

function detectType(title: string, description: string): 'movie' | 'tv' {
  const text = `${title} ${description}`.toLowerCase();
  if (TV_DESC_RE.test(text)) return 'tv';
  if (DISAMBIG_SUFFIX_RE.test(title.toLowerCase())) {
    const inner = title.match(DISAMBIG_SUFFIX_RE)?.[1].toLowerCase() ?? '';
    if (/(tv series|television series|sitcom|miniseries|animated series|web series|anime)/.test(inner)) return 'tv';
  }
  return 'movie';
}

function deriveGenre(description: string, title: string, extract = ''): string {
  const text = `${description} ${title} ${extract}`.toLowerCase();
  for (const [keyword, label] of GENRES) {
    if (text.includes(keyword)) return label;
  }
  return '';
}

function cleanPosterUrl(source: string): string {
  return source.split('?')[0];
}

async function searchWiki(query: string, limit = SEARCH_LIMIT, lang: 'en' | 'pt' = 'en'): Promise<WikiPage[]> {
  const apiBase = lang === 'pt' ? WIKI_PT_API : WIKI_API;
  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrnamespace: '0',
    gsrlimit: String(limit),
    prop: 'description|extracts',
    exintro: '1',
    explaintext: '1',
    format: 'json',
    formatversion: '2',
  });
  const res = await wikiFetch(`${apiBase}?${params.toString()}`);
  if (!res) return [];
  const data = (await res.json().catch(() => null)) as
    | { query?: { pages?: WikiPage[] } }
    | null;
  const pages = data?.query?.pages;
  if (!pages || !Array.isArray(pages)) return [];
  return pages
    .slice()
    .sort((a, b) => (a.index ?? 99) - (b.index ?? 99))
    .map((p) => ({
      pageid: p.pageid,
      title: p.title,
      description: p.description ?? '',
      extract: p.extract ?? '',
    }));
}

async function getSummary(title: string, lang: 'en' | 'pt' = 'en'): Promise<WikiSummary> {
  const restBase = lang === 'pt' ? WIKI_PT_REST : WIKI_REST;
  const encoded = encodeURIComponent(title.replace(/ /g, '_'));
  const res = await wikiFetch(`${restBase}/page/summary/${encoded}`);
  if (!res) return { posterUrl: '', extract: '', description: '' };
  const data = (await res.json().catch(() => null)) as
    | { originalimage?: { source?: string }; thumbnail?: { source?: string }; extract?: string; description?: string }
    | null;
  if (!data) return { posterUrl: '', extract: '', description: '' };
  // Prefer the thumbnail (always square/portrait) over originalimage, which is
  // often a landscape promo shot that crops badly in a 2:3 poster card.
  const poster = cleanPosterUrl(data.thumbnail?.source || data.originalimage?.source || '');
  return {
    posterUrl: poster,
    extract: data.extract ?? '',
    description: data.description ?? '',
  };
}

// A query that clearly targets Brazilian content (accents or common PT words)
// should hit the Portuguese Wikipedia first instead of garbage-matching EN pages.
function looksPortuguese(query: string): boolean {
  const s = query.toLowerCase();
  if (/[àáâãçéêíóôõúü]/i.test(s)) return true;
  return /(^|\s)(o|a|os|as|do|da|dos|das|de|em|para|com|um|uma|filme|serie|temporada|dublado|legendado|episodio)(\s|$)/.test(s);
}

function wikiKey(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|o|os|a|as|el|la|los|las)\s+/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runCatalogSearch(query: string, lang: 'en' | 'pt'): Promise<WikiCatalogItem[]> {
  const key = `search:${lang}:${query.toLowerCase()}`;
  return memoized<WikiCatalogItem[]>(key, async () => {
    let pages = await searchWiki(query, SEARCH_LIMIT, lang);
    let filtered = pages.filter(isFilmOrTv);
    if (filtered.length === 0) {
      pages = await searchWiki(`${query} film`, SEARCH_LIMIT, lang);
      filtered = pages.filter(isFilmOrTv);
    }
    if (filtered.length === 0) return [];
    const top = filtered.slice(0, SUMMARY_LIMIT);
    const summaries = await Promise.allSettled(
      top.map((p) => memoized<WikiSummary>(
        `summary:${lang}:${p.title}`,
        () => getSummary(p.title, lang),
        (s) => s.posterUrl !== '',
      ))
    );
    return top.map((p, i) => {
      const s = summaries[i].status === 'fulfilled' ? summaries[i].value : null;
      const description = s?.description || p.description;
      const extract = s?.extract || p.extract;
      return {
        id: p.pageid,
        title: stripDisambiguation(p.title),
        rawTitle: p.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
        overview: extract || '',
        posterUrl: s?.posterUrl || '',
        backdropUrl: s?.posterUrl || '',
        year: parseYear(p.title, description, extract),
        genre: deriveGenre(description, p.title, extract),
        rating: 8.5,
        type: detectType(p.title, description),
      };
    });
  }, (items) => items.length > 0);
}

export async function searchCatalog(query: string): Promise<WikiCatalogItem[]> {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return [];
  // Primary language by signal (PT queries hit pt.wikipedia first so EN never
  // garbage-matches "homem de ferro" against Ferros-MG/Mazzaropi). Only
  // PT-looking queries fall back to EN when PT yields nothing, so English
  // searches keep their single-language latency.
  const primary: 'en' | 'pt' = looksPortuguese(q) ? 'pt' : 'en';
  const primaryItems = await runCatalogSearch(q, primary);
  if (primaryItems.length > 0) return primaryItems;
  if (primary === 'pt') {
    return runCatalogSearch(q, 'en');
  }
  return primaryItems;
}

export const _internals = {
  isFilmOrTv,
  isBiographyPage,
  stripDisambiguation,
  parseYear,
  detectType,
  deriveGenre,
  cleanPosterUrl,
  searchWiki,
  getSummary,
  looksPortuguese,
  wikiKey,
  cacheClear: () => {
    cache.clear();
    pending.clear();
  },
};
