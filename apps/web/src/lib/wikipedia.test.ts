import { describe, it, expect, vi, beforeEach } from 'vitest';
import { searchCatalog, _internals } from './wikipedia';

const {
  isFilmOrTv,
  isBiographyPage,
  stripDisambiguation,
  parseYear,
  detectType,
  deriveGenre,
  looksPortuguese,
} = _internals;

function page(title: string, description = '', extract = ''): any {
  return { pageid: title.length + 1, title, description, extract };
}

describe('isFilmOrTv', () => {
  it('keeps feature films', () => {
    expect(isFilmOrTv(page('Oppenheimer (film)', '2023 film by Christopher Nolan'))).toBe(true);
    expect(isFilmOrTv(page('The Matrix', '1999 film by the Wachowskis'))).toBe(true);
    expect(isFilmOrTv(page('Casablanca (film)', '1942 film by Michael Curtiz'))).toBe(true);
  });

  it('keeps TV series and anime', () => {
    expect(isFilmOrTv(page('Breaking Bad', 'American crime drama TV series (2008–2013)'))).toBe(true);
    expect(isFilmOrTv(page('Attack on Titan (TV series)', 'Japanese anime television series'))).toBe(true);
    expect(isFilmOrTv(page('Friends', 'American television sitcom (1994–2004)'))).toBe(true);
  });

  it('filters people, disambiguation and plain entities', () => {
    expect(isFilmOrTv(page('J. Robert Oppenheimer', 'American theoretical physicist (1904–1967)'))).toBe(false);
    expect(isFilmOrTv(page('Oppenheimer (disambiguation)', 'Topics referred to by the same term'))).toBe(false);
    expect(isFilmOrTv(page('Casablanca', 'Largest city in Morocco'))).toBe(false);
  });

  it('keeps bare manga franchise pages out (no generic "series" match)', () => {
    expect(isFilmOrTv(page('Attack on Titan', 'Japanese manga series and franchise'))).toBe(false);
    expect(isFilmOrTv(page('One Piece', 'Japanese manga series by Eiichiro Oda'))).toBe(false);
  });

  it('filters conceptual franchise/trilogy pages', () => {
    expect(isFilmOrTv(page('Star Wars sequel trilogy', '2015 sequel trilogy of films'))).toBe(false);
    expect(isFilmOrTv(page('Star Wars (film series)', 'media franchise'))).toBe(false);
    expect(isFilmOrTv(page('List of Pirates of the Caribbean films', 'list of films'))).toBe(false);
  });

  it('filters biography pages about filmmakers', () => {
    // "is a Brazilian filmmaker" -> a person page, not a playable film.
    expect(isBiographyPage(page('Amácio Mazzaropi', 'is a Brazilian filmmaker and actor'))).toBe(true);
    expect(isBiographyPage(page('Roberto Drummond', 'is a Brazilian writer and journalist'))).toBe(true);
    // A film page describing a director still passes.
    expect(isBiographyPage(page('Oppenheimer (film)', '2023 film by Christopher Nolan'))).toBe(false);
    expect(isFilmOrTv(page('Oppenheimer (film)', '2023 film by Christopher Nolan'))).toBe(true);
  });

  it('routes Portuguese-looking queries to pt.wikipedia', () => {
    expect(looksPortuguese('homem de ferro')).toBe(true);
    expect(looksPortuguese('senhor dos aneis')).toBe(true);
    expect(looksPortuguese('temporada 2')).toBe(true);
    expect(looksPortuguese('oppenheimer')).toBe(false);
    expect(looksPortuguese('avatar')).toBe(false);
  });

  it('searches pt.wikipedia for Portuguese queries (no EN garbage)', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('https://pt.wikipedia.org/w/api.php')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
          query: { pages: [page('Homem de Ferro (filme)', '2008 filme americano de super-herói')] },
        }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ extract: '', description: '2008 filme' }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const items = await searchCatalog('homem de ferro');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Homem de Ferro');
    // EN Wikipedia must NOT have been contacted for this PT query.
    const enCalls = fetchMock.mock.calls.filter(([u]) => String(u).startsWith('https://en.wikipedia.org'));
    expect(enCalls).toHaveLength(0);
  });
});

describe('stripDisambiguation', () => {
  it('removes film/TV disambiguation suffixes', () => {
    expect(stripDisambiguation('Oppenheimer (film)')).toBe('Oppenheimer');
    expect(stripDisambiguation('Titanic (1997 film)')).toBe('Titanic');
    expect(stripDisambiguation('Attack on Titan (TV series)')).toBe('Attack on Titan');
    expect(stripDisambiguation('One Piece (1999 TV series)')).toBe('One Piece');
    expect(stripDisambiguation('The Office (American TV series)')).toBe('The Office');
    expect(stripDisambiguation('Avatar (2009 film)')).toBe('Avatar');
  });

  it('keeps legitimate parenthetical titles', () => {
    expect(stripDisambiguation('Sicario: Day of the Soldado')).toBe('Sicario: Day of the Soldado');
    expect(stripDisambiguation('No Time to Die')).toBe('No Time to Die');
  });
});

