import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { getDb, persist, persistThrottled, DATA_DIR } from '../../db/schema.js';
import { existsSync, rmSync, readdirSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { progressEvents } from '../../services/progress-events.js';
import { resolveVideoFile, getProjectMedia, prepareProject, isPreparing, resolveCastFile, listCastAudioTracks, type Target } from '../../services/media-service.js';
import { TRACKERS_LIST } from '../media/trackers.js';
import { LANG_TO_CODES, codeToLang } from '../../services/language-map.js';
import { FFMPEG_BIN } from '../../services/binary-paths.js';

const router = Router();

export function recordWatchHistory(projectId: string) {
  try {
    const db = getDb();
    const result = db.exec(
      'SELECT title, project_type, series_id, season_number, episode_number, watch_progress, watched FROM projects WHERE id = ?',
      [projectId]
    );
    const row = result[0]?.values[0];
    if (!row) return;

    const title = (row[0] as string) || 'Mídia';
    const projectType = (row[1] as string) || 'movie';
    const seriesId = row[2] as string | null;
    const seasonNumber = row[3] as number | null;
    const episodeNumber = row[4] as number | null;
    const watchProgress = (row[5] as number) || 0;
    const watched = (row[6] as number) === 1 ? 1 : 0;

    if (watched !== 1 && watchProgress < 60) return;

    const historyId = uuid();
    const existing = db.exec(
      'SELECT id FROM watch_history WHERE project_id = ? OR (title = ? AND COALESCE(season_number, -1) = COALESCE(?, -1) AND COALESCE(episode_number, -1) = COALESCE(?, -1))',
      [projectId, title, seasonNumber ?? -1, episodeNumber ?? -1]
    );
    const existingId = existing[0]?.values[0]?.[0] as string | undefined;

    if (existingId) {
      db.run(
        'UPDATE watch_history SET watched = ?, watch_progress = ?, watched_at = datetime("now") WHERE id = ?',
        [watched, watchProgress, existingId]
      );
    } else {
      db.run(
        'INSERT INTO watch_history (id, project_id, title, project_type, series_id, season_number, episode_number, watched_at, watch_progress, watched) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"), ?, ?)',
        [historyId, projectId, title, projectType, seriesId, seasonNumber, episodeNumber, watchProgress, watched]
      );
    }
    persist();
  } catch (err: any) {
    console.error(`[JackIn] Erro ao gravar histórico de assistidos para ${projectId}:`, err.message);
  }
}

// Lista a biblioteca de mídia (projetos movie/series). Suporta ?type=movie|series.
router.get('/', (req: Request, res: Response) => {
  const typeFilter = String(req.query.type || '').toLowerCase();
  const db = getDb();
  const filtered = typeFilter === 'movie' || typeFilter === 'series';
  const where = filtered ? 'WHERE project_type = ?' : "WHERE project_type IN ('movie','series')";
  const params = filtered ? [typeFilter] : [];
  const result = db.exec(
    `SELECT id, youtube_url, title, status, error_message, created_at, video_path,
            COALESCE(project_type,'movie') as project_type, faceless_config,
            series_id, season_number, episode_number, watch_progress, watched,
            progress_pct, progress_status
     FROM projects ${where} ORDER BY created_at DESC`,
    params
  );
  const rows = result[0]?.values || [];
  res.json(
    rows.map((r: any[]) => {
      let facelessConfig: any = null;
      if (r[8]) {
        try {
          facelessConfig = typeof r[8] === 'string' ? JSON.parse(r[8] as string) : r[8];
        } catch {}
      }
      const status = String(r[3] || '');
      const progressStatus = (r[15] as string | null) || null;
      let progressPct = r[14] as number | null;
      // Heal: um download em andamento nunca fica preso em 95% por linha de
      // metadados do aria2 (que prendeu o clamp em 95 cedo). Se o banco ainda
      // tem 95+ mas o status mostra o % real, devolve o valor real (máx. 94) —
      // a UI não engana a barra de progresso.
      if (status === 'downloading' && progressPct != null && progressPct >= 95 && progressStatus) {
        const m = progressStatus.match(/- ([\d.]+)%/);
        if (m) {
          const real = parseFloat(m[1]);
          if (Number.isFinite(real) && real < 95) {
            progressPct = Math.max(0, Math.min(94, Math.round(real)));
          }
        }
      }
      return {
        id: r[0],
        youtubeUrl: r[1],
        title: r[2],
        status,
        errorMessage: r[4],
        createdAt: r[5],
        videoPath: r[6],
        projectType: r[7],
        facelessConfig,
        seriesId: r[9] as string | null,
        seasonNumber: r[10] as number | null,
        episodeNumber: r[11] as number | null,
        watchProgress: r[12] as number | null,
        watched: r[13] as number | null,
        progressPct,
        progressStatus,
      };
    })
  );
});

router.get('/series/:seriesId', (req: Request, res: Response) => {
  const seriesId = String(req.params.seriesId);
  const db = getDb();
  const result = db.exec(
    'SELECT id, title, status, error_message, created_at, ' +
    'COALESCE(project_type, \'movie\') as project_type, ' +
    'season_number, episode_number, watch_progress, watched ' +
    'FROM projects WHERE series_id = ? ORDER BY season_number ASC, episode_number ASC',
    [seriesId]
  );
  const rows = result[0]?.values || [];
  const episodes = rows.map((row: any[]) => ({
    id: row[0],
    title: row[1],
    status: row[2],
    errorMessage: row[3],
    createdAt: row[4],
    projectType: row[5],
    seasonNumber: row[6] as number | null,
    episodeNumber: row[7] as number | null,
    watchProgress: row[8] as number | null,
    watched: (row[9] as number) === 1,
  }));
  res.json(episodes);
});

router.delete('/series/:seriesId', async (req: Request, res: Response) => {
  const seriesId = String(req.params.seriesId);
  const db = getDb();
  const deleteFiles = req.query.deleteFiles !== 'false';

  const result = db.exec(
    'SELECT id FROM projects WHERE series_id = ? OR id = ?',
    [seriesId, seriesId]
  );
  const rows = result[0]?.values || [];
  const projectIds = rows.map((r: any[]) => String(r[0]));

  for (const pid of projectIds) {
    try {
      const { cancelTorrent } = await import('../media/torrent-downloader.js');
      cancelTorrent(pid);
    } catch (err) {}

    try {
      const { cancelMovieDownload } = await import('../media/media-search.js');
      cancelMovieDownload(pid);
    } catch (err) {}

    try {
      const { cancelPreparation } = await import('../../services/media-service.js');
      cancelPreparation(pid);
    } catch (err) {}

    recordWatchHistory(pid);

    db.run('DELETE FROM projects WHERE id = ?', [pid]);

    if (deleteFiles) {
      const projectDir = `${DATA_DIR}/projects/${pid}`;
      if (existsSync(projectDir)) {
        console.log(`[JackIn] Removendo diretório do episódio: ${projectDir}`);
        try {
          rmSync(projectDir, { recursive: true, force: true });
        } catch (err: any) {
          console.error(`[JackIn] ⚠️ Falha ao remover diretório ${projectDir}:`, err.message);
        }
      }
    }
  }

  persist();
  res.json({ success: true, count: projectIds.length });
});

router.get('/history/all', (_req: Request, res: Response) => {
  const db = getDb();
  try {
    const watchedProjects = db.exec(`
      SELECT id, title, project_type, series_id, season_number, episode_number, watch_progress, watched, created_at
      FROM projects
      WHERE watched = 1 OR watch_progress >= 60
    `);
    const projRows = watchedProjects[0]?.values || [];
    let synced = false;
    for (const pRow of projRows) {
      const pId = pRow[0] as string;
      const pTitle = (pRow[1] as string) || 'Mídia';
      const pType = (pRow[2] as string) || 'movie';
      const pSeries = pRow[3] as string | null;
      const pSeason = pRow[4] as number | null;
      const pEp = pRow[5] as number | null;
      const pProg = (pRow[6] as number) || 0;
      const pWatched = (pRow[7] as number) === 1 ? 1 : 0;
      const pCreatedAt = (pRow[8] as string) || new Date().toISOString();

      const existing = db.exec(
        'SELECT id FROM watch_history WHERE project_id = ? OR (title = ? AND COALESCE(season_number, -1) = COALESCE(?, -1) AND COALESCE(episode_number, -1) = COALESCE(?, -1))',
        [pId, pTitle, pSeason ?? -1, pEp ?? -1]
      );
      if (!existing[0]?.values?.length) {
        db.run(
          'INSERT INTO watch_history (id, project_id, title, project_type, series_id, season_number, episode_number, watched_at, watch_progress, watched) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [uuid(), pId, pTitle, pType, pSeries, pSeason, pEp, pCreatedAt, pProg, pWatched]
        );
        synced = true;
      }
    }
    if (synced) persist();

    const historyRes = db.exec(`
      SELECT h.id, h.project_id, h.title, h.project_type, h.series_id, h.season_number, h.episode_number, h.poster_url, h.watched_at, h.watch_progress, h.watched,
             p.id as active_project_id, p.status as project_status
      FROM watch_history h
      LEFT JOIN projects p ON p.id = h.project_id
      ORDER BY h.watched_at DESC
    `);
    const rows = historyRes[0]?.values || [];
    const items = rows.map((row: any[]) => ({
      id: row[0],
      projectId: row[1],
      title: row[2],
      projectType: row[3],
      seriesId: row[4],
      seasonNumber: row[5],
      episodeNumber: row[6],
      posterUrl: row[7],
      watchedAt: row[8],
      watchProgress: row[9],
      watched: (row[10] as number) === 1,
      isDownloaded: !!row[11] && row[12] === 'done',
    }));
    res.json(items);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/history/:id', (req: Request, res: Response) => {
  const db = getDb();
  db.run('DELETE FROM watch_history WHERE id = ?', [req.params.id]);
  persist();
  res.json({ success: true });
});

router.get('/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();
  const result = db.exec('SELECT id, title, status, error_message, created_at, video_path, COALESCE(project_type, \'movie\') as project_type, series_id, season_number, episode_number, watch_progress, watched FROM projects WHERE id = ?', [id]);
  const row = result[0]?.values[0];
  if (!row) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }

  res.json({
    id: row[0],
    title: row[1],
    status: row[2],
    errorMessage: row[3],
    createdAt: row[4],
    videoPath: row[5],
    projectType: row[6],
    seriesId: row[7] as string | null,
    seasonNumber: row[8] as number | null,
    episodeNumber: row[9] as number | null,
    watchProgress: row[10] as number | null,
    watched: row[11] as number | null,
  });
});

