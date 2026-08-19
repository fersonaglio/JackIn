import { spawn } from 'child_process';
import path from 'path';

import fs from 'fs';

import { MovieDb } from 'moviedb-promise';
import type { MovieResult, TvResult } from 'moviedb-promise';

// ─── Engine runner (mirrors the /search route) ───
const SCRIPTS_DIR = path.resolve(import.meta.dirname, '../../../../../apps/python-services');
const defaultVenv = path.resolve(import.meta.dirname, '../../../../../.venv/bin/python3');
const VENV_PYTHON = process.env.PYTHON_BIN || (fs.existsSync(defaultVenv) ? defaultVenv : 'python3');

// ─── Types shared with the engine / frontend ───
export interface MediaOption {
  id: string;
  quality: string;
  badge: string;
  resolution: string;
  bitrate: string;
  size: string;
  seeders?: number;
  audio: string;
  audioType?: string;
  hasSubtitles?: boolean;
  ptConfirmed?: boolean;
  ptExcluded?: boolean;
  format: string;
  sourceUrl: string;
}

export interface MediaSearchResult {
  id: string;
  title: string;
  originalTitle: string;
  year: string;
  overview: string;
  posterUrl: string;
  backdropUrl?: string;
  genre: string;
  rating: string;
  options: MediaOption[];
  mediaType?: string;
  matchScore?: number;
  exactMatch?: boolean;
  approximate?: boolean;
  approximateTitle?: string;
  ptUnavailable?: boolean;
}

export interface InterpretedQuery {
  canonicalTitle: string;
  ptTitle?: string | null;
  year?: number | null;
  mediaType?: 'movie' | 'series' | null;
  confidence?: number;
}

// ─── TMDB client (moviedb-promise) — replaces the ZEN LLM interpreter ───
let movieDb: MovieDb | null = null;

function getMovieDb(): MovieDb | null {
  const key = (process.env.TMDB_API_KEY || '').trim();
  if (!key) return null;
  if (!movieDb) movieDb = new MovieDb(key);
  return movieDb;
}

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const interpretCache = new Map<string, { at: number; value: InterpretedQuery }>();
const INTERPRET_TTL_MS = 3600_000;

// ─── interpretQuery: TMDB /search/multi → InterpretedQuery ───
// Resolve um termo livre (PT ou EN) para o título canônico em inglês + título
// PT + ano + tipo (filme/série). O TMDB já resolve títulos em português
// ("senhor dos anéis" → The Lord of the Rings) e tipa filme/série; quando a
// chave está ausente, offline ou sem match, cai no mapa determinístico.
async function interpretViaTmdb(rawQuery: string): Promise<InterpretedQuery | null> {
  const mdb = getMovieDb();
  if (!mdb) return null;
  try {
    const res = await mdb.searchMulti({ query: rawQuery, language: 'pt-BR', include_adult: false });
    for (const r of res.results || []) {
      if (r.media_type === 'movie') {
        const m = r as MovieResult;
        const canonical = (m.original_title || '').trim();
        if (!canonical) continue;
        const pt = (m.title || '').trim();
        return {
          canonicalTitle: canonical,
          ptTitle: pt && fold(pt) !== fold(canonical) ? pt : null,
          year: m.release_date ? Number(m.release_date.slice(0, 4)) || null : null,
          mediaType: 'movie',
          confidence: m.vote_count && m.vote_count > 20 ? 0.9 : 0.7,
        };
      }
      if (r.media_type === 'tv') {
        const t = r as TvResult;
        const canonical = (t.original_name || '').trim();
        if (!canonical) continue;
        const pt = (t.name || '').trim();
        return {
          canonicalTitle: canonical,
          ptTitle: pt && fold(pt) !== fold(canonical) ? pt : null,
          year: t.first_air_date ? Number(t.first_air_date.slice(0, 4)) || null : null,
          mediaType: 'series',
          confidence: t.vote_count && t.vote_count > 20 ? 0.9 : 0.7,
        };
      }
    }
  } catch (e) {
    console.warn(`[JackIn Media] TMDB interpret falhou para "${rawQuery}": ${(e as Error).message}`);
  }
  return null;
}

