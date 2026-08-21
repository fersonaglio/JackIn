import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getDb, persist, persistThrottled, DATA_DIR } from '../../db/schema.js';
import { progressEvents } from '../../services/progress-events.js';
import { prepareProject, reconcileProjectMedia, isPreparing, cancelPreparation, getProjectMedia } from '../../services/media-service.js';
import { searchMediaEnhanced } from './media-search-interpret.js';

const router = Router();

const SCRIPTS_DIR = path.resolve(import.meta.dirname, '../../../../../apps/python-services');
const defaultVenv = path.resolve(import.meta.dirname, '../../../../../.venv/bin/python3');
const VENV_PYTHON = process.env.PYTHON_BIN || (fs.existsSync(defaultVenv) ? defaultVenv : 'python3');

// Projects with an active movie download (prevents duplicate/retry races)
const runningDownloads = new Set<string>();

// Live download processes + pause intent per project, so pause can SIGTERM the
// aria2 worker and resume can restart it (aria2 resumes from the .aria2 file).
const runningProcesses = new Map<string, ReturnType<typeof spawn>>();
const pauseRequested = new Set<string>();

// Auto-retry de downloads: falhas TRANSITÓRIAS (sem seeders, rede, arquivo
// corrompido) são re-tentadas continuamente com backoff crescente capado, e o
// status permanece 'downloading' — o usuário NUNCA precisa clicar "Tentar
// novamente" para uma fonte que pode voltar. Rejeições definitivas (conteúdo
// malicioso) NÃO passam por aqui (tratadas no caller com status 'error').
// Retorna true se um retry foi agendado.
const RETRY_BACKOFF_MS = [15_000, 30_000, 60_000, 120_000, 300_000, 600_000];
const autoRetryState = new Map<string, { attempts: number; timer?: NodeJS.Timeout }>();

function scheduleAutoRetry(id: string, opts: DownloadOptions): boolean {
  const state = autoRetryState.get(id);
  const attempts = state?.attempts ?? 0;
  if (state?.timer) return true; // já há um retry agendado

  const delay = RETRY_BACKOFF_MS[Math.min(attempts, RETRY_BACKOFF_MS.length - 1)];
  const timer = setTimeout(() => {
    // Marca a tentativa em execução (contador persiste entre re-spawns).
    autoRetryState.set(id, { attempts: attempts + 1 });
    try {
      const row = getDb().exec('SELECT id, status FROM projects WHERE id = ?', [id])[0]?.values[0];
      if (!row) {
        autoRetryState.delete(id);
        return;
      }
      const st = row[1] as string;
      if (st === 'paused' || st === 'done' || st === 'preparing') {
        autoRetryState.delete(id);
        return;
      }
      console.log(`[JackIn Media] Auto-retry (${attempts + 1}) do download ${id}`);
      getDb().run(
        'UPDATE projects SET status = ?, progress_status = ? WHERE id = ?',
        ['downloading', `Tentando novamente (${attempts + 1})...`, id]
      );
      persist();
      // Busca novas alternativas em cada tentativa: a fonte morta não vai
      // "acordar" sozinha, mas indexadores reais podem ter novas opções agora.
      findBetterDownloadOptions(opts.title, 4, opts.requirePt)
        .then((altOpts) => {
          const real = altOpts.filter((o) => o.sourceUrl && !CURATED_SITE_RE.test(o.sourceUrl));
          const alts = altOpts.map((o) => o.sourceUrl!).filter((u) => u && u !== opts.sourceUrl);
          const mergedAlts = [...new Set([...(opts.altSourceUrls || []), ...alts])];
          let retryOpts = mergedAlts.length > 0 ? { ...opts, altSourceUrls: mergedAlts } : opts;
          // Se a busca encontrou uma fonte REAL (indexador com seeders de
          // verdade, ex. WOLVERDON), promove para primária: o magnet fantasma
          // não vai "acordar", e tentá-lo primeiro só gasta o warmup morto.
          if (real.length > 0 && opts.sourceUrl) {
            const best = real[0].sourceUrl!;
            const reordered = [...new Set([best, ...(mergedAlts.filter((u) => u !== best))])];
            const keepCurated = !reordered.includes(opts.sourceUrl) ? [...reordered, opts.sourceUrl] : reordered;
            retryOpts = { ...opts, sourceUrl: best, altSourceUrls: keepCurated };
          }
          try {
            getDb().run(
              'UPDATE projects SET faceless_config = ? WHERE id = ?',
              [JSON.stringify({ sourceUrl: retryOpts.sourceUrl, title: retryOpts.title, quality: retryOpts.quality, posterUrl: retryOpts.posterUrl || '', altSourceUrls: retryOpts.altSourceUrls || [], requirePt: retryOpts.requirePt === true }), id]
            );
            persist();
          } catch {}
          startMovieDownload(id, retryOpts);
        })
        .catch(() => startMovieDownload(id, opts));
    } catch (e) {
      console.error(`[JackIn Media] Auto-retry de ${id} falhou ao reagendar:`, (e as Error).message);
      autoRetryState.delete(id);
    }
  }, delay);
  autoRetryState.set(id, { attempts, timer });
  timer.unref?.();
  return true;
}

// Learned per-release knowledge: does this infohash actually contain PT audio?
// Written after every completed download (ffprobe) and read by the search
// engine so real PT-BR releases are preferred and non-PT "DUAL" releases are
// never offered as the dubbed choice again.
const PT_RELEASES_FILE = path.join(SCRIPTS_DIR, 'modules', 'media', 'pt_releases.json');
const PT_LANGS = new Set(['pt', 'por', 'pt-br', 'ptbr', 'bra', 'braz']);

function isPtLang(lang: string): boolean {
  return PT_LANGS.has(lang.toLowerCase());
}

