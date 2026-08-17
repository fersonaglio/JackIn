'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchPtBrSubtitles, saveWatchProgress, getWatchProgress, markWatched } from '@/lib/api';
import { pickCastAudioTrackId, type CastAudioTrack } from '@/lib/cast';
import { useCast } from '@/hooks/useCast';
import { nextWatchedState } from '@/lib/watchState';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface CinemaPlayerProps {
  isOpen: boolean;
  title: string;
  videoUrl: string;
  projectId: string;
  onClose: () => void;
  episodeList?: { id: string; title: string; videoUrl: string }[];
  onEpisodeChange?: (episodeId: string) => void;
}

interface AudioTrackInfo {
  index: number;
  language: string;
  codec: string;
  channels: number;
  title?: string;
}

interface SubtitleTrackInfo {
  index: number;
  language: string;
  codec: string;
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

const AUDIO_CODEC_LABEL: Record<string, string> = {
  aac: 'AAC',
  ac3: 'AC3',
  eac3: 'EAC3',
  dts: 'DTS',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  vorbis: 'Vorbis',
  truehd: 'TrueHD',
  pcm_s16le: 'PCM',
};
const audioCodecLabel = (codec: string) => AUDIO_CODEC_LABEL[codec] || codec.toUpperCase() || '?';

const SUBTITLE_CODEC_LABEL: Record<string, string> = {
  subrip: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'VTT',
  mov_text: 'VTT',
  srt: 'SRT',
  text: 'Texto',
  mp4: 'MP4',
};
const subtitleCodecLabel = (codec: string) => SUBTITLE_CODEC_LABEL[codec] || codec.toUpperCase() || '?';

export default function CinemaPlayer({ isOpen, title, videoUrl, projectId, onClose, episodeList, onEpisodeChange }: CinemaPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [errorReason, setErrorReason] = useState<'processing' | 'preparing' | 'not_found' | 'unknown'>('unknown');
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef(0);
  const RETRY_MAX = 120;
  // Target de codec do browser: hevc (Safari/Apple) ou h264 (Chrome/Edge/Firefox).
  // Capability-based (canPlayType), não UA-sniffing — Chrome em Apple Silicon
  // toca HEVC por hardware e não deve ser forçado a transcode desnecessário.
  const targetRef = useRef<'hevc' | 'h264'>('h264');
  useEffect(() => {
    try {
      const v = document.createElement('video');
      const hevcOk = v.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"') !== '' || v.canPlayType('video/mp4; codecs="hev1.1.6.L120.90"') !== '';
      targetRef.current = hevcOk ? 'hevc' : 'h264';
    } catch {
      targetRef.current = 'h264';
    }
  }, []);
  const [audioLanguage, setAudioLanguage] = useState<string>('pt-br');
  const [subtitleTrack, setSubtitleTrack] = useState<'off' | 'pt-br' | 'en' | 'es'>('off');
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [availableTracks, setAvailableTracks] = useState<string[]>([]);
  const [availableSubtitles, setAvailableSubtitles] = useState<string[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackInfo[]>([]);
  const [tracksLoaded, setTracksLoaded] = useState(false);
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  const [subtitleMessage, setSubtitleMessage] = useState<string | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const savedTimeRef = useRef(0);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [resumePosition, setResumePosition] = useState(0);
  const [showNextEpisode, setShowNextEpisode] = useState(false);
  const [nextEpisode, setNextEpisode] = useState<{ id: string; title: string } | null>(null);
  const [isPip, setIsPip] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const nextCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const progressSaveRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialMountRef = useRef(true);
  // Auto-continuar o próximo episódio (só nesta sessão). Desligado via
  // engrenagem ou "Não perguntar de novo" no overlay.
  const [autoNext, setAutoNext] = useState(true);
  // Contagem regressiva do próximo episódio (segundos restantes).
  const [countdownLeft, setCountdownLeft] = useState(10);
  const NEXT_EPISODE_COUNTDOWN_SECONDS = 10;
  // Refs espelham o estado para callbacks sem stale closure.
  const autoNextRef = useRef<boolean>(true);
  const nextEpisodeRef = useRef<{ id: string; title: string } | null>(null);

  const {
    castSupported,
    devicesAvailable,
    isCasting,
    currentTime: castCurrentTime,
    castCurrent,
    stopCasting,
  } = useCast();
  const [castMeta, setCastMeta] = useState<{ available: boolean; audioTracks: CastAudioTrack[] }>({ available: false, audioTracks: [] });
  const wasCastingRef = useRef(false);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      const isSupported = Boolean(
        document.pictureInPictureEnabled ||
        ('webkitSupportsPresentationMode' in (document.createElement('video') as any))
      );
      setPipSupported(isSupported);
    }
  }, []);

  useEffect(() => {
    setHasError(false);
    setRetrying(false);
    setErrorReason('unknown');
    setIsPip(false);
    retryCountRef.current = 0;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setTracksLoaded(false);
    setAvailableTracks([]);
    isInitialMountRef.current = true;
    savedTimeRef.current = 0;
    setShowResumePrompt(false);
    setResumePosition(0);
    setCastMeta({ available: false, audioTracks: [] });
    wasCastingRef.current = false;
  }, [videoUrl]);

  useEffect(() => {
    if (!isOpen) {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      retryCountRef.current = 0;
    }
  }, [isOpen]);

  const lastSavedPosRef = useRef<number>(0);
  const seekDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const lastTimeUpdateSaveRef = useRef<number>(0);
  // Estado local de "assistido" — só chama markWatched quando muda de fato
  // (transição ≥90% / <80%), evitando spam de PUT e o "desmarca ao rever".
  const watchedRef = useRef<boolean>(false);

  const saveProgressNow = useCallback((customPos?: number, force = false) => {
    const el = videoRef.current;
    if (!el || !projectId) return;
    const pos = typeof customPos === 'number' ? customPos : el.currentTime;
    if (isNaN(pos) || pos < 1) return;

    if (!force && Math.abs(pos - lastSavedPosRef.current) < 1.5) {
      return;
    }

    lastSavedPosRef.current = pos;
    saveWatchProgress(projectId, pos).catch(() => {});

    if (el.duration > 0) {
      const next = nextWatchedState(pos / el.duration, watchedRef.current);
      if (next !== null) {
        watchedRef.current = next;
        markWatched(projectId, next).catch(() => {});
      }
    }
  }, [projectId]);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    getWatchProgress(projectId).then(({ position, watched }) => {
      watchedRef.current = watched;
      if (!position || position < 60) return;
      setResumePosition(position);
      setShowResumePrompt(true);
      const el = videoRef.current;
      if (el) {
        el.pause();
        setIsPlaying(false);
      }
    }).catch(() => {});
  }, [isOpen, projectId]);

  useEffect(() => {
    if (!isOpen) {
      if (progressSaveRef.current) {
        clearInterval(progressSaveRef.current);
        progressSaveRef.current = null;
      }
      return;
    }
    progressSaveRef.current = setInterval(() => {
      const el = videoRef.current;
      if (el && !el.paused && !el.ended && el.currentTime > 1) {
        saveProgressNow();
      }
    }, 3000);
    return () => {
      if (progressSaveRef.current) {
        clearInterval(progressSaveRef.current);
        progressSaveRef.current = null;
      }
    };
  }, [isOpen, saveProgressNow]);

  // Salva o progresso ao desmontar ou fechar a janela
  useEffect(() => {
    return () => {
      if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
      if (progressSaveRef.current) clearInterval(progressSaveRef.current);
      const el = videoRef.current;
      if (el && projectId && el.currentTime > 1) {
        saveWatchProgress(projectId, el.currentTime).catch(() => {});
      }
    };
  }, [projectId]);

  const cancelNextEpisode = useCallback(() => {
    if (nextCountdownRef.current) {
      clearInterval(nextCountdownRef.current);
      nextCountdownRef.current = null;
    }
    nextEpisodeRef.current = null;
    setNextEpisode(null);
    setShowNextEpisode(false);
  }, []);

  const goToNextEpisode = useCallback(() => {
    const next = nextEpisodeRef.current;
    cancelNextEpisode();
    if (next && onEpisodeChange) {
      onEpisodeChange(next.id);
    }
  }, [cancelNextEpisode, onEpisodeChange]);

  // Mostra o aviso do próximo episódio. Só inicia a contagem regressiva (10s)
  // quando auto-next está ligado; desligado, o aviso fica parado aguardando o
  // usuário — estilo Netflix com auto-play off.
  const promptNextEpisode = useCallback(
    (nextEp: { id: string; title: string }) => {
      nextEpisodeRef.current = nextEp;
      setNextEpisode(nextEp);
      setShowNextEpisode(true);
      // Sempre reseta a contagem (evita que um 0 de um ciclo anterior dispare
      // o próximo na hora quando o auto-next está desligado).
      setCountdownLeft(NEXT_EPISODE_COUNTDOWN_SECONDS);
      if (!autoNextRef.current) return;
      if (nextCountdownRef.current) clearInterval(nextCountdownRef.current);
      nextCountdownRef.current = setInterval(() => {
        setCountdownLeft((c) => Math.max(0, c - 1));
      }, 1000);
    },
    []
  );

  // Contagem chega a 0 → auto-continua para o próximo episódio.
  useEffect(() => {
    if (!showNextEpisode || countdownLeft > 0) return;
    goToNextEpisode();
  }, [countdownLeft, showNextEpisode, goToNextEpisode]);

  // "Não perguntar de novo": desliga o auto-next na hora (sessão) e para a
  // contagem atual — o aviso continua visível, mas sem auto-start.
  const disableAutoNext = useCallback(() => {
    autoNextRef.current = false;
    setAutoNext(false);
    if (nextCountdownRef.current) {
      clearInterval(nextCountdownRef.current);
      nextCountdownRef.current = null;
    }
  }, []);

  // Liga/desliga o auto-next (ref + estado). Ao religar com um aviso ativo,
  // retoma a contagem regressiva do episódio atual.
  const setAutoNextBoth = useCallback(
    (v: boolean) => {
      autoNextRef.current = v;
      setAutoNext(v);
      if (v && showNextEpisode && nextEpisode) {
        setCountdownLeft(NEXT_EPISODE_COUNTDOWN_SECONDS);
        if (nextCountdownRef.current) clearInterval(nextCountdownRef.current);
        nextCountdownRef.current = setInterval(() => {
          setCountdownLeft((c) => Math.max(0, c - 1));
        }, 1000);
      }
    },
    [showNextEpisode, nextEpisode]
  );

  const handleVideoEnded = useCallback(() => {
    setIsPlaying(false);
    const el = videoRef.current;
    // Salva a posição final (100%) antes de marcar assistido — senão o
    // watch_progress fica no último tick (alguns segundos antes do fim).
    if (el && projectId && el.duration > 0 && !isNaN(el.duration)) {
      saveWatchProgress(projectId, el.duration).catch(() => {});
    }
    watchedRef.current = true;
    markWatched(projectId, true).catch(() => {});
    if (!episodeList || episodeList.length === 0) return;
    const currentIdx = episodeList.findIndex(ep => ep.id === projectId);
    if (currentIdx >= 0 && currentIdx < episodeList.length - 1) {
      promptNextEpisode(episodeList[currentIdx + 1]);
    }
  }, [projectId, episodeList, promptNextEpisode]);

  const handleResumePlay = useCallback(() => {
    setShowResumePrompt(false);
    const el = videoRef.current;
    if (el && resumePosition > 0) {
      el.currentTime = resumePosition;
    }
    el?.play().then(() => setIsPlaying(true)).catch(() => {});
  }, [resumePosition]);

  const handleStartFromBeginning = useCallback(() => {
    setShowResumePrompt(false);
    setResumePosition(0);
    const el = videoRef.current;
    if (el) el.currentTime = 0;
    if (projectId) saveWatchProgress(projectId, 0).catch(() => {});
    el?.play().then(() => setIsPlaying(true)).catch(() => {});
  }, [projectId]);

  const buildVideoUrl = useCallback((base: string, lang?: string) => {
    const sep = base.includes('?') ? '&' : '?';
    let url = `${base}${sep}target=${targetRef.current}`;
    if (lang) url += `&audio=${lang}`;
    return url;
  }, []);

  const reloadVideo = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setHasError(false);
    el.load();
    if (resumePosition > 0) {
      el.currentTime = resumePosition;
    }
    el.play().then(() => setIsPlaying(true)).catch(() => { });
  }, [resumePosition]);

  const handleVideoError = useCallback(async () => {
    const errCode = videoRef.current?.error?.code;
    if (errCode === 1) return;

    const currentPos = videoRef.current?.currentTime || 0;
    if (currentPos > 0 && resumePosition === 0) {
      setResumePosition(currentPos);
    }

    setHasError(true);
    let reason: 'processing' | 'preparing' | 'not_found' | 'unknown' = 'unknown';
    if (!videoUrl || retryCountRef.current >= RETRY_MAX) {
      setRetrying(false);
      return;
    }
    try {
      const ctrl = new AbortController();
      const probe = await fetch(buildVideoUrl(videoUrl), { headers: { Range: 'bytes=0-0' }, signal: ctrl.signal });
      setTimeout(() => ctrl.abort(), 3000);
      if (probe.status === 404) {
        setErrorReason('not_found');
        setRetrying(false);
        return;
      }
      if (probe.status === 425) {
        try {
          const body = await probe.json();
          reason = body.error === 'video_preparing' ? 'preparing' : 'processing';
        } catch {
          reason = 'processing';
        }
      }
    } catch {
      reason = 'unknown';
    }
    setErrorReason(reason);
    setRetrying(true);
    retryCountRef.current += 1;
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = setTimeout(() => {
      setRetrying(false);
      reloadVideo();
    }, reason === 'preparing' ? 3000 : 1000);
  }, [videoUrl, reloadVideo, resumePosition, buildVideoUrl]);

  useEffect(() => {
    if (!isOpen || !projectId) return;
    fetch(`${API_URL}/projects/${projectId}/tracks`)
      .then(res => {
        if (!res.ok) throw new Error(`tracks ${res.status}`);
        return res.json();
      })
      .then(data => {
        const audio = (data.audio || []) as AudioTrackInfo[];
        const subtitles = (data.subtitles || []) as SubtitleTrackInfo[];
        setAudioTracks(audio);
        setSubtitleTracks(subtitles);

        const uniqueAudio = [...new Set<string>(audio.map(t => t.language))];
        setAvailableTracks(uniqueAudio);
        if (uniqueAudio.length > 0 && !uniqueAudio.includes(audioLanguage)) {
          setAudioLanguage(uniqueAudio[0] as 'pt-br' | 'en' | 'es');
        }

        const uniqueSub = [...new Set<string>(subtitles.map(t => t.language))];
        setAvailableSubtitles(uniqueSub);

        setTracksLoaded(true);
      })
      .catch(() => {
        setAvailableTracks([]);
        setAvailableSubtitles([]);
        setAudioTracks([]);
        setSubtitleTracks([]);
        setTracksLoaded(true);
      });

    // Meta de transmissão (Google Cast). Se o endpoint ainda não existir ou
    // falhar, trata como indisponível — o player local continua funcionando.
    fetch(`${API_URL}/projects/${projectId}/cast`)
      .then(res => (res.ok ? res.json() : null))
      .then((data: { available?: boolean; audioTracks?: CastAudioTrack[] } | null) => {
        setCastMeta({
          available: !!data?.available,
          audioTracks: data?.audioTracks || [],
        });
      })
      .catch(() => {
        setCastMeta({ available: false, audioTracks: [] });
      });
  }, [isOpen, projectId]);

  const handleFetchSubtitles = useCallback(async () => {
    if (!projectId) return;
    setSubtitleLoading(true);
    setSubtitleMessage(null);
    try {
      const res = await fetchPtBrSubtitles(projectId);
      if (res.ok) {
        setSubtitleMessage('Legenda PT-BR baixada com sucesso.');
        setSubtitleTrack('pt-br');
        const { fetch } = window;
        const ctrl = new AbortController();
        fetch(`${API_URL}/projects/${projectId}/tracks`, { signal: ctrl.signal })
          .then(r => (r.ok ? r.json() : null))
          .then(data => {
            if (!data) return;
            const subtitles = (data.subtitles || []) as SubtitleTrackInfo[];
            setSubtitleTracks(subtitles);
            setAvailableSubtitles([...new Set(subtitles.map(t => t.language))]);
          })
          .catch(() => {});
      } else {
        const reason = res.code === 'no_api_key'
          ? 'Chave OpenSubtitles não configurada no servidor.'
          : res.code === 'login_failed'
            ? 'Credenciais OpenSubtitles inválidas.'
            : res.error || 'Nenhuma legenda PT-BR encontrada.';
        setSubtitleMessage(reason);
      }
    } catch {
      setSubtitleMessage('Não foi possível buscar legendas agora.');
    } finally {
      setSubtitleLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (!videoRef.current || !isOpen || !videoUrl) return;
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    savedTimeRef.current = videoRef.current.currentTime;
    const wasPlaying = !videoRef.current.paused;
    videoRef.current.src = buildVideoUrl(videoUrl, audioLanguage);
    videoRef.current.load();
    if (wasPlaying) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => { });
    }
  }, [audioLanguage, subtitleTrack, isOpen, videoUrl, buildVideoUrl]);

  // Garante que a faixa de legenda selecionada fique ativa após o load. Sem
  // isso, <track> injetado dinamicamente pode ficar em 'disabled' no browser.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !isOpen || !el.textTracks) return;
    for (let i = 0; i < el.textTracks.length; i++) {
      const t = el.textTracks[i];
      const active = subtitleTrack !== 'off' && (t.language === subtitleTrack || t.label === langLabel(subtitleTrack));
      t.mode = active ? 'showing' : 'disabled';
    }
  }, [subtitleTrack, isOpen]);

  const handleLoadedMetadata = () => {
    setDuration(videoRef.current?.duration || 0);
    if (showResumePrompt) {
      videoRef.current?.pause();
      setIsPlaying(false);
      return;
    }
    if (savedTimeRef.current > 0 && videoRef.current) {
      try {
        videoRef.current.currentTime = savedTimeRef.current;
        savedTimeRef.current = 0;
      } catch {
        // stream without seek support — ignore
      }
    }
  };

  const togglePlay = useCallback(() => {
    if (!videoRef.current || showResumePrompt) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => { });
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, [showResumePrompt]);

  const toggleMute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  }, [isMuted]);

  const handleVolumeChange = (newVol: number) => {
    if (!videoRef.current) return;
    videoRef.current.volume = newVol;
    setVolume(newVol);
    setIsMuted(newVol === 0);
  };

  const seekRelative = useCallback((seconds: number) => {
    if (!videoRef.current) return;
    const newTime = Math.max(0, Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      saveProgressNow(newTime, true);
    }, 400);
  }, [saveProgressNow]);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    if (videoRef.current) {
      videoRef.current.currentTime = val;
      setCurrentTime(val);
    }
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    seekDebounceRef.current = setTimeout(() => {
      saveProgressNow(val, true);
    }, 400);
  };

  const handleClose = useCallback(() => {
    if (seekDebounceRef.current) clearTimeout(seekDebounceRef.current);
    saveProgressNow(undefined, true);
    if (isCasting) stopCasting().catch(() => {});
    onClose();
  }, [saveProgressNow, onClose, isCasting, stopCasting]);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => { });
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => { });
    }
  }, []);

  const togglePictureInPicture = useCallback(async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled && el.requestPictureInPicture) {
        await el.requestPictureInPicture();
      } else if ((el as any).webkitSupportsPresentationMode && typeof (el as any).webkitSetPresentationMode === 'function') {
        const mode = (el as any).webkitPresentationMode;
        (el as any).webkitSetPresentationMode(mode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      }
    } catch (err) {
      console.error('Erro ao alternar Picture-in-Picture:', err);
    }
  }, []);

  const handleCastClick = useCallback(async () => {
    if (isCasting) {
      await stopCasting().catch(() => {});
      return;
    }
    videoRef.current?.pause();
    saveProgressNow(undefined, true);
    try {
      const audioTrackId = pickCastAudioTrackId(castMeta.audioTracks, audioLanguage);
      await castCurrent({
        title,
        videoUrl,
        projectId,
        subtitleLang: subtitleTrack,
        thumbnailUrl: `${API_URL}/projects/${projectId}/thumbnail`,
        audioTrackId,
      });
    } catch (err) {
      // Falha (diálogo cancelado, lan-ip indisponível, rede): retoma o player local.
      console.error('Erro ao transmitir para a TV:', err);
      videoRef.current?.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isCasting, stopCasting, castCurrent, castMeta.audioTracks, audioLanguage, title, videoUrl, projectId, subtitleTrack, saveProgressNow]);

  // Retoma a reprodução local quando a transmissão para a TV termina.
  useEffect(() => {
    if (isCasting) {
      wasCastingRef.current = true;
      return;
    }
    if (wasCastingRef.current && videoRef.current && castCurrentTime > 0) {
      wasCastingRef.current = false;
      videoRef.current.currentTime = castCurrentTime;
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }, [isCasting, castCurrentTime]);

  // Para a transmissão ao trocar de episódio (o videoUrl muda). Depende só do
  // videoUrl de propósito: girar o isCasting não deve derrubar uma sessão ativa.
  useEffect(() => {
    if (isCasting) stopCasting().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoUrl]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onEnterPip = () => setIsPip(true);
    const onLeavePip = () => setIsPip(false);

    video.addEventListener('enterpictureinpicture', onEnterPip);
    video.addEventListener('leavepictureinpicture', onLeavePip);
    video.addEventListener('webkitpresentationmodechanged', onLeavePip);

    return () => {
      video.removeEventListener('enterpictureinpicture', onEnterPip);
      video.removeEventListener('leavepictureinpicture', onLeavePip);
      video.removeEventListener('webkitpresentationmodechanged', onLeavePip);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (showResumePrompt) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'c' || e.key === 'C') {
          e.preventDefault();
          handleResumePlay();
        } else if (e.key === 'r' || e.key === 'R' || e.key === 'Escape') {
          e.preventDefault();
          handleStartFromBeginning();
        }
        return;
      }

      if (e.key === 'Escape') {
        if (showSettingsModal) {
          setShowSettingsModal(false);
        } else if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => { });
        } else {
          handleClose();
        }
      } else if (e.key === ' ' || e.key === 'k') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        togglePictureInPicture();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seekRelative(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seekRelative(5);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
      if (nextCountdownRef.current) clearInterval(nextCountdownRef.current);
      if (progressSaveRef.current) clearInterval(progressSaveRef.current);
    };
  }, [isOpen, showResumePrompt, showSettingsModal, handleClose, handleResumePlay, handleStartFromBeginning, togglePlay, togglePictureInPicture, toggleFullscreen, toggleMute, seekRelative]);

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !showSettingsModal) setShowControls(false);
    }, 3000);
  };

  const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds)) return '00:00';
    const mins = Math.floor(timeInSeconds / 60);
    const secs = Math.floor(timeInSeconds % 60);
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    if (hours > 0) {
      return `${hours}:${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${remMins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={containerRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseMove={handleMouseMove}
          onClick={handleMouseMove}
          className={`fixed inset-0 z-[150] bg-black overflow-hidden select-none ${
            !showControls ? 'cursor-none' : ''
          }`}
        >
          {/* Main Video Element */}
          <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={buildVideoUrl(videoUrl, audioLanguage)}
                crossOrigin="anonymous"
                autoPlay={!showResumePrompt}
                className={`w-full h-full object-contain ${showControls ? 'cursor-pointer' : 'cursor-none'}`}
                onClick={() => {
                  if (!showResumePrompt) togglePlay();
                }}
                onPlay={() => {
                  if (showResumePrompt) {
                    videoRef.current?.pause();
                    setIsPlaying(false);
                    return;
                  }
                  setIsPlaying(true);
                  handleMouseMove();
                }}
                onPause={() => {
                  setIsPlaying(false);
                  setShowControls(true);
                  if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
                  saveProgressNow(undefined, true);
                }}
                onSeeked={() => {
                  saveProgressNow(undefined, true);
                }}
                onTimeUpdate={() => {
                  const el = videoRef.current;
                  if (!el) return;
                  setCurrentTime(el.currentTime);
                  const now = Date.now();
                  if (!el.paused && !el.ended && el.currentTime > 1 && now - lastTimeUpdateSaveRef.current > 3500) {
                    lastTimeUpdateSaveRef.current = now;
                    saveProgressNow();
                  }
                }}
                onLoadedMetadata={handleLoadedMetadata}
                onError={handleVideoError}
                onEnded={handleVideoEnded}
              >
                {subtitleTrack !== 'off' && (
                  <track
                    key={subtitleTrack}
                    kind="subtitles"
                    src={`${API_URL}/projects/${projectId}/subtitles?lang=${subtitleTrack}`}
                    srcLang={subtitleTrack}
                    label={langLabel(subtitleTrack)}
                    default
                  />
                )}
              </video>
            ) : (
              <div className="text-center space-y-2">
                <p className="text-zinc-500 text-sm">Nenhum vídeo disponível</p>
              </div>
            )}

            {retrying && (
              <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center space-y-4 z-30">
                <div className="w-12 h-12 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
                <h4 className="text-lg font-bold text-zinc-100">
                  {errorReason === 'preparing'
                    ? 'Preparando versão compatível...'
                    : 'Preparando vídeo...'}
                </h4>
                <p className="text-xs text-zinc-400 max-w-md">
                  {errorReason === 'preparing'
                    ? 'Gerando versão para o seu navegador. A reprodução começa automaticamente quando estiver pronta.'
                    : errorReason === 'processing'
                    ? 'O arquivo ainda está sendo baixado/finalizado. A reprodução começa automaticamente quando estiver pronto.'
                    : 'Tentando reconectar ao servidor local...'}
                </p>
              </div>
            )}

            {!retrying && hasError && (
              <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center p-6 text-center space-y-3 z-30">
                <span className="text-4xl">⚠️</span>
                <h4 className="text-lg font-bold text-zinc-100">
                  {errorReason === 'not_found' ? 'Vídeo não encontrado' : 'Erro ao carregar o vídeo 4K'}
                </h4>
                <p className="text-xs text-zinc-400 max-w-md">
                  {errorReason === 'not_found'
                    ? 'Este projeto não possui um arquivo de vídeo (pode ter sido excluído ou o download não foi concluído).'
                    : 'O arquivo de vídeo está sendo finalizado ou não está acessível no servidor local.'}
                </p>
                <button
                  type="button"
                  onClick={handleClose}
                  className="mt-2 px-4 py-2 rounded-xl bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 font-black text-xs uppercase tracking-wider transition-all"
                >
                  &#8592; Voltar à Biblioteca
                </button>
              </div>
            )}

            {isCasting && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-black/40">
                <div className="w-10 h-10 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
                <p className="text-sm font-bold text-zinc-100">Transmitindo para a TV…</p>
                <button
                  type="button"
                  onClick={() => { stopCasting().catch(() => {}); }}
                  className="mt-1 px-4 py-2 rounded-xl bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 font-black text-xs uppercase tracking-wider transition-all"
                >
                  Parar transmissão
                </button>
              </div>
            )}
          </div>

          {/* Header Bar */}
          <div
            className={`absolute top-0 left-0 right-0 flex items-center justify-between px-6 py-5 bg-gradient-to-b from-black/95 via-black/50 to-transparent z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🍿</span>
              <div>
                <h3 className="text-base font-black text-zinc-100 tracking-tight">{title}</h3>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[11px] font-black uppercase tracking-tight">
                    <span className="text-[#E50914]">JACK</span> <span className="text-white">IN</span> <span className="text-[#EF9F27] font-mono font-bold ml-1">4K</span>
                  </span>
                  <span className="text-[10px] text-zinc-400 font-mono bg-zinc-900/90 border border-zinc-800/80 px-2 py-0.5 rounded-md">
                    Áudio: {langLabel(audioLanguage)}
                  </span>
                  <span className="text-[10px] text-zinc-400 font-mono bg-zinc-900/90 border border-zinc-800/80 px-2 py-0.5 rounded-md">
                    Legendas: {subtitleTrack === 'off' ? 'Desativadas' : langLabel(subtitleTrack)}
                  </span>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="px-4 py-2 rounded-xl bg-zinc-900/90 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-bold text-xs transition-all flex items-center gap-1.5 backdrop-blur-md shadow-lg"
            >
              <span>Fechar</span>
              <span className="text-sm">✕</span>
            </button>
          </div>

          {/* Floating Controls Bar */}
          <div
            className={`absolute bottom-0 left-0 right-0 px-6 pb-6 pt-12 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-30 transition-opacity duration-300 space-y-3 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
          >
            {/* Seek Bar */}
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-bold text-zinc-300 min-w-[45px]">
                {formatTime(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                disabled={isCasting}
                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[#EF9F27] disabled:cursor-not-allowed disabled:opacity-50"
              />
              <span className="text-xs font-mono font-bold text-zinc-400 min-w-[45px]">
                {formatTime(duration)}
              </span>
            </div>

            {/* Controls Actions Toolbar */}
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                {/* Play / Pause Button */}
                <button
                  type="button"
                  onClick={togglePlay}
                  className="w-10 h-10 flex items-center justify-center bg-[#EF9F27] hover:bg-[#EF9F27]/90 active:scale-95 text-zinc-950 font-black rounded-full transition-all shadow-md shadow-[#EF9F27]/20 text-sm"
                  title={isPlaying ? 'Pausar' : 'Reproduzir'}
                >
                  <span>{isPlaying ? '⏸' : '▶'}</span>
                </button>

                {/* Volume Slider */}
                <div className="flex items-center gap-2 bg-zinc-900/90 border border-zinc-800 px-3 py-2 h-10 rounded-full">
                  <button
                    type="button"
                    onClick={toggleMute}
                    className="text-zinc-300 hover:text-zinc-100 text-sm transition-colors"
                  >
                    {isMuted || volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                    className="w-20 h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-zinc-200"
                  />
                </div>

              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-zinc-500 hidden xl:inline-block">
                  [Espaço] Play/Pause · [P] PiP · [F] Tela Cheia · [Esc] Fechar
                </span>

                {/* Picture in Picture Button */}
                {pipSupported && (
                  <button
                    type="button"
                    onClick={togglePictureInPicture}
                    className={`w-10 h-10 flex items-center justify-center rounded-full border transition-all text-sm ${isPip
                        ? 'bg-[#EF9F27]/20 border-[#EF9F27] text-[#EF9F27] shadow-lg shadow-[#EF9F27]/10'
                        : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-200 hover:border-zinc-500'
                      }`}
                    title={isPip ? 'Sair do Picture-in-Picture (P)' : 'Picture-in-Picture (P)'}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="4" width="20" height="16" rx="2" />
                      <rect x="12" y="12" width="8" height="6" rx="1" fill="currentColor" fillOpacity={isPip ? "0.6" : "0.2"} />
                    </svg>
                  </button>
                )}

                {/* Google Cast (Chromecast) Button */}
                {castSupported && devicesAvailable && isOpen && (
                  <button
                    type="button"
                    onClick={handleCastClick}
                    disabled={!castMeta.available}
                    title={
                      !castMeta.available
                        ? 'Transmissão indisponível para este vídeo'
                        : isCasting
                          ? 'Parar transmissão'
                          : 'Transmitir para a TV'
                    }
                    className={`w-10 h-10 flex items-center justify-center rounded-full border transition-all text-sm ${isCasting
                        ? 'bg-[#EF9F27]/20 border-[#EF9F27] text-[#EF9F27] shadow-lg shadow-[#EF9F27]/10'
                        : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-200 hover:border-zinc-500'
                      } ${!castMeta.available ? 'opacity-40 cursor-not-allowed' : ''}`}
                  >
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
                      <path d="M2 12a9 9 0 0 1 8 8" />
                      <path d="M2 16a5 5 0 0 1 4 4" />
                      <line x1="2" y1="20" x2="2.01" y2="20" />
                    </svg>
                  </button>
                )}

                {/* Settings / Track Info Gear Button */}
                <button
                  type="button"
                  onClick={() => { setShowSettingsModal(true); }}
                  className={`w-10 h-10 flex items-center justify-center rounded-full border transition-all text-sm ${audioTracks.length > 1 || subtitleTracks.length > 0
                      ? 'bg-[#EF9F27]/15 border-[#EF9F27]/40 text-[#EF9F27] hover:bg-[#EF9F27]/25'
                      : 'bg-zinc-900 hover:bg-zinc-800 border-zinc-700 text-zinc-200'
                    }`}
                  title="Áudio e Legendas"
                >
                  <span>⚙️</span>
                </button>

                {/* Maximize / Minimize Fullscreen Button */}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="w-10 h-10 flex items-center justify-center bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-full transition-all text-sm"
                  title="Alternar Tela Cheia (Maximizar/Minimizar)"
                >
                  <span>{isFullscreen ? '📉' : '⛶'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Settings Modal — audio & subtitle tracks for this download */}
          <AnimatePresence>
            {showSettingsModal && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-6"
                onClick={() => setShowSettingsModal(false)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-md bg-[#0E0F12]/98 border border-[#202226] rounded-2xl shadow-2xl overflow-hidden"
                >
                  {/* Header */}
                  <div className="px-5 py-4 border-b border-[#202226] flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-black text-zinc-100 uppercase tracking-wider">Faixas disponíveis</h3>
                      <p className="text-[10px] text-[#6B6E76] mt-0.5">Áudio e legendas deste arquivo</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSettingsModal(false)}
                      className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-zinc-200 transition-all text-sm"
                      title="Fechar"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="p-5 space-y-6 max-h-[60vh] overflow-y-auto custom-scrollbar">
                    {/* Reprodução — auto-continuar próximo episódio */}
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <h4 className="text-[11px] font-black text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                          <span>⏭️</span> Reprodução
                        </h4>
                      </div>
                      <button
                        type="button"
                        onClick={() => setAutoNextBoth(!autoNext)}
                        className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl border bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 transition-colors"
                      >
                        <span className="text-xs font-bold text-zinc-200">Reproduzir próximo automaticamente</span>
                        <span
                          className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${autoNext ? 'bg-[#EF9F27]' : 'bg-zinc-700'}`}
                        >
                          <span
                            className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${autoNext ? 'left-[18px]' : 'left-0.5'}`}
                          />
                        </span>
                      </button>
                      <p className="text-[9px] text-zinc-500 mt-1.5 leading-snug">
                        {autoNext
                          ? 'Ao terminar um episódio, o próximo entra automaticamente após 10s.'
                          : 'Ao terminar um episódio, você escolhe se quer continuar.'}
                      </p>
                    </div>

                    {/* Audio section */}
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <h4 className="text-[11px] font-black text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                          <span>🎧</span> Áudio
                        </h4>
                        {audioTracks.length > 0 && (
                          <span className="text-[9px] font-mono text-[#6B6E76]">{audioTracks.length} faixa(s)</span>
                        )}
                      </div>

      {!tracksLoaded ? (
        <p className="text-xs text-zinc-500 py-3">Detectando faixas...</p>
      ) : audioTracks.length === 0 ? (
        <p className="text-xs text-zinc-500 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl px-3.5">
          Nenhuma faixa de áudio detectada neste arquivo.
        </p>
      ) : (
        <div className="space-y-1.5">
          {audioTracks.map((t, i) => (
            <button
              key={`${t.index}-${t.language}-${t.codec}-${i}`}
              type="button"
              onClick={() => { setAudioLanguage(t.language as 'pt-br' | 'en'); }}
              className={`w-full text-left px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${audioLanguage === t.language
                  ? 'bg-[#EF9F27]/10 border-[#EF9F27]/40'
                  : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                }`}
            >
              <div className="min-w-0">
                <p className={`text-xs font-bold ${audioLanguage === t.language ? 'text-[#EF9F27]' : 'text-zinc-200'}`}>
                  {langLabel(t.language)}
                </p>
                <p className="text-[9px] font-mono text-[#6B6E76] mt-0.5 truncate">
                  {[t.title, `#${t.index}`, audioCodecLabel(t.codec), t.channels > 0 ? `${t.channels} canais` : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
              {audioLanguage === t.language && (
                <span className="text-[#EF9F27] text-xs font-black shrink-0">✓ ATUAL</span>
              )}
            </button>
          ))}
        </div>
      )}

      {tracksLoaded && audioTracks.length > 0 && !audioTracks.some((t) => t.language === 'pt-br' || t.language === 'pt') && (
        <div className="mt-2.5 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3.5 py-2.5">
          <p className="text-[10px] text-amber-200/90 leading-snug">
            Este episódio não possui faixa de áudio em <strong>português</strong> (só {audioTracks.map((t) => langLabel(t.language)).join(' e ')}).
            Para assistir dublado, baixe a versão <strong>Dual Áudio / Dublado</strong> do título.
          </p>
        </div>
      )}
                    </div>

                    {/* Subtitles section */}
                    <div>
                      <div className="flex items-center justify-between mb-2.5">
                        <h4 className="text-[11px] font-black text-zinc-300 uppercase tracking-wider flex items-center gap-2">
                          <span>💬</span> Legendas
                        </h4>
                        {subtitleTracks.length > 0 && (
                          <span className="text-[9px] font-mono text-[#6B6E76]">{subtitleTracks.length} faixa(s)</span>
                        )}
                      </div>

                      {!tracksLoaded ? (
                        <p className="text-xs text-zinc-500 py-3">Detectando legendas...</p>
                      ) : subtitleTracks.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-3 bg-zinc-900/50 border border-zinc-800 rounded-xl px-3.5">
                          Nenhuma legenda embutida neste arquivo.
                        </p>
                      ) : (
                        <div className="space-y-1.5">
                          <button
                            type="button"
                            onClick={() => { setSubtitleTrack('off'); }}
                            className={`w-full text-left px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${subtitleTrack === 'off'
                                ? 'bg-[#EF9F27]/10 border-[#EF9F27]/40'
                                : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                              }`}
                          >
                            <p className={`text-xs font-bold ${subtitleTrack === 'off' ? 'text-[#EF9F27]' : 'text-zinc-200'}`}>
                              Desativadas
                            </p>
                            {subtitleTrack === 'off' && <span className="text-[#EF9F27] text-xs font-black shrink-0">✓ ATUAL</span>}
                          </button>
                          {subtitleTracks.map((t, i) => (
                            <button
                              key={`${t.index}-${t.language}-${t.codec}-${i}`}
                              type="button"
                              onClick={() => { setSubtitleTrack(t.language as any); }}
                              className={`w-full text-left px-3.5 py-2.5 rounded-xl border flex items-center justify-between gap-3 transition-colors ${subtitleTrack === t.language
                                  ? 'bg-[#EF9F27]/10 border-[#EF9F27]/40'
                                  : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                                }`}
                            >
                              <div className="min-w-0">
                                <p className={`text-xs font-bold ${subtitleTrack === t.language ? 'text-[#EF9F27]' : 'text-zinc-200'}`}>
                                  {langLabel(t.language)}
                                </p>
                                <p className="text-[9px] font-mono text-[#6B6E76] mt-0.5 truncate">
                                  #{t.index} · {subtitleCodecLabel(t.codec)}
                                </p>
                              </div>
                              {subtitleTrack === t.language && (
                                <span className="text-[#EF9F27] text-xs font-black shrink-0">✓ ATUAL</span>
                              )}
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={handleFetchSubtitles}
                        disabled={subtitleLoading}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#EF9F27]/10 hover:bg-[#EF9F27]/20 disabled:opacity-50 border border-[#EF9F27]/30 text-[#EF9F27] font-black text-[10px] uppercase tracking-wider transition-all flex items-center justify-center gap-2"
                      >
                        {subtitleLoading ? (
                          <>
                            <span className="w-3.5 h-3.5 border-2 border-[#EF9F27] border-t-transparent rounded-full animate-spin" />
                            Buscando legenda PT-BR...
                          </>
                        ) : (
                          <>⬇ Buscar legenda PT-BR (OpenSubtitles)</>
                        )}
                      </button>
                      {subtitleMessage && (
                        <p className="text-[10px] text-zinc-400 px-1">{subtitleMessage}</p>
                      )}
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-5 py-3.5 border-t border-[#202226] bg-[#07080a]/50 flex items-center justify-between">
                    <span className="text-[9px] font-mono text-[#6B6E76]">
                      Áudio: {langLabel(audioLanguage)} · Legendas: {subtitleTrack === 'off' ? 'Desativadas' : langLabel(subtitleTrack)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSettingsModal(false)}
                      className="px-4 py-2 rounded-xl bg-[#EF9F27] hover:bg-[#EF9F27]/90 text-zinc-950 font-black text-[10px] uppercase tracking-wider transition-all"
                    >
                      Concluído
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

        {/* Resume prompt */}
        <AnimatePresence>
          {showResumePrompt && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
            >
              <div className="text-center space-y-6 p-8">
                <p className="text-xl font-bold text-white">Continuar de onde parou?</p>
                <p className="text-sm text-zinc-400">
                  Você estava em {formatTime(resumePosition)}
                </p>
                <div className="flex items-center gap-4 justify-center">
                  <button
                    onClick={handleResumePlay}
                    className="px-6 py-3 bg-[#EF9F27] text-black font-bold rounded-xl text-sm hover:bg-[#ffb04d] transition-colors"
                  >
                    Continuar
                  </button>
                  <button
                    onClick={handleStartFromBeginning}
                    className="px-6 py-3 bg-zinc-800 text-zinc-300 font-bold rounded-xl text-sm hover:bg-zinc-700 transition-colors"
                  >
                    Recomeçar
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Next episode prompt */}
        <AnimatePresence>
          {showNextEpisode && nextEpisode && (
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="absolute bottom-24 right-8 z-50 w-80 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="relative p-5">
                {/* X para cancelar (só este episódio) */}
                <button
                  type="button"
                  onClick={cancelNextEpisode}
                  className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center rounded-full bg-zinc-800/90 hover:bg-zinc-700 border border-zinc-700 text-zinc-400 hover:text-white transition-colors text-xs font-bold"
                  title="Cancelar (não continuar agora)"
                >
                  ✕
                </button>

                <p className="text-[11px] text-[#EF9F27] font-black uppercase tracking-wider">
                  Próximo episódio
                  {autoNext && countdownLeft > 0 && (
                    <span className="ml-2 text-zinc-400 font-mono">em {countdownLeft}s</span>
                  )}
                </p>
                <p className="text-sm font-bold text-white mt-1.5 pr-6 leading-snug line-clamp-2">
                  {nextEpisode.title}
                </p>

                <div className="flex items-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={goToNextEpisode}
                    className="flex-1 px-4 py-2.5 bg-[#EF9F27] hover:bg-[#ffb04d] text-black font-black rounded-xl text-xs uppercase tracking-wider transition-all active:scale-95"
                  >
                    ▶ Assistir agora
                  </button>
                  <button
                    type="button"
                    onClick={cancelNextEpisode}
                    className="px-3 py-2.5 text-zinc-400 hover:text-white text-[11px] font-bold transition-colors"
                  >
                    Fechar
                  </button>
                </div>

                {!autoNext && (
                  <button
                    type="button"
                    onClick={() => setAutoNextBoth(true)}
                    className="mt-3 w-full text-left text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    ⏭️ Auto-continuar está desligado — ativar de novo
                  </button>
                )}
              </div>

              {/* Barra de contagem — só quando auto-next está ligado */}
              {autoNext && (
                <div className="h-1.5 bg-zinc-800 overflow-hidden">
                  <motion.div
                    animate={{ width: `${(countdownLeft / NEXT_EPISODE_COUNTDOWN_SECONDS) * 100}%` }}
                    className="h-full bg-[#EF9F27]"
                  />
                </div>
              )}

              {/* "Não perguntar de novo" — desliga o auto-next nesta sessão */}
              <button
                type="button"
                onClick={disableAutoNext}
                className="w-full px-4 py-2 border-t border-zinc-800 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900 transition-colors text-left"
              >
                Não perguntar de novo (desativar auto-continuar)
              </button>
            </motion.div>
          )}
        </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
