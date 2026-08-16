import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildCastMediaUrl, buildCastTrackUrl, pickCastAudioTrackId, normalizeHostForCast } from './cast';

const LAN_IP = '192.168.0.10';
const PORT = 3001;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildCastMediaUrl', () => {
  it('swaps host to lan ip, forces target=h264 and drops audio for the default receiver', () => {
    const url = buildCastMediaUrl(
      `http://localhost:3001/api/projects/abc/video?target=hevc&audio=por`,
      LAN_IP,
      PORT
    );
    expect(url).toBe(`http://192.168.0.10:3001/api/projects/abc/video?target=h264`);
  });

  it('adds ?target=h264 to a bare URL', () => {
    const url = buildCastMediaUrl(`http://localhost:3001/api/projects/abc/video`, LAN_IP, PORT);
    expect(url).toBe(`http://192.168.0.10:3001/api/projects/abc/video?target=h264`);
  });

  it('preserves unrelated query params', () => {
    const url = buildCastMediaUrl(
      `http://localhost:3001/api/projects/abc/video?foo=bar&target=hevc&audio=por`,
      LAN_IP,
      PORT
    );
    expect(url).toBe(`http://192.168.0.10:3001/api/projects/abc/video?foo=bar&target=h264`);
  });

  it('is idempotent on repeated calls', () => {
    const first = buildCastMediaUrl(
      `http://localhost:3001/api/projects/abc/video?target=hevc&audio=por`,
      LAN_IP,
      PORT
    );
    const second = buildCastMediaUrl(first, LAN_IP, PORT);
    expect(second).toBe(first);
  });

  it('returns relative/unparseable URLs unchanged and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const url = buildCastMediaUrl(`/api/projects/abc/video`, LAN_IP, PORT);
    expect(url).toBe(`/api/projects/abc/video`);
    expect(warn).toHaveBeenCalled();
  });

  it('drops existing audio param even when target is already h264', () => {
    const url = buildCastMediaUrl(
      `http://localhost:3001/api/projects/abc/video?target=h264&audio=eng`,
      LAN_IP,
      PORT
    );
    expect(url).toBe(`http://192.168.0.10:3001/api/projects/abc/video?target=h264`);
  });
});

describe('buildCastTrackUrl', () => {
  it('builds the exact subtitle track URL shape', () => {
    const url = buildCastTrackUrl(LAN_IP, PORT, 'abc', 'pt-br');
    expect(url).toBe(`http://192.168.0.10:3001/api/projects/abc/subtitles?lang=pt-br`);
  });

  it('encodes the language', () => {
    const url = buildCastTrackUrl(LAN_IP, PORT, 'abc', 'pt br');
    expect(url).toBe(`http://192.168.0.10:3001/api/projects/abc/subtitles?lang=pt%20br`);
  });
});

describe('pickCastAudioTrackId', () => {
  const tracks = [
    { trackId: 1, language: 'eng' },
    { trackId: 2, language: 'por' },
    { trackId: 3, language: 'spa' },
  ];

  it('returns the trackId of the first track matching the desired language', () => {
    expect(pickCastAudioTrackId(tracks, 'por')).toBe(2);
  });

  it('returns undefined when no track matches', () => {
    expect(pickCastAudioTrackId(tracks, 'fra')).toBeUndefined();
  });

  it('returns undefined for empty track list', () => {
    expect(pickCastAudioTrackId([], 'por')).toBeUndefined();
  });

  it('returns undefined when tracks is null/undefined defensively', () => {
    expect(pickCastAudioTrackId(undefined as any, 'por')).toBeUndefined();
    expect(pickCastAudioTrackId(null as any, 'por')).toBeUndefined();
  });
});

describe('normalizeHostForCast', () => {
  it('repoints localhost to the lan ip', () => {
    expect(normalizeHostForCast(`http://localhost:3001/api/projects/abc/thumbnail`, LAN_IP, PORT)).toBe(
      `http://192.168.0.10:3001/api/projects/abc/thumbnail`
    );
  });

  it('repoints 127.0.0.1 to the lan ip', () => {
    expect(normalizeHostForCast(`http://127.0.0.1:3001/x.png`, LAN_IP, PORT)).toBe(`http://192.168.0.10:3001/x.png`);
  });

  it('keeps a host that is not local unchanged', () => {
    const url = `http://10.0.0.5:3001/x.png`;
    expect(normalizeHostForCast(url, LAN_IP, PORT)).toBe(url);
  });

  it('returns relative URLs unchanged', () => {
    expect(normalizeHostForCast(`/x.png`, LAN_IP, PORT)).toBe(`/x.png`);
  });
});