function persistPtKnowledge(infoHash: string | null, langs: string[]) {
  if (!infoHash) return;

  // ffprobe returns "und" (undefined) when the media container has no language
  // metadata tags — the audio itself may still be PT-BR. Writing pt=false here
  // would permanently ban that release from future dubbed searches. Skip when
  // all detected languages are "und" (inconclusive).
  const known = langs.filter((l) => l.toLowerCase() !== 'und');
  if (known.length === 0) return;

  let data: Record<string, { pt: boolean; langs: string[] }> = {};
  try {
    data = JSON.parse(fs.readFileSync(PT_RELEASES_FILE, 'utf8'));
  } catch {
    // file does not exist yet
  }
  data[infoHash.toLowerCase()] = { pt: langs.some(isPtLang), langs };
  try {
    fs.writeFileSync(PT_RELEASES_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[JackIn Media] Erro ao gravar pt_releases.json: ${(err as Error).message}`);
  }
}

interface DownloadOptions {
  sourceUrl: string;
  title: string;
  quality: string;
  posterUrl?: string;
  /** Alternativas em cascata — se o primário estiver morto, tenta estas. */
  altSourceUrls?: string[];
  /** true quando o usuário pediu Dublado: o download é rejeitado se o arquivo
   *  não tiver áudio em português, e o fallback fica restrito a fontes PT. */
  requirePt?: boolean;
}

// Curated WordPress BR magnets carry a fixed 30-seed estimate but often have
// zero real peers, so downloads from them fail forever. Prefer real indexer
// options (apibay/1337x) with actual seed counts on retry.
const CURATED_SITE_RE = /limontorrents|baixetorrents|mestredosfilmes|filmeshdtorrent/i;

// Retorna até maxOptions magnets REAIS (apibay/1337x, sem curated/yts) para o
// título, ordenados do mais confiável para o menos — usados como candidates em
// cascata: se um magnet estiver morto, o worker tenta o próximo automaticamente.
export async function findBetterDownloadOptions(title: string, maxOptions: number = 4, requirePt: boolean = false): Promise<Partial<DownloadOptions>[]> {
  const { searchMediaEnhanced } = await import('./media-search-interpret.js');
  const seen = new Set<string>();
  const results: Partial<DownloadOptions>[] = [];
  let posterUrl = '';

  const push = (o: any) => {
    if (!o?.sourceUrl || seen.has(o.sourceUrl)) return;
    seen.add(o.sourceUrl);
    results.push({
      sourceUrl: o.sourceUrl,
      quality: o.quality || '4K',
      posterUrl: posterUrl || '',
    });
  };

  // Tenta a busca com o título dado E com um fallback de título original
  // (ex.: "FormiguinhaZ" → "Antz"), já que o título PT costuma só achar
  const cleanReqTitle = title.split(' (')[0].toLowerCase().replace(/[^a-z0-9]/gi, ' ').trim();
  const reqWords = cleanReqTitle.split(/\s+/).filter((w) => w.length > 2);

  const fallbacks = [title, expandTitleFallback(title)];
  for (const t of fallbacks) {
    let out: any = { results: [] };
    try {
      out = await searchMediaEnhanced(t);
    } catch {}
    for (const r of out.results || []) {
      if (!r.options || r.options.length === 0) continue;

      // Proteção de franquia: quando a busca retorna múltiplos grupos, garante
      // que só pegamos candidatos que correspondam ao filme/ano exato requisitado.
      if (out.results.length > 1) {
        const rTitleClean = (r.title || '').toLowerCase().replace(/[^a-z0-9]/gi, ' ');
        const rOrigClean = (r.originalTitle || '').toLowerCase().replace(/[^a-z0-9]/gi, ' ');
        const distinctiveWords = reqWords.filter(
          (w) => !['piratas', 'pirates', 'caribe', 'caribbean', 'senhor', 'aneis', 'lord', 'rings', 'star', 'wars', 'harry', 'potter', 'filme', 'movie', 'part', 'parte'].includes(w)
        );
        if (distinctiveWords.length > 0) {
          const matchDistinctive = distinctiveWords.some((w) => rTitleClean.includes(w) || rOrigClean.includes(w));
          if (!matchDistinctive) continue;
        }
      }

      if (!posterUrl && r.posterUrl) posterUrl = r.posterUrl;

      // Opções reais (indexadores com seeders reais) têm prioridade total.
      const real = r.options.filter((o: any) => o.sourceUrl && !CURATED_SITE_RE.test(o.sourceUrl) && !o.sourceUrl.toLowerCase().includes('yts') && !(o as any).quality?.toLowerCase().includes('yts'));
      // Quando o usuário pediu Dublado, o fallback NÃO pode escorregar para uma
      // fonte sem PT (YTS/original) — restringe o pool às PT-confirmadas.
      const pool = requirePt ? real.filter((o: any) => o.ptConfirmed) : real;
      // PT-confirmadas primeiro, depois qualidade/seeders (a busca já ordena).
      const pt = pool.filter((o: any) => o.ptConfirmed);
      for (const o of [...pt, ...pool]) {
        if (results.length >= maxOptions) break;
        push(o);
      }
      // Curadas (limontorrents etc.) só como último recurso, e só se nada real.
      if (results.length === 0) {
        const curated = requirePt ? r.options.filter((o: any) => o.ptConfirmed) : r.options;
        for (const o of curated) {
          if (results.length >= maxOptions) break;
          push(o);
        }
      }
      if (results.length >= maxOptions) break;
    }
    if (results.length >= maxOptions) break;
  }
  return results;
}

// Fallback de título original para buscas: expande títulos PT "colados"
// (ex.: "formiguinhaz" → "Antz") espelhando o expandGluedQuery do frontend.
const GLUED_TITLE_FALLBACK: Record<string, string> = {
  formiguinhaz: 'Antz',
  homemdasmascaradeferro: 'The Man in the Iron Mask',
  ironmen: 'Iron Man',
  ironmans: 'Iron Man',
};

function expandTitleFallback(title: string): string {
  // O título pode vir com sufixo de qualidade ("FormiguinhaZ (1080p Full HD (Torrent))")
  // — remove o parêntese antes de normalizar para o fallback casar.
  const base = title.split(' (')[0];
  const folded = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return GLUED_TITLE_FALLBACK[folded] || title;
}

// Compat: caminho antigo usado em alguns fluxos — retorna só o melhor ou null.
async function findBetterDownloadOption(title: string): Promise<Partial<DownloadOptions> | null> {
  const opts = await findBetterDownloadOptions(title, 1);
  return opts[0] || null;
}

function saveInitialPoster(projectDir: string, posterUrl: string) {
  if (!posterUrl || !posterUrl.startsWith('http')) return;
  fetch(posterUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } })
    .then(async (r) => {
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        await fs.promises.writeFile(path.join(projectDir, 'thumbnail.jpg'), buf);
      }
    })
    .catch((err) => {
      console.error(`[JackIn Media] Erro ao baixar poster inicial: ${err.message}`);
    });
}

function startMovieDownload(id: string, opts: DownloadOptions) {
  const db = getDb();
  const { sourceUrl, title, quality, posterUrl, altSourceUrls } = opts;
  const projectDir = path.join(DATA_DIR, 'projects', id);
  fs.mkdirSync(projectDir, { recursive: true });
  runningDownloads.add(id);

  saveInitialPoster(projectDir, posterUrl || '');

  const downloadScript = path.join(SCRIPTS_DIR, 'modules', 'media', 'download_movie.py');
  const args = [
    downloadScript,
    '--url', sourceUrl,
    '--out-dir', projectDir,
    '--title', title,
    '--quality', quality || '4K',
    '--poster-url', posterUrl || ''
  ];
  // Fallback em cascata: se o primário estiver morto, o worker tenta as
  // alternativas (magnets reais da busca) automaticamente.
  if (Array.isArray(altSourceUrls) && altSourceUrls.length > 0) {
    const alts = [...new Set(altSourceUrls.filter((u) => u && u !== sourceUrl))];
    if (alts.length > 0) args.push('--alt-urls', JSON.stringify(alts));
  }
  // Dublado: o worker rejeita o arquivo se não houver faixa de áudio PT.
  if (opts.requirePt) args.push('--require-pt');
  const proc = spawn(VENV_PYTHON, args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });

  proc.on('error', (err) => {
    runningDownloads.delete(id);
    runningProcesses.delete(id);
    try {
      db.run('UPDATE projects SET status = ?, error_message = ? WHERE id = ?', ['error', `Falha ao iniciar worker de download: ${err.message}`, id]);
      persist();
    } catch {}
    progressEvents.emit(id, { stage: 'error', progress: 0, status: `Erro: ${err.message}` });
    console.error(`[JackIn Media] spawn de download_movie.py falhou para ${id}:`, err);
  });

  // A previous worker for this id may still be alive (leftover from an older
  // duplicate-spawn race). Kill it so this new worker is the only one writing
  // to the project, and clear any stale pause intent that belongs to it.
  const prevProc = runningProcesses.get(id);
  if (prevProc && prevProc.exitCode === null) {
    try { prevProc.kill('SIGKILL'); } catch {}
  }
  pauseRequested.delete(id);

  runningProcesses.set(id, proc);

  let stdout = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });

  proc.stderr.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line.trim());
        if (typeof parsed.progress === 'number') {
          progressEvents.emit(id, { stage: 'downloading', progress: parsed.progress, status: parsed.status || 'Baixando Mídia' });
          try {
            db.run(
              'UPDATE projects SET progress_pct = ?, progress_status = ? WHERE id = ?',
              [parsed.progress, parsed.status || null, id]
            );
            persistThrottled();
          } catch (dbErr) {
            console.error('[JackIn Media] Erro ao atualizar progresso do banco:', dbErr);
          }
        }
      } catch {}
    }
  });

  proc.on('close', (code) => {
    // Ownership guard: only the CURRENT worker for this project may finalize
    // status/emit. A stale worker closing late (duplicate spawn, SIGKILL of a
    // replaced worker) must not clobber state owned by a newer worker.
    if (runningProcesses.get(id) !== proc) {
      console.log(`[JackIn Media] Ignorando close de worker antigo do projeto ${id}`);
      return;
    }

    runningDownloads.delete(id);
    runningProcesses.delete(id);

    // Paused by the user (SIGTERM) — keep progress, mark 'paused' instead of
    // error. aria2 leaves the .aria2 control file so a resume can pick up.
    if (pauseRequested.has(id)) {
      pauseRequested.delete(id);
      autoRetryState.delete(id);
      const progressRow = db.exec('SELECT progress_pct FROM projects WHERE id = ?', [id]);
      const lastPct = (progressRow[0]?.values[0]?.[0] ?? 0) as number;
      try {
        db.run(
          'UPDATE projects SET status = ?, progress_status = ? WHERE id = ?',
          ['paused', 'Pausado', id]
        );
        persist();
      } catch (dbErr) {
        console.error('[JackIn Media] Erro ao marcar download como pausado:', dbErr);
      }
      progressEvents.emit(id, { stage: 'paused', progress: lastPct, status: 'Pausado' });
      console.log(`[JackIn Media] Download do projeto ${id} pausado em ${lastPct}%`);
      return;
    }

    if (code === 0) {
      autoRetryState.delete(id);
      console.log(`[JackIn Media] Download do projeto ${id} concluído e validado pelo escudo anti-vírus.`);
      let audioLabel = '';
      let downloadedVideoPath: string | null = null;
      let audioLangs: string[] = [];
      let isBlockedAudio = false;
      let episodes: { path: string; season: number; episode: number }[] = [];
      const WANTED_LANGS = new Set(['eng', 'en', 'por', 'pt', 'pt-br', 'ptbr', 'spa', 'es']);
      try {
        const result = JSON.parse(stdout);
        if (result.video_path) downloadedVideoPath = result.video_path;
        if (Array.isArray(result.episodes)) episodes = result.episodes;
        if (Array.isArray(result.audio_languages)) audioLangs = result.audio_languages;
        if (audioLangs.length > 0) {
          audioLabel += ` — Áudio: ${audioLangs.join(' / ')}`;
        }
        const subs = result.subtitle_languages;
        if (Array.isArray(subs) && subs.length > 0) {
          audioLabel += ` — Legendas: ${subs.join(' / ')}`;
        }
        // Feed the learning map: real languages from ffprobe -> search ranking.
        const btih = (opts.sourceUrl || '').match(/btih:([a-f0-9]{40})/i);
        if (btih) persistPtKnowledge(btih[1], audioLangs);
        if (audioLangs.length > 0) {
          audioLabel += audioLangs.some(isPtLang) ? ' — PT-BR ✓' : ' — sem PT';
        }
        isBlockedAudio = audioLangs.length > 0 && !audioLangs.some((l) => WANTED_LANGS.has(l.toLowerCase()));
      } catch {
        // ignore parse failure
      }
      const finalStatus = isBlockedAudio
        ? `Baixado (áudio não-PT/EN — verifique antes de assistir)${audioLabel}`
        : `Concluído e Validado (Seguro)${audioLabel}`;
      try {
        db.run(
          'UPDATE projects SET status = ?, progress_pct = 100, progress_status = ?, video_path = ? WHERE id = ?',
          ['preparing', finalStatus, downloadedVideoPath, id]
        );
        persist();
      } catch (dbErr) {
        console.error('[JackIn Media] Erro ao atualizar status final do banco:', dbErr);
      }
      // Pack de temporada (ex.: "S03 COMPLETE" com vários .mkv): indexa cada
      // episódio como projeto próprio para o modal de série permitir assistir
      // individualmente. O projeto pai vira um placeholder da temporada.
      if (episodes.length > 1) {
        try {
          const parentRow = db.exec('SELECT series_id, season_number, title FROM projects WHERE id = ?', [id])[0]?.values[0];
          const parentSeriesId = (parentRow?.[0] as string) || id;
          const parentSeason = (parentRow?.[1] as number) || null;
          const parentTitle = (parentRow?.[2] as string) || opts.title;

          const created = 0;
          for (const ep of episodes) {
            if (!ep.path || !fs.existsSync(ep.path)) continue;
            const epId = uuid();
            const epTitle = `${parentTitle.replace(/\s*\(T\d+\)\s*$/i, '')} S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}`;
            db.run(
              'INSERT INTO projects (id, youtube_url, title, status, project_type, video_path, series_id, season_number, episode_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [epId, opts.sourceUrl, epTitle, 'preparing', 'series', ep.path, parentSeriesId, ep.season, ep.episode]
            );
            persist();
            // Prepara cada episódio para playback (master/playable/áudio/legendas).
            progressEvents.emit(epId, { stage: 'preparing', progress: 1, status: 'Preparando episódio...' });
            prepareProject(epId).catch((e: any) => {
              console.error(`[JackIn Media] Prepare do episódio ${epId} falhou:`, e);
              db.run('UPDATE projects SET status = ?, error_message = ? WHERE id = ?', ['error', `Falha ao preparar episódio: ${e.message}`, epId]);
              persist();
            });
          }
          console.log(`[JackIn Media] Pack de temporada: indexados ${episodes.length} episódios do projeto ${id}`);
          void created;
        } catch (epErr) {
          console.error('[JackIn Media] Erro ao indexar episódios do pack:', epErr);
        }
      }
      // Pré-processa TODOS os artefatos de playback (master/playable/variantes de
      // áudio/legendas) ANTES de liberar como "done" — clicar em assistir é
      // sempre servir arquivo estático, nunca processar.
      progressEvents.emit(id, { stage: 'preparing', progress: 1, status: 'Preparando para assistir...' });
      prepareProject(id)
        .then(() => {
          progressEvents.emit(id, { stage: 'done', progress: 100, status: finalStatus });
        })
        .catch((e: any) => {
          console.error(`[JackIn Media] Prepare do projeto ${id} falhou:`, e);
          db.run('UPDATE projects SET status = ?, error_message = ? WHERE id = ?', ['error', `Falha ao preparar playback: ${e.message}`, id]);
          persist();
          progressEvents.emit(id, { stage: 'error', progress: 0, status: `Erro: ${e.message}` });
        });
    } else {
      console.error(`[JackIn Media] Erro ou Reprovação pelo escudo anti-vírus no download do projeto ${id}`);
      let errorMessage = 'Falha no download (sem seeders ou fonte indisponível)';
      try {
        const parsed = JSON.parse(stdout);
        if (parsed.error) errorMessage = parsed.error;
      } catch {
        // keep default
      }

      // Rejeição definitiva (conteúdo MALICIOSO: extensão bloqueada, malware,
      // executável) NÃO é re-tentada. Corrupção de vídeo, seeders fantasmas ou
      // falha de rede são TRANSITÓRIAS: outro seed/magnet pode vir íntegro, então
      // re-tentam sozinhas (com backoff capado) até o download finalizar.
      const malicious = /extens[aã]o.*proibid|malware|trojan|backdoor|execut[aá]vel|v[ií]rus/i.test(errorMessage);
      const corrupted = /corrompid|sem faixas|ffprobe|indecodific[aá]vel/i.test(errorMessage);
      const definitive = malicious || (corrupted && /quarentena|reprovad|rejeit/i.test(errorMessage));
      if (definitive && !corrupted) {
        try {
          db.run(
            'UPDATE projects SET status = ?, error_message = ? WHERE id = ?',
            ['error', errorMessage, id]
          );
          persist();
        } catch (dbErr) {
          console.error('[JackIn Media] Erro ao atualizar status de erro do banco:', dbErr);
        }
        progressEvents.emit(id, { stage: 'error', progress: 0, status: errorMessage });
      } else if (definitive) {
        // Arquivo corrompido colocado em quarentena — limpa o lixo e agenda
        // retry: a próxima tentativa busca novas fontes e tenta de novo.
        try {
          const projectDir = path.join(DATA_DIR, 'projects', id);
          if (fs.existsSync(projectDir)) {
            for (const f of fs.readdirSync(projectDir)) {
              if (f.endsWith('.quarantine')) {
                try { fs.unlinkSync(path.join(projectDir, f)); } catch {}
              }
            }
          }
        } catch {}
        if (scheduleAutoRetry(id, opts)) {
          try {
            db.run(
              'UPDATE projects SET status = ?, progress_status = ?, progress_pct = ?, error_message = NULL WHERE id = ?',
              ['downloading', 'Download corrompido — tentando nova fonte automaticamente...', 5, id]
            );
            persist();
          } catch (dbErr) {
            console.error('[JackIn Media] Erro ao atualizar status de retry:', dbErr);
          }
          progressEvents.emit(id, { stage: 'downloading', progress: 5, status: 'Download corrompido — nova tentativa automática...' });
        } else {
          try {
            db.run(
              'UPDATE projects SET status = ?, error_message = ? WHERE id = ?',
              ['error', errorMessage, id]
            );
            persist();
          } catch (dbErr) {
            console.error('[JackIn Media] Erro ao atualizar status de erro do banco:', dbErr);
          }
          progressEvents.emit(id, { stage: 'error', progress: 0, status: errorMessage });
        }
      } else if (scheduleAutoRetry(id, opts)) {
        // Retry automático agendado: NÃO derrubar para 'error' (que mostraria o
        // botão "Tentar novamente" no frontend). Mantém 'downloading' com aviso
        // claro de que outra tentativa virá sozinha. Zera o progresso (o
        // candidate anterior foi limpo) para a barra não enganar com "95%".
        try {
          db.run(
            'UPDATE projects SET status = ?, progress_status = ?, progress_pct = ? WHERE id = ?',
            ['downloading', `Falha transitória — nova tentativa automática em instantes...`, 5, id]
          );
          persist();
        } catch (dbErr) {
          console.error('[JackIn Media] Erro ao atualizar status de retry:', dbErr);
        }
        progressEvents.emit(id, { stage: 'downloading', progress: 5, status: 'Falha transitória — nova tentativa automática...' });
      } else {
        try {
          db.run(
            'UPDATE projects SET status = ?, error_message = ? WHERE id = ?',
            ['error', errorMessage, id]
          );
          persist();
        } catch (dbErr) {
          console.error('[JackIn Media] Erro ao atualizar status de erro do banco:', dbErr);
        }
        progressEvents.emit(id, { stage: 'error', progress: 0, status: errorMessage });
      }
    }
  });
}

// Reconcile a project stuck in "downloading" after a server restart.
// Mata o worker Python de download de um projeto (se estiver rodando) e limpa
// o estado de auto-retry. Chamado pelo DELETE do projeto para que o worker não
// continue baixando e recrie o diretório após a exclusão.
export function cancelMovieDownload(projectId: string): boolean {
  const proc = runningProcesses.get(projectId);
  if (proc && proc.exitCode === null) {
    console.log(`[JackIn Media] Cancelando download do projeto ${projectId}`);
    try { proc.kill('SIGKILL'); } catch {}
  }
  runningProcesses.delete(projectId);
  runningDownloads.delete(projectId);
  autoRetryState.delete(projectId);
  return true;
}

// Reconcile a project stuck in "downloading" after a server restart.
// Cobre TODOS os tipos (filme, série, upload): se um arquivo de vídeo completo
// existe (sem .aria2 vivo), marca done e dispara o prepare; senão RETOMA o
// download automaticamente (aria2 continua do .aria2) até finalizar.
// Indexa os episódios de um pack de temporada concluído a partir do diretório
// (recuperação pós-restart — o worker pode ter sido morto antes de indexar).
// Dedup por (series_id, season_number, episode_number): se dois packs (ex.:
// mesmo torrent completo baixado por temporada) têm os mesmos episódios, só o
// primeiro vira projeto; o resto é ignorado.
export function indexPackEpisodesFromDisk(parentId: string): void {
  const db = getDb();
  const row = db.exec(
    'SELECT series_id, season_number, title FROM projects WHERE id = ? AND project_type = ? AND episode_number IS NULL',
    [parentId, 'series']
  )[0]?.values[0];
  if (!row) return;
  const parentSeriesId = (row[0] as string) || parentId;
  const parentTitle = (row[2] as string) || 'Série';

  const projectDir = path.join(DATA_DIR, 'projects', parentId);
  if (!fs.existsSync(projectDir)) return;

  const candidates: { path: string; season: number; episode: number }[] = [];
  const seen = new Set<string>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (/\.(mp4|mkv|webm|avi|mov|m4v|ts|m2ts)$/i.test(e.name)) {
        const m = e.name.match(/\bS(\d{1,3})[Ee](\d{1,3})\b/) || e.name.match(/\b(\d{1,3})x(\d{1,3})\b/);
        if (!m) continue;
        const season = parseInt(m[1], 10);
        const episode = parseInt(m[2], 10);
        const key = `${season}-${episode}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push({ path: p, season, episode });
      }
    }
  };
  walk(projectDir);
  if (candidates.length === 0) return;

  let created = 0;
  for (const ep of candidates) {
    if (!ep.path || !fs.existsSync(ep.path)) continue;
    // O aria2 PRÉ-ALOCA arquivos com zeros: um download interrompido deixa
    // placeholders "completos" que o ffprobe rejeita. Só indexa arquivo real
    // (EBML/MP4 mágico) — senão o episódio ficaria preso em 'preparing'.
    let real = false;
    try {
      const fh = fs.openSync(ep.path, 'r');
      const head = Buffer.alloc(16);
      fs.readSync(fh, head, 0, 16, 0);
      fs.closeSync(fh);
      real = (head[0] === 0x1a && head[1] === 0x45) || head.subarray(4, 8).toString() === 'ftyp';
    } catch {}
    if (!real) continue;
    const existing = db.exec(
      'SELECT id FROM projects WHERE series_id = ? AND season_number = ? AND episode_number = ? LIMIT 1',
      [parentSeriesId, ep.season, ep.episode]
    )[0]?.values[0];
    if (existing) continue;
    const epId = uuid();
    const epTitle = `${parentTitle.replace(/\s*\(T\d+\)\s*$/i, '').trim()} S${String(ep.season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}`;
    db.run(
      'INSERT INTO projects (id, youtube_url, title, status, project_type, video_path, series_id, season_number, episode_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [epId, '', epTitle, 'preparing', 'series', ep.path, parentSeriesId, ep.season, ep.episode]
    );
    persist();
    progressEvents.emit(epId, { stage: 'preparing', progress: 1, status: 'Preparando episódio...' });
    prepareProject(epId).catch((e: any) => {
      console.error(`[JackIn Media] Prepare do episódio ${epId} falhou:`, e);
      db.run('UPDATE projects SET status = ?, error_message = ? WHERE id = ?', ['error', `Falha ao preparar episódio: ${e.message}`, epId]);
      persist();
    });
    created++;
  }
  if (created > 0) {
    console.log(`[JackIn Media] Pack ${parentId}: indexados ${created} episódios (recuperação)`);
  }
}

