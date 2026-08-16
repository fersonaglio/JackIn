// Tipos ambient para o Google Cast Web Sender SDK (cast_sender.js).
// Só a superfície mínima usada pelo player; o SDK real é injetado em runtime
// e o restante das APIs fica acessível via `any` quando necessário.
declare namespace chrome.cast {
  const isAvailable: boolean;
  const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

  enum AutoJoinPolicy {
    ORIGIN_SCOPED,
  }

  namespace media {
    const DEFAULT_MEDIA_RECEIVER_APP_ID: string;

    enum StreamType {
      BUFFERED,
    }

    enum TrackType {
      TEXT,
      AUDIO,
    }

    enum TextTrackType {
      SUBTITLES,
    }

    class MediaInfo {
      constructor(contentId: string, contentType: string);
      contentId: string;
      contentType: string;
      metadata: any;
      streamType: StreamType;
      tracks: Track[];
      duration: number | null;
    }

    class Image {
      url: string;
      constructor(url: string);
    }

    class Track {
      constructor(trackId: number, trackType: TrackType);
      trackId: number;
      trackType: TrackType;
      trackContentId: string;
      trackContentType: string;
      subtype: TextTrackType;
      name: string;
      language: string;
    }

    class MovieMediaMetadata {
      metadataType: any;
      title: string;
      images: Image[];
    }

    class LoadRequest {
      constructor(mediaInfo: MediaInfo);
      media: MediaInfo;
      autoplay: boolean;
      currentTime: number;
      activeTrackIds: number[];
    }
  }

  namespace framework {
    const CastContext: any;

    enum CastState {
      NO_DEVICES_AVAILABLE,
      NOT_CONNECTED,
      CONNECTED,
    }

    enum SessionState {
      NO_SESSION,
      SESSION_STARTING,
      SESSION_STARTED,
      SESSION_START_FAILED,
      SESSION_ENDING,
      SESSION_ENDED,
      SESSION_RESUMED,
    }

    enum CastContextEventType {
      CAST_STATE_CHANGED,
      SESSION_STATE_CHANGED,
    }

    enum RemotePlayerEventType {
      ANY_CHANGE,
      IS_CONNECTED_CHANGED,
      IS_MEDIA_LOADED_CHANGED,
      CURRENT_TIME_CHANGED,
      PLAYER_STATE_CHANGED,
    }

    class RemotePlayer {
      currentTime: number;
      isPaused: boolean;
      isConnected: boolean;
      isMediaLoaded: boolean;
      playerState: any;
    }

    class RemotePlayerController {
      constructor(player: RemotePlayer);
      play(): void;
      pause(): void;
      stop(): void;
      seek(): void;
      addEventListener(type: any, cb: (e: any) => void): void;
      removeEventListener(type: any, cb: (e: any) => void): void;
    }

    class CastSession {
      loadMedia(req: chrome.cast.media.LoadRequest): Promise<void>;
      stop(): Promise<void>;
    }
  }
}

interface Window {
  __onGCastApiAvailable?: (isAvailable: boolean) => void;
}
