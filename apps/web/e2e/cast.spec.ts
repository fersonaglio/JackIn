/**
 * Google Cast (Chromecast) smoke test — E2E verification for the Cast feature
 * added by the cast pipeline (useCast.ts + CinemaPlayer cast button).
 *
 * The REAL cast_sender.js requires gstatic + secure context; we do NOT load it.
 * Instead, a FAKE Google Cast SDK is injected via page.addInitScript BEFORE any
 * page script runs. The fake mirrors the exact surface that useCast.ts reads:
 *
 *   chrome.cast.isAvailable / AutoJoinPolicy.ORIGIN_SCOPED
 *   chrome.cast.media.{DEFAULT_MEDIA_RECEIVER_APP_ID, StreamType, TrackType,
 *                       TextTrackType, MediaInfo, MovieMediaMetadata, Track,
 *                       LoadRequest}
 *   chrome.cast.framework.{CastContext, RemotePlayer, RemotePlayerController,
 *                          CastContextEventType, RemotePlayerEventType,
 *                          CastState, SessionState}
 *
 * A <script id="cast-sdk-script"> element is created by the fake so that
 * ensureCastSdk() (useCast.ts) finds it and short-circuits — the gstatic URL is
 * never fetched.
 *
 * Exposed on window.__fakeCast (for assertions):
 *   initCalls[]        — CastContext.initialize() options
 *   loadCalls[]        — LoadRequest objects passed to session.loadMedia()
 *   stopCalls[]        — timestamps of session.stop()
 *   emitCastState(s)   — fire cast_state_changed listeners
 *   emitSessionState(s, {currentTime}) — set player time + fire session listeners
 *   setCurrentTime(t)  — update RemotePlayer.currentTime + fire CURRENT_TIME_CHANGED
 *
 * API endpoints used by the player are stubbed via page.route() so the test does
 * not depend on real server data. The video route serves a real (tiny) MP4 so
 * playback actually starts in headless Chromium.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ID = '123e4567-e89b-12d3-a456-426614174000';
const LAN_IP = '192.168.1.5';
const LAN_PORT = 3001;
const TEXT_TRACK_ID = 1000;

const mp4Buffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'tiny.mp4'));
const pngBuffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'tiny.png'));

// ─── Fake Google Cast SDK (runs before any page script) ─────────────────────
function injectFakeCastSdk() {
  (() => {
    if (typeof window === 'undefined') return;
    const fake: any = {
      initCalls: [],
      loadCalls: [],
      stopCalls: [],
      castState: 'not_connected',
      session: null,
      player: null,
      controller: null,
      castStateListeners: new Set<any>(),
      sessionStateListeners: new Set<any>(),
    };

    // RemotePlayer / RemotePlayerController
    class FakeRemotePlayer {
      currentTime = 0;
      constructor() { fake.player = this; }
    }
    class FakeRemotePlayerController {
      player: any;
      timeListeners = new Set<any>();
      constructor(player: any) {
        this.player = player;
        fake.controller = this;
      }
      addEventListener(_type: string, cb: any) { this.timeListeners.add(cb); }
      removeEventListener(_type: string, cb: any) { this.timeListeners.delete(cb); }
    }

    // Media classes
    class MediaInfo {
      contentId: string;
      contentType: string;
      metadata: any = null;
      streamType: any = null;
      tracks: any[] = [];
      constructor(contentId: string, contentType: string) {
        this.contentId = contentId;
        this.contentType = contentType;
      }
    }
    class MovieMediaMetadata { title = ''; images: any[] = []; }
    class Track {
      trackId: number;
      type: string;
      trackContentId: string | null = null;
      trackContentType: string | null = null;
      subtype: any = null;
      name: string | null = null;
      language: string | null = null;
      constructor(trackId: number, type: string) { this.trackId = trackId; this.type = type; }
    }
    class LoadRequest {
      mediaInfo: any;
      media: any;
      autoplay = false;
      activeTrackIds: number[] = [];
      constructor(mediaInfo: any) {
        // Real SDK exposes the media info as `media` (and we keep mediaInfo too)
        this.mediaInfo = mediaInfo;
        this.media = mediaInfo;
      }
    }

    // Session
    class FakeSession {
      loadMedia(req: any) { fake.loadCalls.push(req); return Promise.resolve(); }
      stop() { fake.stopCalls.push(Date.now()); return Promise.resolve(); }
    }

    // CastContext (singleton)
    class FakeCastContext {
      private static _instance: FakeCastContext | null = null;
      static getInstance() {
        if (!FakeCastContext._instance) FakeCastContext._instance = new FakeCastContext();
        return FakeCastContext._instance;
      }
      initialize(opts: any) { fake.initCalls.push(opts); }
      getCastState() { return fake.castState; }
      getCurrentSession() { return fake.session; }
      addEventListener(type: string, cb: any) {
        if (type === 'cast_state_changed') fake.castStateListeners.add(cb);
        if (type === 'session_state_changed') fake.sessionStateListeners.add(cb);
      }
      removeEventListener(type: string, cb: any) {
        if (type === 'cast_state_changed') fake.castStateListeners.delete(cb);
        if (type === 'session_state_changed') fake.sessionStateListeners.delete(cb);
      }
      requestSession() {
        fake.session = new FakeSession();
        // The real SDK fires SESSION_STARTED when the session begins.
        emitSessionState('SESSION_STARTED', { currentTime: 0 });
        return Promise.resolve(fake.session);
      }
    }

    // Helpers exposed for the test
    function emitSessionState(state: string, opts?: { currentTime?: number }) {
      if (opts && typeof opts.currentTime === 'number' && fake.player) {
        fake.player.currentTime = opts.currentTime;
      }
      fake.sessionStateListeners.forEach((cb: any) => { try { cb({ sessionState: state }); } catch {} });
    }

    // chrome.cast namespace
    const ch: any = (window as any).chrome || {};
    ch.cast = {
      isAvailable: true,
      AutoJoinPolicy: { ORIGIN_SCOPED: 'origin_scoped' },
      media: {
        DEFAULT_MEDIA_RECEIVER_APP_ID: 'CC1AD845',
        StreamType: { BUFFERED: 'buffered', LIVE: 'live', NONE: 'none' },
        TrackType: { TEXT: 'text', AUDIO: 'audio', VIDEO: 'video' },
        TextTrackType: { SUBTITLES: 'subtitles', CAPTIONS: 'captions' },
        MediaInfo,
        MovieMediaMetadata,
        Track,
        LoadRequest,
      },
      framework: {
        CastContext: FakeCastContext,
        RemotePlayer: FakeRemotePlayer,
        RemotePlayerController: FakeRemotePlayerController,
        CastContextEventType: {
          CAST_STATE_CHANGED: 'cast_state_changed',
          SESSION_STATE_CHANGED: 'session_state_changed',
        },
        RemotePlayerEventType: { CURRENT_TIME_CHANGED: 'current_time_changed' },
        CastState: { NO_DEVICES_AVAILABLE: 'no_devices_available', NOT_CONNECTED: 'not_connected', CONNECTED: 'connected' },
        SessionState: {
          SESSION_STARTED: 'SESSION_STARTED',
          NO_SESSION: 'NO_SESSION',
          SESSION_ENDED: 'SESSION_ENDED',
          SESSION_ENDING: 'SESSION_ENDING',
          SESSION_START_FAILED: 'SESSION_START_FAILED',
        },
      },
    };
    (window as any).chrome = ch;

    // ── window.__fakeCast API ──
    (window as any).__fakeCast = {
      get initCalls() { return fake.initCalls; },
      get loadCalls() { return fake.loadCalls; },
      get stopCalls() { return fake.stopCalls; },
      get castState() { return fake.castState; },
      get session() { return fake.session; },
      get player() { return fake.player; },
      emitCastState(state: string) {
        fake.castState = state;
        fake.castStateListeners.forEach((cb: any) => { try { cb({ castState: state }); } catch {} });
      },
      emitSessionState,
      setCurrentTime(t: number) {
        if (!fake.player) return;
        fake.player.currentTime = t;
        if (fake.controller) {
          fake.controller.timeListeners.forEach((cb: any) => { try { cb({ type: 'current_time_changed' }); } catch {} });
        }
      },
    };

    // Register the SDK element so useCast's ensureCastSdk() short-circuits and
    // never fetches the real gstatic cast_sender.js. Created at
    // DOMContentLoaded: at document-start <head> does not exist yet, and
    // appending to `document` at that point corrupts the HTML parser (blank
    // page). The hook only runs after React mounts, so this is in time.
    const registerSdkElement = () => {
      if (document.getElementById('cast-sdk-script')) return;
      const el = document.createElement('script');
      el.id = 'cast-sdk-script';
      (document.head || document.documentElement || document).appendChild(el);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', registerSdkElement);
    } else {
      registerSdkElement();
    }
    (window as any).__onGCastApiAvailable = (available: boolean) => { if (!available) console.warn('[fakeCast] sdk unavailable'); };
  })();
}

// ─── API stubs (minimal but sufficient for the player to open) ─────────────
async function stubApi(page: Page) {
  await page.route('**/api/lan-ip', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ lanIp: LAN_IP, port: LAN_PORT }) })
  );
  await page.route('**/api/projects/*/cast', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        available: true,
        target: 'h264',
        audioTracks: [{ trackId: 1, language: 'pt-br', codec: 'aac', channels: 2, label: 'Português (Brasil)' }],
      }),
    })
  );
  await page.route('**/api/projects/*/tracks', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        audio: [{ index: 1, language: 'pt-br', codec: 'aac', channels: 2 }],
        subtitles: [{ index: 1, language: 'pt-br', codec: 'webvtt' }],
      }),
    })
  );
  await page.route('**/api/projects/*/progress', (route) => {
    if (route.request().method() === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ position: 0, watched: false }) });
  });
  await page.route('**/api/projects/*/watched', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  );
  await page.route('**/api/projects/*/video**', (route) => {
    // Serve the tiny MP4 with byte-range support (Accept-Ranges / 206) so the
    // media element can SEEK — without it, `video.currentTime = X` is silently
    // ignored and resume-after-cast cannot be verified.
    const req = route.request();
    const range = req.headers()['range'];
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      const start = m ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : mp4Buffer.length - 1;
      const slice = mp4Buffer.subarray(start, end + 1);
      return route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${mp4Buffer.length}`,
          'Content-Length': String(slice.length),
        },
        body: slice,
      });
    }
    return route.fulfill({
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(mp4Buffer.length),
      },
      body: mp4Buffer,
    });
  });
  await page.route('**/api/projects/*/subtitles*', (route) =>
    route.fulfill({ status: 200, contentType: 'text/vtt', body: 'WEBVTT\n\n00:00.000 --> 00:05.000\nOlá\n' })
  );
  await page.route('**/api/projects/*/thumbnail', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: pngBuffer })
  );
  await page.route('**/api/projects', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: PROJECT_ID,
          title: 'Filme de Teste',
          status: 'done',
          projectType: 'movie',
          youtubeUrl: '',
          errorMessage: null,
          createdAt: new Date().toISOString(),
        },
      ]),
    })
  );
}

const CAST_BTN = 'button[title="Transmitir para a TV"]';
const CAST_BTN_ANY = 'button[title*="Transmitir"]';

// Remove the Next.js dev error overlay if the dev server shows one (e.g. while
// another agent is mid-edit) so it cannot intercept clicks.
async function dismissDevOverlay(page: Page) {
  await page.evaluate(() => {
    const p = document.querySelector('nextjs-portal');
    if (p) p.remove();
  }).catch(() => {});
}

test.describe('Google Cast smoke', () => {
  test('a. cast button hidden when the real SDK is absent', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Cast smoke targets Chromium only');
    await page.route('**/gstatic.com/**', (route) => route.abort());
    await stubApi(page);
    await page.goto('/media?watch=' + PROJECT_ID);
    await dismissDevOverlay(page);

    // Player mounts (watch flow)
    await expect(page.locator('video')).toBeVisible();
    await expect(page.locator('#cast-sdk-script')).toHaveCount(1); // ensureCastSdk tried

    // Cast button must never appear without a working SDK.
    await expect(page.locator(CAST_BTN_ANY)).toHaveCount(0);
    await page.waitForTimeout(1500); // bounded settle: gstatic abort + re-renders
    await expect(page.locator(CAST_BTN_ANY)).toHaveCount(0);
  });

  test('b. cast button visible+enabled with fake SDK and devices available', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Cast smoke targets Chromium only');
    await page.addInitScript(injectFakeCastSdk);
    await stubApi(page);
    await page.goto('/media?watch=' + PROJECT_ID);
    await dismissDevOverlay(page);

    await expect(page.locator('video')).toBeVisible();
    const castBtn = page.locator(CAST_BTN);
    await expect(castBtn).toBeVisible();
    await expect(castBtn).toBeEnabled();

    // CastContext.initialize() called with Default Media Receiver + ORIGIN_SCOPED
    const initCalls: any[] = await page.evaluate(() => (window as any).__fakeCast.initCalls);
    expect(initCalls.length).toBeGreaterThanOrEqual(1);
    expect(initCalls[0].receiverApplicationId).toBe('CC1AD845');
    expect(initCalls[0].autoJoinPolicy).toBe('origin_scoped');

    // devicesAvailable reacts to cast_state_changed events (SDK enum values)
    await page.evaluate(() => (window as any).__fakeCast.emitCastState('no_devices_available'));
    await expect(page.locator(CAST_BTN_ANY)).toHaveCount(0);
    await page.evaluate(() => (window as any).__fakeCast.emitCastState('not_connected'));
    await expect(castBtn).toBeVisible();
  });

  test('c+d+e. cast load request shape, progress throttle, resume after session end', async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== 'chromium', 'Cast smoke targets Chromium only');
    // The 'mobile' project (iPhone 13 emulation) applies a visual-viewport scale
    // that breaks Playwright's actionability hit-testing against the player's
    // full-screen fixed overlay (elementFromPoint resolves correctly, but
    // Playwright reports the <video> as intercepting — verified empirically).
    // The cast journey is a desktop/web behavior; smoke tests (a) and (b) still
    // run on the mobile project.
    test.skip(testInfo.project.name === 'mobile', 'Full cast journey runs on the desktop project only (emulated-viewport hit-test quirk)');
    await page.addInitScript(injectFakeCastSdk);
    await stubApi(page);

    // Count PUTs to /progress whose body carries position 42 (cast progress save)
    let castProgressPuts = 0;
    page.on('request', (r) => {
      if (r.method() === 'PUT' && r.url().endsWith('/progress')) {
        try {
          const body = JSON.parse(r.postData() || '{}');
          if (body.position === 42) castProgressPuts += 1;
        } catch {}
      }
    });

    await page.goto('/media?watch=' + PROJECT_ID);
    await dismissDevOverlay(page);

    await expect(page.locator('video')).toBeVisible();
    const castBtn = page.locator(CAST_BTN);
    await expect(castBtn).toBeVisible();
    await expect(castBtn).toBeEnabled();

    // The floating controls bar auto-hides after ~3s of playback; hover the
    // player first so the control buttons stay actionable.
    await page.locator('video').hover();

    // Enable pt-br subtitles (the subtitle language must produce a TEXT track)
    await page.locator('button[title="Áudio e Legendas"]').click();
    await expect(page.getByRole('heading', { name: 'Faixas disponíveis' })).toBeVisible();
    await page.locator('button:has-text("Português (Brasil)")').last().click();
    await page.locator('button:has-text("Concluído")').click();

    // Click the cast button
    await castBtn.click();

    // Wait until loadMedia was called
    await expect
      .poll(() => page.evaluate(() => (window as any).__fakeCast.loadCalls.length), { timeout: 10000 })
      .toBeGreaterThanOrEqual(1);
    const load: any = await page.evaluate(() => (window as any).__fakeCast.loadCalls[0]);
    const media = load.media;

    // ASSERTION (c1): contentId is the LAN-repointed video URL with target=h264
    // and NO audio= param.
    expect(media.contentId).toMatch(
      new RegExp(`^http://${LAN_IP.replace(/\./g, '\\.')}:${LAN_PORT}/api/projects/[0-9a-f-]{36}/video\\?target=h264$`)
    );
    expect(media.contentId).not.toContain('audio=');

    // ASSERTION (c2): contentType is video/mp4 and a text/vtt track exists
    expect(media.contentType).toBe('video/mp4');
    const textTracks = (media.tracks || []).filter((t: any) => t.trackContentType === 'text/vtt');
    expect(textTracks.length).toBe(1);
    expect(textTracks[0].trackId).toBe(TEXT_TRACK_ID);
    expect(textTracks[0].subtype).toBe('subtitles');
    expect(textTracks[0].language).toBe('pt-br');
    expect(textTracks[0].name).toBe('Português (Brasil)');
    expect(textTracks[0].trackContentId).toBe(
      `http://${LAN_IP}:${LAN_PORT}/api/projects/${PROJECT_ID}/subtitles?lang=pt-br`
    );

    // ASSERTION (c3): activeTrackIds includes the pt-br audio track id 1
    expect(load.activeTrackIds).toContain(1);
    expect(load.activeTrackIds).toContain(TEXT_TRACK_ID);
    expect(load.autoplay).toBe(true);

    // ASSERTION (d): CURRENT_TIME_CHANGED → throttled PUT to /progress
    await page.evaluate(() => (window as any).__fakeCast.setCurrentTime(42));
    await expect.poll(() => castProgressPuts, { timeout: 5000 }).toBeGreaterThanOrEqual(1);
    // Second change inside the throttle window (3.5s) must NOT save again
    await page.evaluate(() => (window as any).__fakeCast.setCurrentTime(43));
    await page.waitForTimeout(900);
    expect(castProgressPuts).toBe(1);

    // ASSERTION (e): SESSION_ENDED with currentTime=123 → resume local playback
    await page.evaluate(() => (window as any).__fakeCast.setCurrentTime(123));
    await page.evaluate(() =>
      (window as any).__fakeCast.emitSessionState('SESSION_ENDED', { currentTime: 123 })
    );

    await expect
      .poll(
        () => page.evaluate(() => {
          const v = document.querySelector('video');
          return v ? { paused: v.paused, t: v.currentTime } : null;
        }),
        { timeout: 10000 }
      )
      .toEqual({ paused: false, t: expect.any(Number) });

    const state = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement;
      return { paused: v.paused, t: v.currentTime };
    });
    expect(state.paused).toBe(false);
    expect(Math.abs(state.t - 123)).toBeLessThanOrEqual(10);
  });
});