export function reconcileMovieStatus(projectId: string): void {
  const db = getDb();
  const row = db.exec(
    'SELECT id, status, video_path, faceless_config, title, project_type, episode_number FROM projects WHERE id = ?',
    [projectId]
  )[0]?.values[0];
  if (!row) return;

  const [id, status, videoPath, facelessConfigRaw, rawTitle, projectType, episodeNumber] = row as [string, string, string | null, string | null, string | null, string, number | null];
  if (status !== 'downloading' && status !== 'preparing' && status !== 'error') return;
  if (runningDownloads.has(id)) return;
  if (isPreparing(id)) return;

  const projectDir = path.join(DATA_DIR, 'projects', id);
  const masterFile = path.join(projectDir, 'master.mp4');
  const hasMaster = fs.existsSync(masterFile) && fs.statSync(masterFile).size > 1000000;

  let videoFile: string | null = hasMaster ? masterFile : (videoPath && fs.existsSync(videoPath) ? videoPath : null);
  const aria2Files: string[] = [];

  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
      } else if (e.name.endsWith('.aria2')) {
        aria2Files.push(p);
      } else if (/\.(mp4|mkv|webm|avi|mov|m4v|ts|m2ts)$/i.test(e.name)) {
        if (!p.includes('.tmp-') && (!videoFile || fs.statSync(p).size > fs.statSync(videoFile).size)) {
          videoFile = p;
        }
      }
    }
  };
  if (fs.existsSync(projectDir)) walk(projectDir);

  const hasIncompleteAria = aria2Files.length > 0;

  let fc: { sourceUrl?: string; quality?: string; posterUrl?: string; altSourceUrls?: string[]; requirePt?: boolean } | null = null;
  try {
    fc = facelessConfigRaw ? JSON.parse(facelessConfigRaw) : null;
  } catch {}
  const sourceUrl = fc?.sourceUrl;

  const isVideoValid = videoFile && fs.existsSync(videoFile) && fs.statSync(videoFile).size > 50_000_000;

  // 1) Se já possui master.mp4 ou arquivo de vídeo real completo (>50MB) sem download aria2 pendente:
  if (hasMaster || (isVideoValid && !hasIncompleteAria)) {
    console.log(`[JackIn Media] Reconciliado: download ${id} estava completo (${videoFile || masterFile})`);
    db.run(
      'UPDATE projects SET status = ?, error_message = NULL, progress_pct = 100, progress_status = ?, video_path = ? WHERE id = ?',
      ['preparing', 'Concluído (recuperado)', videoFile || masterFile, id]
    );
    persist();
    if (projectType === 'series' && episodeNumber == null) {
      indexPackEpisodesFromDisk(id);
    }
    reconcileProjectMedia(id);
    return;
  }

  // 2) Se estava baixando ou possui .aria2 em andamento: retoma download
  if (sourceUrl) {
    console.log(`[JackIn Media] Auto-retry: retomando download interrompido ${id}`);
    db.run(
      'UPDATE projects SET status = ?, error_message = NULL, progress_status = ? WHERE id = ?',
      ['downloading', 'Retomando automaticamente após reinício...', id]
    );
    persist();
    startMovieDownload(id, {
      sourceUrl,
      title: rawTitle || 'Mídia',
      quality: fc?.quality || '4K',
      posterUrl: fc?.posterUrl || '',
      altSourceUrls: fc?.altSourceUrls,
      requirePt: fc?.requirePt === true,
    });
  } else {
    console.log(`[JackIn Media] Reconciliado: download ${id} sem fonte para retomar`);
    db.run(
      'UPDATE projects SET status = ?, error_message = ? WHERE id = ?',
      ['error', 'Download interrompido (sem fonte para retomar)', id]
    );
    persist();
  }
}

