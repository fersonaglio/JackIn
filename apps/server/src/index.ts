import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'fs';
import path from 'path';
import { initDb, getDb } from './db/schema.js';
import mediaSearchRouter, { reconcileMovieStatus } from './domains/media/media-search.js';
import mediaLibraryRouter from './domains/library/media-library.js';
import { reconcileProjectMedia } from './services/media-service.js';
import { getPrimaryLanIp } from './services/network.js';

// Load environment variables from the workspace root .env file
try {
  const envPath = path.resolve(import.meta.dirname, '../../../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^([\w.\-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
        process.env[key] = value;
      }
    }
    console.log('[JackIn] 🔑 Loaded environment variables from root .env');
  } else {
    console.warn('[JackIn] ⚠️ No .env file found at workspace root:', envPath);
  }
} catch (error) {
  console.error('[JackIn] ❌ Failed to load .env file:', error);
}

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/lan-ip', (_req, res) => {
  const lanIp = getPrimaryLanIp();
  if (!lanIp) {
    res.status(500).json({ error: 'no_lan_ip' });
    return;
  }
  res.json({ lanIp, port: Number(PORT) });
});

app.use('/api/media-search', mediaSearchRouter);
app.use('/api/media-library', mediaLibraryRouter);
// O front-end JackIn consome /api/projects/* (URLs montadas pelo player, cards
// da biblioteca, faixas, cast, legendas, progresso, séries, histórico). O mesmo
// router também é exposto em /api/media-library para a API documentada.
app.use('/api/projects', mediaLibraryRouter);

// After a restart, projects stuck in downloading/preparing are reconciled and
// missing playback artifacts are regenerated — media-only, same as the source monorepo.
async function reconcileStuckDownloads() {
  try {
    const db = getDb();
    const rows = db.exec(
      "SELECT id FROM projects WHERE status IN ('downloading', 'preparing')"
    )[0]?.values || [];
    for (const r of rows) {
      reconcileMovieStatus(r[0] as string);
    }
    if (rows.length > 0) {
      console.log(`[JackIn] Reconciliados ${rows.length} projeto(s) pendentes de restart.`);
    }
    const doneRows = db.exec(
      "SELECT id FROM projects WHERE status = 'done' AND prep_state != 'done'"
    )[0]?.values || [];
    for (const r of doneRows) {
      reconcileProjectMedia(r[0] as string);
    }
    if (doneRows.length > 0) {
      console.log(`[JackIn] Reconciliados ${doneRows.length} artefato(s) de playback faltantes.`);
    }
  } catch (err) {
    console.error('[JackIn] Erro na reconciliação de downloads:', err);
  }
}

async function start() {
  await initDb();
  await reconcileStuckDownloads();
  app.listen(PORT, () => {
    console.log(`[JackIn] 🚀 Server running on http://localhost:${PORT}`);
  });
}

start();