describe('parseYear', () => {
  it('extracts the first year from description or title', () => {
    expect(parseYear('Oppenheimer (film)', '2023 film by Christopher Nolan')).toBe(2023);
    expect(parseYear('Breaking Bad', 'American crime drama TV series (2008–2013)')).toBe(2008);
    expect(parseYear('Casablanca (film)', '1942 film by Michael Curtiz')).toBe(1942);
    expect(parseYear('Some Page', 'no years here')).toBeNull();
  });
});

describe('detectType', () => {
  it('detects tv vs movie', () => {
    expect(detectType('Oppenheimer (film)', '2023 film by Christopher Nolan')).toBe('movie');
    expect(detectType('Breaking Bad', 'American crime drama TV series (2008–2013)')).toBe('tv');
    expect(detectType('Attack on Titan (TV series)', 'Japanese anime television series')).toBe('tv');
    expect(detectType('The Matrix', '1999 film by the Wachowskis')).toBe('movie');
  });
});

describe('deriveGenre', () => {
  it('maps genre keywords to PT labels', () => {
    expect(deriveGenre('2023 epic biographical thriller film', 'Oppenheimer (film)')).toBe('Suspense');
    expect(deriveGenre('American television sitcom', 'Friends')).toBe('Sitcom');
    expect(deriveGenre('1999 film', 'The Matrix')).toBe('');
  });
});

describe('searchCatalog', () => {
  beforeEach(() => {
    _internals.cacheClear();
    vi.restoreAllMocks();
  });

  it('maps the Nolan film to a clean CatalogItem (no iTunes docs)', async () => {
    const pages = [
      page('J. Robert Oppenheimer', 'American theoretical physicist (1904–1967)'),
      page('Oppenheimer (film)', '2023 film by Christopher Nolan'),
      page('Oppenheimer (disambiguation)', 'Topics referred to by the same term'),
    ];
    const summary = {
      originalimage: { source: 'https://upload.wikimedia.org/wikipedia/en/4/4a/Oppenheimer_%28film%29.jpg?utm_source=x' },
      extract: 'Oppenheimer is a 2023 epic biographical thriller film written, co-produced, and directed by Christopher Nolan.',
      description: '2023 film by Christopher Nolan',
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: { pages } }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(summary) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const items = await searchCatalog('oppenheimer');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      title: 'Oppenheimer',
      type: 'movie',
      year: 2023,
      genre: 'Suspense',
    });
    expect(items[0].posterUrl).toBe(
      'https://upload.wikimedia.org/wikipedia/en/4/4a/Oppenheimer_%28film%29.jpg'
    );
    expect(items[0].overview).toContain('Christopher Nolan');
  });

  it('falls back to a "film"-qualified search when nothing matches', async () => {
    const search = vi.fn((url: string) => {
      const calls = search.mock.calls.length;
      if (calls === 1) {
        // first call: no film/tv pages
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: { pages: [page('Some Town', 'Largest city')] } }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: { pages: [page('Avatar (2009 film)', '2009 epic science fiction film by James Cameron')] } }) });
    });
    vi.stubGlobal('fetch', search);
    const items = await searchCatalog('avatar');
    expect(items[0]).toMatchObject({ title: 'Avatar', type: 'movie', year: 2009, genre: 'Ficção Científica' });
  });

  it('returns empty array when Wikipedia has no film/tv hit', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: { pages: [page('Nothing', 'No media here')] } }) })
    );
    expect(await searchCatalog('zzzz-nonexistent')).toEqual([]);
  });

  it('keeps items alive when a summary fails (poster empty)', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: { pages: [page('Pulp Fiction', '1994 film by Quentin Tarantino')] } }) });
      }
      return Promise.reject(new Error('network down'));
    });
    vi.stubGlobal('fetch', fetchMock);
    const items = await searchCatalog('pulp fiction');
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Pulp Fiction');
    expect(items[0].posterUrl).toBe('');
  });

  it('serves cached results without extra upstream calls', async () => {
    const pages = [page('The Godfather', '1972 film by Francis Ford Coppola')];
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ query: { pages } }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ description: '', extract: '' }) });
    });
    vi.stubGlobal('fetch', fetchMock);
    const first = await searchCatalog('the godfather');
    const callCountAfterFirst = fetchMock.mock.calls.length;
    const second = await searchCatalog('the godfather');
    expect(first[0].title).toBe('The Godfather');
    expect(second[0].title).toBe('The Godfather');
    expect(fetchMock.mock.calls.length).toBe(callCountAfterFirst);
  });

  it('returns empty without crashing when Wikipedia rate-limits', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: false, status: 429, headers: { get: () => '1' } })
    );
    expect(await searchCatalog('rate-limited-title')).toEqual([]);
  });
});
