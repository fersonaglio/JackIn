import { describe, it, expect } from 'vitest';
import { classifyForTarget, audioBitrate, pickNextPrepIndex, type MediaInfo, type Target, type PrepTask } from '../services/media-service.js';

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

describe('classifyForTarget', () => {
  it('h264+aac em mp4 com moov é direct para ambos os targets', () => {
    const info = mkInfo({
      formatNames: ['mov', 'mp4'],
      video: { index: 0, codecType: 'video', codec: 'h264' },
      audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 6, language: 'por' }],
    });
    expect(classifyForTarget(info, 'hevc')).toBe('direct');
    expect(classifyForTarget(info, 'h264')).toBe('direct');
  });

  it('HEVC em MKV é remux para Safari (copy) e transcode para Chrome', () => {
    const info = mkInfo({
      formatNames: ['matroska', 'webm'],
      video: { index: 0, codecType: 'video', codec: 'hevc' },
      audio: [{ index: 1, codecType: 'audio', codec: 'eac3', channels: 6, language: 'eng' }],
      moovAtHead: false,
    });
    expect(classifyForTarget(info, 'hevc')).toBe('remux');
    expect(classifyForTarget(info, 'h264')).toBe('transcode');
  });

  it('DTS em MKV com h264 é remux para ambos (áudio transcodado, vídeo copiado)', () => {
    const info = mkInfo({
      formatNames: ['matroska', 'webm'],
      video: { index: 0, codecType: 'video', codec: 'h264' },
      audio: [{ index: 1, codecType: 'audio', codec: 'dts', channels: 6, language: 'eng' }],
      moovAtHead: false,
    });
    expect(classifyForTarget(info, 'hevc')).toBe('remux');
    expect(classifyForTarget(info, 'h264')).toBe('remux');
  });

  it('mp4 sem moov no topo (sem faststart) vira remux — garante seek nativo', () => {
    const info = mkInfo({
      formatNames: ['mov', 'mp4'],
      video: { index: 0, codecType: 'video', codec: 'h264' },
      audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 2, language: 'por' }],
      moovAtHead: false,
    });
    expect(classifyForTarget(info, 'h264')).toBe('remux');
  });

  it('Dolby Vision Profile 7 força transcode (remux quebraria)', () => {
    const info = mkInfo({
      formatNames: ['mov', 'mp4'],
      video: { index: 0, codecType: 'video', codec: 'hevc', profile: 'Main 10' },
      audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 6, language: 'eng' }],
      hdr: 'dv',
      dvProfile: 7,
    });
    expect(classifyForTarget(info, 'hevc')).toBe('transcode');
    expect(classifyForTarget(info, 'h264')).toBe('transcode');
  });

  it('áudio mono em mp4 h264 é direct (não há conversão útil; escudo Python rejeita mono na ingestão)', () => {
    const info = mkInfo({
      formatNames: ['mov', 'mp4'],
      video: { index: 0, codecType: 'video', codec: 'h264' },
      audio: [{ index: 1, codecType: 'audio', codec: 'aac', channels: 1, language: 'eng' }],
    });
    expect(classifyForTarget(info, 'h264')).toBe('direct');
  });

  it('AC3 não é seguro para Chrome (remux) mas é para Safari', () => {
    const info = mkInfo({
      formatNames: ['mov', 'mp4'],
      video: { index: 0, codecType: 'video', codec: 'h264' },
      audio: [{ index: 1, codecType: 'audio', codec: 'ac3', channels: 6, language: 'eng' }],
    });
    expect(classifyForTarget(info, 'hevc')).toBe('direct');
    expect(classifyForTarget(info, 'h264')).toBe('remux');
  });

  it('sem stream de vídeo = transcode (nunca direct)', () => {
    const info = mkInfo({ video: undefined, audio: [] });
    expect(classifyForTarget(info, 'hevc')).toBe('transcode');
    expect(classifyForTarget(info, 'h264')).toBe('transcode');
  });
});

describe('audioBitrate', () => {
  it('bitrate por canal — nunca mono, sem downmix', () => {
    expect(audioBitrate(2, 'aac')).toBe('320k');
    expect(audioBitrate(6, 'aac')).toBe('448k');
    expect(audioBitrate(8, 'aac')).toBe('640k');
    expect(audioBitrate(2, 'eac3')).toBe('320k');
    expect(audioBitrate(6, 'eac3')).toBe('448k');
    expect(audioBitrate(8, 'eac3')).toBe('768k');
  });

  it('targets válidos cobrem h264 e hevc', () => {
    const targets: Target[] = ['hevc', 'h264'];
    expect(targets).toContain('h264');
    expect(targets).toContain('hevc');
  });
});

describe('pickNextPrepIndex (fila de preparação prioritária)', () => {
  const task = (season: number, episode: number): PrepTask => ({
    priority: { season, episode },
    run: async () => {},
  });

  it('temporada 1 sai antes das demais', () => {
    const tasks = [task(3, 1), task(1, 8), task(2, 1), task(4, 1)];
    expect(pickNextPrepIndex(tasks)).toBe(1);
  });

  it('dentro da mesma temporada, episódio menor sai antes', () => {
    const tasks = [task(1, 10), task(1, 2), task(1, 5)];
    expect(pickNextPrepIndex(tasks)).toBe(1);
  });

  it('filmes (sem temporada, prioridade 0) saem antes de qualquer série', () => {
    const tasks = [task(1, 1), task(0, 0), task(2, 1)];
    expect(pickNextPrepIndex(tasks)).toBe(1);
  });

  it('pack da temporada (episódio 0) precede os episódios da mesma temporada', () => {
    const tasks = [task(1, 3), task(1, 0), task(1, 1)];
    expect(pickNextPrepIndex(tasks)).toBe(1);
  });

  it('fila unitária retorna o índice 0', () => {
    expect(pickNextPrepIndex([task(5, 9)])).toBe(0);
  });
});