interface SearchCacheEntry {
  data: any;
  expiresAt: number;
}
const SEARCH_CACHE = new Map<string, SearchCacheEntry>();
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function getSearchCache(key: string): any | null {
  const entry = SEARCH_CACHE.get(key);
  if (entry && entry.expiresAt > Date.now()) {
    return entry.data;
  }
  if (entry) {
    SEARCH_CACHE.delete(key);
  }
  return null;
}

function setSearchCache(key: string, data: any): void {
  if (SEARCH_CACHE.size > 200) {
    const oldestKey = SEARCH_CACHE.keys().next().value;
    if (oldestKey) SEARCH_CACHE.delete(oldestKey);
  }
  SEARCH_CACHE.set(key, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
}

// GET /api/media-search/search?q=Oppenheimer[&audio=dub]
router.get('/search', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
  const audio = (req.query.audio as string || '').trim();
  const ptTitle = (req.query.ptTitle as string || '').trim();
  if (!query) {
    res.status(400).json({ error: 'Query param q is required' });
    return;
  }

  const metaHint = {
    title: query,
    year: String(req.query.year || ''),
    posterUrl: String(req.query.posterUrl || ''),
    overview: String(req.query.overview || ''),
    genre: String(req.query.genre || ''),
  };
  const hasMeta = Boolean(metaHint.posterUrl || metaHint.overview);

  const cacheKey = `search:${query.toLowerCase()}:${audio.toLowerCase()}:${ptTitle.toLowerCase()}:${metaHint.year}`;
  const cached = getSearchCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  console.log(`[JackIn Media] Buscando mídias 4K para: "${query}"${audio ? ` (áudio: ${audio})` : ''}${ptTitle ? ` (pt: ${ptTitle})` : ''}`);

  const args = [
    path.join(SCRIPTS_DIR, 'modules', 'media', 'media_search_engine.py'),
    '--query', query,
  ];
  if (audio) args.push('--audio', audio);
  if (ptTitle && ptTitle.toLowerCase() !== query.toLowerCase()) args.push('--pt-title', ptTitle);
  if (hasMeta) args.push('--meta-json', JSON.stringify(metaHint));

  const proc = spawn(VENV_PYTHON, args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });

  let stdout = '';
  let stderr = '';

  let finished = false;
  let killed = false;

  const finishAndKill = () => {
    if (finished) return;
    finished = true;
    clearTimeout(hardTimeout);
    if (!killed) {
      killed = true;
      try { proc.kill('SIGKILL'); } catch {}
    }
  };

  // Hard ceiling: the engine is multi-source (torrent indexers + BR sites +
  // metadata enrichment) and can legitimately take ~45-60s. Kill it past 180s
  // so a hung source never leaves the request (and a Python process) dangling.
  const hardTimeout = setTimeout(() => {
    console.error(`[JackIn Media] Busca excedeu 180s para "${query}" — encerrando engine`);
    finishAndKill();
    if (!res.headersSent) {
      res.json({ query, results: [], error: 'search_timeout' });
    }
  }, 180000);

  // Client disconnected (browser tab closed / abort) — kill the engine so we
  // don't keep burning CPU on a response nobody will receive.
  res.on('close', () => {
    if (!finished && !killed) {
      console.log(`[JackIn Media] Cliente desconectou durante busca de "${query}" — encerrando engine`);
      finishAndKill();
    }
  });

  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  proc.on('close', async (code) => {
    finished = true;
    clearTimeout(hardTimeout);
    if (code !== 0) {
      console.error(`[JackIn Media] Search engine failed: ${stderr.slice(0, 200)}`);
      res.json({ query, results: [], error: 'search_engine_error' });
      return;
    }

    try {
      const data = JSON.parse(stdout);
      if (Array.isArray(data.results) && data.results.length > 0) {
        setSearchCache(cacheKey, data);
      }
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: 'Failed to parse media search output' });
    }
  });
});

