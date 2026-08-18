import { spawn, execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { FFMPEG_BIN, FFPROBE_BIN } from './binary-paths.js';
import { getDb, persist, DATA_DIR } from '../db/schema.js';
import { progressEvents } from './progress-events.js';
import { codeToLang, LANG_LABEL } from './language-map.js';

export type PrepState = 'none' | 'running' | 'partial' | 'done' | 'failed';
export type Target = 'hevc' | 'h264';
export type Tier = 'direct' | 'remux' | 'transcode';

export interface MediaStreamInfo {
  index: number;
  codecType: 'video' | 'audio' | 'subtitle';
  codec: string;
  profile?: string;
  pixFmt?: string;
  bitDepth?: number;
  fps?: number;
  channels?: number;
  channelLayout?: string;
  sampleRate?: number;
  bitRate?: number;
  language?: string;
  title?: string;
}

export interface MediaInfo {
  path: string;
  sizeBytes: number;
  mtimeMs: number;
  duration: number;
  formatNames: string[];
  streams: MediaStreamInfo[];
  video?: MediaStreamInfo;
  audio: MediaStreamInfo[];
  subtitles: MediaStreamInfo[];
  hdr: 'hdr10' | 'hlg' | 'dv' | 'sdr';
  dvProfile?: number;
  moovAtHead: boolean;
}

export interface ArtifactInfo {
  path: string;
  fingerprint: string;
  size: number;
}

export interface Artifacts {
  master: ArtifactInfo | null;
  playable: ArtifactInfo | null;
  audio: Record<string, ArtifactInfo>;
  subs: Record<string, ArtifactInfo>;
}

interface ProjectMediaRow {
  id: string;
  status: string;
  videoPath: string | null;
  mediaInfo: MediaInfo | null;
  prepState: PrepState;
  prepError: string | null;
  prepSettingsHash: string | null;
  artifacts: Artifacts | null;
}

// ── Listas seguras por target ─────────────────────────────────────────────
const VIDEO_SAFE: Record<Target, Set<string>> = {
  hevc: new Set(['h264', 'hevc']),
  h264: new Set(['h264', 'vp8', 'vp9', 'av1']),
};

const AUDIO_SAFE: Record<Target, Set<string>> = {
  hevc: new Set(['aac', 'ac3', 'eac3', 'mp3']),
  h264: new Set(['aac', 'mp3', 'opus']),
};

const CONTAINER_SAFE: Record<Target, Set<string>> = {
  hevc: new Set(['mp4', 'mov', 'm4v']),
  h264: new Set(['mp4', 'mov', 'm4v', 'webm']),
};

const TEXT_SUB_CODECS = new Set(['subrip', 'ass', 'ssa', 'webvtt', 'mov_text', 'srt', 'text', 'mp4']);

// ── Cache de probe (mtime+size) ───────────────────────────────────────────
const probeCache = new Map<string, { key: string; info: MediaInfo }>();

function fileKey(filePath: string): string {
  try {
    const st = fs.statSync(filePath);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return 'missing';
  }
}

// ── Helpers de baixo nível ────────────────────────────────────────────────
function hasMoovAtHead(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(65536);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    let off = 0;
    while (off + 8 <= bytes) {
      const size = buf.readUInt32BE(off);
      const type = buf.toString('ascii', off + 4, off + 8);
      if (type === 'moov') return true;
      if (size < 8 || size > 1 << 30) break;
      off += size;
    }
    return false;
  } catch {
    return false;
  }
}

function detectHdrFromProbe(data: any): { hdr: MediaInfo['hdr']; dvProfile?: number } {
  const v = (data.streams || []).find((s: any) => s.codec_type === 'video');
  if (!v) return { hdr: 'sdr' };
  const transfer = v.color_transfer || '';
  const primaries = v.color_primaries || '';
  const dv = (v.side_data_list || []).find((sd: any) => String(sd.side_data_type || sd.type || '').toLowerCase().includes('dovi') || (sd.dv_profile !== undefined));
  if (dv) {
    const p = Number(dv.dv_profile || dv.bitstream_profile_id || 0);
    return { hdr: 'dv', dvProfile: p };
  }
  if (transfer.includes('smpte2084') && primaries.includes('bt2020')) return { hdr: 'hdr10' };
  if (transfer.includes('arib-std-b67')) return { hdr: 'hlg' };
  return { hdr: 'sdr' };
}

function languageOf(tags: any, disposition: any): string {
  const lang = (tags?.language || '').toLowerCase();
  if (lang && lang !== 'und') return lang;
  if (disposition?.original === 1) return 'orig';
  return 'und';
}

