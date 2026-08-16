import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './route';
import { searchCatalog } from '@/lib/wikipedia';

vi.mock('@/lib/wikipedia', async () => {
  const actual = await vi.importActual('@/lib/wikipedia') as typeof import('@/lib/wikipedia');
  return { ...actual, searchCatalog: vi.fn() };
});

const mockedSearchCatalog = searchCatalog as unknown as ReturnType<typeof vi.fn>;

const EN_WIKI = [
  {
    id: 1,
    title: 'Pirates of the Caribbean: On Stranger Tides',
    overview: 'A 2011 American fantasy swashbuckler film.',
    posterUrl: 'https://upload.wikimedia.org/wikipedia/en/x.jpg',
    backdropUrl: 'https://upload.wikimedia.org/wikipedia/en/x.jpg',
    year: 2011,
    genre: 'Fantasia',
    rating: 8.5,
    type: 'movie',
  },
];

const PT_TORRENT = {
  query: 'piratas do caribe',
  results: [
    {
      id: 'torrent-abc',
      title: 'Piratas do Caribe: Navegando em Águas Misteriosas',
      originalTitle: 'Pirates of the Caribbean: On Stranger Tides',
      overview: 'Jack Sparrow encontra Penélope Cruz.',
      posterUrl: 'https://image.tmdb.org/t/p/w500/x.jpg',
      backdropUrl: 'https://image.tmdb.org/t/p/w1280/y.jpg',
      year: '2011',
      genre: 'Aventura / Fantasia',
      rating: '',
      mediaType: 'movie',
      options: [{ id: '4k-a', sourceUrl: 'magnet:?xt=urn:btih:aaaa', quality: '4K' }],
      ptUnavailable: false,
    },
  ],
};

describe('GET /api/itunes merge', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedSearchCatalog.mockReset();
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api';
  });

  it('merges EN Wikipedia + PT torrent into ONE card, PT wins', async () => {
    mockedSearchCatalog.mockResolvedValue(EN_WIKI);
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(PT_TORRENT) }),
    ));

    const res = await GET(new Request('http://localhost/api/itunes?q=piratas%20do%20caribe'));
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    const card = data.results[0];
    // PT/TMDB row won (has options) -> PT title + TMDB backdrop on the hero.
    expect(card.title).toBe('Piratas do Caribe: Navegando em Águas Misteriosas');
    expect(card.posterUrl).toBe('https://image.tmdb.org/t/p/w500/x.jpg');
    expect(card.backdropUrl).toBe('https://image.tmdb.org/t/p/w1280/y.jpg');
    expect(card.options).toHaveLength(1);
  });

  it('keeps wiki-only rows when there is no torrent match', async () => {
    mockedSearchCatalog.mockResolvedValue(EN_WIKI);
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ results: [] }) }),
    ));

    const res = await GET(new Request('http://localhost/api/itunes?q=pirates%20of%20the%20caribbean'));
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].title).toBe('Pirates of the Caribbean: On Stranger Tides');
    expect(data.results[0].options).toBeUndefined();
  });

  it('collapses a franchise wiki page (tv, no year) into the movie with a year', async () => {
    const franchiseWiki = [
      {
        id: 9,
        title: 'Guerra nas Estrelas',
        overview: 'Franquia de filmes e séries de ficção científica.',
        posterUrl: 'https://upload.wikimedia.org/wikipedia/pt/x.jpg',
        backdropUrl: 'https://upload.wikimedia.org/wikipedia/pt/x.jpg',
        year: null,
        genre: '',
        rating: 8.5,
        type: 'tv',
      },
    ];
    const starWars1977 = {
      query: 'star wars',
      results: [
        {
          id: 'torrent-sw1',
          title: 'Guerra nas Estrelas',
          originalTitle: 'Star Wars',
          overview: 'Uma galáxia muito distante.',
          posterUrl: 'https://image.tmdb.org/t/p/w500/sw.jpg',
          backdropUrl: 'https://image.tmdb.org/t/p/w1280/swb.jpg',
          year: '1977',
          genre: 'Aventura',
          rating: '',
          mediaType: 'movie',
          options: [{ id: 'sw-4k', sourceUrl: 'magnet:?xt=urn:btih:sw1977', quality: '4K' }],
        },
      ],
    };
    mockedSearchCatalog.mockResolvedValue(franchiseWiki);
    vi.stubGlobal('fetch', vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(starWars1977) }),
    ));

    const res = await GET(new Request('http://localhost/api/itunes?q=star%20wars'));
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    const card = data.results[0];
    expect(card.title).toBe('Guerra nas Estrelas');
    expect(card.year).toBe(1977);
    expect(card.type).toBe('movie');
    expect(card.options).toHaveLength(1);
  });
});