// Capa/poster da mídia. Prioridade: arquivo de capa na pasta do projeto →
// frame extraído do vídeo (ffmpeg) → poster via iTunes pelo título.
router.get('/:id/thumbnail', async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const projectDir = path.join(DATA_DIR, 'projects', projectId);

  if (existsSync(projectDir)) {
    const candidates = ['thumbnail.jpg', 'thumbnail.png', 'poster.jpg', 'poster.png', 'project_thumb.jpg', 'project_thumb.png', 'cover.jpg', 'cover.png'];
    for (const file of candidates) {
      const filePath = path.join(projectDir, file);
      if (existsSync(filePath)) {
        res.sendFile(path.resolve(filePath));
        return;
      }
    }
  }

  const proj = getDb().exec('SELECT video_path, title FROM projects WHERE id = ?', [projectId])[0]?.values[0];
  let videoPath = proj?.[0] as string | null;
  const rawTitle = proj?.[1] as string | null;

  if (!videoPath && existsSync(projectDir)) {
    try {
      const files = readdirSync(projectDir);
      const found = files.find((f) => f.startsWith('original.') || f.startsWith('source_') || /\.(mp4|webm|mkv|avi)$/i.test(f));
      if (found) videoPath = path.join(projectDir, found);
    } catch {}
  }

  if (videoPath && existsSync(videoPath)) {
    const thumbPath = path.join(projectDir, 'project_thumb.jpg');
    try {
      execSync(`"${FFMPEG_BIN}" -y -ss 00:00:01 -i "${videoPath}" -vframes 1 -q:v 2 "${thumbPath}"`, { stdio: 'pipe' });
      res.sendFile(path.resolve(thumbPath));
      return;
    } catch (e) {
      console.error(`[JackIn] Falha ao gerar thumbnail de ${projectId}:`, (e as Error).message);
    }
  }

  if (rawTitle) {
    const cleanTitle = rawTitle.replace(/\s*\([^)]*\)/g, '').trim();
    if (cleanTitle) {
      try {
        const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(cleanTitle)}&limit=1`;
        const itunesRes = await fetch(searchUrl);
        if (itunesRes.ok) {
          const data = await itunesRes.json();
          const artUrl = data.results?.[0]?.artworkUrl100;
          if (artUrl) {
            const hiRes = artUrl.replace('100x100bb.jpg', '600x600bb.jpg');
            const imgRes = await fetch(hiRes);
            if (imgRes.ok) {
              mkdirSync(projectDir, { recursive: true });
              const thumbPath = path.join(projectDir, 'thumbnail.jpg');
              writeFileSync(thumbPath, Buffer.from(await imgRes.arrayBuffer()));
              res.sendFile(path.resolve(thumbPath));
              return;
            }
          }
        }
      } catch (e) {
        console.error(`[JackIn] Falha ao buscar poster iTunes de ${projectId}:`, (e as Error).message);
      }
    }
  }

  res.status(404).json({ error: 'Thumbnail not available' });
});

router.delete('/:id', async (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const db = getDb();
  const deleteFiles = req.query.deleteFiles !== 'false';

  // Get project info before deleting row
  let videoPath: string | null = null;
  try {
    const projResult = db.exec('SELECT video_path FROM projects WHERE id = ?', [projectId]);
    videoPath = (projResult[0]?.values[0]?.[0] as string) || null;
  } catch (err) {}

  // Cancel any running tasks (torrents, FFmpeg/prepare)
  try {
    const { cancelTorrent } = await import('../media/torrent-downloader.js');
    cancelTorrent(projectId);
  } catch (err) {}
  // Mata o worker Python de download (media-search) para não recriar o
  // diretório após a exclusão.
  try {
    const { cancelMovieDownload } = await import('../media/media-search.js');
    cancelMovieDownload(projectId);
  } catch (err) {}

  try {
    const { cancelPreparation } = await import('../../services/media-service.js');
    cancelPreparation(projectId);
  } catch (err) {}

  recordWatchHistory(projectId);

  db.run('DELETE FROM projects WHERE id = ?', [projectId]);
  persist();

  if (deleteFiles) {
    const projectDir = `${DATA_DIR}/projects/${projectId}`;
    if (existsSync(projectDir)) {
      console.log(`[JackIn] Removendo diretório do projeto: ${projectDir}`);
      try {
        rmSync(projectDir, { recursive: true, force: true });
      } catch (err: any) {
        console.error(`[JackIn] ⚠️ Falha ao remover diretório ${projectDir}:`, err.message);
      }
    }

    if (videoPath && existsSync(videoPath) && !videoPath.includes(projectId)) {
      console.log(`[JackIn] Removendo arquivo de vídeo avulso: ${videoPath}`);
      try {
        rmSync(videoPath, { force: true });
      } catch (err: any) {
        console.error(`[JackIn] ⚠️ Falha ao remover vídeo ${videoPath}:`, err.message);
      }
    }
  }

  res.json({ success: true });
});

const TEXT_SUBTITLE_CODECS = new Set([
  'subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'srt', 'text', 'mp4',
]);

// Stream video of the project — static artifact serving with native Range.
// Toda a preparação acontece na ingestão (prepareProject); aqui só resolvemos
// o artefato certo para o target do browser e servimos com res.sendFile.
// Alvo: h264 (Chrome/Edge/Firefox) | hevc (Safari). Default por User-Agent.
function detectTarget(req: Request): Target {
  const q = String(req.query.target || '');
  if (q === 'hevc' || q === 'h264') return q;
  const ua = req.headers['user-agent'] || '';
  const isSafari = /Safari\//.test(ua) && !/Chrome\//.test(ua) && !/Chromium/.test(ua);
  return isSafari ? 'hevc' : 'h264';
}

router.get('/:id/video', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/.test(projectId)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const audioLang = (req.query.audio as string) || null;
  if (audioLang && !/^[a-z]{2,3}(-[a-zA-Z]{2})?$/i.test(audioLang)) {
    res.status(400).json({ error: 'invalid_audio_lang' });
    return;
  }
  const target = detectTarget(req);
  const db = getDb();
  const statusRow = db.exec('SELECT status FROM projects WHERE id = ?', [projectId])[0]?.values[0];
  if (!statusRow) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const projectStatus = statusRow[0] as string;

  // O player envia rótulo amigável (pt-br/en), mas os artefatos de áudio são
  // chaveados pelo código cru do ffprobe (por/eng). Resolve a chave real antes
  // de procurar a variante — sem isso o pedido caía no master/playable genérico.
  const pmForAudio = getProjectMedia(projectId);
  const artifactKeys = Object.keys(pmForAudio?.artifacts?.audio || {});
  const mappedAudioLang = audioLang
    ? artifactKeys.find((k) => (LANG_TO_CODES[audioLang] || []).includes(k)) ||
      artifactKeys.find((k) => k === audioLang) ||
      audioLang
    : null;

  const resolved = resolveVideoFile(projectId, target, mappedAudioLang);

  // Ainda baixando o MASTER original: stream incompleto corromperia o playback.
  // Artefatos preparados (master/playable/variantes) são completos por
  // construção (tmp+rename), então servem mesmo com status de pipeline ativo.
  if (projectStatus === 'downloading' && !resolved.isArtifact) {
    res.status(425).json({ error: 'video_processing', message: 'Download em andamento' });
    return;
  }

  // Artefato pedido ainda sendo gerado → 425 com retry curto do player.
  if (!resolved.filePath) {
    const pm = getProjectMedia(projectId);
    if (pm?.prepState === 'failed') {
      res.status(404).json({ error: 'prep_failed', message: pm.prepError || 'Preparação falhou' });
      return;
    }
    if (!isPreparing(projectId) && pm?.prepState !== 'running') {
      // Fallback defensivo: nunca bloquear o play — dispara prepare e avisa.
      prepareProject(projectId).catch((e) => console.error(`[JackIn] prepare on-demand ${projectId}:`, e));
    }
    res.status(425).json({ error: 'video_preparing', message: 'Preparando versão compatível...' });
    return;
  }

  // Playable estático com moov no topo + faststart: Range nativo do Express
  // (206 correto), seek de byte exato e sync A/V perfeita.
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(resolved.filePath, { cacheControl: false }, (err) => {
    if (err && !res.headersSent) {
      res.status(404).json({ error: 'video_missing', message: 'Arquivo não encontrado' });
    }
  });
});

// Unified tracks detection — returns both audio and subtitle streams.
// Lê do cache media_info (probe na ingestão) — zero ffprobe por request.
// ÁUDIO: uma entrada por idioma. O mesmo arquivo costuma ter vários streams do
// mesmo idioma (AAC stereo + AC3 5.1, FORÇADA + completa) — sem dedupe o menu
// do player mostra "Inglês" várias vezes. Fica a faixa de mais canais, com o
// title do stream ("Original"/"Dublado"/"5.1 Ch") para diferenciar variantes.
router.get('/:id/tracks', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const pm = getProjectMedia(projectId);

  const info = pm?.mediaInfo;
  const audioByLang = new Map<string, any>();
  for (const s of info?.audio || []) {
    const friendly = codeToLang[s.language || ''] || s.language || 'und';
    const cur = audioByLang.get(friendly);
    if (!cur || (s.channels || 0) > (cur.channels || 0)) {
      audioByLang.set(friendly, {
        index: s.index,
        language: friendly,
        codec: s.codec,
        channels: s.channels || 0,
        title: s.title || '',
      });
    }
  }

  const subtitlesByLang = new Map<string, any>();
  for (const s of (info?.subtitles || []).filter((x) => TEXT_SUBTITLE_CODECS.has(x.codec))) {
    const friendly = codeToLang[s.language || ''] || s.language || 'und';
    if (!subtitlesByLang.has(friendly)) {
      subtitlesByLang.set(friendly, {
        index: s.index,
        language: friendly,
        codec: s.codec,
      });
    }
  }

  let subtitles = [...subtitlesByLang.values()];

  // Variantes de áudio e legendas extraídas na ingestão aparecem no menu.
  // Converte a chave crua do ffprobe (por/eng) para o rótulo amigável
  // (pt-br/en) para bater com o que o player envia em ?audio=.
  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  const variantLangs = Object.keys(pm?.artifacts?.audio || {});
  for (const lang of variantLangs) {
    const friendly = codeToLang[lang] || lang;
    if (!audioByLang.has(friendly)) {
      audioByLang.set(friendly, { index: -1, language: friendly, codec: 'variant', channels: 0, title: '' });
    }
  }
  const audio = [...audioByLang.values()];

  // External PT-BR subtitle downloaded by the subtitle service. Quando existe,
  // substitui a embutida do mesmo idioma (que costuma ser só FORÇADA) para o
  // player expor uma única opção pt-br apontando para a versão completa.
  if (existsSync(path.join(projectDir, 'subs_ptbr.vtt'))) {
    subtitles = subtitles
      .filter((s) => s.language !== 'pt-br')
      .concat({ index: -1, language: 'pt-br', codec: 'vtt' });
  }
  // Legendas embutidas extraídas na ingestão (subs_<lang>.vtt).
  const prepSubLangs = Object.keys(pm?.artifacts?.subs || {});
  for (const lang of prepSubLangs) {
    const friendly = codeToLang[lang] || lang;
    if (!subtitles.some((s) => s.language === friendly)) {
      subtitles.push({ index: -1, language: friendly, codec: 'vtt' });
    }
  }

  res.json({ audio, subtitles });
});

// Cast (Chromecast) — resolve o arquivo cast-safe (h264 + áudio cast-safe)
// e descreve as trilhas de áudio na ordem do playable para o receiver.
router.get('/:id/cast', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  if (!/^[0-9a-f-]{36}$/.test(projectId)) {
    res.status(400).json({ error: 'invalid_id' });
    return;
  }
  const resolved = resolveCastFile(projectId);
  if (!resolved) {
    res.json({ available: false, target: 'h264', audioTracks: [] });
    return;
  }
  res.json({ available: true, target: 'h264', audioTracks: listCastAudioTracks(projectId) });
});

// Serve extracted subtitles. Prioridade: legenda externa PT-BR → VTT extraído
// na ingestão (subs_<lang>.vtt) → stream embutido (fallback).
router.get('/:id/subtitles', (req: Request, res: Response) => {
  const projectId = String(req.params.id);
  const targetLang = (req.query.lang as string) || 'pt-br';

  // External PT-BR subtitle downloaded by the subtitle service wins over any
  // embedded stream — it is the most reliable, highest-quality option.
  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  const externalVtt = path.join(projectDir, 'subs_ptbr.vtt');
  if (existsSync(externalVtt)) {
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.sendFile(path.resolve(externalVtt));
    return;
  }

  // VTT extraído na ingestão para o idioma pedido (ex.: subs_en.vtt).
  const pm = getProjectMedia(projectId);
  if (pm?.artifacts?.subs && Object.keys(pm.artifacts.subs).length > 0) {
    const targetCodes = LANG_TO_CODES[targetLang] || [targetLang];
    const foundCode = Object.keys(pm.artifacts.subs).find((l) => targetCodes.includes(l) || l === targetLang);
    const art = foundCode ? pm.artifacts.subs[foundCode] : null;
    if (art && existsSync(art.path)) {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      res.sendFile(path.resolve(art.path));
      return;
    }
  }

  // Fallback: stream embutido via ffmpeg (sem cache).
  const db = getDb();
  const result = db.exec('SELECT video_path FROM projects WHERE id = ?', [projectId]);
  const row = result[0]?.values[0];
  let filePath = row ? (row[0] as string) : null;

  if (!filePath || !existsSync(filePath)) {
    if (existsSync(projectDir)) {
      const files = readdirSync(projectDir);
      const f = files.find(x => x.endsWith('.mp4') || x.endsWith('.mkv') || x.endsWith('.webm'));
      if (f) filePath = path.join(projectDir, f);
    }
  }

  if (!filePath || !existsSync(filePath)) {
    res.setHeader('Content-Type', 'text/vtt');
    res.send('WEBVTT\n\n');
    return;
  }

  const targetCodes = LANG_TO_CODES[targetLang] || [targetLang];

  try {
    const ffprobeBin = process.env.FFPROBE_BIN || 'ffprobe';
    const raw = execSync(
      `"${ffprobeBin}" -v quiet -show_entries stream=index,codec_type:stream_tags=language -of json "${filePath}"`,
      { encoding: 'utf-8', timeout: 10000 }
    );
    const data = JSON.parse(raw);
    const subStreams = (data.streams || []).filter((s: any) => s.codec_type === 'subtitle');

    let subIndex = -1;
    for (const target of targetCodes) {
      const found = subStreams.findIndex((s: any) => (s.tags?.language || '').toLowerCase() === target);
      if (found >= 0) {
        subIndex = subStreams[found].index;
        break;
      }
    }

    if (subIndex < 0) {
      res.setHeader('Content-Type', 'text/vtt');
      res.send('WEBVTT\n\n');
      return;
    }

    const ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg';
    const ffmpeg = spawn(ffmpegBin, [
      '-i', filePath,
      '-map', `0:s:${subStreams.findIndex((s: any) => s.index === subIndex)}`,
      '-f', 'webvtt',
      'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    res.setHeader('Content-Type', 'text/vtt');
    ffmpeg.stdout.pipe(res);
    ffmpeg.on('error', () => { if (!res.headersSent) res.status(500).end(); });
    res.on('close', () => { ffmpeg.kill(); });
  } catch {
    res.setHeader('Content-Type', 'text/vtt');
    res.send('WEBVTT\n\n');
  }
});

// Helper to search and find the most seeded magnet link dynamically
async function resolveActiveMagnetForSeason(query: string, fallbackMagnet: string): Promise<string> {
  try {
    console.log(`[TorrentSearch] Buscando magnet ativo para a busca: "${query}"...`);
    const searchUrl = `https://apibay.org/q.php?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl);
    if (!response.ok) {
      throw new Error(`Apibay HTTP error ${response.status}`);
    }
    const results = await response.json();
    if (!Array.isArray(results) || results.length === 0 || results[0].id === "0") {
      console.log(`[TorrentSearch] Nenhum torrent encontrado para a busca "${query}". Usando fallback.`);
      return fallbackMagnet;
    }

    // Sort by seeders descending
    const sorted = results
      .map((r: any) => ({
        name: r.name,
        info_hash: r.info_hash,
        seeders: parseInt(r.seeders || '0', 10),
        size: parseInt(r.size || '0', 10)
      }))
      .filter((r: any) => r.info_hash && r.seeders > 0)
      .sort((a: any, b: any) => b.seeders - a.seeders);

    if (sorted.length === 0) {
      console.log(`[TorrentSearch] Nenhum torrent com seeders ativo encontrado. Usando fallback.`);
      return fallbackMagnet;
    }

    const best = sorted[0];
    console.log(`[TorrentSearch] Melhor torrent encontrado: "${best.name}" com ${best.seeders} seeders! Infohash: ${best.info_hash}`);

    // Construct magnet URL with centralized trackers
    const trackerParams = TRACKERS_LIST.map(tr => `tr=${encodeURIComponent(tr)}`).join('&');
    const magnetUrl = `magnet:?xt=urn:btih:${best.info_hash}&dn=${encodeURIComponent(best.name)}&${trackerParams}`;

    return magnetUrl;
  } catch (err) {
    console.error(`[TorrentSearch] Erro ao buscar torrents via API:`, err);
    return fallbackMagnet;
  }
}