// GET /api/media-search/enhanced?q=... — same as /search but routes the query
// through the LLM interpretation pipeline (free-form queries like "aquela saga
// de anel" are normalized to the canonical title, then noise is filtered out of
// the engine results). Hybrid: if the LLM is unavailable it degrades to the
// exact same behavior as /search.
router.get('/enhanced', async (req: Request, res: Response) => {
  const query = (req.query.q as string || '').trim();
  const audio = (req.query.audio as string || '').trim();
  if (!query) {
    res.status(400).json({ error: 'Query param q is required' });
    return;
  }

  const metaHint = {
    title: query,
    year: String(req.query.year || ''),
    posterUrl: String(req.query.posterUrl || ''),
    overview: String(req.query.overview || ''),
    genre: String(req.query.genre || ''),
  };
  const hasMeta = Boolean(metaHint.posterUrl || metaHint.overview);

  const cacheKey = `enhanced:${query.toLowerCase()}:${audio.toLowerCase()}:${metaHint.year}`;
  const cached = getSearchCache(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  try {
    const output = await searchMediaEnhanced(query, audio, hasMeta ? metaHint : null);
    if (Array.isArray(output.results) && output.results.length > 0) {
      setSearchCache(cacheKey, output);
    }
    res.json(output);
  } catch (err) {
    console.error(`[JackIn Media] Enhanced search error: ${(err as Error).message}`);
    res.json({ query, results: [], llmEnhanced: false });
  }
});

// POST /api/media-search/download
router.post('/download', (req: Request, res: Response) => {
  const { title, quality, sourceUrl, posterUrl, altSourceUrls, seriesTitle, seasonNumber, episodeNumber, episodeTitle, requirePt } = req.body;
  if (!title || !sourceUrl) {
    res.status(400).json({ error: 'Title and sourceUrl are required' });
    return;
  }
  const wantPt = requirePt === true;
  // sql.js rejeita `undefined` em binds — normaliza para null.
  const sNum = seasonNumber == null ? null : Number(seasonNumber);
  const eNum = episodeNumber == null ? null : Number(episodeNumber);
  // Alternativas reais fornecidas pela busca (frontend) — usadas em cascata
  // quando o magnet primário está morto (seeders fantasmas). Filtra duplicatas.
  const alts = Array.isArray(altSourceUrls)
    ? [...new Set((altSourceUrls as string[]).filter((u) => u && u !== sourceUrl))]
    : [];

  const id = uuid();
  const db = getDb();

  const isSeries = sNum != null || eNum != null;
  const projectType = isSeries ? 'series' : 'movie';
  // Temporada inteira: "Série (T2)"; episódio específico: usa o título do ep.
  const formattedTitle = isSeries && sNum != null && eNum == null
    ? `${title} (T${sNum})`
    : isSeries && episodeTitle
      ? `${episodeTitle}`
      : `${title} (${quality || '4K'})`;

  let seriesId: string | null = null;
  if (isSeries && seriesTitle) {
    // Agrupa TODAS as temporadas de uma série sob o mesmo seriesId (ignora a
    // temporada) para o JackIn Flix mostrar uma entrada única por série.
    const existing = db.exec(
      'SELECT series_id FROM projects WHERE series_id IS NOT NULL AND project_type = ? AND title LIKE ? LIMIT 1',
      ['series', `%${seriesTitle}%`]
    );
    seriesId = (existing[0]?.values[0]?.[0] as string) || id;
  }

  const config = JSON.stringify({ sourceUrl, quality: quality || '4K', posterUrl: posterUrl || '', altSourceUrls: alts, requirePt: wantPt });
  console.log(`[JackIn Media] Criando projeto de mídia ${id} para: ${formattedTitle}`);

  if (isSeries) {
    db.run(
      'INSERT INTO projects (id, youtube_url, title, status, project_type, faceless_config, series_id, season_number, episode_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, sourceUrl, formattedTitle, 'downloading', projectType, config, seriesId, sNum, eNum]
    );
  } else {
    db.run(
      'INSERT INTO projects (id, youtube_url, title, status, project_type, faceless_config) VALUES (?, ?, ?, ?, ?, ?)',
      [id, sourceUrl, formattedTitle, 'downloading', projectType, config]
    );
  }
  persist();

  // Já dispara com alternatives: se o magnet escolhido estiver morto (seeders
  // fantasmas, DL:0B), o worker tenta os próximos automaticamente em cascata.
  startMovieDownload(id, { sourceUrl, title, quality: quality || '4K', posterUrl: posterUrl || '', altSourceUrls: alts, requirePt: wantPt });
  findBetterDownloadOptions(title, 4, wantPt)
    .then((altOpts) => {
      const altsFromSearch = altOpts.map((o) => o.sourceUrl!).filter((u) => u && u !== sourceUrl);
      const mergedAlts = [...new Set([...alts, ...altsFromSearch])];
      if (mergedAlts.length > 0) {
        try {
          db.run('UPDATE projects SET faceless_config = ? WHERE id = ?', [JSON.stringify({ sourceUrl, title, quality: quality || '4K', posterUrl: posterUrl || '', altSourceUrls: mergedAlts, requirePt: wantPt }), id]);
          persist();
        } catch {}
        // Se o worker primário já terminou (muito rápido ou falhou), refaz com alternativas.
        if (!runningDownloads.has(id)) {
          const st = db.exec('SELECT status FROM projects WHERE id = ?', [id])[0]?.values[0]?.[0];
          if (st === 'error') {
            startMovieDownload(id, { sourceUrl, title, quality: quality || '4K', posterUrl: posterUrl || '', altSourceUrls: mergedAlts, requirePt: wantPt });
          }
        }
      }
    })
    .catch(() => {});

  res.status(201).json({
    id,
    title: formattedTitle,
    status: 'downloading',
    quality: quality || '4K'
  });
});

// POST /api/media-search/retry/:projectId
router.post('/retry/:projectId', async (req: Request, res: Response) => {  const projectId = String(req.params.projectId);
  const db = getDb();

  const row = db.exec(
    'SELECT id, youtube_url, title, status, faceless_config FROM projects WHERE id = ?',
    [projectId]
  )[0]?.values[0];

  if (!row) {
    res.status(404).json({ error: 'Projeto não encontrado' });
    return;
  }

  const [, sourceUrl, title, status, facelessRaw] = row as [string, string, string, string, string | null];
  // Retry manual zera o contador de auto-retry para um ciclo novo.
  autoRetryState.delete(projectId);

  const hasActiveWorker = runningProcesses.has(projectId) && runningProcesses.get(projectId)?.exitCode === null;
  if (hasActiveWorker) {
    res.status(409).json({ error: 'Download já em andamento' });
    return;
  }
  runningDownloads.delete(projectId);
  // Prepare "em andamento" num projeto que já está em erro/cancelado é um
  // prepare PRESO (ex.: ffmpeg pendurado que nunca emitiu close) — o watchdog
  // do runFfmpeg eventualmente mata o processo, mas enquanto a entrada de
  // runningPrep não é limpa o isPreparing() retorna true e o retry fica
  // eternamente em 409. Força o cancelamento do prepare stale e segue o fluxo
  // normal de retry (re-download ou re-prepare, conforme o caso abaixo).
  if (isPreparing(projectId)) {
    if (status === 'error' || status === 'cancelled') {
      cancelPreparation(projectId);
    } else {
      res.status(409).json({ error: 'Preparação de playback já em andamento' });
      return;
    }
  }
  // Permite retry se estiver com erro, cancelado, preparing preso, ou downloading sem worker ativo.
  const isStalledDownloading = status === 'downloading' && !runningDownloads.has(projectId);
  if (status !== 'error' && status !== 'cancelled' && status !== 'preparing' && !isStalledDownloading) {
    res.status(400).json({ error: `Status atual (${status}) não permite tentar novamente` });
    return;
  }

  // Caso especial: download concluído mas com prepare falho (status 'error'
  // com arquivo no disco, ex.: ffprobe transitório na finalização). Não
  // re-baixar GBs à toa — re-dispara o pipeline de prepare. Se não houver
  // master ou se o download estiver incompleto (.aria2 ativo), cai no re-download/resume normal abaixo.
  if (status === 'preparing' || status === 'error') {
    const pm = getProjectMedia(projectId);
    const projectDir = path.join(DATA_DIR, 'projects', projectId);
    const masterFile = path.join(projectDir, 'master.mp4');
    const hasMaster = fs.existsSync(masterFile) && fs.statSync(masterFile).size > 1000000;

    let hasAria2 = false;
    try {
      const walk = (d: string) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) walk(path.join(d, e.name));
          else if (e.name.endsWith('.aria2')) hasAria2 = true;
        }
      };
      if (fs.existsSync(projectDir)) walk(projectDir);
    } catch {}

    const videoExists = pm?.videoPath && fs.existsSync(pm.videoPath);
    const isComplete = hasMaster || (videoExists && !hasAria2);

    if (isComplete) {
      try {
        db.run('UPDATE projects SET status = ?, error_message = NULL, prep_state = ? WHERE id = ?', ['preparing', 'none', projectId]);
        persist();
      } catch {}
      prepareProject(projectId)
        .then(() => {
          progressEvents.emit(projectId, { stage: 'done', progress: 100, status: 'Pronto para assistir' });
        })
        .catch((e: any) => {
          console.error(`[JackIn Media] Re-prepare do projeto ${projectId} falhou:`, e);
          try {
            db.run('UPDATE projects SET status = ?, error_message = ? WHERE id = ?', ['error', `Falha ao preparar playback: ${e.message}`, projectId]);
            persist();
          } catch {}
          progressEvents.emit(projectId, { stage: 'error', progress: 0, status: `Erro: ${e.message}` });
        });
      res.json({ id: projectId, status: 'preparing', source: 'prepare' });
      return;
    }
  }

  let opts: DownloadOptions | null = null;
  if (facelessRaw) {
    try {
      const parsed = JSON.parse(facelessRaw);
      if (parsed.sourceUrl) {
        opts = {
          sourceUrl: parsed.sourceUrl,
          title: parsed.title || title,
          quality: parsed.quality || '4K',
          posterUrl: parsed.posterUrl || '',
          altSourceUrls: Array.isArray(parsed.altSourceUrls) ? parsed.altSourceUrls : undefined,
          requirePt: parsed.requirePt === true,
        };
      }
    } catch {
      // ignore
    }
  }
  if (!opts && sourceUrl) {
    // Fallback: parse quality/title from the formatted title "Título (Qualidade)"
    const t = title || 'Mídia';
    const m = t.match(/^(.+?)\s*\((.+)\)$/);
    opts = {
      sourceUrl,
      title: m ? m[1] : t,
      quality: m ? m[2] : '4K',
      posterUrl: '',
    };
  }
  if (!opts || !opts.sourceUrl) {
    res.status(400).json({ error: 'Fonte de download indisponível para tentar novamente' });
    return;
  }

  // Claim the download slot
  runningDownloads.add(projectId);
  db.run(
    'UPDATE projects SET status = ? WHERE id = ?',
    ['downloading', projectId]
  );
  persist();

  // Clean partial files so the retry starts fresh
  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  try {
    if (fs.existsSync(projectDir)) {
      for (const f of fs.readdirSync(projectDir)) {
        const fullPath = path.join(projectDir, f);
        if (f.startsWith('source_') || f.startsWith('original.') || f.endsWith('.aria2') || f.endsWith('.quarantine')) {
          try { fs.unlinkSync(fullPath); } catch {}
        } else {
          const st = fs.statSync(fullPath);
          if (st.isDirectory()) {
            try { fs.rmSync(fullPath, { recursive: true, force: true }); } catch {}
          }
        }
      }
    }
  } catch (e) {
    console.error('[JackIn Media] Erro ao limpar arquivos parciais:', e);
  }

  // Busca novas fontes ativas (Torrentio + Trackers) antes de iniciar
  try {
    const altOpts = await findBetterDownloadOptions(opts.title, 4, opts.requirePt);
    const real = altOpts.filter((o) => o.sourceUrl && !CURATED_SITE_RE.test(o.sourceUrl));
    const alts = altOpts.map((o) => o.sourceUrl!).filter((u) => u && u !== opts!.sourceUrl);
    const mergedAlts = [...new Set([...(opts.altSourceUrls || []), ...alts])];
    if (real.length > 0) {
      const best = real[0].sourceUrl!;
      const reordered = [...new Set([best, ...(mergedAlts.filter((u) => u !== best))])];
      const keepCurated = !reordered.includes(opts.sourceUrl) ? [...reordered, opts.sourceUrl] : reordered;
      opts = { ...opts, sourceUrl: best, altSourceUrls: keepCurated };
    } else if (mergedAlts.length > 0) {
      opts = { ...opts, altSourceUrls: mergedAlts };
    }
  } catch (err) {
    console.error('[JackIn Media] Erro ao buscar alternativas no retry:', err);
  }

  try {
    db.run(
      'UPDATE projects SET status = ?, error_message = NULL, progress_pct = 0, progress_status = NULL, faceless_config = ? WHERE id = ?',
      ['downloading', JSON.stringify(opts), projectId]
    );
    persist();

    startMovieDownload(projectId, opts);
  } catch (err) {
    runningDownloads.delete(projectId);
    const msg = `Falha ao iniciar download: ${(err as Error).message}`;
    try {
      db.run(
        'UPDATE projects SET status = ?, error_message = ? WHERE id = ?',
        ['error', msg, projectId]
      );
      persist();
    } catch {}
    res.status(500).json({ error: msg });
    return;
  }

  res.json({ id: projectId, status: 'downloading', source: 'retry' });
});

