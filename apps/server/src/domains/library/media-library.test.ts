import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { v4 as uuid } from 'uuid';
import { initDb, getDb, persist, flushPersist } from '../../db/schema.js';
import mediaLibraryRouter from './media-library.js';

/**
 * Integration tests for the extracted media-library router.
 *
 * Uses the REAL schema module (sql.js DB at /data/jackin.db, gitignored).
 * Each test inserts its own rows and afterAll removes them, so the repo DB
 * stays clean between runs.
 */

let server: any;
let base: string;
const createdIds: string[] = [];
let titleCounter = 0;

function insertProject(overrides: Record<string, any> = {}): any {
  const db = getDb();
  const id = uuid();
  const row = {
    id,
    title: `Test Movie ${titleCounter++}`,
    status: 'done',
    project_type: 'movie',
    series_id: null,
    season_number: null,
    episode_number: null,
    video_path: null,
    watch_progress: 0,
    watched: 0,
    ...overrides,
  };
  db.run(
    'INSERT INTO projects (id, title, status, project_type, series_id, season_number, episode_number, video_path, watch_progress, watched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [row.id, row.title, row.status, row.project_type, row.series_id, row.season_number, row.episode_number, row.video_path, row.watch_progress, row.watched]
  );
  persist();
  createdIds.push(row.id);
  return row;
}

beforeAll(async () => {
  await initDb();
  const app = express();
  app.use(express.json());
  app.use('/api/media-library', mediaLibraryRouter);
  server = app.listen(0);
  const port = (server.address() as any).port;
  base = `http://127.0.0.1:${port}/api/media-library`;
});

afterAll(async () => {
  const db = getDb();
  for (const id of createdIds) {
    db.run('DELETE FROM watch_history WHERE project_id = ?', [id]);
    db.run('DELETE FROM projects WHERE id = ?', [id]);
  }
  persist();
  flushPersist();
  server?.close();
});