export function probeMedia(filePath: string): Promise<MediaInfo> {
  const key = fileKey(filePath);
  const cached = probeCache.get(filePath);
  if (cached && cached.key === key) return Promise.resolve(cached.info);

  return new Promise((resolve, reject) => {
    execFile(
      FFPROBE_BIN,
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
      { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(new Error(`ffprobe falhou: ${err.message}`));
        try {
          const data = JSON.parse(stdout);
          const fmt = data.format || {};
          const streams: MediaStreamInfo[] = (data.streams || []).map((s: any, i: number) => ({
            index: s.index ?? i,
            codecType: s.codec_type as any,
            codec: s.codec_name || '',
            profile: s.profile || undefined,
            pixFmt: s.pix_fmt || undefined,
            bitDepth: s.bits_per_raw_sample ? Number(s.bits_per_raw_sample) : undefined,
            fps: s.avg_frame_rate && s.avg_frame_rate !== '0/0' ? evalFps(s.avg_frame_rate) : undefined,
            channels: s.channels !== undefined ? Number(s.channels) : undefined,
            channelLayout: s.channel_layout || undefined,
            sampleRate: s.sample_rate ? Number(s.sample_rate) : undefined,
            bitRate: s.bit_rate ? Number(s.bit_rate) : undefined,
            language: languageOf(s.tags, s.disposition),
            title: s.tags?.title || undefined,
          }));
          const video = streams.find((s) => s.codecType === 'video');
          const hdr = detectHdrFromProbe(data);
          const st = fs.statSync(filePath);
          const info: MediaInfo = {
            path: filePath,
            sizeBytes: st.size,
            mtimeMs: st.mtimeMs,
            duration: parseFloat(fmt.duration || '0'),
            formatNames: String(fmt.format_name || '').split(',').map((s: string) => s.trim()).filter(Boolean),
            streams,
            video,
            audio: streams.filter((s) => s.codecType === 'audio'),
            subtitles: streams.filter((s) => s.codecType === 'subtitle'),
            hdr: hdr.hdr,
            dvProfile: hdr.dvProfile,
            moovAtHead: hasMoovAtHead(filePath),
          };
          probeCache.set(filePath, { key, info });
          resolve(info);
        } catch (e: any) {
          reject(new Error(`ffprobe parse falhou: ${e.message}`));
        }
      }
    );
  });
}

function evalFps(rate: string): number {
  const [n, d] = rate.split('/').map(Number);
  if (!d) return 0;
  return Math.round((n / d) * 100) / 100;
}

// ── Classificação ─────────────────────────────────────────────────────────
export function classifyForTarget(info: MediaInfo, target: Target): Tier {
  const video = info.video;
  if (!video) return 'transcode';

  // Dolby Vision Profile 7 dual-layer: remux/copy quebra no MP4 — força transcode.
  if (info.hdr === 'dv' && info.dvProfile === 7) return 'transcode';

  // Vídeo incompatível com o target exige re-encode de vídeo (transcode).
  if (!VIDEO_SAFE[target].has(video.codec)) return 'transcode';

  // Vídeo ok: direct só se contêiner + áudio + moov no topo (faststart) —
  // sem moov no topo, o seek fica degradado; melhor gerar o master remuxado.
  const containerOk = info.formatNames.some((f) => CONTAINER_SAFE[target].has(f));
  const audioOk = info.audio.length > 0 && info.audio.every((a) => AUDIO_SAFE[target].has(a.codec));
  if (containerOk && audioOk && info.moovAtHead) return 'direct';

  return 'remux';
}

// ── Bitrate de áudio por canal ────────────────────────────────────────────
export function audioBitrate(channels: number, codec: 'eac3' | 'aac'): string {
  if (codec === 'eac3') {
    if (channels >= 7) return '768k';
    if (channels >= 5) return '448k';
    return '320k';
  }
  if (channels >= 7) return '640k';
  if (channels >= 5) return '448k';
  return '320k';
}

function fingerprintFile(filePath: string): string {
  try {
    const st = fs.statSync(filePath);
    const head = Buffer.alloc(65536);
    const fd = fs.openSync(filePath, 'r');
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    return crypto.createHash('sha256').update(`${st.size}:${st.mtimeMs}`).update(head.subarray(0, n)).digest('hex');
  } catch {
    return 'missing';
  }
}

function artifactOf(filePath: string): ArtifactInfo {
  return { path: filePath, fingerprint: fingerprintFile(filePath), size: fs.existsSync(filePath) ? fs.statSync(filePath).size : 0 };
}

// ── Legendas sidecar (.srt/.ass/.ssa baixadas junto ao vídeo) ─────────────
const SIDECAR_EXT = new Set(['.srt', '.ass', '.ssa', '.vtt']);

function findSidecarSubtitles(projectDir: string, masterPath: string): string[] {
  if (!fs.existsSync(projectDir)) return [];
  const out: string[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 2) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (![...SIDECAR_EXT].some((e) => lower.endsWith(e))) continue;
      if (/^subs_[a-z0-9-]+\.vtt$/i.test(entry.name)) continue; // artefato gerado
      if (lower.includes('subs_ptbr')) continue;
      if (full === masterPath) continue;
      out.push(full);
    }
  };
  walk(projectDir, 0);
  return out;
}

function detectSubEncoding(filePath: string): 'utf-8' | 'latin1' {
  try {
    const buf = fs.readFileSync(filePath);
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return 'utf-8';
  } catch {
    return 'latin1';
  }
}

function countSubtitleCues(filePath: string): number {
  try {
    const buf = fs.readFileSync(filePath);
    let count = 0;
    for (let i = 0; i < buf.length - 2; i++) {
      if (buf[i] === 45 && buf[i + 1] === 45 && buf[i + 2] === 62) count++; // '-->'
    }
    return count;
  } catch {
    return 0;
  }
}

function pickBestSidecar(candidates: string[]): string | null {
  if (candidates.length === 0) return null;
  const score = (p: string): number => {
    const n = path.basename(p).toLowerCase();
    let s = 0;
    if (/\b(completa|completo|full|legendado|legendada|portugu[eê]s|pt[- ]?br|ptbr|por|bra|brazil)\b/.test(n)) s += 10;
    if (/\b(for[cç]ada|forced|signs)\b/.test(n)) s -= 8;
    if (/\.ass$/.test(p)) s += 1;
    return s;
  };
  const scored = candidates
    .map((p) => ({ p, s: score(p), cues: countSubtitleCues(p) }))
    .sort((a, b) => b.s - a.s || b.cues - a.cues);
  return scored[0].p;
}

