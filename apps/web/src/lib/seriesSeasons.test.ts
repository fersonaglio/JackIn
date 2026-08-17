import { describe, expect, it } from 'vitest';
import {
  seasonNumberFromTitle,
  seriesBaseTitle,
  episodeInfoFromOptions,
  groupSeriesSeasons,
} from './seriesSeasons';
import type { MediaOption, MovieSearchResult } from './api';

function option(id: string, sourceUrl: string, quality = '1080p'): MediaOption {
  return {
    id,
    quality,
    badge: '',
    resolution: '1920x1080',
    bitrate: '~8 Mbps P2P',
    size: '1.0 GB',
    audio: 'Stereo',
    format: 'MP4',
    sourceUrl,
  };
}

describe('seasonNumberFromTitle', () => {
  it('extrai temporada de "Season N"', () => {
    expect(seasonNumberFromTitle('Love Death and Robots Season 2')).toBe(2);
  });
  it('extrai temporada de "S02"', () => {
    expect(seasonNumberFromTitle('The Show S03')).toBe(3);
  });
  it('extrai temporada de "Temporada 1"', () => {
    expect(seasonNumberFromTitle('Série Top Temporada 1')).toBe(1);
  });
  it('retorna null sem marcador', () => {
    expect(seasonNumberFromTitle('Um Filme Qualquer')).toBeNull();
  });
});

describe('seriesBaseTitle', () => {
  it('remove o marcador de temporada', () => {
    expect(seriesBaseTitle('Love Death and Robots Season 2')).toBe('Love Death and Robots');
  });
  it('remove S01E01 mantendo a base', () => {
    expect(seriesBaseTitle('Love Death and Robots S01E01')).toBe('Love Death and Robots');
  });
});

describe('episodeInfoFromOptions', () => {
  it('conta episódios únicos pelos magnets', () => {
    const opts = [
      option('a', 'magnet:?xt=urn:btih:aa&dn=Show S01E01 1080p'),
      option('b', 'magnet:?xt=urn:btih:bb&dn=Show S01E02 1080p'),
      option('c', 'magnet:?xt=urn:btih:cc&dn=Show S01E02 720p'),
    ];
    expect(episodeInfoFromOptions(opts)).toEqual({ count: 2, maxEpisode: 2 });
  });
  it('retorna zero sem episódios', () => {
    expect(episodeInfoFromOptions([option('a', 'magnet:?xt=urn:btih:aa&dn=Show Complete')])).toEqual({ count: 0, maxEpisode: 0 });
  });
});

describe('groupSeriesSeasons', () => {
  const s1: MovieSearchResult = {
    id: 's1',
    title: 'Love Death and Robots Season 1',
    originalTitle: 'Love Death and Robots',
    year: '2019',
    overview: '',
    posterUrl: '',
    genre: '',
    rating: '',
    mediaType: 'series',
    options: [option('a', 'magnet:?xt=urn:btih:aa&dn=Show S01E01')],
  };
  const s2: MovieSearchResult = {
    id: 's2',
    title: 'Love Death and Robots Season 2',
    originalTitle: 'Love Death and Robots',
    year: '2021',
    overview: '',
    posterUrl: '',
    genre: '',
    rating: '',
    mediaType: 'series',
    options: [option('b', 'magnet:?xt=urn:btih:bb&dn=Show S02E01'), option('c', 'magnet:?xt=urn:btih:cc&dn=Show S02E02')],
  };
  const movie: MovieSearchResult = {
    id: 'm',
    title: 'Um Filme',
    originalTitle: 'A Movie',
    year: '2000',
    overview: '',
    posterUrl: '',
    genre: '',
    rating: '',
    options: [option('d', 'magnet:?xt=urn:btih:dd')],
  };

  it('agrupa temporadas em ordem e sem filmes', () => {
    const seasons = groupSeriesSeasons([s2, s1, movie]);
    expect(seasons).toBeDefined();
    expect(seasons!.map((s) => s.seasonNumber)).toEqual([1, 2]);
    expect(seasons![0].episodeCount).toBe(1);
    expect(seasons![1].episodeCount).toBe(2);
  });

  it('retorna undefined sem nenhuma série', () => {
    expect(groupSeriesSeasons([movie])).toBeUndefined();
  });

  it('mescla opções duplicadas da mesma temporada', () => {
    const dup = { ...s1, options: [option('x', 'magnet:?xt=urn:btih:aa&dn=Show S01E01')] };
    const seasons = groupSeriesSeasons([s1, dup])!;
    expect(seasons[0].options.length).toBe(1);
  });
});
