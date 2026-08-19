import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { searchMultiMock } = vi.hoisted(() => ({ searchMultiMock: vi.fn() }));

vi.mock('moviedb-promise', () => ({
  MovieDb: class {
    searchMulti = searchMultiMock;
  },
}));

import { interpretQuery, rankCandidates } from './media-search-interpret.js';
import type { MediaSearchResult, MediaOption, InterpretedQuery } from './media-search-interpret.js';

function movieResult(overrides: Record<string, unknown> = {}): any {
  return {
    media_type: 'movie',
    original_title: 'The Lion King',
    title: 'O Rei Leão',
    release_date: '1994-06-15',
    vote_count: 5000,
    ...overrides,
  };
}

function tvResult(overrides: Record<string, unknown> = {}): any {
  return {
    media_type: 'tv',
    original_name: 'The Boys',
    name: 'The Boys',
    first_air_date: '2019-07-26',
    vote_count: 9000,
    ...overrides,
  };
}

function opt(sourceUrl: string, ptConfirmed = false): MediaOption {
  return {
    id: sourceUrl,
    quality: '1080p',
    badge: '',
    resolution: '',
    bitrate: '',
    size: '',
    audio: ptConfirmed ? 'Dublado' : 'Stereo',
    audioType: ptConfirmed ? 'dub' : 'unknown',
    ptConfirmed,
    format: 'MKV',
    sourceUrl,
  };
}

function result(title: string, options: MediaOption[], year = ''): MediaSearchResult {
  return {
    id: title,
    title,
    originalTitle: title,
    year,
    overview: '',
    posterUrl: '',
    genre: '',
    rating: '',
    options,
  };
}

describe('interpretQuery (TMDB + determinístico, sem LLM)', () => {
  beforeEach(() => {
    searchMultiMock.mockReset();
    process.env.TMDB_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.TMDB_API_KEY;
  });

  it('prioriza o mapa determinístico e NÃO chama o TMDB', async () => {
    const r = await interpretQuery('senhor dos aneis');
    expect(r.canonicalTitle).toBe('The Lord of the Rings');
    expect(r.ptTitle).toBe('senhor dos aneis');
    expect(r.confidence).toBeGreaterThan(0);
    expect(searchMultiMock).not.toHaveBeenCalled();
  });

  it('usa TMDB como fallback quando o título não está no mapa (filme)', async () => {
    searchMultiMock.mockResolvedValue({ results: [movieResult()] });
    const r = await interpretQuery('o rei leao');
    expect(r.canonicalTitle).toBe('The Lion King');
    expect(r.ptTitle).toBe('O Rei Leão');
    expect(r.year).toBe(1994);
    expect(r.mediaType).toBe('movie');
    expect(searchMultiMock).toHaveBeenCalledWith(expect.objectContaining({ query: 'o rei leao', language: 'pt-BR' }), expect.any(Object));
  });

  it('usa TMDB para série (mediaType series)', async () => {
    searchMultiMock.mockResolvedValue({ results: [tvResult()] });
    const r = await interpretQuery('os meninos');
    expect(r.canonicalTitle).toBe('The Boys');
    expect(r.mediaType).toBe('series');
  });

  it('sem chave TMDB → identidade (confidence 0), sem chamar TMDB', async () => {
    delete process.env.TMDB_API_KEY;
    const r = await interpretQuery('um filme qualquer totalmente aleatorio');
    expect(r.canonicalTitle).toBe('um filme qualquer totalmente aleatorio');
    expect(r.confidence).toBe(0);
    expect(searchMultiMock).not.toHaveBeenCalled();
  });

  it('erro do TMDB → identidade (confidence 0), sem quebrar a busca', async () => {
    searchMultiMock.mockRejectedValue(new Error('network down'));
    const r = await interpretQuery('uma obra misteriosa fora do mapa');
    expect(r.canonicalTitle).toBe('uma obra misteriosa fora do mapa');
    expect(r.confidence).toBe(0);
  });

  it('TMDB devolvendo o próprio título (EN) → identidade, mas preserva mediaType via confiança 0', async () => {
    searchMultiMock.mockResolvedValue({ results: [tvResult({ original_name: 'The Last of Us', name: 'The Last of Us' })] });
    const r = await interpretQuery('the last of us');
    expect(r.confidence).toBe(0);
    expect(r.canonicalTitle).toBe('the last of us');
  });

  it('cache em memória: segunda chamada não consulta TMDB de novo', async () => {
    searchMultiMock.mockResolvedValue({ results: [movieResult()] });
    await interpretQuery('o rei leao cachetest');
    await interpretQuery('o rei leao cachetest');
    expect(searchMultiMock).toHaveBeenCalledTimes(1);
  });
});

describe('rankCandidates (determinístico)', () => {
  it('colapsa edições/near-dups do mesmo título numa linha só (preservando PT)', async () => {
    const rows = [
      result('The Matrix', [opt('m1', true)]),
      result('The Matrix Extended', [opt('m2')]),
    ];
    const ranked = await rankCandidates('matrix', rows, null as unknown as InterpretedQuery);
    expect(ranked.length).toBe(1);
    expect(ranked[0].options.some((o) => o.ptConfirmed)).toBe(true);
  });

  it('remove grupos com sufixo/prefixo de ruído', async () => {
    const rows = [
      result('Avatar', [opt('a1', true)]),
      result('Avatar 10b r', [opt('a2')]),
      result('atv3 shang chi', [opt('a3')]),
    ];
    const ranked = await rankCandidates('avatar', rows, null as unknown as InterpretedQuery);
    const titles = ranked.map((r) => r.title);
    expect(titles).toContain('Avatar');
    expect(titles).not.toContain('Avatar 10b r');
    expect(titles).not.toContain('atv3 shang chi');
  });

  it('dedup preserva o grupo com opção PT-DUB', async () => {
    const rows = [
      result('The Mandalorian and Grogu', [opt('sem-dub')]),
      result('Star Wars The Mandalorian and Grogu', [opt('com-dub', true)]),
    ];
    const ranked = await rankCandidates('the mandalorian', rows, null as unknown as InterpretedQuery);
    expect(ranked.length).toBe(1);
    expect(ranked[0].options.some((o) => o.ptConfirmed)).toBe(true);
  });

  it('com <2 resultados devolve inalterado', async () => {
    const rows = [result('Solo', [opt('s1')])];
    const ranked = await rankCandidates('solo', rows, null as unknown as InterpretedQuery);
    expect(ranked).toEqual(rows);
  });
});