async function convertSidecarToVtt(sidecarPath: string, outVtt: string, projectId?: string): Promise<boolean> {
  const ext = path.extname(sidecarPath).toLowerCase();
  const args: string[] = ['-y'];
  if (detectSubEncoding(sidecarPath) === 'latin1') args.push('-sub_charenc', 'windows-1252');
  args.push('-i', sidecarPath);
  if (ext === '.vtt') {
    args.push('-c', 'copy', outVtt);
  } else {
    args.push('-c:s', 'webvtt', '-f', 'webvtt', outVtt);
  }
  try {
    await runFfmpeg(args, 0, () => {}, projectId);
    if (!fs.existsSync(outVtt)) return false;
    return fs.statSync(outVtt).size > 100;
  } catch (e) {
    console.warn(`[JackIn] Sidecar convert failed ${sidecarPath}: ${(e as Error).message}`);
    return false;
  }
}

async function importSidecarSubtitles(projectId: string, projectDir: string, master: string, artifacts: Artifacts): Promise<void> {
  const candidates = findSidecarSubtitles(projectDir, master);
  const best = pickBestSidecar(candidates);
  if (!best) return;
  const out = path.join(projectDir, 'subs_ptbr.vtt');
  const tmp = out + `.tmp-${process.pid}`;
  emitPrep(projectId, 94, 'Importando legenda externa (sidecar)...');
  try {
    if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    const ok = await convertSidecarToVtt(best, tmp, projectId);
    if (!ok || !fs.existsSync(tmp)) return;
    if (fs.existsSync(out)) fs.unlinkSync(out);
    fs.renameSync(tmp, out);
    artifacts.subs['pt-br'] = artifactOf(out);
    updatePrepState(projectId, 'partial', { artifacts });
  } catch (e) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    console.warn(`[JackIn] Sidecar import failed: ${(e as Error).message}`);
  }
}

// ── Acesso a banco ────────────────────────────────────────────────────────
function readJson(db: any, sql: string, params: any[]): any {
  const row = db.exec(sql, params)[0]?.values[0];
  if (!row || row[0] == null) return null;
  try {
    return JSON.parse(row[0] as string);
  } catch {
    return null;
  }
}

export function getProjectMedia(projectId: string): ProjectMediaRow | null {
  const db = getDb();
  const row = db.exec(
    'SELECT id, status, video_path, media_info, prep_state, prep_error, prep_settings_hash, artifacts FROM projects WHERE id = ?',
    [projectId]
  )[0]?.values[0];
  if (!row) return null;
  return {
    id: row[0] as string,
    status: row[1] as string,
    videoPath: (row[2] as string) || null,
    mediaInfo: row[3] ? JSON.parse(row[3] as string) as MediaInfo : null,
    prepState: (row[4] as PrepState) || 'none',
    prepError: (row[5] as string) || null,
    prepSettingsHash: (row[6] as string) || null,
    artifacts: row[7] ? JSON.parse(row[7] as string) as Artifacts : null,
  };
}

function updatePrepState(projectId: string, state: PrepState, extra?: { error?: string; mediaInfo?: MediaInfo; artifacts?: Artifacts; settingsHash?: string }) {
  const db = getDb();
  if (extra?.mediaInfo) db.run('UPDATE projects SET media_info = ? WHERE id = ?', [JSON.stringify(extra.mediaInfo), projectId]);
  if (extra?.artifacts) db.run('UPDATE projects SET artifacts = ? WHERE id = ?', [JSON.stringify(extra.artifacts), projectId]);
  if (extra?.settingsHash) db.run('UPDATE projects SET prep_settings_hash = ? WHERE id = ?', [extra.settingsHash, projectId]);
  if (extra?.error) db.run('UPDATE projects SET prep_error = ? WHERE id = ?', [extra.error, projectId]);
  db.run('UPDATE projects SET prep_state = ? WHERE id = ?', [state, projectId]);
  persist();
}

// Prepare falhou: além do prep_state='failed', o projeto NÃO pode ficar
// eternamente em 'preparing' — marca 'error' para a UI oferecer "Tentar
// novamente" e o usuário ver de verdade o que falhou.
function markPrepFailed(projectId: string, error: string, artifacts?: Artifacts) {
  updatePrepState(projectId, 'failed', { error, artifacts });
  const db = getDb();
  const cur = db.exec('SELECT status FROM projects WHERE id = ?', [projectId])[0]?.values[0]?.[0];
  if (cur === 'preparing' || cur === 'pending') {
    db.run('UPDATE projects SET status = ?, error_message = ? WHERE id = ?', ['error', error, projectId]);
    persist();
    progressEvents.emit(projectId, { stage: 'error', progress: 0, status: `Erro ao preparar: ${error}` });
  }
}

function emitPrep(projectId: string, progress: number, status: string) {
  progressEvents.emit(projectId, { stage: 'preparing', progress: Math.min(100, Math.round(progress)), status });
}

// ── FFmpeg runner com progresso real (out_time) ───────────────────────────
const activeFfmpegProcesses = new Map<string, any>();

