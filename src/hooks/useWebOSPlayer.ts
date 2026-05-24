import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type {
  PlayerStatus,
  QualityLevel,
  AudioTrack,
  SubtitleTrack,
} from '../types/player.types';
import type { WebPlayerController } from './usePlayer';

/**
 * Implémentation `PlayerController` pour LG webOS — voir docs/native-port.md §4.
 *
 * Stratégie minimaliste (v1) :
 * - `<video>` HTML5 natif pour TOUT (HLS comme fichier direct). webOS 4.0+ a
 *   un Chromium récent qui supporte MSE → hls.js fonctionne sans souci ;
 *   beaucoup de versions supportent aussi HLS nativement (`canPlayType` truthy).
 * - URL Xtream DIRECTE (mode natif via `xtream.service.ts`) → le flux part de
 *   l'IP de la TV (pas de blocage 403 d'IP datacenter), aucun ffmpeg.
 * - Pas de proxy `/api/subtitle` : les sous-titres embarqués des MKV/MP4 ne
 *   sont pas exposés en v1 (nécessiterait la Media Pipeline `luna://`).
 * - Pas de correction `seekOffsetRef` : la timeline native est absolue, pas
 *   de rebase à 0 comme avec ffmpeg `-output_ts_offset`.
 *
 * Différences assumées vs `usePlayer` (web/ffmpeg) :
 * - `subtitleTracks` toujours vide → menu CC masqué par `VideoPlayer.tsx`.
 * - `levels` peuplé seulement si hls.js prend la main (HLS via MSE).
 * - `toggleFullscreen` no-op (l'app .ipk est déjà plein écran).
 *
 * Le retour est typé `WebPlayerController` (avec refs DOM) — interchangeable
 * avec `usePlayer` dans `VideoPlayer.tsx` via la bascule `isWebOS`.
 */
