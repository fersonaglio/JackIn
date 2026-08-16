import { spawn } from 'child_process';
import path from 'path';

// ─── Engine runner (mirrors the /search route) ───
const SCRIPTS_DIR = path.resolve(import.meta.dirname, '../../../../../apps/python-services');
const VENV_PYTHON = process.env.PYTHON_BIN || path.resolve(import.meta.dirname, '../../../../../.venv/bin/python3');

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

// ─── ZEN LLM client with circuit breaker ───
interface ZenChoice {
  message?: { content?: string };
}

const breaker = { failures: 0, openUntil: 0 };
const MAX_FAILURES = 3;
const OPEN_MS = 60_000;

function isBreakerOpen(): boolean {
  if (Date.now() < breaker.openUntil) return true;
  if (breaker.failures >= MAX_FAILURES) {
    breaker.openUntil = Date.now() + OPEN_MS;
    breaker.failures = 0;
    return true;
  }
  return false;
}

function recordSuccess() {
  breaker.failures = 0;
}

function recordFailure() {
  breaker.failures += 1;
}

async function callZen(prompt: string, timeoutMs: number): Promise<string | null> {
  if (isBreakerOpen()) return null;
  const zenKey = process.env.ZEN_API_KEY || process.env.OPENCODE_ZEN_API_KEY || '';
  if (!zenKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const apiRes = await fetch('https://opencode.ai/zen/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${zenKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash-free',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.1,
        // deepseek-v4-flash-free spends tokens on "reasoning_content" before
        // emitting the final content. The API default max_tokens is too small,
        // so responses came back empty or truncated (finish_reason=length).
        // 1000 gives the reasoning room while still returning a short JSON body.
        max_tokens: 1000,
      }),
      signal: controller.signal,
    });
    if (!apiRes.ok) {
      recordFailure();
      return null;
    }
    const data = (await apiRes.json()) as { choices?: ZenChoice[] };
    const content = data.choices?.[0]?.message?.content?.trim() || '';
    if (!content) {
      recordFailure();
      return null;
    }
    recordSuccess();
    return content;
  } catch {
    recordFailure();
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(content: string): any {
  const cleaned = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ─── interpretQuery (LLM 1) with in-memory cache ───
const interpretCache = new Map<string, { at: number; value: InterpretedQuery }>();
const INTERPRET_TTL_MS = 3600_000;

function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

const INTERPRET_PROMPT = (rawQuery: string) => `Você é o assistente de busca de um catálogo de torrents brasileiro (filmes e séries).
O usuário escreve um termo livre (pode ser português, inglês, vago, com gíria, ou nome parcial). Você deve identificar o título canônico do filme/série em INGLÊS, o título em português do Brasil (quando conhecido), o ano de lançamento (quando inferível) e o tipo (movie ou series).

REGRA: responda APENAS um objeto JSON puro, sem markdown, sem \`\`\`.

Exemplos:
Entrada: "aquela saga de anel"
Saída: {"canonicalTitle":"The Lord of the Rings","ptTitle":"O Senhor dos Anéis","year":null,"mediaType":"movie","confidence":0.9}

Entrada: "shang shi dublado"
Saída: {"canonicalTitle":"Shang-Chi and the Legend of the Ten Rings","ptTitle":"Shang-Chi e a Lenda dos Dez Anéis","year":2021,"mediaType":"movie","confidence":0.95}

Entrada: "o filme do homem que voa"
Saída: {"canonicalTitle":"Superman","ptTitle":"Super-Homem","year":null,"mediaType":"movie","confidence":0.8}

Entrada: "the last of us"
Saída: {"canonicalTitle":"The Last of Us","ptTitle":"The Last of Us","year":null,"mediaType":"series","confidence":0.95}

Entrada: "velozes e furiosos"
Saída: {"canonicalTitle":"Fast & Furious","ptTitle":"Velozes e Furiosos","year":null,"mediaType":"movie","confidence":0.8}

Entrada: "mandalorian"
Saída: {"canonicalTitle":"The Mandalorian","ptTitle":"The Mandalorian","year":null,"mediaType":"series","confidence":0.9}

Se o termo já for um título canônico, devolva-o como canonicalTitle.

Entrada: "${rawQuery}"
Saída:`;

export async function interpretQuery(rawQuery: string): Promise<InterpretedQuery> {
  const key = fold(rawQuery);
  const hit = interpretCache.get(key);
  if (hit && Date.now() - hit.at < INTERPRET_TTL_MS) {
    return hit.value;
  }

  // ZEN has a slow cold start after a server restart; allow a single retry so a
  // first-call timeout never degrades the whole search to the identity query.
  let content: string | null = null;
  for (let attempt = 0; attempt < 2 && !content; attempt += 1) {
    content = await callZen(INTERPRET_PROMPT(rawQuery), 20000);
  }
  const parsed = content ? parseJson(content) : null;

  // Only accept an interpretation when the model returned a title we can act on.
  // Failures (timeout/offline/bad JSON) fall back to identity AND are NOT cached,
  // so a transient ZEN hiccup never poisons the 1h cache with a useless result.
  const result: InterpretedQuery = parsed?.canonicalTitle && String(parsed.canonicalTitle).length > 0
    ? {
        canonicalTitle: String(parsed.canonicalTitle),
        ptTitle: parsed.ptTitle ? String(parsed.ptTitle) : null,
        year: parsed.year ? Number(parsed.year) || null : null,
        mediaType: parsed.mediaType === 'series' || parsed.mediaType === 'movie' ? parsed.mediaType : null,
        confidence: parsed.confidence ? Number(parsed.confidence) : undefined,
      }
    : { canonicalTitle: rawQuery, confidence: 0 };

  if ((result.confidence ?? 0) > 0) {
    interpretCache.set(key, { at: Date.now(), value: result });
  }
  return result;
}

// ─── Deterministic PT→EN translation (mirrors Python _pt_to_en) ───
// Used as fallback when ZEN LLM is unavailable. Tries compound phrases
// first, then word-level translations (longest key first to avoid
// partial matches like "duna" capturing "duna parte 2").

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
      // Replace the PT phrase with the EN equivalent
      const re = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      result = result.replace(re, value);
      break; // First (longest) match wins
    }
  }

  // Clean up: if result still has PT words, try word-level fallback
  if (result === rawQuery.toLowerCase()) {
    // Try a second pass with word-level only (shorter keys)
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

// ─── Deterministic edition merge (no LLM cost) ───
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

// ─── rankCandidates (LLM 2): filter noise + reorder ───
function rankGuidance(query: string, interpreted: InterpretedQuery | null, results: MediaSearchResult[]): string {
  const qLower = query.toLowerCase();
  const hasSeries = results.some((r) => r.mediaType === 'series');
  const hasMovie = results.some((r) => (r.mediaType || 'movie') === 'movie');

  // Explicit type intent from the query itself ("temporada", "season", "filme").
  const wantsSeries = /serie|temporada|season|temporadas/i.test(qLower);
  const wantsMovie = /\bfilme\b|\bmovie\b/i.test(qLower) || interpreted?.mediaType === 'movie';

  if (wantsSeries) return 'só a série (descarte filmes e extras)';
  if (wantsMovie) return 'só o filme (descarte episódios)';
  if (hasSeries && hasMovie) return 'mantenha série E filme (só remova lixo/duplicatas)';
  return 'remova apenas lixo/duplicatas';
}

const RANK_PROMPT = (query: string, interpreted: InterpretedQuery | null, results: MediaSearchResult[]) => {
  const guidance = rankGuidance(query, interpreted, results);
  const compact = results.map((r, i) => {
    const pt = (r.options || []).some((o) => o.ptConfirmed || o.audioType === 'dub') ? 'PT-DUB' : '';
    return `${i}:${r.mediaType === 'series' ? 'S' : 'F'} ${r.title} (${r.year || '?'})${pt ? ' [' + pt + ']' : ''}`;
  });
  return `Busca "${query}". ${guidance}. Resultados:\n${compact.join('\n')}\nPreferi manter versões marcadas [PT-DUB] quando o filme/série for o mesmo. Responda só JSON {"keep":["indices em ordem"]}`;
};

// Deterministic noise filter applied BEFORE the LLM ranking. The ZEN model is
// variable-latency and non-deterministic; obvious junk that shows up as title
// artifacts (group encodes, short suffixes, near-duplicate rows) is removed
// here so even an LLM miss leaves a clean result set.
const JUNK_SUFFIX_RE = /(\s+(r|v\d+|10b|atv\d+|web-dl|hdr|x265|hevc|proper|repack|extended|ext)\s*$)/i;
// Encoding/group prefixes that indicate junk. NOT franchise heads — "star wars"
// is a valid franchise title (Star Wars: O Mandaloriano e Grogu) and must not
// be dropped here; the franchise-noise filtering happens at the engine level.
const JUNK_PREFIX_RE = /^(mcu|atv\d+|disneyplus?|marvel|dsnp|amzn|nf|d+)\s+/i;

function filterNoiseGroups(results: MediaSearchResult[]): MediaSearchResult[] {
  const kept: MediaSearchResult[] = [];
  for (const r of results) {
    const base = r.title.trim();
    // Drop rows whose title is just the canonical title plus a junk suffix or
    // encoding prefix ("... 10b r", "atv3 shang chi...").
    if (JUNK_SUFFIX_RE.test(base) || JUNK_PREFIX_RE.test(base)) continue;
    kept.push(r);
  }
  // Near-duplicate rows: same normalized title/type/year where one title fully
  // contains the other (the longer/rarer one is usually an encoding artifact).
  // Prefer keeping the row that carries a PT-BR dubbed option, so dedup never
  // discards the group that actually has the dub (e.g. "star wars the
  // mandalorian and grogu" with PT vs the bare "the mandalorian and grogu").
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
      // If the incoming row has a dub and the kept one does not, swap.
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

export async function rankCandidates(
  query: string,
  results: MediaSearchResult[],
  interpreted: InterpretedQuery | null,
): Promise<MediaSearchResult[]> {
  if (results.length < 2) return results;
  // Deterministic pass first: drop obvious title artifacts and near-duplicates
  // so the LLM never has to reason about encoding noise.
  const cleaned = filterNoiseGroups(results);
  const merged = mergeEditionGroups(cleaned);
  if (merged.length < 2) return merged;

  const refQuery = interpreted?.canonicalTitle || query;
  // Single attempt for ranking: the ZEN model is variable-latency (5-25s). A
  // retry doubles worst-case latency for marginal reliability gain; if this
  // call fails the deterministic fallback (merged) is already good.
  const content = await callZen(RANK_PROMPT(refQuery, interpreted, merged), 25000);
  const parsed = content ? parseJson(content) : null;
  const keep = parsed?.keep;

  if (!Array.isArray(keep) || keep.length === 0) return merged;

  // The model may return numeric indices or title strings (or a mix). Resolve
  // each entry against the merged results by index first, then by title.
  const ordered: MediaSearchResult[] = [];
  const used = new Set<number>();
  for (const entry of keep) {
    let idx: number | undefined;
    if (typeof entry === 'number') {
      idx = entry;
    } else if (typeof entry === 'string') {
      const asNum = Number(entry.trim());
      if (Number.isInteger(asNum) && asNum >= 0) {
        idx = asNum;
      } else {
        const norm = normalizeEdition(entry).toLowerCase();
        const found = merged.findIndex((r, i) => !used.has(i) && normalizeEdition(r.title).toLowerCase() === norm);
        if (found >= 0) idx = found;
      }
    }
    if (idx !== undefined && merged[idx] && !used.has(idx)) {
      used.add(idx);
      ordered.push(merged[idx]);
    }
  }

  // If the LLM dropped everything (bad response), keep the original ordering.
  const finalOrdered = ordered.length > 0 ? ordered : merged;

  // The LLM must never hide the PT-BR dub that the engine surfaced. If it
  // dropped the only group carrying a ptConfirmed option, restore it at the top
  // (prefer a group that matches the query, else any dubbed group).
  const hasPt = (r: MediaSearchResult) => (r.options || []).some((o) => o.ptConfirmed || o.audioType === 'dub');
  if (merged.some(hasPt) && !finalOrdered.some(hasPt)) {
    const ptGroup = merged.find((r) => hasPt(r));
    if (ptGroup) {
      finalOrdered.unshift(ptGroup);
    }
  }
  return finalOrdered;
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
        console.error(`[JackIn Media LLM] Engine failed: ${stderr.slice(0, 200)}`);
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

// ─── Orchestrator (hybrid: LLM enhances, never blocks) ───
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

  let engineQuery: string;
  let llmEnhanced = false;

  if ((interpret.confidence ?? 0) > 0 && interpret.canonicalTitle !== rawQuery) {
    // LLM successfully interpreted the query
    engineQuery = interpret.canonicalTitle;
    llmEnhanced = true;
  } else {
    // LLM failed or returned identity — try deterministic PT→EN translation
    const translated = deterministicTranslate(rawQuery);
    engineQuery = translated !== rawQuery.toLowerCase() ? translated : rawQuery;
    console.log(
      `[JackIn Media LLM] LLM miss for "${rawQuery}" → deterministic: "${engineQuery}" ` +
      `(original: "${rawQuery}")`,
    );
  }
  const ptTitle = interpret?.ptTitle && interpret.ptTitle !== rawQuery ? interpret.ptTitle : '';

  const { results } = await runEngine(engineQuery, audio, metaHint, ptTitle);

  let ranked = results;
  if (llmEnhanced && results.length > 0) {
    const before = ranked.length;
    ranked = await rankCandidates(engineQuery, results, interpret);
    llmEnhanced = ranked.length !== before || JSON.stringify(ranked.map((r) => r.id)) !== JSON.stringify(results.map((r) => r.id));
  }

  console.log(
    `[JackIn Media LLM] "${rawQuery}" → engine:"${engineQuery}" llm:${llmEnhanced ? 'on' : 'off'} ` +
    `${results.length}→${ranked.length} resultados em ${Date.now() - started}ms`,
  );

  return {
    query: rawQuery,
    engineQuery,
    results: ranked,
    llmEnhanced,
    tookMs: Date.now() - started,
    interpret: llmEnhanced ? interpret : undefined,
  };
}