export function cancelPreparation(projectId: string): boolean {
  let cancelled = false;
  const proc = activeFfmpegProcesses.get(projectId);
  if (proc) {
    try {
      proc.kill('SIGKILL');
    } catch {}
    activeFfmpegProcesses.delete(projectId);
    cancelled = true;
  }
  if (runningPrep.has(projectId)) {
    runningPrep.delete(projectId);
    cancelled = true;
  }

  try {
    const projectDir = path.join(DATA_DIR, 'projects', projectId);
    if (fs.existsSync(projectDir)) {
      const files = fs.readdirSync(projectDir);
      for (const f of files) {
        if (f.includes('.tmp-')) {
          try { fs.unlinkSync(path.join(projectDir, f)); } catch {}
        }
      }
    }
  } catch {}

  return cancelled;
}

function runFfmpeg(args: string[], durationSec: number, onProgress: (pct: number) => void, projectId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // -progress pipe:1 emite out_time_ms=... em stdout para progresso real.
    const proc = spawn(FFMPEG_BIN, [...args, '-progress', 'pipe:1', '-nostats'], { stdio: ['ignore', 'pipe', 'pipe'] });
    if (projectId) {
      activeFfmpegProcesses.set(projectId, proc);
    }
    let stderrFull = '';
    let sawProgress = false;

    proc.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const m = text.match(/out_time_ms=(\d+)/);
      if (m && durationSec > 0) {
        sawProgress = true;
        const pct = (Number(m[1]) / 1e6 / durationSec) * 100;
        onProgress(Math.min(99, pct));
      }
    });

    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrFull += chunk.toString();
      if (stderrFull.length > 8000) {
        stderrFull = stderrFull.slice(stderrFull.length - 8000);
      }
    });

    proc.on('error', (err) => {
      if (projectId && activeFfmpegProcesses.get(projectId) === proc) {
        activeFfmpegProcesses.delete(projectId);
      }
      reject(new Error(`ffmpeg spawn: ${err.message}`));
    });

    proc.on('close', (code, signal) => {
      if (projectId && activeFfmpegProcesses.get(projectId) === proc) {
        activeFfmpegProcesses.delete(projectId);
      }
      if (code === 0) {
        if (!sawProgress) onProgress(100);
        resolve('');
      } else if (signal === 'SIGTERM' || signal === 'SIGKILL' || proc.killed) {
        reject(new Error(`ffmpeg cancelado (${signal || 'kill'})`));
      } else {
        const tail = stderrFull.trim().split('\n').slice(-8).join(' | ').slice(0, 500);
        reject(new Error(`ffmpeg exit ${code}: ${tail}`));
      }
    });
  });
}

