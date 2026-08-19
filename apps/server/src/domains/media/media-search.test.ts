import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./media-search-interpret.js', () => ({
  searchMediaEnhanced: vi.fn(),
}));

import { findBetterDownloadOptions } from './media-search.js';
import { searchMediaEnhanced } from './media-search-interpret.js';

function opt(sourceUrl: string, ptConfirmed = false, quality = '1080p'): any {
  return {
    id: sourceUrl,
    quality,
    badge: '⚡ 10 Seeds',
    resolution: '1920x1080',
    bitrate: '8 Mbps',
    size: '2 GB',
    audio: ptConfirmed ? 'Dublado PT-BR' : 'Stereo',
    audioType: ptConfirmed ? 'dub' : 'unknown',
    ptConfirmed,
    hasSubtitles: false,
    format: 'MKV',
    sourceUrl,
  };
}

function mockedResults(options: any[]): void {
  (searchMediaEnhanced as any).mockResolvedValue({
    results: [{ id: 'x', title: 'Movie', posterUrl: '', options }],
  });
}

describe('findBetterDownloadOptions (requirePt)', () => {
  beforeEach(() => {
    (searchMediaEnhanced as any).mockReset();
  });

  it('com requirePt=true retorna apenas fontes PT-confirmadas reais', async () => {
    const pt1 = 'magnet:?xt=urn:btih:aaaa1111&dn=Movie.2024.1080p.DUBLADO';
    const pt2 = 'magnet:?xt=urn:btih:bbbb2222&dn=Movie.2024.1080p.DUAL';
    const eng = 'magnet:?xt=urn:btih:cccc3333&dn=Movie.2024.1080p';
    mockedResults([opt(pt1, true), opt(pt2, true), opt(eng)]);

    const res = await findBetterDownloadOptions('Movie', 4, true);
    const urls = res.map((o) => o.sourceUrl);
    expect(urls).toEqual([pt1, pt2]);
    expect(urls).not.toContain(eng);
  });

  it('sem requirePt mantém PT e não-PT reais (PT primeiro)', async () => {
    const pt = 'magnet:?xt=urn:btih:aaaa1111&dn=Movie.2024.1080p.DUBLADO';
    const eng = 'magnet:?xt=urn:btih:cccc3333&dn=Movie.2024.1080p';
    mockedResults([opt(pt, true), opt(eng)]);

    const res = await findBetterDownloadOptions('Movie', 4, false);
    expect(res.map((o) => o.sourceUrl)).toEqual([pt, eng]);
  });

  it('com requirePt, YTS/original real não entra no fallback', async () => {
    const pt = 'magnet:?xt=urn:btih:aaaa1111&dn=Movie.2024.1080p.DUBLADO';
    const yts = 'magnet:?xt=urn:btih:cccc3333&dn=Movie.2024.2160p.YTS';
    mockedResults([opt(pt, true), opt(yts)]);

    const res = await findBetterDownloadOptions('Movie', 4, true);
    expect(res.map((o) => o.sourceUrl)).toEqual([pt]);
  });

  it('com requirePt e só fonte curada PT, usa a curada como último recurso', async () => {
    const curated = 'magnet:?xt=urn:btih:dddd4444&dn=%5BDual%20%C3%81udio%5D%20Movie%202024%20limontorrents';
    mockedResults([opt(curated, true)]);

    const res = await findBetterDownloadOptions('Movie', 4, true);
    expect(res.map((o) => o.sourceUrl)).toEqual([curated]);
  });

  it('com requirePt e só fonte curada SEM PT, não retorna nada (fail-closed)', async () => {
    const curated = 'magnet:?xt=urn:btih:eeee5555&dn=Movie.2024%20limontorrents';
    mockedResults([opt(curated, false)]);

    const res = await findBetterDownloadOptions('Movie', 4, true);
    expect(res).toEqual([]);
  });
});
