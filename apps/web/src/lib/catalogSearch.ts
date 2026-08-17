import type { CatalogItem } from '@/types/media';

// Glued franchise queries ("starwars", "homemdeferro") miss both Wikipedia and
// the torrent indexers, which expect spaced terms. Expand the common ones the
// engine's LLM/dictionaries already know.
const GLUED_TITLES: Record<string, string> = {
  starwars: 'star wars',
  guerranasestrelas: 'guerra nas estrelas',
  senhordosaneis: 'senhor dos aneis',
  velozesefuriosos: 'velozes e furiosos',
  homemdeferro: 'homem de ferro',
  homemaranha: 'homem aranha',
  panteranegra: 'pantera negra',
  vingadoresultimato: 'vingadores ultimato',
  capitamerica: 'capitao america',
  doutorestranho: 'doutor estranho',
  piratasdocaribe: 'piratas do caribe',
  harrypotter: 'harry potter',
  jurassicpark: 'jurassic park',
  jogosvorazes: 'jogos vorazes',
  semvoltapracasa: 'sem volta para casa',
  indianajones: 'indiana jones',
  jurassicworld: 'jurassic world',
  mundojurassico: 'mundo jurassico',
  pequenasereia: 'a pequena sereia',
  abelaefera: 'a bela e a fera',
  reileao: 'o rei leao',
  comotreinarseudragao: 'como treinar o seu dragao',
  meumalvadofavorito: 'meu malvado favorito',
  homemdasmascaradeferro: 'o homem da mascara de ferro',
  formiguinhaz: 'antz',
  ironmen: 'iron man',
  ironmans: 'iron man',
};

function expandGluedQuery(query: string): string {
  const folded = query.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const expanded = GLUED_TITLES[folded];
  return expanded || query;
}

export { expandGluedQuery };

export function apiResultToCatalogItem(r: any): CatalogItem {
  return {
    tmdbId: r.id || 0,
    title: r.title || '',
    originalTitle: r.originalTitle || '',
    overview: r.overview || '',
    posterPath: r.posterUrl || '',
    backdropPath: r.backdropUrl || null,
    year: r.year ?? null,
    rating: r.rating ?? 0,
    genres: r.genre ? [r.genre] : [],
    type: r.type === 'tv' ? ('tv' as const) : ('movie' as const),
    options: Array.isArray(r.options) && r.options.length > 0 ? r.options : undefined,
  };
}

/** Busca no catálogo (Wikipedia-backed) e normaliza para CatalogItem. */
export async function catalogSearch(query: string, signal?: AbortSignal): Promise<CatalogItem[]> {
  const q = expandGluedQuery(query.trim());
  const res = await fetch(`/api/itunes?q=${encodeURIComponent(q)}`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) throw new Error('Falha na busca do catálogo');
  const data = await res.json();
  // A API local de torrents está fora do ar → erro claro em vez de "nada achado".
  if (data.offline) throw new Error('API_OFFLINE');
  return (data.results || []).map(apiResultToCatalogItem);
}