// Import Season automation using WebTorrent
router.post('/import-season', async (req: Request, res: Response) => {
  const { language, customMagnet, episodes: bodyEpisodes, searchQuery } = req.body;
  const db = getDb();

  // Load season automation data (defaults) from data/season-automation.json
  let config: { searchQuery?: string; fallbackMagnet?: string; episodes?: { code: string; title: string }[] } = {};
  try {
    const configPath = path.join(DATA_DIR, 'season-automation.json');
    const raw = readFileSync(configPath, 'utf-8');
    config = JSON.parse(raw);
  } catch {
    // no config file — rely on request body
  }

  const fallbackMagnet = config.fallbackMagnet || '';
  const defaultSearchQuery = config.searchQuery || '';

  let MAGNET_URL = customMagnet || '';
  if (!MAGNET_URL && fallbackMagnet) {
    MAGNET_URL = await resolveActiveMagnetForSeason(searchQuery || defaultSearchQuery, fallbackMagnet);
  }

  const episodes = Array.isArray(bodyEpisodes) && bodyEpisodes.length > 0
    ? bodyEpisodes
    : config.episodes || [];

  if (episodes.length === 0 || !MAGNET_URL?.startsWith('magnet:')) {
    res.status(400).json({ error: 'episodes e customMagnet (ou config de temporada) são obrigatórios' });
    return;
  }

  console.log(`[JackIn] Recebida solicitação de automação de temporada com ${episodes.length} episódios (Idioma: ${language || 'pt'})`);
  const createdProjects: any[] = [];

  for (const ep of episodes) {
    const projectId = uuid();
    db.run(
      'INSERT INTO projects (id, youtube_url, title, status, project_type) VALUES (?, ?, ?, ?, ?)',
      [projectId, '', ep.title, 'pending', 'movie']
    );
    createdProjects.push({ id: projectId, code: ep.code, title: ep.title });
  }
  persist();

  // Process downloads in background sequentially
  const { downloadEpisodeFromMagnet } = await import('../media/torrent-downloader.js');

  async function processSeasonDownloadQueue() {
    for (const proj of createdProjects) {
      // Check if project was cancelled/deleted in DB before starting the download
      const checkProj = db.exec('SELECT status FROM projects WHERE id = ?', [proj.id]);
      const currentStatus = checkProj[0]?.values[0]?.[0] as string | null;
      if (!currentStatus || currentStatus === 'cancelled') {
        console.log(`[JackIn] Download do episódio ${proj.code} pulado/cancelado.`);
        continue;
      }

      const projectDir = path.join(DATA_DIR, 'projects', proj.id);

      db.run('UPDATE projects SET status = ? WHERE id = ?', ['downloading', proj.id]);
      persist();

      try {
        // 1. Torrent Download
        const videoPath = await downloadEpisodeFromMagnet(
          MAGNET_URL,
          proj.code,
          projectDir,
          proj.id,
          (progressInfo) => {
            progressEvents.emit(proj.id, {
              stage: 'downloading',
              progress: progressInfo.progress,
              status: progressInfo.status
            });
          }
        );

        // 2. Update video_path and set status to preparing — o prepare de
        // playback roda ANTES de mais nada, para o episódio ser assistível
        // imediatamente ao terminar.
        db.run(
          'UPDATE projects SET status = ?, video_path = ? WHERE id = ?',
          ['preparing', videoPath, proj.id]
        );
        persist();

        // 3. Pré-processa artefatos de playback (master/playable/áudio/legendas).
        await prepareProject(proj.id);

      } catch (err: any) {
        console.error(`[JackIn] Falha ao baixar/processar episódio ${proj.code}:`, err);
        db.run(
          'UPDATE projects SET status = ?, error_message = ? WHERE id = ?',
          ['error', err.message || 'Erro no download', proj.id]
        );
        persist();
        progressEvents.emit(proj.id, {
          stage: 'error',
          progress: 0,
          status: `Erro: ${err.message || 'Falha no download'}`
        });
      }
    }
  }

  processSeasonDownloadQueue();

  res.status(202).json({
    message: "Season automation started",
    projects: createdProjects
  });
});

