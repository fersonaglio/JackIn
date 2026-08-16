import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  fetchApi,
  listProjects,
  searchMediaSources,
  downloadMediaMovie,
  pauseMediaDownload,
  resumeMediaDownload,
  retryMediaDownload,
  fetchPtBrSubtitles,
  deleteProject,
  deleteSeries,
  pauseProjectDownload,
  resumeProjectDownload,
  cancelProjectDownload,
  saveWatchProgress,
  getWatchProgress,
  markWatched,
  getSeriesEpisodes,
  getWatchHistory,
  deleteWatchHistoryItem,
  importSeason,
  getProjectVideoUrl,
  getProjectThumbnailUrl,
} from './api';

const API_URL = 'http://localhost:3001/api';

function mockFetchOk(body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => body,
      text: async () => JSON.stringify(body),
    })
  );
}

function mockFetchError(status: number) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: false,
      status,
      json: async () => ({}),
      text: async () => `HTTP ${status}`,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchApi', () => {
  it('requests GET with the API base URL and returns parsed JSON', async () => {
    mockFetchOk({ items: [1, 2] });
    const data = await fetchApi<{ items: number[] }>('/projects');
    expect(data.items).toEqual([1, 2]);
    expect(global.fetch).toHaveBeenCalledWith(
      `${API_URL}/projects`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('throws on non-ok responses', async () => {
    mockFetchError(500);
    await expect(fetchApi('/projects')).rejects.toThrow('API error: 500');
  });

  it('relays the caller signal to the request', async () => {
    mockFetchOk({ ok: true });
    const controller = new AbortController();
    await fetchApi('/projects', { signal: controller.signal });
    const call = vi.mocked(global.fetch).mock.calls[0];
    expect(call[1]).toHaveProperty('signal');
    expect(call[1]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe('listProjects', () => {
  it('lists all projects without a type filter', async () => {
    mockFetchOk([]);
    await listProjects();
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects`);
  });

  it('passes the type filter as a query param', async () => {
    mockFetchOk([]);
    await listProjects('movie');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects?type=movie`);
  });
});

describe('searchMediaSources', () => {
  it('builds q, audio, year and ptTitle query params', async () => {
    mockFetchOk({ query: 'matrix', results: [] });
    await searchMediaSources('Matrix', 'ptbr', { year: 1999 }, 'Matrix Reloaded');
    const url = String(vi.mocked(global.fetch).mock.calls[0][0]);
    expect(url).toContain(`${API_URL}/media-search/search?`);
    expect(url).toContain('q=Matrix');
    expect(url).toContain('audio=ptbr');
    expect(url).toContain('year=1999');
    expect(url).toContain('ptTitle=Matrix+Reloaded');
  });
});

describe('download controls', () => {
  it('downloads a media movie with POST', async () => {
    mockFetchOk({ id: 'p1', title: 'Matrix', status: 'downloading', quality: '4K' });
    await downloadMediaMovie('Matrix', '4K', 'magnet:?xt=abc', 'http://img/poster.jpg');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/media-search/download`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({
        title: 'Matrix',
        quality: '4K',
        sourceUrl: 'magnet:?xt=abc',
        posterUrl: 'http://img/poster.jpg',
      }),
    });
  });

  it('pauses a media download with POST', async () => {
    mockFetchOk({ id: 'p1', status: 'paused' });
    await pauseMediaDownload('p1');
    expect(vi.mocked(global.fetch).mock.calls[0]).toEqual([
      `${API_URL}/media-search/pause/p1`,
      expect.objectContaining({ method: 'POST' }),
    ]);
  });

  it('resumes a media download with POST', async () => {
    mockFetchOk({ id: 'p1', status: 'downloading' });
    await resumeMediaDownload('p1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/media-search/resume/p1`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('retries a media download with POST', async () => {
    mockFetchOk({ id: 'p1', status: 'downloading' });
    await retryMediaDownload('p1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/media-search/retry/p1`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('pauses, resumes and cancels project downloads via POST', async () => {
    mockFetchOk({ success: true, message: 'ok' });
    await pauseProjectDownload('p1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/p1/pause`);
    mockFetchOk({ success: true, message: 'ok' });
    await resumeProjectDownload('p1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/p1/resume`);
    mockFetchOk({ success: true, message: 'ok' });
    await cancelProjectDownload('p1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/p1/cancel`);
  });
});

describe('subtitles', () => {
  it('fetches PT-BR subtitles for a project', async () => {
    mockFetchOk({ ok: true });
    await fetchPtBrSubtitles('p1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/media-search/subtitles/p1`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });
});

describe('watch progress', () => {
  it('saves watch progress with PUT', async () => {
    mockFetchOk({ ok: true });
    await saveWatchProgress('p1', 42);
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/p1/progress`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ position: 42 }),
    });
  });

  it('reads watch progress with GET', async () => {
    mockFetchOk({ position: 42, watched: false });
    const result = await getWatchProgress('p1');
    expect(result).toEqual({ position: 42, watched: false });
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/p1/progress`);
  });

  it('marks a project as watched with PUT', async () => {
    mockFetchOk({ ok: true });
    await markWatched('p1', true);
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/p1/watched`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ method: 'PUT' });
  });
});

describe('library', () => {
  it('fetches series episodes', async () => {
    mockFetchOk([]);
    await getSeriesEpisodes('s1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/series/s1`);
  });

  it('fetches watch history', async () => {
    mockFetchOk([]);
    await getWatchHistory();
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/history/all`);
  });

  it('deletes a watch history item', async () => {
    mockFetchOk(undefined);
    await deleteWatchHistoryItem('h1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/history/h1`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('deletes a project with deleteFiles flag', async () => {
    mockFetchOk(undefined);
    await deleteProject('p1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/p1?deleteFiles=true`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ method: 'DELETE' });
  });

  it('deletes a series with deleteFiles flag', async () => {
    mockFetchOk({ success: true, count: 5 });
    const result = await deleteSeries('s1');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/series/s1?deleteFiles=true`);
    expect(result).toEqual({ success: true, count: 5 });
  });

  it('imports a season', async () => {
    mockFetchOk({ message: 'ok', projects: [] });
    await importSeason('ptbr');
    expect(vi.mocked(global.fetch).mock.calls[0][0]).toBe(`${API_URL}/projects/import-season`);
    expect(vi.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ method: 'POST' });
  });

  it('builds project video and thumbnail URLs', () => {
    expect(getProjectVideoUrl('p1')).toBe(`${API_URL}/projects/p1/video`);
    expect(getProjectThumbnailUrl('p1')).toBe(`${API_URL}/projects/p1/thumbnail`);
  });
});
