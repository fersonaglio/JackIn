'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { saveWatchProgress } from '@/lib/api';
import { buildCastMediaUrl, buildCastTrackUrl, normalizeHostForCast } from '@/lib/cast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const CAST_SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const CAST_SCRIPT_ID = 'cast-sdk-script';
const PROGRESS_SAVE_THROTTLE_MS = 3500;
const TEXT_TRACK_ID = 1000;

export interface CastLoadOptions {
  title: string;
  videoUrl: string;
  projectId: string;
  subtitleLang?: string;
  thumbnailUrl?: string;
  audioTrackId?: number;
}

export interface CastState {
  castSupported: boolean;
  devicesAvailable: boolean;
  isCasting: boolean;
  currentTime: number;
  castProjectId: string | null;
}

const LANG_LABEL: Record<string, string> = {
  'pt-br': 'Português (Brasil)',
  en: 'Inglês (Original)',
  es: 'Espanhol',
  fr: 'Francês',
  de: 'Alemão',
  ja: 'Japonês',
  it: 'Italiano',
  ru: 'Russo',
  ko: 'Coreano',
  und: 'Indefinido',
};
const langLabel = (lang: string) => LANG_LABEL[lang] || lang.toUpperCase();

// ─── Estado do SDK a nível de módulo. HMR-safe: além das flags de módulo,
// checamos o DOM (script já injetado) para não injetar o SDK duas vezes. ───
let sdkInjected = false;
let sdkReady = false;
let castContextInitialized = false;
const sdkReadyListeners = new Set<() => void>();

function castSdkAvailable(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    typeof chrome.cast !== 'undefined' &&
    typeof chrome.cast.framework !== 'undefined' &&
    typeof chrome.cast.framework.CastContext !== 'undefined' &&
    chrome.cast.isAvailable === true
  );
}

function handleSdkAvailable(available: boolean): void {
  sdkReady = available;
  if (!available || typeof window === 'undefined' || !castSdkAvailable()) return;
  if (!castContextInitialized) {
    castContextInitialized = true;
    try {
      const context = chrome.cast?.framework?.CastContext?.getInstance?.();
      if (context) {
        context.initialize({
          receiverApplicationId: chrome.cast?.media?.DEFAULT_MEDIA_RECEIVER_APP_ID || '',
          autoJoinPolicy: chrome.cast?.AutoJoinPolicy?.ORIGIN_SCOPED,
        });
      }
    } catch (err) {
      console.error('[Cast] falha ao inicializar CastContext:', err);
    }
  }
  sdkReadyListeners.forEach((cb) => cb());
}

function subscribeSdkReady(cb: () => void): () => void {
  if (sdkReady) {
    cb();
    return () => {};
  }
  sdkReadyListeners.add(cb);
  return () => {
    sdkReadyListeners.delete(cb);
  };
}

function ensureCastSdk(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (document.getElementById(CAST_SCRIPT_ID)) {
    // SDK já presente no DOM (ex.: HMR re-executou este módulo) — usa o que existe.
    sdkInjected = true;
    if (castSdkAvailable()) handleSdkAvailable(true);
    return;
  }
  if (sdkInjected) return;
  sdkInjected = true;
  // O callback precisa existir ANTES do script para o SDK avisar que carregou.
  window.__onGCastApiAvailable = (available: boolean) => handleSdkAvailable(available);
  const script = document.createElement('script');
  script.id = CAST_SCRIPT_ID;
  script.src = CAST_SDK_URL;
  script.async = true;
  script.onerror = () => console.error('[Cast] falha ao carregar o SDK do Google Cast');
  document.head.appendChild(script);
}

// ─── Cache do IP da LAN (o Chromecast busca a mídia direto do servidor local). ───
let lanIpCache: { lanIp: string; port: number } | null = null;
let lanIpPromise: Promise<{ lanIp: string; port: number }> | null = null;

async function fetchLanIp(): Promise<{ lanIp: string; port: number }> {
  if (lanIpCache) return lanIpCache;
  if (!lanIpPromise) {
    lanIpPromise = fetch(`${API_URL}/lan-ip`)
      .then((res) => {
        if (!res.ok) throw new Error(`lan-ip ${res.status}`);
        return res.json() as Promise<{ lanIp?: string; port?: number }>;
      })
      .then((data) => {
        if (!data.lanIp) throw new Error('no_lan_ip');
        lanIpCache = { lanIp: data.lanIp, port: data.port ?? 3001 };
        return lanIpCache;
      })
      .catch((err) => {
        // Deixa a próxima chamada tentar de novo (cache de promise só em sucesso).
        lanIpPromise = null;
        throw err;
      });
  }
  return lanIpPromise;
}