export async function interpretQuery(rawQuery: string): Promise<InterpretedQuery> {
  const key = fold(rawQuery);
  const hit = interpretCache.get(key);
  if (hit && Date.now() - hit.at < INTERPRET_TTL_MS) {
    return hit.value;
  }

  const tmdb = await interpretViaTmdb(rawQuery);

  let result: InterpretedQuery;
  if (tmdb && tmdb.canonicalTitle) {
    result = tmdb;
  } else {
    // TMDB sem match/chave/offline: cai na tradução determinística PT→EN e
    // devolve identidade quando nada casa (o engine então tenta o termo cru).
    const translated = deterministicTranslate(rawQuery);
    const engineTitle = fold(translated) !== fold(rawQuery) ? translated : rawQuery;
    result = { canonicalTitle: engineTitle, confidence: 0 };
  }

  if ((result.confidence ?? 0) > 0) {
    interpretCache.set(key, { at: Date.now(), value: result });
  }
  return result;
}

// ─── Deterministic PT→EN translation (fallback offline) ───
const DETERMINISTIC_TRANSLATIONS: Record<string, string> = {
  // Compound phrases (longest first — checked in sorted order)
  "duna parte dois": "Dune Part Two",
  "duna parte 2": "Dune Part Two",
  "duna parte um": "Dune Part One",
  "duna parte 1": "Dune Part One",
  "senhor dos aneis a sociedade do anel": "The Lord of the Rings The Fellowship of the Ring",
  "senhor dos aneis as duas torres": "The Lord of the Rings The Two Towers",
  "senhor dos aneis o retorno do rei": "The Lord of the Rings The Return of the King",
  "a sociedade do anel": "The Fellowship of the Ring",
  "as duas torres": "The Two Towers",
  "o retorno do rei": "The Return of the King",
  "star wars o imperio contra ataca": "Star Wars The Empire Strikes Back",
  "star wars uma nova esperanca": "Star Wars A New Hope",
  "star wars o retorno de jedi": "Star Wars Return of the Jedi",
  "star wars a ameaca fantasma": "Star Wars The Phantom Menace",
  "star wars ataque dos clones": "Star Wars Attack of the Clones",
  "star wars a vinganca dos sith": "Star Wars Revenge of the Sith",
  "star wars o despertar da forca": "Star Wars The Force Awakens",
  "star wars os ultimos jedi": "Star Wars The Last Jedi",
  "star wars a ascensao skywalker": "Star Wars The Rise of Skywalker",
  "harry potter e a pedra filosofal": "Harry Potter and the Philosopher's Stone",
  "harry potter e a camara secreta": "Harry Potter and the Chamber of Secrets",
  "harry potter e o prisioneiro de azkaban": "Harry Potter and the Prisoner of Azkaban",
  "harry potter e o calice de fogo": "Harry Potter and the Goblet of Fire",
  "harry potter e a ordem da fenix": "Harry Potter and the Order of the Phoenix",
  "harry potter e o enigma do principe": "Harry Potter and the Half-Blood Prince",
  "harry potter e as reliquias da morte": "Harry Potter and the Deathly Hallows",
  "velozes e furiosos desafio em toquio": "Tokyo Drift",
  "velozes e furiosos 5 operacao rio": "Fast Five",
  "missao impossivel acerto de contas": "Mission Impossible Dead Reckoning",
  "missao impossivel efeito fallout": "Mission Impossible Fallout",
  "missao impossivel nacao secreta": "Mission Impossible Rogue Nation",
  "missao impossivel protocolo fantasma": "Mission Impossible Ghost Protocol",
  "homem aranha sem volta para casa": "Spider-Man: No Way Home",
  "homem aranha longe de casa": "Spider-Man: Far From Home",
  "homem aranha de volta ao lar": "Spider-Man: Homecoming",
  "o hobbit uma jornada inesperada": "The Hobbit: An Unexpected Journey",
  "o hobbit a desolacao de smaug": "The Hobbit: The Desolation of Smaug",
  "o hobbit a batalha dos cinco exercitos": "The Hobbit: The Battle of the Five Armies",
  "jogos vorazes": "The Hunger Games",
  "jogos vorazes em chamas": "The Hunger Games Catching Fire",
  "jogos vorazes a esperanca": "The Hunger Games Mockingjay",
  "pantera negra wakanda forever": "Black Panther Wakanda Forever",
  // Word-level translations (applied after compound phrases)
  "senhor dos aneis": "The Lord of the Rings",
  "o senhor dos aneis": "The Lord of the Rings",
  "guerra nas estrelas": "Star Wars",
  "divertida mente": "Inside Out",
  "velozes e furiosos": "Fast and Furious",
  "vingadores": "Avengers",
  "homem aranha": "Spider-Man",
  "homem de ferro": "Iron Man",
  "capitao america": "Captain America",
  "pantera negra": "Black Panther",
  "doutor estranho": "Doctor Strange",
  "guerra infinita": "Infinity War",
  "ultimato": "Endgame",
  "guerra civil": "Civil War",
  "liga da justica": "Justice League",
  "esquadrao suicida": "Suicide Squad",
  "mulher maravilha": "Wonder Woman",
  "missao impossivel": "Mission Impossible",
  "piratas do caribe": "Pirates of the Caribbean",
  "de volta pro futuro": "Back to the Future",
  "de volta para o futuro": "Back to the Future",
  "exterminador do futuro": "Terminator",
  "o poderoso chefao": "The Godfather",
  "jurassic world": "Jurassic World",
  "mundo jurassico": "Jurassic World",
  "duna": "Dune",
  "o hobbit": "The Hobbit",
  "harry potter": "Harry Potter",
  "transformers": "Transformers",
  "a origem": "Inception",
  "interestelar": "Interstellar",
  "clube da luta": "Fight Club",
  "matrix": "Matrix",
  "avatar": "Avatar",
  "gladiador": "Gladiator",
  "batman": "Batman",
  "superman": "Superman",
  "coringa": "Joker",
  "deadpool": "Deadpool",
  "wolverine": "Wolverine",
  "logan": "Logan",
  // Typo aliases
  "sennor dos aneis": "The Lord of the Rings",
  "sennor": "senhor",
  "guera nas estrelas": "Star Wars",
};

