import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

/**
 * JackIn — schema SQLite media-only (sql.js, arquivo único em /data).
 *
 * Colunas de projects: apenas o necessário para o catálogo de mídia
 * (filmes/séries) e o pipeline de download/prepare/playback. Nada de cuts,
 * faceless, publish ou analytics.
 *
 * DATA_DIR pode ser sobrescrito via JACKIN_DATA_DIR (usado no Dockerfile para
 * apontar para o volume /data).
 */
export const DATA_DIR = process.env.JACKIN_DATA_DIR
  ? path.resolve(process.env.JACKIN_DATA_DIR)
  : path.resolve(import.meta.dirname, '../../../../data');
const DB_PATH = path.join(DATA_DIR, 'jackin.db');

let db: any;

export async function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      youtube_url TEXT DEFAULT '',
      title TEXT,
      status TEXT DEFAULT 'pending',
      project_type TEXT DEFAULT 'movie',
      faceless_config TEXT DEFAULT NULL,
      series_id TEXT DEFAULT NULL,
      season_number INTEGER DEFAULT NULL,
      episode_number INTEGER DEFAULT NULL,
      video_path TEXT DEFAULT NULL,
      watch_progress REAL DEFAULT 0,
      watched INTEGER DEFAULT 0,
      media_info TEXT DEFAULT NULL,
      prep_state TEXT DEFAULT 'none',
      prep_error TEXT DEFAULT NULL,
      prep_settings_hash TEXT DEFAULT NULL,
      artifacts TEXT DEFAULT NULL,
      error_message TEXT DEFAULT NULL,
      progress_pct REAL DEFAULT NULL,
      progress_status TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_projects_series ON projects(series_id, season_number, episode_number)');

  db.run(`
    CREATE TABLE IF NOT EXISTS watch_history (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      title TEXT NOT NULL,
      project_type TEXT DEFAULT 'movie',
      series_id TEXT,
      season_number INTEGER,
      episode_number INTEGER,
      poster_url TEXT,
      watched_at TEXT DEFAULT (datetime('now')),
      watch_progress REAL DEFAULT 0,
      watched INTEGER DEFAULT 1
    );
  `);

  save();
  return db;
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

export function getDb() {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function persist() {
  save();
}

// Persist throttled: grava no máximo uma vez a cada intervalMs.
// O último estado pendente é garantido no flush() (chamar em shutdown/close).
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let persistDirty = false;
const PERSIST_INTERVAL_MS = 2000;

export function persistThrottled(intervalMs: number = PERSIST_INTERVAL_MS) {
  persistDirty = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    if (persistDirty) {
      persistDirty = false;
      persist();
    }
  }, intervalMs);
}

export function flushPersist() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  if (persistDirty) {
    persistDirty = false;
    persist();
  }
}