// ── Geração de artefatos ──────────────────────────────────────────────────
function buildMasterArgs(info: MediaInfo, outPath: string): string[] {
  const args: string[] = ['-y', '-i', info.path, '-map', '0:v:0', '-c:v', 'copy'];
  if (info.video?.codec === 'hevc') args.push('-tag:v', 'hvc1');
  args.push('-map', '0:a');
  const audioNeedsTranscode = info.audio.some((a) => !AUDIO_SAFE.hevc.has(a.codec));
  const maxCh = Math.max(...info.audio.map((a) => a.channels || 2));
  if (audioNeedsTranscode) {
    // EAC3 não suporta mono; em arquivos mono (fora do padrão), usa AAC 2.0.
    if (maxCh >= 2) {
      args.push('-c:a', 'eac3');
      args.push('-b:a', audioBitrate(maxCh, 'eac3'));
    } else {
      args.push('-c:a', 'aac', '-b:a', '192k');
    }
  } else {
    args.push('-c:a', 'copy');
  }
  const textSubs = info.subtitles.filter((s) => TEXT_SUB_CODECS.has(s.codec));
  if (textSubs.length > 0) {
    args.push('-map', '0:s?', '-c:s', 'mov_text');
  }
  args.push('-movflags', '+faststart', '-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '1024', '-f', 'mp4', outPath);
  return args;
}

function toneMapFilter(info: MediaInfo): string[] {
  if (info.hdr === 'sdr') return [];
  return ['-vf', 'tonemap=hable:desat=0,format=yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];
}

function buildPlayableArgs(info: MediaInfo, outPath: string): string[] {
  const fastTranscode = process.env.JACKIN_FAST_TRANSCODE === '1';
  const args: string[] = ['-y', '-i', info.path, '-map', '0:v:0'];
  if (info.video?.codec === 'h264' || info.video?.codec === 'vp9' || info.video?.codec === 'vp8' || info.video?.codec === 'av1') {
    args.push('-c:v', 'copy');
  } else if (fastTranscode) {
    args.push('-c:v', 'h264_videotoolbox', '-q:v', '65', '-allow_sw', '1');
  } else {
    args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18');
  }
  args.push(...toneMapFilter(info));
  args.push('-map', '0:a');
  const audioNeedsTranscode = info.audio.some((a) => !AUDIO_SAFE.h264.has(a.codec));
  if (audioNeedsTranscode) {
    args.push('-c:a', 'aac');
    const maxCh = Math.max(...info.audio.map((a) => a.channels || 2));
    args.push('-b:a', audioBitrate(maxCh, 'aac'));
  } else {
    args.push('-c:a', 'copy');
  }
  const textSubs = info.subtitles.filter((s) => TEXT_SUB_CODECS.has(s.codec));
  if (textSubs.length > 0) {
    args.push('-map', '0:s?', '-c:s', 'mov_text');
  }
  args.push('-movflags', '+faststart', '-avoid_negative_ts', 'make_zero', '-max_muxing_queue_size', '1024', '-f', 'mp4', outPath);
  return args;
}

function buildAudioVariantArgs(info: MediaInfo, audioIdx: number, outPath: string): string[] {
  const track = info.audio.find((a) => a.index === audioIdx) || info.audio[audioIdx];
  const args: string[] = ['-y', '-i', info.path, '-map', '0:v:0', '-c:v', 'copy'];
  if (info.video?.codec === 'hevc') args.push('-tag:v', 'hvc1');
  args.push('-map', `0:${track.index}`, '-c:a', track.codec === 'aac' ? 'copy' : 'aac', '-b:a', audioBitrate(track.channels || 2, 'aac'));
  args.push('-movflags', '+faststart', '-avoid_negative_ts', 'make_zero', '-f', 'mp4', outPath);
  return args;
}

// ── Hash de settings (recovery idempotente) ───────────────────────────────
function settingsHash(info: MediaInfo): string {
  const summary = {
    fmt: info.formatNames,
    v: info.video ? { c: info.video.codec, p: info.video.profile, bd: info.video.bitDepth, pf: info.video.pixFmt } : null,
    hdr: info.hdr,
    dv: info.dvProfile,
    audio: info.audio.map((a) => ({ c: a.codec, ch: a.channels, l: a.language })),
    subs: info.subtitles.map((s) => s.codec),
    flags: { fast: process.env.JACKIN_FAST_TRANSCODE === '1' },
  };
  return crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex');
}

// ── Encontrar master na pasta do projeto ──────────────────────────────────
export function findMasterFile(projectDir: string): string | null {
  if (!fs.existsSync(projectDir)) return null;
  const files = fs.readdirSync(projectDir);
  const videoRe = /\.(mp4|mkv|webm|avi|mov|m4v|ts|m2ts)$/i;
  const preferred = files.find((f) => f.startsWith('master.') && videoRe.test(f));
  if (preferred) return path.join(projectDir, preferred);
  const original = files.find((f) => f.startsWith('original.') && videoRe.test(f));
  if (original) return path.join(projectDir, original);
  const source = files.find((f) => f.startsWith('source_') && videoRe.test(f));
  if (source) return path.join(projectDir, source);
  const any = files.find((f) => videoRe.test(f));
  return any ? path.join(projectDir, any) : null;
}

// ── Preparation pipeline ──────────────────────────────────────────────────
const runningPrep = new Map<string, Promise<void>>();

export function isPreparing(projectId: string): boolean {
  const proc = runningPrep.get(projectId);
  return !!proc;
}

// Filas de preparação com concorrência limitada: um pack de temporada com
// dezenas de episódios dispara N prepareProject de uma vez (reconcile/índex).
// Sem trava, dezenas de ffmpeg rodam simultâneos e nada termina. Com limite,
// os episódios ficam prontos um a um — dá para assistir enquanto o resto
// prepara.
// A fila é PRIORITÁRIA: (temporada, episódio) menor sai primeiro, então a
// temporada 1 de uma série fica pronta antes das demais.
const PREP_CONCURRENCY = 3;

export interface PrepPriority {
  season: number;
  episode: number;
}

export interface PrepTask {
  priority: PrepPriority;
  run: () => Promise<void>;
}

// Índice da tarefa de menor prioridade (primeira a rodar). Puro e testável.
export function pickNextPrepIndex(tasks: PrepTask[]): number {
  let best = 0;
  for (let i = 1; i < tasks.length; i++) {
    const a = tasks[best].priority;
    const b = tasks[i].priority;
    if (b.season < a.season || (b.season === a.season && b.episode < a.episode)) best = i;
  }
  return best;
}

const prepQueue: PrepTask[] = [];
let prepActive = 0;

function pumpPrep(): void {
  while (prepActive < PREP_CONCURRENCY && prepQueue.length > 0) {
    const [task] = prepQueue.splice(pickNextPrepIndex(prepQueue), 1);
    prepActive++;
    task.run().finally(() => {
      prepActive--;
      pumpPrep();
    });
  }
}

function enqueuePrep(priority: PrepPriority, fn: () => Promise<void>): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    prepQueue.push({ priority, run: () => fn().then(resolve, reject) });
    pumpPrep();
  });
}

export function prepareProject(projectId: string): Promise<void> {
  const existing = runningPrep.get(projectId);
  if (existing) return existing;

  // Prioridade pela temporada/episódio do projeto: séries preparam a 1ª
  // temporada antes das demais; filmes (sem temporada) têm prioridade máxima.
  const row = getDb().exec('SELECT season_number, episode_number FROM projects WHERE id = ?', [projectId])[0]?.values[0];
  const priority: PrepPriority = {
    season: row && row[0] != null ? Number(row[0]) : 0,
    episode: row && row[1] != null ? Number(row[1]) : 0,
  };

  const proc = enqueuePrep(priority, () => doPrepare(projectId)).finally(() => {
    runningPrep.delete(projectId);
  });
  runningPrep.set(projectId, proc);
  return proc;
}