function foldText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function deterministicTranslate(rawQuery: string): string {
  const folded = foldText(rawQuery);
  if (!folded) return rawQuery;

  // Sort keys by length descending (longest match first)
  const sortedKeys = Object.keys(DETERMINISTIC_TRANSLATIONS).sort(
    (a, b) => b.length - a.length,
  );

  let result = rawQuery.toLowerCase();

  for (const key of sortedKeys) {
    const keyFolded = foldText(key);
    if (folded.includes(keyFolded)) {
      const value = DETERMINISTIC_TRANSLATIONS[key];
      if (value === 'senhor') continue; // typo alias — skip, let another key match
      const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      result = result.replace(re, value);
      break; // First (longest) match wins
    }
  }

  if (result === rawQuery.toLowerCase()) {
    const wordKeys = sortedKeys.filter((k) => k.split(' ').length <= 2);
    for (const key of wordKeys) {
      const keyFolded = foldText(key);
      if (folded.includes(keyFolded)) {
        const value = DETERMINISTIC_TRANSLATIONS[key];
        if (value !== 'senhor') {
          const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
          result = result.replace(re, value);
          break;
        }
      }
    }
  }

  return result !== rawQuery.toLowerCase() ? result : rawQuery;
}

// ─── Deterministic edition merge + noise filter (no LLM) ───
const EDITION_RE = /\b(extended|ext\.?|theatrical|directors?\s*cut|uncut|remastered?|remaster|imax|special\s*edition|collectors?\s*edition)\b/gi;
const LEADING_ARTICLE_RE = /^(the|a|an|o|os|a|as|el|la|los|las)\s+/i;