describe('GET /api/media-library', () => {
  it('heals a downloading project stuck at 95% using the real % from progress_status', async () => {
    const row = insertProject({
      title: 'Love, Death & Robots (T4)',
      status: 'downloading',
      project_type: 'series',
      season_number: 4,
    });
    getDb().run(
      'UPDATE projects SET progress_pct = ?, progress_status = ? WHERE id = ?',
      [95, 'Baixando 1080p Full HD (Torrent) - 36.0% (⚡ 3.9 MB/s) [SD:1 CN:11]', row.id]
    );
    persist();

    const res = await fetch(`${base}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    const proj = body.find((p: any) => p.id === row.id);
    expect(proj).toBeDefined();
    expect(proj.progressPct).toBe(36);
    expect(proj.status).toBe('downloading');
  });

  it('keeps progressPct for a real 100% (done) project unchanged', async () => {
    const row = insertProject({ title: 'Finished Movie' });
    getDb().run(
      'UPDATE projects SET progress_pct = ?, progress_status = ? WHERE id = ?',
      [100, 'Concluído e Validado (Seguro)', row.id]
    );
    persist();

    const res = await fetch(`${base}`);
    const body = await res.json();
    const proj = body.find((p: any) => p.id === row.id);
    expect(proj.progressPct).toBe(100);
  });
});

describe('GET /api/media-library/:id', () => {
  it('returns only media fields for an existing project', async () => {
    const row = insertProject({ title: 'Interstellar (2014)' });
    const res = await fetch(`${base}/${row.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      id: row.id,
      title: 'Interstellar (2014)',
      status: 'done',
      projectType: 'movie',
      videoPath: null,
      watchProgress: 0,
      watched: 0,
    });
    // Non-media fields must not leak into the response.
    expect(body.youtubeUrl).toBeUndefined();
    expect(body.transcription).toBeUndefined();
    expect(body.hashtags).toBeUndefined();
    expect(body.facelessConfig).toBeUndefined();
  });

  it('returns 404 for an unknown id', async () => {
    const res = await fetch(`${base}/${uuid()}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/media-library/:id/progress', () => {
  it('returns position and watched state', async () => {
    const row = insertProject({ watch_progress: 42, watched: 1 });
    const res = await fetch(`${base}/${row.id}/progress`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ position: 42, watched: true });
  });

  it('returns 404 for an unknown id', async () => {
    const res = await fetch(`${base}/${uuid()}/progress`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/media-library/:id/progress', () => {
  it('rejects a negative position with 400', async () => {
    const row = insertProject();
    const res = await fetch(`${base}/${row.id}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: -5 }),
    });
    expect(res.status).toBe(400);
  });

  it('persists position above 60s into watch history', async () => {
    const row = insertProject({ watch_progress: 0 });
    const res = await fetch(`${base}/${row.id}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: 90 }),
    });
    expect(res.status).toBe(200);
    flushPersist();

    const db = getDb();
    const history = db.exec(
      'SELECT watch_progress, watched FROM watch_history WHERE project_id = ?',
      [row.id]
    )[0]?.values[0];
    expect(history).toBeTruthy();
    expect(history[0]).toBe(90);
  });
});

describe('PUT /api/media-library/:id/watched', () => {
  it('rejects a non-boolean watched value with 400', async () => {
    const row = insertProject();
    const res = await fetch(`${base}/${row.id}/watched`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watched: 'yes' }),
    });
    expect(res.status).toBe(400);
  });

  it('marks watched and records history', async () => {
    const row = insertProject({ watched: 0 });
    const res = await fetch(`${base}/${row.id}/watched`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watched: true }),
    });
    expect(res.status).toBe(200);

    const db = getDb();
    const proj = db.exec('SELECT watched FROM projects WHERE id = ?', [row.id])[0]?.values[0];
    expect(proj).toEqual([1]);

    const history = db.exec(
      'SELECT watched FROM watch_history WHERE project_id = ?',
      [row.id]
    )[0]?.values[0];
    expect(history).toEqual([1]);
  });
});

describe('GET /api/media-library/history/all', () => {
  it('includes watched projects synced from projects', async () => {
    const row = insertProject({ title: 'Dune (2021)', watched: 1 });
    const res = await fetch(`${base}/history/all`);
    expect(res.status).toBe(200);
    const items = await res.json();

    const match = items.find((i: any) => i.projectId === row.id);
    expect(match).toBeTruthy();
    expect(match).toMatchObject({
      title: 'Dune (2021)',
      projectType: 'movie',
      isDownloaded: true,
    });
  });

  it('removes an entry via DELETE /history/:id', async () => {
    const row = insertProject({ title: 'Delete Me', watched: 1 });
    const db = getDb();
    // GET /history/all syncs watched projects into watch_history first.
    const syncRes = await fetch(`${base}/history/all`);
    expect(syncRes.status).toBe(200);
    const historyId = db.exec(
      'SELECT id FROM watch_history WHERE project_id = ?',
      [row.id]
    )[0]?.values[0]?.[0] as string;
    expect(historyId).toBeTruthy();

    const res = await fetch(`${base}/history/${historyId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const gone = db.exec('SELECT id FROM watch_history WHERE id = ?', [historyId])[0]?.values.length || 0;
    expect(gone).toBe(0);
  });
});

describe('GET /api/media-library/:id/tracks', () => {
  it('returns empty audio/subtitles for a project without artifacts', async () => {
    const row = insertProject();
    const res = await fetch(`${base}/${row.id}/tracks`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.audio)).toBe(true);
    expect(Array.isArray(body.subtitles)).toBe(true);
  });

  it('deduplica streams do mesmo idioma (uma faixa de áudio por idioma)', async () => {
    const row = insertProject();
    // media_info com DOIS streams de áudio em inglês (AAC stereo + AC3 5.1) e
    // legendas en/ukr duplicadas — o menu não pode listar "Inglês" 3x.
    getDb().run(
      'UPDATE projects SET media_info = ? WHERE id = ?',
      [
        JSON.stringify({
          audio: [
            { index: 1, language: 'eng', codec: 'aac', channels: 2 },
            { index: 2, language: 'eng', codec: 'ac3', channels: 6, title: 'Original' },
          ],
          subtitles: [
            { index: 3, language: 'eng', codec: 'subrip' },
            { index: 4, language: 'eng', codec: 'subrip' },
            { index: 5, language: 'ukr', codec: 'subrip' },
            { index: 6, language: 'ukr', codec: 'subrip' },
          ],
        }),
        row.id,
      ]
    );
    persist();

    const res = await fetch(`${base}/${row.id}/tracks`);
    const body = await res.json();
    expect(body.audio).toHaveLength(1);
    expect(body.audio[0]).toMatchObject({ language: 'en', codec: 'ac3', channels: 6, title: 'Original' });
    expect(body.subtitles.map((s: any) => s.language).sort()).toEqual(['en', 'ukr']);
  });
});