async function doPrepare(projectId: string): Promise<void> {
  const isAborted = () => {
    const pm = getProjectMedia(projectId);
    return !pm || pm.status === 'cancelled';
  };

  const db = getDb();
  const row = db.exec('SELECT status FROM projects WHERE id = ?', [projectId])[0]?.values[0];
  if (!row) return;

  const projectDir = path.join(DATA_DIR, 'projects', projectId);
  // Episódios indexados de um pack NÃO têm diretório próprio (o arquivo fica
  // na pasta do pack) — sem isso o ffmpeg falha ao gravar master/playable e o
  // prepare fica eternamente em "Preparando".
  fs.mkdirSync(projectDir, { recursive: true });
  // Limpa tmp órfãos de prepares mortos por restart (playable.mp4.tmp-<pid>):
  // o tmp usa o pid do SERVIDOR, então um processo novo nunca reaproveita o
  // arquivo antigo e ele fica ocupando disco para sempre. Um prepare por
  // projeto (runningPrep dedupa), então remover *.tmp-* aqui é seguro.
  try {
    for (const f of fs.readdirSync(projectDir)) {
      if (f.includes('.tmp-')) {
        try { fs.unlinkSync(path.join(projectDir, f)); } catch {}
      }
    }
  } catch {}
  const master = getProjectMedia(projectId)?.videoPath && fs.existsSync(getProjectMedia(projectId)!.videoPath!)
    ? getProjectMedia(projectId)!.videoPath!
    : findMasterFile(projectDir);
  if (!master) {
    markPrepFailed(projectId, 'Nenhum arquivo de vídeo master encontrado');
    return;
  }

  emitPrep(projectId, 1, 'Analisando arquivo...');
  let info: MediaInfo;
  try {
    info = await probeMedia(master);
  } catch (e: any) {
    if (isAborted()) return;
    markPrepFailed(projectId, e.message);
    return;
  }

  if (isAborted()) return;

  const hash = settingsHash(info);
  const existing = getProjectMedia(projectId);
  if (existing?.prepState === 'done' && existing?.prepSettingsHash === hash && existing?.artifacts) {
    // Verificar integridade: arquivos do manifest ainda existem.
    const arts = existing.artifacts;
    const allExist =
      (arts.master ? fs.existsSync(arts.master.path) : true) &&
      (arts.playable ? fs.existsSync(arts.playable.path) : true) &&
      Object.values(arts.audio).every((a) => fs.existsSync(a.path)) &&
      Object.values(arts.subs).every((a) => fs.existsSync(a.path));
    if (allExist) {
      emitPrep(projectId, 100, 'Pronto');
      return;
    }
    updatePrepState(projectId, 'running', { mediaInfo: info });
  } else {
    updatePrepState(projectId, 'running', { mediaInfo: info });
  }

  const artifacts: Artifacts = { master: null, playable: null, audio: {}, subs: {} };
  const h264 = classifyForTarget(info, 'h264');
  const hevc = classifyForTarget(info, 'hevc');
  const directForSafari = hevc === 'direct';
  const directForChrome = h264 === 'direct';

  const tmpSuffix = `.tmp-${process.pid}`;
  const fail = (e: any) => {
    if (isAborted()) return;
    markPrepFailed(projectId, e.message || String(e), artifacts);
  };

  // 1) master.mp4 (Safari) — só se o master original não for direct para Safari
  if (!directForSafari) {
    if (isAborted()) return;
    const out = path.join(projectDir, 'master.mp4');
    const tmp = out + tmpSuffix;
    emitPrep(projectId, 5, 'Gerando master.mp4 (Safari)...');
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      await runFfmpeg(buildMasterArgs(info, tmp), info.duration, (pct) => emitPrep(projectId, 5 + pct * 0.25, 'Gerando master.mp4 (Safari)...'), projectId);
      if (isAborted()) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        return;
      }
      if (!fs.existsSync(tmp)) throw new Error('master.mp4 não foi gerado');
      if (fs.existsSync(out)) fs.unlinkSync(out);
      fs.renameSync(tmp, out);
      artifacts.master = artifactOf(out);
      updatePrepState(projectId, 'partial', { artifacts });
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      return fail(e);
    }
  }

  // 2) playable.mp4 (Chrome) — só se o master original não for direct para Chrome
  if (!directForChrome) {
    if (isAborted()) return;
    const out = path.join(projectDir, 'playable.mp4');
    const tmp = out + tmpSuffix;
    emitPrep(projectId, 30, 'Gerando playable.mp4 (Chrome)...');
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      await runFfmpeg(buildPlayableArgs(info, tmp), info.duration, (pct) => emitPrep(projectId, 30 + pct * 0.4, 'Gerando playable.mp4 (Chrome)...'), projectId);
      if (isAborted()) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        return;
      }
      if (!fs.existsSync(tmp)) throw new Error('playable.mp4 não foi gerado');
      if (fs.existsSync(out)) fs.unlinkSync(out);
      fs.renameSync(tmp, out);
      artifacts.playable = artifactOf(out);
      updatePrepState(projectId, 'partial', { artifacts });
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      return fail(e);
    }
  }

  // 3) Variantes de áudio por idioma
  const langs = [...new Set(info.audio.map((a) => a.language || 'und'))];
  if (langs.length > 1) {
    let i = 0;
    for (const lang of langs) {
      if (isAborted()) return;
      const track = info.audio.find((a) => a.language === lang) || info.audio.filter((a) => a.language === lang)[0];
      if (!track) continue;
      const safeLang = lang.replace(/[^a-z0-9-]/gi, '_');
      const out = path.join(projectDir, `audio_${safeLang}.mp4`);
      const tmp = out + tmpSuffix;
      emitPrep(projectId, 70 + (i / langs.length) * 20, `Gerando variante de áudio (${lang})...`);
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        await runFfmpeg(buildAudioVariantArgs(info, track.index, tmp), info.duration, (pct) => emitPrep(projectId, 70 + ((i + pct / 100) / langs.length) * 20, `Gerando variante de áudio (${lang})...`), projectId);
        if (isAborted()) {
          try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
          return;
        }
        if (!fs.existsSync(tmp)) throw new Error(`audio_${lang}.mp4 não foi gerado`);
        if (fs.existsSync(out)) fs.unlinkSync(out);
        fs.renameSync(tmp, out);
        artifacts.audio[lang] = artifactOf(out);
        updatePrepState(projectId, 'partial', { artifacts });
      } catch (e) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        return fail(e);
      }
      i++;
    }
  }

  // 4) Legendas embutidas → VTT
  const textSubs = info.subtitles.filter((s) => TEXT_SUB_CODECS.has(s.codec));
  for (let i = 0; i < textSubs.length; i++) {
    if (isAborted()) return;
    const s = textSubs[i];
    const lang = s.language || 'und';
    const safeLang = lang.replace(/[^a-z0-9-]/gi, '_');
    const out = path.join(projectDir, `subs_${safeLang}.vtt`);
    const tmp = out + tmpSuffix;
    emitPrep(projectId, 92, `Extraindo legenda (${lang})...`);
    try {
      const subIdx = info.subtitles.filter((x) => TEXT_SUB_CODECS.has(x.codec)).indexOf(s);
      await runFfmpeg(['-y', '-i', info.path, '-map', `0:s:${subIdx}`, '-c:s', 'webvtt', '-f', 'webvtt', tmp], info.duration, () => {}, projectId);
      if (isAborted()) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
        return;
      }
      if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 20) throw new Error(`legenda ${lang} vazia`);
      if (fs.existsSync(out)) fs.unlinkSync(out);
      fs.renameSync(tmp, out);
      artifacts.subs[lang] = artifactOf(out);
    } catch (e) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      // Legenda é não-crítica: segue sem falhar.
      console.warn(`[JackIn] Legenda ${lang} falhou: ${(e as Error).message}`);
    }
  }

  if (isAborted()) return;

  // 5) Legendas sidecar baixadas junto do vídeo (.srt/.ass/.ssa) — a versão
  // completa costuma vir assim; a embutida pode ser só FORÇADA.
  await importSidecarSubtitles(projectId, projectDir, master, artifacts);

  if (isAborted()) return;

  updatePrepState(projectId, 'done', { artifacts, settingsHash: hash });
  emitPrep(projectId, 100, 'Pronto para assistir');

  // Se o projeto estava em download/preparo e o prepare terminou, garante status assistível.
  const cur = getProjectMedia(projectId);
  if (cur && ['pending', 'downloading', 'preparing'].includes(cur.status)) {
    db.run('UPDATE projects SET status = ? WHERE id = ?', ['done', projectId]);
    persist();
  }
}

