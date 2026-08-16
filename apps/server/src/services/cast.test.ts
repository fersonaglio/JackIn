import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pickCastFile, buildCastAudioTrackDescriptors, listCastAudioTracks, resolveCastFile, type MediaInfo, type Artifacts, type ProjectMediaLike } from '../services/media-service.js';
import { codeToLang } from '../services/language-map.js';

// Fake DB row store — allows wiring tests for resolveCastFile/listCastAudioTracks
// without touching the real sql.js database.
const dbState = vi.hoisted(() => ({ rows: new Map<string, any[]>() }));

vi.mock('../db/schema.js', () => ({
  getDb: () => ({
    exec: (_sql: string, params: any[]) => {
      const id = params?.[0];
      const row = dbState.rows.get(String(id));
      return row ? [{ values: [row] }] : [{ values: [] }];
    },
  }),
  persist: () => {},
  DATA_DIR: '/tmp/data',
}));

function mkInfo(partial: Partial<MediaInfo>): MediaInfo {
  return {
    path: '/fake.mp4',
    sizeBytes: 1000,
    mtimeMs: 0,
    duration: 60,
    formatNames: ['mp4'],
    streams: [],
    audio: [],
    subtitles: [],
    hdr: 'sdr',
    moovAtHead: true,
    ...partial,
  };
}

function art(pathLike: string): Artifacts['playable'] {
  return { path: pathLike, fingerprint: 'x', size: 1 };
}

// Real temp files so fs.existsSync behaves like production.
let tmpDir: string;

function touch(rel: string): string {
  const p = path.join(tmpDir, rel);
  fs.writeFileSync(p, 'x');
  return p;
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cast-test-'));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// Row layout for getProjectMedia: [id, status, video_path, media_info, prep_state, prep_error, prep_settings_hash, artifacts]
function dbRow(partial: { id: string; videoPath: string | null; mediaInfo: MediaInfo | null; artifacts?: Artifacts | null }): any[] {
  return [
    partial.id,
    'done',
    partial.videoPath,
    partial.mediaInfo ? JSON.stringify(partial.mediaInfo) : null,
    'done',
    null,
    'hash',
    partial.artifacts ? JSON.stringify(partial.artifacts) : null,
  ];
}

describe('pickCastFile', () => {
  it('master h264 direct → devolve o master original (isArtifact false)', () => {
    const master = touch('direct-master.mp4');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        video: { index: 0, codecType: 'video', codec: 'h264' },
        audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2, language: 'por' }],
      }),
    };
    expect(pickCastFile(pm)).toEqual({ filePath: master, isArtifact: false });
  });

  it('master h264 direct mas com áudio opus → não serve o master (opus não é cast-safe)', () => {
    // classifyForTarget aceita opus (AUDIO_SAFE.h264) → 'direct', mas o
    // Chromecast não reproduz opus: o branch direct precisa barrar também.
    const master = touch('direct-opus.mp4');
    const playable = touch('direct-opus-playable.mp4');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        video: { index: 0, codecType: 'video', codec: 'h264' },
        audio: [{ index: 1, codecType: 'audio', codec: 'opus', channels: 2, language: 'por' }],
      }),
      artifacts: { master: null, playable: art(playable), audio: {}, subs: {} },
    };
    expect(pickCastFile(pm)).toBeNull();
  });

  it('fonte hevc com playable h264 → playable (isArtifact true)', () => {
    const master = touch('hevc-master.mkv');
    const playable = touch('hevc-playable.mp4');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        formatNames: ['matroska'],
        moovAtHead: false,
        video: { index: 0, codecType: 'video', codec: 'hevc' },
        audio: [{ index: 1, codecType: 'audio', codec: 'eac3', channels: 6, language: 'por' }],
      }),
      artifacts: { master: null, playable: art(playable), audio: {}, subs: {} },
    };
    expect(pickCastFile(pm)).toEqual({ filePath: playable, isArtifact: true });
  });

  it('fonte vp9 com playable e master não-h264 → null (nada cast-safe)', () => {
    const master = touch('hevc-master.mkv');
    const playable = touch('vp9-playable.mp4');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        formatNames: ['matroska'],
        moovAtHead: false,
        video: { index: 0, codecType: 'video', codec: 'vp9' },
        audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2, language: 'por' }],
      }),
      artifacts: { master: null, playable: art(playable), audio: {}, subs: {} },
    };
    expect(pickCastFile(pm)).toBeNull();
  });

  it('master h264 sem playable (ou playable não cast-safe) → fallback para o master', () => {
    const master = touch('h264-master.mkv');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        formatNames: ['matroska'],
        moovAtHead: false,
        video: { index: 0, codecType: 'video', codec: 'h264' },
        audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2, language: 'por' }],
      }),
      artifacts: { master: null, playable: null, audio: {}, subs: {} },
    };
    expect(pickCastFile(pm)).toEqual({ filePath: master, isArtifact: false });
  });

  it('áudio opus (fora do CAST_SAFE) → null mesmo com playable h264', () => {
    const master = touch('opus-master.mkv');
    const playable = touch('opus-playable.mp4');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        formatNames: ['matroska'],
        moovAtHead: false,
        video: { index: 0, codecType: 'video', codec: 'h264' },
        audio: [{ index: 1, codecType: 'audio', codec: 'opus', channels: 2, language: 'por' }],
      }),
      artifacts: { master: null, playable: art(playable), audio: {}, subs: {} },
    };
    expect(pickCastFile(pm)).toBeNull();
  });

  it('pm nulo / sem mediaInfo / sem vídeo → null', () => {
    expect(pickCastFile(null)).toBeNull();
    expect(pickCastFile({ mediaInfo: null })).toBeNull();
    expect(pickCastFile({ mediaInfo: mkInfo({ video: undefined, audio: [] }) })).toBeNull();
  });

  it('playable ausente e master não-h264 → null', () => {
    const master = touch('hevc-master.mkv');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        formatNames: ['matroska'],
        moovAtHead: false,
        video: { index: 0, codecType: 'video', codec: 'hevc' },
        audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2, language: 'por' }],
      }),
      artifacts: { master: null, playable: null, audio: {}, subs: {} },
    };
    expect(pickCastFile(pm)).toBeNull();
  });

  it('artefato playable apontando para arquivo inexistente → tratado como ausente', () => {
    const master = touch('hevc-master.mkv');
    const pm: ProjectMediaLike = {
      videoPath: master,
      mediaInfo: mkInfo({
        formatNames: ['matroska'],
        moovAtHead: false,
        video: { index: 0, codecType: 'video', codec: 'hevc' },
        audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2, language: 'por' }],
      }),
      artifacts: { master: null, playable: art('/nonexistent/playable.mp4'), audio: {}, subs: {} },
    };
    expect(pickCastFile(pm)).toBeNull();
  });
});