// Pause download
router.post('/:id/pause', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { pauseTorrent } = await import('../media/torrent-downloader.js');
  const db = getDb();

  const success = pauseTorrent(id);
  if (success) {
    db.run("UPDATE projects SET status = ? WHERE id = ?", ['paused', id]);
    persist();
    progressEvents.emit(id, { stage: 'paused', progress: 0, status: 'Download Pausado' });
    res.json({ success: true, message: 'Torrent paused' });
  } else {
    res.status(404).json({ error: 'Active torrent download not found for this project' });
  }
});

// Resume download
router.post('/:id/resume', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { resumeTorrent } = await import('../media/torrent-downloader.js');
  const db = getDb();

  const success = resumeTorrent(id);
  if (success) {
    db.run("UPDATE projects set status = 'downloading' WHERE id = ?", [id]);
    persist();
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Failed to resume or download not active' });
  }
});

router.put('/:id/progress', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { position } = req.body;
  if (typeof position !== 'number' || position < 0) {
    res.status(400).json({ error: 'position must be a non-negative number' });
    return;
  }
  const db = getDb();
  db.run('UPDATE projects SET watch_progress = ? WHERE id = ?', [position, id]);
  persistThrottled(5000);
  if (position >= 60) {
    recordWatchHistory(id);
  }
  const mins = Math.floor(position / 60);
  const secs = Math.floor(position % 60);
  const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  console.log(`[JackIn ⏱️ Progresso] Projeto ${id.slice(0, 8)}... | Salvo em ${timeFormatted} (${Math.round(position)}s)`);
  res.json({ ok: true });
});

router.get('/:id/progress', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const db = getDb();
  const result = db.exec('SELECT watch_progress, watched FROM projects WHERE id = ?', [id]);
  const row = result[0]?.values[0];
  if (!row) {
    res.status(404).json({ error: 'Project not found' });
    return;
  }
  res.json({
    position: (row[0] as number) || 0,
    watched: (row[1] as number) === 1,
  });
});

router.put('/:id/watched', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { watched } = req.body;
  if (typeof watched !== 'boolean') {
    res.status(400).json({ error: 'watched must be a boolean' });
    return;
  }
  const db = getDb();
  db.run('UPDATE projects SET watched = ? WHERE id = ?', [watched ? 1 : 0, id]);
  persist();
  recordWatchHistory(id);
  res.json({ ok: true });
});

export default router;