// ── Resolução de arquivo para reprodução ──────────────────────────────────
export interface ResolveResult {
  filePath: string | null;
  prepState: PrepState;
  /** true quando o arquivo é um artefato preparado (completo por construção,
   *  escrito via tmp+rename). false quando é o master original direto. */
  isArtifact: boolean;
}

export function resolveVideoFile(projectId: string, target: Target, audioLang?: string | null): ResolveResult {
  const pm = getProjectMedia(projectId);
  if (!pm) return { filePath: null, prepState: 'none', isArtifact: false };

  if (audioLang && pm.artifacts?.audio[audioLang] && fs.existsSync(pm.artifacts.audio[audioLang].path)) {
    return { filePath: pm.artifacts.audio[audioLang].path, prepState: pm.prepState, isArtifact: true };
  }

  const info = pm.mediaInfo;
  if (info) {
    const tier = classifyForTarget(info, target);
    if (tier === 'direct' && pm.videoPath && fs.existsSync(pm.videoPath)) {
      return { filePath: pm.videoPath, prepState: pm.prepState, isArtifact: false };
    }
  }

  if (target === 'hevc' && pm.artifacts?.master && fs.existsSync(pm.artifacts.master.path)) {
    // O master é um REMUX (-c:v copy): só é seguro para o Safari quando o
    // codec de vídeo é h264/hevc. Fontes mpeg4/divx (indecodáveis no browser)
    // geram master mpeg4 → vídeo preto com áudio. Nesse caso cai no playable
    // (h264), que o Safari também reproduz nativamente.
    const masterCodecOk = !!info?.video && VIDEO_SAFE.hevc.has(info.video.codec);
    if (masterCodecOk) {
      return { filePath: pm.artifacts.master.path, prepState: pm.prepState, isArtifact: true };
    }
  }
  // playable.mp4 (h264) funciona em TODOS os browsers (Chrome + Safari) —
  // fallback universal quando o master não é seguro para o target pedido.
  if (pm.artifacts?.playable && fs.existsSync(pm.artifacts.playable.path)) {
    return { filePath: pm.artifacts.playable.path, prepState: pm.prepState, isArtifact: true };
  }

  return { filePath: null, prepState: pm.prepState, isArtifact: false };
}

// ── Cast (Chromecast) ──────────────────────────────────────────────────────
export const CAST_SAFE_AUDIO_CODECS = new Set(['aac', 'mp3', 'ac3', 'eac3']);

export interface CastAudioTrack {
  trackId: number;   // posição 1-based no playable.mp4 (= index no array de áudio + 1)
  language: string;  // rótulo amigável: por → pt-br
  codec: string;
  channels: number;
  label: string;     // rótulo amigável do idioma (+ título do stream, se houver)
}