// POST /api/media-search/pause/:projectId — pause a live torrent download. The
// aria2 worker is SIGTERM'd; it keeps the .aria2 control file + partial data so
// a resume can continue from the same point.
router.post('/pause/:projectId', (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const proc = runningProcesses.get(projectId);
  if (!proc) {
    res.status(400).json({ error: 'Download não está em execução para pausar' });
    return;
  }
  pauseRequested.add(projectId);
  try {
    proc.kill('SIGTERM');
  } catch (err) {
    pauseRequested.delete(projectId);
    res.status(500).json({ error: `Falha ao pausar: ${(err as Error).message}` });
    return;
  }
  res.json({ id: projectId, status: 'pausing' });
});

// POST /api/media-search/resume/:projectId — resume a paused download. Restarts
// the worker with the stored magnet; aria2 detects the .aria2 file and picks up
// where it left off.
router.post('/resume/:projectId', (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const db = getDb();

  const row = db.exec(
    'SELECT id, title, status, faceless_config FROM projects WHERE id = ?',
    [projectId]
  )[0]?.values[0];
  if (!row) {
    res.status(404).json({ error: 'Projeto não encontrado' });
    return;
  }
  const [, title, status, facelessRaw] = row as [string, string, string, string | null];
  if (status !== 'paused') {
    res.status(400).json({ error: `Status atual (${status}) não permite retomar` });
    return;
  }

  let opts: DownloadOptions | null = null;
  if (facelessRaw) {
    try {
      const parsed = JSON.parse(facelessRaw);
      if (parsed.sourceUrl) {
        opts = {
          sourceUrl: parsed.sourceUrl,
          title: parsed.title || title,
          quality: parsed.quality || '4K',
          posterUrl: parsed.posterUrl || '',
          altSourceUrls: Array.isArray(parsed.altSourceUrls) ? parsed.altSourceUrls : undefined,
          requirePt: parsed.requirePt === true,
        };
      }
    } catch {
      // ignore
    }
  }
  if (!opts || !opts.sourceUrl) {
    res.status(400).json({ error: 'Fonte de download indisponível para retomar' });
    return;
  }

  db.run(
    'UPDATE projects SET status = ?, error_message = NULL WHERE id = ?',
    ['downloading', projectId]
  );
  persist();

  startMovieDownload(projectId, opts);
  res.json({ id: projectId, status: 'downloading', source: 'resume' });
});

