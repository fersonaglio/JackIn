import { describe, it, expect, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Integration tests for the media-only schema module.
 *
 * The module computes DATA_DIR at load time from import.meta.dirname, so these
 * tests exercise the REAL module against the repo's /data dir (gitignored).
 * Each test reloads the module (fresh in-memory state) via vi.resetModules()
 * and cleans up its own rows afterwards.
 */

let createdFile = false;
const DATA_DIR = path.resolve(import.meta.dirname, '../../../../data');
const DB_PATH = path.join(DATA_DIR, 'jackin.db');

async function freshSchema() {
  vi.resetModules();
  return await import('./schema.js');
}

function columnNames(db: any, table: string): string[] {
  return db
    .exec(`PRAGMA table_info(${table})`)
    .flatMap((r: any) => r.values.map((c: any) => c[1]));
}

afterAll(() => {
  // Remove only the DB file this test suite created (fresh repos have none).
  if (createdFile && fs.existsSync(DB_PATH)) {
    fs.rmSync(DB_PATH, { force: true });
  }
});

describe('schema module', () => {
  it('getDb() throws before initDb()', async () => {
    const schema = await freshSchema();
    expect(() => schema.getDb()).toThrow(/not initialized/i);
  });

  it('initDb() creates /data/jackin.db with the media-only projects table', async () => {
    const schema = await freshSchema();
    if (!fs.existsSync(DB_PATH)) createdFile = true;

    const db = await schema.initDb();

    // DATA_DIR must point at the repo root /data (apps/server/src/db → up 4).
    expect(schema.DATA_DIR).toBe(DATA_DIR);
    expect(fs.existsSync(DB_PATH)).toBe(true);

    const projectsCols = columnNames(db, 'projects');
    for (const col of [
      'id', 'title', 'project_type', 'series_id', 'season_number',
      'episode_number', 'status', 'video_path', 'watch_progress', 'watched',
      'media_info', 'prep_state', 'prep_error', 'prep_settings_hash',
      'artifacts', 'error_message', 'progress_pct', 'progress_status',
      'created_at', 'updated_at',
    ]) {
      expect(projectsCols).toContain(col);
    }

    const historyCols = columnNames(db, 'watch_history');
    for (const col of ['id', 'project_id', 'title', 'project_type', 'watched_at', 'watch_progress', 'watched']) {
      expect(historyCols).toContain(col);
    }
  });

  it('persist() writes the DB and a fresh load reads the row back', async () => {
    const schema = await freshSchema();
    const db = await schema.initDb();

    db.run(
      'INSERT INTO projects (id, title, status, project_type) VALUES (?, ?, ?, ?)',
      ['schema-test-1', 'Persist Test', 'done', 'movie']
    );
    schema.persist();

    const reloaded = await freshSchema();
    await reloaded.initDb();
    const row = reloaded
      .getDb()
      .exec('SELECT title, status FROM projects WHERE id = ?', ['schema-test-1'])[0]?.values[0];
    expect(row).toEqual(['Persist Test', 'done']);

    // Cleanup
    reloaded.getDb().run('DELETE FROM projects WHERE id = ?', ['schema-test-1']);
    reloaded.persist();
  });

  it('persistThrottled() batches writes and flushPersist() flushes them', async () => {
    const schema = await freshSchema();
    const db = await schema.initDb();

    db.run(
      'INSERT INTO projects (id, title, status) VALUES (?, ?, ?)',
      ['schema-test-2', 'Throttled', 'pending']
    );
    schema.persistThrottled(50);

    const reloaded = await freshSchema();
    await reloaded.initDb();
    let row = reloaded.getDb().exec('SELECT title FROM projects WHERE id = ?', ['schema-test-2'])[0]?.values[0];
    // Not flushed yet — the reloaded DB snapshot predates the throttled write.
    expect(row).toBeUndefined();

    schema.flushPersist();

    const reloaded2 = await freshSchema();
    await reloaded2.initDb();
    row = reloaded2.getDb().exec('SELECT title FROM projects WHERE id = ?', ['schema-test-2'])[0]?.values[0];
    expect(row).toEqual(['Throttled']);

    reloaded2.getDb().run('DELETE FROM projects WHERE id = ?', ['schema-test-2']);
    reloaded2.persist();
  });
});