export function useWebOSPlayer(url: string | null, _mediaUrl?: string | null): WebPlayerController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const urlRef = useRef<string | null>(null);

  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevelState] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [currentAudio, setCurrentAudio] = useState(-1);

  // ── Listeners sur le <video> ──────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrentTime(video.currentTime);
    const onDurationChange = () => {
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        setDuration(d);
        setIsLive(false);
      } else {
        setDuration(0);
        setIsLive(true);
      }
    };
    const onProgress = () => {
      if (video.buffered.length > 0) {
        setBufferedEnd(video.buffered.end(video.buffered.length - 1));
      }
    };
    const onPlay = () => setStatus('playing');
    const onPause = () => setStatus('paused');
    const onWaiting = () => setStatus('buffering');
    const onPlaying = () => setStatus('playing');
    const onVolumeChange = () => {
      setVolumeState(video.volume);
      setIsMuted(video.muted);
    };
    const onError = () => {
      setStatus('error');
      const code = video.error?.code;
      setError(`Erreur de lecture${code ? ` (code ${code})` : ''}`);
    };
    const onLoadedMetadata = () => {
      // Pistes audio natives (MP4 multi-audio). Lues uniquement si hls.js
      // n'est pas actif (sinon doublons : hls.js émet AUDIO_TRACKS_UPDATED).
      if (hlsRef.current) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (video as any).audioTracks as
        | ({ label?: string; language?: string; enabled: boolean }[] & { length: number })
        | undefined;
      if (!list || list.length < 2) return;
      const tracks: AudioTrack[] = [];
      let enabledIdx = -1;
      for (let i = 0; i < list.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = list[i] as any;
        tracks.push({
          index: i,
          name: t.label || t.language || `Audio ${i + 1}`,
          language: t.language || '',
        });
        if (t.enabled) enabledIdx = i;
      }
      setAudioTracks(tracks);
      setCurrentAudio(enabledIdx >= 0 ? enabledIdx : 0);
    };
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('progress', onProgress);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  // ── Chargement de la source ───────────────────────────────────────────────
  const loadSource = useCallback((src: string) => {
    const video = videoRef.current;
    if (!video) return;

    // Reset complet
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setLevels([]);
    setCurrentLevelState(-1);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setIsLive(false);

    const isHls = src.includes('.m3u8');
    const tryPlay = () => {
      video.play().catch(() => setStatus('paused'));
    };

    // HLS natif (Safari-like) — webOS 4.0+ le supporte sur certains firmwares.
    // On préfère le natif quand disponible : pas de MSE → décodage hardware
    // direct, démarrage plus rapide, moins de RAM (important sur TV bas de gamme).
    if (isHls && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      video.load();
      tryPlay();
      return;
    }

    // HLS via hls.js (MSE). webOS 4.0+ a Chromium récent → MSE OK.
    if (isHls && Hls.isSupported()) {
      const isLiveStream = /\/live\//.test(src);
      const hls = new Hls(isLiveStream ? {
        enableWorker: true,
        liveDurationInfinity: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        backBufferLength: 30,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 500,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 500,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        maxLoadingDelay: 8,
      } : {
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startFragPrefetch: true,
      });
      hlsRef.current = hls;
      if (isLiveStream) setIsLive(true);

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const qualityLevels: QualityLevel[] = data.levels.map((l, i) => ({
          index: i,
          label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`,
          bitrate: l.bitrate,
        }));
        setLevels(qualityLevels);
        tryPlay();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevelState(data.level);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data: any) => {
        const list = (data.audioTracks ?? []) as { name?: string; lang?: string }[];
        const tracks: AudioTrack[] = list.map((t, i) => ({
          index: i,
          name: t.name || t.lang || `Audio ${i + 1}`,
          language: t.lang || '',
        }));
        setAudioTracks(tracks);
        if (tracks.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hlsAny = hls as any;
          if (hlsAny.audioTrack === -1) hlsAny.audioTrack = 0;
          setCurrentAudio(Math.max(0, hlsAny.audioTrack ?? 0));
        }
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data: any) => {
        setCurrentAudio(data.id ?? 0);
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;
        setStatus('error');
        setError(`Erreur HLS : ${data.details}`);
      });

      return;
    }

    // Fichier direct (MP4 / MKV) — webOS lit nativement les conteneurs courants.
    // Pas de probe, pas de transcodage : si le codec n'est pas supporté, on
    // tombera sur l'event `error` et `onFallback` (côté `VideoPlayer`) tentera
    // l'URL alternative passée par les pages détail.
    video.src = src;
    video.load();
    tryPlay();
  }, []);

  useEffect(() => {
    urlRef.current = url;
    if (!url) {
      setStatus('idle');
      return;
    }
    loadSource(url);
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [url, loadSource]);

  // ── Contrôles ─────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;
    const max = video.duration || 0;
    video.currentTime = Math.max(0, max > 0 ? Math.min(time, max) : time);
  }, []);

  const setVolume = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, v));
    video.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const setLevel = useCallback((level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentLevelState(level);
    }
  }, []);

  const setAudio = useCallback((index: number) => {
    if (hlsRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hlsRef.current as any).audioTrack = index;
      setCurrentAudio(index);
      return;
    }
    // Pistes audio natives (MP4 multi-audio). Sur webOS, l'API audioTracks
    // expose .enabled — bascule au plus une piste active à la fois.
    const video = videoRef.current;
    if (!video) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list = (video as any).audioTracks as
      | { length: number; [i: number]: { enabled: boolean } }
      | undefined;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (list[i] as any).enabled = i === index;
    }
    setCurrentAudio(index);
  }, []);

  const setSubtitle = useCallback(() => {
    // v1 : pas de sous-titres sur webOS (cf. en-tête du fichier).
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // L'app .ipk est déjà plein écran — rien à basculer.
  }, []);

  const retry = useCallback(() => {
    const u = urlRef.current;
    if (u) loadSource(u);
  }, [loadSource]);

  const adjustSubtitleOffset = useCallback(() => {
    // v1 : pas de sous-titres → pas de décalage.
  }, []);

  const setSubtitleOffset = useCallback(() => {
    // v1 : pas de sous-titres → pas de décalage.
  }, []);

  // Pistes de sous-titres : toujours vide en v1 → menu CC masqué par
  // `VideoPlayer.tsx` (la condition `player.subtitleTracks.length > 0`).
  const subtitleTracks: SubtitleTrack[] = [];

  return {
    videoRef,
    wrapperRef,
    status,
    error,
    isLive,
    currentTime,
    duration,
    bufferedEnd,
    volume,
    isMuted,
    isFullscreen,
    levels,
    currentLevel,
    audioTracks,
    currentAudio,
    subtitleTracks,
    currentSubtitle: -1,
    subtitleText: '',
    subtitleLoading: false,
    subtitleOffset: 0,
    adjustSubtitleOffset,
    setSubtitleOffset,
    toggle,
    seek,
    setVolume,
    toggleMute,
    setLevel,
    setAudio,
    setSubtitle,
    toggleFullscreen,
    retry,
  };
}