describe('GET /api/media-library/:id/video', () => {
  it('returns 425 while the master is still downloading (no artifact)', async () => {
    const row = insertProject({ status: 'downloading' });
    const res = await fetch(`${base}/${row.id}/video`);
    expect(res.status).toBe(425);
    const body = await res.json();
    expect(body.error).toBe('video_processing');
  });

  it('rejects an invalid project id with 400', async () => {
    const res = await fetch(`${base}/not-a-uuid/video`);
    expect(res.status).toBe(400);
  });
});

describe('GET /api/media-library/:id/subtitles', () => {
  it('returns an empty WEBVTT when no subtitles exist', async () => {
    const row = insertProject({ video_path: null });
    const res = await fetch(`${base}/${row.id}/subtitles`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/vtt');
    expect(await res.text()).toContain('WEBVTT');
  });
});

describe('GET /api/media-library/:id/cast', () => {
  it('reports not available for a project without a cast-safe file', async () => {
    const row = insertProject();
    const res = await fetch(`${base}/${row.id}/cast`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ available: false, target: 'h264' });
  });
});

describe('series endpoints', () => {
  it('GET /series/:seriesId returns episodes ordered by season/episode', async () => {
    insertProject({ title: 'S01E01', series_id: 'ser-1', season_number: 1, episode_number: 1 });
    insertProject({ title: 'S01E02', series_id: 'ser-1', season_number: 1, episode_number: 2 });
    insertProject({ title: 'S02E01', series_id: 'ser-1', season_number: 2, episode_number: 1 });

    const res = await fetch(`${base}/series/ser-1`);
    expect(res.status).toBe(200);
    const eps = await res.json();
    expect(eps.map((e: any) => e.title)).toEqual(['S01E01', 'S01E02', 'S02E01']);
  });

  it('DELETE /series/:seriesId removes every episode and returns the count', async () => {
    const e1 = insertProject({ title: 'E1', series_id: 'ser-del', season_number: 1, episode_number: 1 });
    const e2 = insertProject({ title: 'E2', series_id: 'ser-del', season_number: 1, episode_number: 2 });

    const res = await fetch(`${base}/series/ser-del?deleteFiles=false`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, count: 2 });

    const db = getDb();
    const remaining = db.exec('SELECT id FROM projects WHERE id IN (?, ?)', [e1.id, e2.id])[0]?.values.length || 0;
    expect(remaining).toBe(0);
  });
});

describe('DELETE /api/media-library/:id', () => {
  it('removes the project row and returns success', async () => {
    const row = insertProject({ title: 'To Delete' });
    const res = await fetch(`${base}/${row.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });

    const db = getDb();
    const remaining = db.exec('SELECT id FROM projects WHERE id = ?', [row.id])[0]?.values.length || 0;
    expect(remaining).toBe(0);
  });
});

describe('pause/resume', () => {
  it('POST /:id/pause returns 404 when no torrent is active', async () => {
    const row = insertProject({ status: 'downloading' });
    const res = await fetch(`${base}/${row.id}/pause`, { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('POST /:id/resume returns 400 when no torrent is active', async () => {
    const row = insertProject({ status: 'paused' });
    const res = await fetch(`${base}/${row.id}/resume`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