export function useCast(): CastState & {
  castCurrent(opts: CastLoadOptions): Promise<void>;
  stopCasting(): Promise<void>;
} {
  const [castSupported, setCastSupported] = useState(false);
  const [devicesAvailable, setDevicesAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [castProjectId, setCastProjectId] = useState<string | null>(null);

  const castProjectIdRef = useRef<string | null>(null);
  const progressRef = useRef<{ lastSave: number }>({ lastSave: 0 });
  const remotePlayerRef = useRef<{ player: any; controller: any } | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const setupRemotePlayer = () => {
      if (remotePlayerRef.current) return;
      const player = new chrome.cast.framework.RemotePlayer();
      const controller = new chrome.cast.framework.RemotePlayerController(player);
      remotePlayerRef.current = { player, controller };
      const onTimeChanged = () => {
        setCurrentTime(player.currentTime);
        const projectId = castProjectIdRef.current;
        const now = Date.now();
        if (projectId && player.currentTime > 0 && now - progressRef.current.lastSave >= PROGRESS_SAVE_THROTTLE_MS) {
          progressRef.current.lastSave = now;
          saveWatchProgress(projectId, player.currentTime).catch(() => {});
        }
      };
      controller.addEventListener(chrome.cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, onTimeChanged);
      cleanupRef.current.push(() => {
        controller.removeEventListener(chrome.cast.framework.RemotePlayerEventType.CURRENT_TIME_CHANGED, onTimeChanged);
      });
    };

    const tearDownRemotePlayer = () => {
      remotePlayerRef.current = null;
    };

    const onSdkReady = () => {
      if (!castSdkAvailable() || !window.isSecureContext) return;
      setCastSupported(true);

      const context = chrome.cast.framework.CastContext.getInstance();
      if (!context) return;

      const onCastStateChanged = (e: any) => {
        const state = e?.castState ?? context.getCastState?.();
        setDevicesAvailable(state !== chrome.cast.framework.CastState.NO_DEVICES_AVAILABLE);
      };

      const onSessionStateChanged = (e: any) => {
        const sessionState = e?.sessionState;
        if (sessionState === chrome.cast.framework.SessionState.SESSION_STARTED) {
          setIsCasting(true);
          setupRemotePlayer();
        } else if (
          sessionState === chrome.cast.framework.SessionState.NO_SESSION ||
          sessionState === chrome.cast.framework.SessionState.SESSION_ENDED ||
          sessionState === chrome.cast.framework.SessionState.SESSION_ENDING ||
          sessionState === chrome.cast.framework.SessionState.SESSION_START_FAILED
        ) {
          setIsCasting(false);
          setCastProjectId(null);
          castProjectIdRef.current = null;
          tearDownRemotePlayer();
        }
      };

      context.addEventListener(chrome.cast.framework.CastContextEventType.CAST_STATE_CHANGED, onCastStateChanged);
      context.addEventListener(chrome.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, onSessionStateChanged);
      cleanupRef.current.push(() => {
        context.removeEventListener(chrome.cast.framework.CastContextEventType.CAST_STATE_CHANGED, onCastStateChanged);
        context.removeEventListener(chrome.cast.framework.CastContextEventType.SESSION_STATE_CHANGED, onSessionStateChanged);
      });

      // Estado inicial — o evento de cast state pode não disparar se nada mudou.
      const initialCastState = context.getCastState?.();
      if (initialCastState !== undefined) {
        setDevicesAvailable(initialCastState !== chrome.cast.framework.CastState.NO_DEVICES_AVAILABLE);
      }
    };

    const offSdkReady = subscribeSdkReady(onSdkReady);
    cleanupRef.current.push(offSdkReady);
    ensureCastSdk();

    return () => {
      cleanupRef.current.forEach((off) => {
        try {
          off();
        } catch {
          // listener já removido pelo SDK — ignora
        }
      });
      cleanupRef.current = [];
      remotePlayerRef.current = null;
    };
  }, []);

  const castCurrent = useCallback(async (opts: CastLoadOptions) => {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      throw new Error('Cast indisponível fora do navegador');
    }
    if (!castSdkAvailable()) {
      throw new Error('SDK do Google Cast não está disponível (contexto seguro?)');
    }

    const { lanIp, port } = await fetchLanIp();
    castProjectIdRef.current = opts.projectId;
    setCastProjectId(opts.projectId);

    const session = await chrome.cast.framework.CastContext.getInstance().requestSession();

    const mediaInfo = new chrome.cast.media.MediaInfo(
      buildCastMediaUrl(opts.videoUrl, lanIp, port),
      'video/mp4'
    );
    const metadata = new chrome.cast.media.MovieMediaMetadata();
    metadata.title = opts.title;
    if (opts.thumbnailUrl) {
      // O poster também é buscado pela TV — reaponte localhost para a LAN.
      metadata.images = [{ url: normalizeHostForCast(opts.thumbnailUrl, lanIp, port) }];
    }
    mediaInfo.metadata = metadata;
    mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;

    const tracks: chrome.cast.media.Track[] = [];
    const activeTrackIds: number[] = [];

    if (opts.subtitleLang && opts.subtitleLang !== 'off') {
      const textTrack = new chrome.cast.media.Track(TEXT_TRACK_ID, chrome.cast.media.TrackType.TEXT);
      textTrack.trackContentId = buildCastTrackUrl(lanIp, port, opts.projectId, opts.subtitleLang);
      textTrack.trackContentType = 'text/vtt';
      textTrack.subtype = chrome.cast.media.TextTrackType.SUBTITLES;
      textTrack.name = langLabel(opts.subtitleLang);
      textTrack.language = opts.subtitleLang;
      tracks.push(textTrack);
      activeTrackIds.push(TEXT_TRACK_ID);
    }

    if (typeof opts.audioTrackId === 'number' && opts.audioTrackId > 0) {
      activeTrackIds.push(opts.audioTrackId);
    }
    mediaInfo.tracks = tracks;

    const loadRequest = new chrome.cast.media.LoadRequest(mediaInfo);
    loadRequest.autoplay = true;
    loadRequest.activeTrackIds = activeTrackIds;

    await session.loadMedia(loadRequest);
  }, []);

  const stopCasting = useCallback(async () => {
    if (typeof window === 'undefined' || !castSdkAvailable()) return;
    try {
      const session = chrome.cast.framework.CastContext.getInstance().getCurrentSession();
      if (session) {
        await session.stop();
      }
    } catch (err) {
      console.error('Erro ao parar a transmissão:', err);
    }
  }, []);

  return {
    castSupported,
    devicesAvailable,
    isCasting,
    currentTime,
    castProjectId,
    castCurrent,
    stopCasting,
  };
}