// POST /api/media-search/subtitles/:projectId
// Fetch a PT-BR subtitle from OpenSubtitles for a finished download and store it
// as subs_ptbr.vtt next to the video (served by GET /projects/:id/subtitles).
router.post('/subtitles/:projectId', async (req: Request, res: Response) => {
  const projectId = String(req.params.projectId);
  const db = getDb();
  const row = db.exec(
    'SELECT video_path, title, status FROM projects WHERE id = ?',
    [projectId]
  )[0]?.values[0];

  if (!row) {
    res.status(404).json({ error: 'Projeto não encontrado' });
    return;
  }
  const [videoPath, title, status] = row as [string | null, string | null, string];
  if (status !== 'done' && status !== 'downloading') {
    res.status(400).json({ error: `Status atual (${status}) não permite buscar legendas` });
    return;
  }

  let filePath = videoPath && fs.existsSync(videoPath) ? videoPath : null;
  if (!filePath) {
    const projectDir = path.join(DATA_DIR, 'projects', projectId);
    if (fs.existsSync(projectDir)) {
      const f = fs.readdirSync(projectDir).find(x => x.endsWith('.mp4') || x.endsWith('.mkv') || x.endsWith('.webm'));
      if (f) filePath = path.join(projectDir, f);
    }
  }
  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Vídeo não encontrado' });
    return;
  }

  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  const subtitleScript = path.join(SCRIPTS_DIR, 'modules', 'media', 'subtitle_service.py');
  const proc = spawn(VENV_PYTHON, [
    subtitleScript,
    '--video', filePath,
    '--out-dir', projectDir,
    '--title', title || '',
  ], { env: { ...process.env, PYTHONUNBUFFERED: '1' } });

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  proc.on('close', (code) => {
    if (code === 0) {
      try {
        const result = JSON.parse(stdout);
        if (result.ok) {
          res.json({ ok: true, path: result.path, name: result.name || '' });
        } else {
          res.status(200).json({ ok: false, error: result.error || 'Sem legenda disponível', code: result.code || 'not_found' });
        }
      } catch {
        res.status(500).json({ error: 'Falha ao parsear resposta do serviço de legendas' });
      }
    } else {
      console.error(`[JackIn Media] Subtitle service failed: ${stderr.slice(0, 200)}`);
      res.status(500).json({ error: 'Falha no serviço de legendas', detail: stderr.slice(0, 200) });
    }
  });
});