export interface CastFileResult {
  filePath: string;
  isArtifact: boolean;
}

/** Forma mínima do projeto usada pelo picker (getProjectMedia é compatível). */
export interface ProjectMediaLike {
  status?: string;
  videoPath?: string | null;
  mediaInfo?: MediaInfo | null;
  artifacts?: Artifacts | null;
}

function isCastSafeAudio(info: MediaInfo): boolean {
  return info.audio.length > 0 && info.audio.every((a) => CAST_SAFE_AUDIO_CODECS.has(a.codec));
}

/** Puro + testável: decide o arquivo cast-safe a partir do ProjectMedia. */
export function pickCastFile(pm: ProjectMediaLike | null): CastFileResult | null {
  if (!pm?.mediaInfo?.video) return null;
  const sourceCodec = pm.mediaInfo.video.codec;

  // Master original direct (h264 faststart) — sem artefatos. Também exige áudio
  // cast-safe: classifyForTarget usa AUDIO_SAFE.h264 (aceita opus), que o
  // Chromecast não reproduz — esse master iria direto pra TV e falharia.
  if (
    classifyForTarget(pm.mediaInfo, 'h264') === 'direct' &&
    isCastSafeAudio(pm.mediaInfo) &&
    pm.videoPath &&
    fs.existsSync(pm.videoPath)
  ) {
    return { filePath: pm.videoPath, isArtifact: false };
  }

  // Playable: h264 copiado ou hevc transcodado → vídeo cast-safe; o áudio
  // precisa estar no conjunto cast-safe (opus não é aceito pelo Chromecast).
  const playable = pm.artifacts?.playable;
  const castSafeVideo = sourceCodec === 'h264' || sourceCodec === 'hevc';
  const audioSafe = isCastSafeAudio(pm.mediaInfo);
  if (playable && fs.existsSync(playable.path)) {
    if (castSafeVideo && audioSafe) return { filePath: playable.path, isArtifact: true };
  }

  // Fallback: master h264 quando o playable não serve (ausente ou não cast-safe).
  if (pm.videoPath && fs.existsSync(pm.videoPath) && sourceCodec === 'h264' && audioSafe) {
    return { filePath: pm.videoPath, isArtifact: false };
  }

  return null;
}

export function resolveCastFile(projectId: string): CastFileResult | null {
  return pickCastFile(getProjectMedia(projectId));
}

function castLabel(language: string): string {
  return LANG_LABEL[language] || language.toUpperCase();
}

/** Descritores na ordem do playable (-map 0:a = ordem do array de áudio). */
export function buildCastAudioTrackDescriptors(info: MediaInfo, codeToLangMap: Record<string, string>): CastAudioTrack[] {
  return info.audio.map((s, i) => {
    const language = codeToLangMap[s.language || ''] || s.language || 'und';
    const label = castLabel(language) + (s.title ? ` (${s.title})` : '');
    return {
      trackId: i + 1,
      language,
      codec: s.codec,
      channels: s.channels || 0,
      label,
    };
  });
}

export function listCastAudioTracks(projectId: string): CastAudioTrack[] {
  const pm = getProjectMedia(projectId);
  if (!pm?.mediaInfo) return [];
  return buildCastAudioTrackDescriptors(pm.mediaInfo, codeToLang);
}

// ── Reconcile: re-gera artefatos faltantes (idempotente) ──────────────────
export function reconcileProjectMedia(projectId: string): void {
  const pm = getProjectMedia(projectId);
  if (!pm) return;
  if (pm.prepState === 'done' && pm.artifacts && pm.prepSettingsHash) {
    const arts = pm.artifacts;
    const allExist =
      (arts.master ? fs.existsSync(arts.master.path) : true) &&
      (arts.playable ? fs.existsSync(arts.playable.path) : true) &&
      Object.values(arts.audio).every((a) => fs.existsSync(a.path));
    if (allExist) return;
    console.log(`[JackIn] Reconcile: artefatos faltantes em ${projectId}, regenerando...`);
    prepareProject(projectId).catch((e) => console.error(`[JackIn] Reconcile falhou ${projectId}:`, e));
    return;
  }
  // 'running' sem worker ativo = prepare morto por crash/restart no meio do
  // ffmpeg. Re-dispara; o doPrepare já limpa tmp órfãos antes de escrever.
  // 'partial' (master gerado, playable/áudio não) também entra: sem isso um
  // restart no meio do transcode deixava o episódio eternamente em 'preparing'.
  if (
    pm.prepState === 'none' ||
    pm.prepState === 'failed' ||
    pm.prepState === 'partial' ||
    (pm.prepState === 'running' && !isPreparing(projectId))
  ) {
    const projectDir = path.join(DATA_DIR, 'projects', projectId);
    // Torrents costumam extrair para um subdiretório (ex.: "... (2000) [2160p].../").
    // A coluna video_path já aponta para o master real descoberto pelo reconcile
    // recursivo — não confiar só no findMasterFile (top-level) ou o prepare
    // nunca dispara e o projeto fica preso em 'preparing' para sempre.
    const master = pm.videoPath && fs.existsSync(pm.videoPath) ? pm.videoPath : findMasterFile(projectDir);
    if (master) {
      console.log(`[JackIn] Reconcile: preparando ${projectId}...`);
      prepareProject(projectId).catch((e) => console.error(`[JackIn] Reconcile falhou ${projectId}:`, e));
    }
  }
}