describe('buildCastAudioTrackDescriptors', () => {
  it('trackIds seguem a ordem do array de áudio, não o index do master', () => {
    const info = mkInfo({
      video: { index: 0, codecType: 'video', codec: 'h264' },
      audio: [
        { index: 1, codecType: 'audio', codec: 'aac', channels: 6, language: 'por' },
        { index: 3, codecType: 'audio', codec: 'ac3', channels: 2, language: 'eng' },
      ],
      subtitles: [{ index: 2, codecType: 'subtitle', codec: 'subrip', language: 'por' }],
    });
    const tracks = buildCastAudioTrackDescriptors(info, codeToLang);
    expect(tracks).toEqual([
      { trackId: 1, language: 'pt-br', codec: 'aac', channels: 6, label: 'Português (Brasil)' },
      { trackId: 2, language: 'en', codec: 'ac3', channels: 2, label: 'Inglês (Original)' },
    ]);
  });

  it('título do stream entra no label', () => {
    const info = mkInfo({
      video: { index: 0, codecType: 'video', codec: 'h264' },
      audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2, language: 'por', title: 'Comentários' }],
    });
    const [track] = buildCastAudioTrackDescriptors(info, codeToLang);
    expect(track.label).toBe('Português (Brasil) (Comentários)');
  });

  it('código de idioma desconhecido → mantém o cru', () => {
    const info = mkInfo({
      audio: [{ index: 1, codecType: 'audio', codec: 'mp3', channels: 2, language: 'zz' }],
    });
    const [track] = buildCastAudioTrackDescriptors(info, codeToLang);
    expect(track.language).toBe('zz');
    expect(track.label).toBe('ZZ');
  });

  it('sem language → und / Indefinido', () => {
    const info = mkInfo({
      audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2 }],
    });
    const [track] = buildCastAudioTrackDescriptors(info, codeToLang);
    expect(track.language).toBe('und');
    expect(track.label).toBe('Indefinido');
  });

  it('sem streams de áudio → []', () => {
    expect(buildCastAudioTrackDescriptors(mkInfo({ audio: [] }), codeToLang)).toEqual([]);
  });
});

describe('resolveCastFile / listCastAudioTracks (db wiring)', () => {
  it('projeto inexistente → null / []', () => {
    expect(resolveCastFile('nope')).toBeNull();
    expect(listCastAudioTracks('nope')).toEqual([]);
  });

  it('projeto com media_info → resolve master e descreve trilhas na ordem do playable', () => {
    const master = touch('direct-wired.mp4');
    dbState.rows.set('proj-1', dbRow({
      id: 'proj-1',
      videoPath: master,
      mediaInfo: mkInfo({
        video: { index: 0, codecType: 'video', codec: 'h264' },
        audio: [
          { index: 1, codecType: 'audio', codec: 'aac', channels: 6, language: 'por' },
          { index: 3, codecType: 'audio', codec: 'aac', channels: 2, language: 'eng' },
        ],
        subtitles: [{ index: 2, codecType: 'subtitle', codec: 'subrip', language: 'por' }],
      }),
    }));
    expect(resolveCastFile('proj-1')).toEqual({ filePath: master, isArtifact: false });
    expect(listCastAudioTracks('proj-1')).toEqual([
      { trackId: 1, language: 'pt-br', codec: 'aac', channels: 6, label: 'Português (Brasil)' },
      { trackId: 2, language: 'en', codec: 'aac', channels: 2, label: 'Inglês (Original)' },
    ]);
  });
});