// POST /api/media-search/import-season
// Baixa uma temporada completa do JackIn Flix a partir de UM magnet (pack),
// criando um projeto project_type='series' por episódio (com series_id,
// season_number e episode_number) e preparando cada um para playback.
// Reaproveita downloadEpisodeFromMagnet (aria2 --select-file) para baixar só o
// arquivo do episódio dentro do pack + prepareProject para transcode/legendas.
router.post('/import-season', async (req: Request, res: Response) => {
  const { seriesTitle, seasonNumber, magnetUrl, episodes } = req.body;

  if (!seriesTitle || !magnetUrl || !magnetUrl.startsWith('magnet:') || !Array.isArray(episodes) || episodes.length === 0) {
    res.status(400).json({ error: 'seriesTitle, magnetUrl (magnet:) e episodes[] são obrigatórios' });
    return;
  }
  if (seasonNumber == null || Number.isNaN(Number(seasonNumber))) {
    res.status(400).json({ error: 'seasonNumber é obrigatório' });
    return;
  }

  const db = getDb();
  const season = Number(seasonNumber);

  // Resolve um seriesId estável para a série (compartilhado entre temporadas).
  let seriesId = (db.exec(
    'SELECT series_id FROM projects WHERE series_id IS NOT NULL AND project_type = ? AND title LIKE ? LIMIT 1',
    ['series', `%${seriesTitle}%`]
  )[0]?.values[0]?.[0] as string) || null;

  const created: { id: string; code: string; title: string; episode: number; existing: boolean }[] = [];

  // Modo retomada: se a temporada já foi criada (ex.: servidor reiniciou), não
  // duplica — reprocessa apenas episódios pending/error e pula os done.
  const existingRows = seriesId
    ? db.exec(
        'SELECT id, episode_number, status, title FROM projects WHERE series_id = ? AND season_number = ?',
        [seriesId, season]
      )
    : null;
  const existingMap = new Map<number, { id: string; status: string; title: string }>();
  if (existingRows && existingRows[0]?.values.length) {
    for (const r of existingRows[0].values) {
      existingMap.set(Number(r[1]), { id: r[0] as string, status: r[2] as string, title: r[3] as string });
    }
    for (const ep of episodes) {
      const ex = existingMap.get(Number(ep.episode));
      if (!ex) continue; // episódio novo sem projeto — ignora no resume (mantém a temporada original)
      created.push({
        id: ex.id,
        code: ep.code || `S${String(season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}`,
        title: ex.title || ep.title,
        episode: Number(ep.episode),
        existing: true,
      });
    }
  } else {
    // Primeira vez: cria os projetos da temporada.
    for (const ep of episodes) {
      const id = uuid();
      const epTitle = ep.title || `${seriesTitle} S${String(season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}`;
      db.run(
        'INSERT INTO projects (id, youtube_url, title, status, project_type, faceless_config, series_id, season_number, episode_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, magnetUrl, epTitle, 'pending', 'series', JSON.stringify({ sourceUrl: magnetUrl, title: seriesTitle }), seriesId, season, ep.episode]
      );
      created.push({ id, code: ep.code || `S${String(season).padStart(2, '0')}E${String(ep.episode).padStart(2, '0')}`, title: epTitle, episode: Number(ep.episode), existing: false });
      if (!seriesId) seriesId = id; // primeiro episódio vira o seed da série
    }
  }

  if (created.length === 0) {
    res.status(200).json({ ok: true, seriesId, season, created: [], resumed: true, message: 'Nada a fazer (todos os episódios já concluídos)' });
    return;
  }

  // Cura o seed: episódios da série com series_id NULL (ex.: o primeiro, criado
  // antes de existir um id de referência) passam a pertencer ao grupo.
  if (seriesId) {
    db.run('UPDATE projects SET series_id = ? WHERE project_type = ? AND series_id IS NULL AND title LIKE ?', [seriesId, 'series', `%${seriesTitle}%`]);
  }
  persist();

  console.log(`[JackIn Media] Importando temporada ${season} de "${seriesTitle}" — ${created.length} episódios (seriesId=${seriesId})`);

  const { downloadEpisodeFromMagnet } = await import('./torrent-downloader.js');
  const { prepareProject } = await import('../../services/media-service.js');

  const hasCompleteVideo = (dir: string): string | null => {
    if (!fs.existsSync(dir)) return null;
    let found: string | null = null;
    const walk = (d: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(d, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) {
          walk(p);
        } else if (e.name.endsWith('.aria2')) {
          found = null; // download ainda em curso → sem arquivo completo confiável
        } else if (/\.(mp4|mkv|webm|avi|mov|m4v)$/i.test(e.name)) {
          if (!found || fs.statSync(p).size > fs.statSync(found).size) found = p;
        }
      }
    };
    walk(dir);
    return found;
  };

  // Baixa e prepara episódios em sequência (evita saturar banda/disco).
  (async () => {
    for (const proj of created) {
      const cur = db.exec('SELECT status FROM projects WHERE id = ?', [proj.id])[0]?.values[0]?.[0] as string | null;
      if (!cur || cur === 'cancelled') {
        console.log(`[JackIn Media] Episódio ${proj.code} cancelado — pulando.`);
        continue;
      }
      if (cur === 'done') {
        console.log(`[JackIn Media] Episódio ${proj.code} já concluído — pulando.`);
        continue;
      }

      const projectDir = path.join(DATA_DIR, 'projects', proj.id);
      runningDownloads.add(proj.id);
      try {
        db.run('UPDATE projects SET status = ?, error_message = NULL WHERE id = ?', ['downloading', proj.id]);
        persist();

        // Se o vídeo já foi baixado (ex.: aria2 terminou antes do restart), só
        // prepara. Senão limpa parciais e baixa seletivamente do pack.
        const complete = hasCompleteVideo(projectDir);
        let videoPath = complete;
        if (!videoPath) {
          for (const f of fs.existsSync(projectDir) ? fs.readdirSync(projectDir) : []) {
            const full = path.join(projectDir, f);
            const st = fs.statSync(full);
            if (st.isDirectory()) {
              try { fs.rmSync(full, { recursive: true, force: true }); } catch {}
            } else if (f.endsWith('.aria2') || f.endsWith('.torrent') || f.startsWith('original.') || f.startsWith('master.') || f.startsWith('playable.') || f.startsWith('audio_')) {
              try { fs.unlinkSync(full); } catch {}
            }
          }
          videoPath = await downloadEpisodeFromMagnet(
            magnetUrl,
            proj.code,
            projectDir,
            proj.id,
            (p) => progressEvents.emit(proj.id, { stage: 'downloading', progress: p.progress, status: p.status })
          );
        }

        db.run('UPDATE projects SET status = ?, video_path = ? WHERE id = ?', ['preparing', videoPath, proj.id]);
        persist();

        await prepareProject(proj.id);

        db.run('UPDATE projects SET status = ? WHERE id = ?', ['done', proj.id]);
        persist();
        progressEvents.emit(proj.id, { stage: 'done', progress: 100, status: 'Pronto para assistir' });
        console.log(`[JackIn Media] Episódio ${proj.code} pronto.`);
      } catch (err: any) {
        console.error(`[JackIn Media] Falha no episódio ${proj.code}:`, err?.message || err);
        try {
          db.run('UPDATE projects SET status = ?, error_message = ? WHERE id = ?', ['error', String(err?.message || err), proj.id]);
          persist();
        } catch {}
        progressEvents.emit(proj.id, { stage: 'error', progress: 0, status: `Erro: ${err?.message || 'Falha no download'}` });
      } finally {
        runningDownloads.delete(proj.id);
      }
    }
    console.log(`[JackIn Media] Importação da temporada ${season} de "${seriesTitle}" finalizada.`);
  })();

  res.status(201).json({ ok: true, seriesId, season, created: created.map((c) => ({ id: c.id, code: c.code })) });
});

export default router;