function normalizeEdition(title: string): string {
  return title
    .replace(EDITION_RE, ' ')
    .replace(LEADING_ARTICLE_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function mergeEditionGroups(results: MediaSearchResult[]): MediaSearchResult[] {
  const groups: MediaSearchResult[] = [];
  for (const r of results) {
    const normalized = normalizeEdition(r.title).toLowerCase();
    const idx = groups.findIndex((g) => {
      if (normalizeEdition(g.title).toLowerCase() !== normalized) return false;
      if ((g.mediaType || 'movie') !== (r.mediaType || 'movie')) return false;
      const gy = g.year ? String(g.year) : '';
      const ry = r.year ? String(r.year) : '';
      if (gy && ry && gy !== ry) return false;
      return true;
    });
    if (idx >= 0) {
      const g = groups[idx];
      const seen = new Set(g.options.map((o) => o.sourceUrl));
      for (const o of r.options) {
        if (!seen.has(o.sourceUrl)) g.options.push(o);
      }
      if (!g.posterUrl && r.posterUrl) {
        g.posterUrl = r.posterUrl;
        g.overview = r.overview;
        g.backdropUrl = r.backdropUrl || r.posterUrl;
      }
      g.matchScore = Math.max(g.matchScore || 0, r.matchScore || 0);
      g.exactMatch = g.exactMatch || r.exactMatch;
    } else {
      groups.push({ ...r });
    }
  }
  return groups;
}

const JUNK_SUFFIX_RE = /(\s+(r|v\d+|10b|atv\d+|web-dl|hdr|x265|hevc|proper|repack|extended|ext)\s*$)/i;
const JUNK_PREFIX_RE = /^(mcu|atv\d+|disneyplus?|marvel|dsnp|amzn|nf|d+)\s+/i;

function filterNoiseGroups(results: MediaSearchResult[]): MediaSearchResult[] {
  const kept: MediaSearchResult[] = [];
  for (const r of results) {
    const base = r.title.trim();
    if (JUNK_SUFFIX_RE.test(base) || JUNK_PREFIX_RE.test(base)) continue;
    kept.push(r);
  }
  const hasPt = (r: MediaSearchResult) => (r.options || []).some((o) => o.ptConfirmed || o.audioType === 'dub');
  const deduped: MediaSearchResult[] = [];
  for (const r of kept) {
    const isDup = deduped.some((d) => {
      if ((d.mediaType || 'movie') !== (r.mediaType || 'movie')) return false;
      if (d.year && r.year && d.year !== r.year) return false;
      const a = normalizeEdition(d.title).toLowerCase();
      const b = normalizeEdition(r.title).toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    if (isDup) {
      const idx = deduped.findIndex((d) => {
        if ((d.mediaType || 'movie') !== (r.mediaType || 'movie')) return false;
        if (d.year && r.year && d.year !== r.year) return false;
        const a = normalizeEdition(d.title).toLowerCase();
        const b = normalizeEdition(r.title).toLowerCase();
        return a === b || a.includes(b) || b.includes(a);
      });
      if (idx >= 0 && hasPt(r) && !hasPt(deduped[idx])) {
        deduped[idx] = r;
      }
      continue;
    }
    deduped.push(r);
  }
  return deduped;
}

// ─── rankCandidates: determinístico (merge de edições + filtro de ruído) ───
export async function rankCandidates(
  _query: string,
  results: MediaSearchResult[],
  _interpreted: InterpretedQuery | null,
): Promise<MediaSearchResult[]> {
  if (results.length < 2) return results;
  return mergeEditionGroups(filterNoiseGroups(results));
}

// ─── Engine subprocess runner ───
function runEngine(query: string, audio: string, metaHint: Record<string, string> | null, ptTitle = ''): Promise<{ results: MediaSearchResult[] }> {
  return new Promise((resolve) => {
    const args = [
      path.join(SCRIPTS_DIR, 'modules', 'media', 'media_search_engine.py'),
      '--query', query,
    ];
    if (audio) args.push('--audio', audio);
    if (ptTitle) args.push('--pt-title', ptTitle);
    if (metaHint) args.push('--meta-json', JSON.stringify(metaHint));

    const proc = spawn(VENV_PYTHON, args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code !== 0) {
        console.error(`[JackIn Media] Engine failed: ${stderr.slice(0, 200)}`);
        resolve({ results: [] });
        return;
      }
      try {
        const data = JSON.parse(stdout);
        resolve({ results: data.results || [] });
      } catch {
        resolve({ results: [] });
      }
    });
  });
}

// ─── Orchestrator (TMDB + determinístico, sem LLM) ───
export interface EnhancedSearchOutput {
  query: string;
  engineQuery: string;
  results: MediaSearchResult[];
  llmEnhanced: boolean;
  tookMs: number;
  interpret?: InterpretedQuery;
}

export async function searchMediaEnhanced(
  rawQuery: string,
  audio = '',
  metaHint: Record<string, string> | null = null,
): Promise<EnhancedSearchOutput> {
  const started = Date.now();
  const interpret = await interpretQuery(rawQuery);

  const engineQuery =
    (interpret.confidence ?? 0) > 0 && interpret.canonicalTitle !== rawQuery
      ? interpret.canonicalTitle
      : deterministicTranslate(rawQuery);
  const ptTitle = interpret?.ptTitle && interpret.ptTitle !== rawQuery ? interpret.ptTitle : '';

  const { results } = await runEngine(engineQuery, audio, metaHint, ptTitle);
  const ranked = await rankCandidates(engineQuery, results, interpret);

  console.log(
    `[JackIn Media] "${rawQuery}" → engine:"${engineQuery}" ${results.length}→${ranked.length} resultados em ${Date.now() - started}ms`,
  );

  return {
    query: rawQuery,
    engineQuery,
    results: ranked,
    llmEnhanced: false,
    tookMs: Date.now() - started,
    interpret: (interpret.confidence ?? 0) > 0 ? interpret : undefined,
  };
}
