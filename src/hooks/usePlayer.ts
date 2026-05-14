import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

// ── ffprobe probe result ──────────────────────────────────────────────────────
interface ProbeTrack {
  index: number;
  streamIndex: number;
  codec: string;
  language: string;
  title: string;
}
interface ProbeData {
  audio: ProbeTrack[];
  subtitles: ProbeTrack[];
  duration?: number; // durée réelle du fichier en secondes (depuis les métadonnées du conteneur)
}

async function probeUrl(url: string): Promise<ProbeData> {
  try {
    const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    return (await res.json()) as ProbeData;
  } catch {
    return { audio: [], subtitles: [] };
  }
}

function buildStreamUrl(sourceUrl: string, audioTrack: number, seekSec?: number): string {
  const inner = new URL(sourceUrl, window.location.origin);
  const upstream = inner.searchParams.get('url') ?? sourceUrl;
  const params = new URLSearchParams({ url: upstream, audio: String(audioTrack) });
  if (seekSec && seekSec > 0) params.set('seek', seekSec.toFixed(1));
  return `/api/stream?${params}`;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'buffering';

export interface QualityLevel {
  index: number;
  label: string;
  bitrate: number;
}

export interface AudioTrack {
  index: number;
  name: string;
  language: string;
}

export interface SubtitleTrack {
  index: number;        // index 0-based dans la liste UI (après filtrage des codecs image)
  streamIndex: number;  // index absolu du stream dans le fichier (envoyé à ffmpeg)
  name: string;
  language: string;
}

function isHlsUrl(url: string) {
  return url.includes('.m3u8');
}

// Lit les AudioTracks natives de l'élément video (MP4 multi-audio)
function readNativeAudioTracks(video: HTMLVideoElement): AudioTrack[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (video as any).audioTracks as ({ label?: string; language?: string; enabled: boolean }[] & { length: number }) | undefined;
  if (!list || list.length === 0) return [];

  const tracks: AudioTrack[] = [];
  let hasEnabled = false;

  for (let i = 0; i < list.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = list[i] as any;
    tracks.push({
      index: i,
      name: t.label || t.language || `Audio ${i + 1}`,
      language: t.language || '',
    });
    if (t.enabled) hasEnabled = true;
  }

  if (!hasEnabled && list.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (list[0] as any).enabled = true;
  }

  return tracks;
}

export function usePlayer(url: string | null, mediaUrl?: string | null) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  const sourceUrlRef = useRef<string | null>(null);
  const directSourceRef = useRef<string | null>(null);
  // URL upstream du fichier média (MKV/MP4) — exposée à useSubtitles pour /api/subtitle.
  const mediaUrlRef = useRef<string | null>(null);
  // Durée réelle du fichier (depuis ffprobe) — video.duration peut être Infinity pour les streams ffmpeg
  const probeDurationRef = useRef(0);
  // Offset de seek : quand on redémarre ffmpeg à la position X, video.currentTime repart de 0
  // mais on affiche currentTime + seekOffset pour montrer la vraie position dans le fichier.
  // EXPOSE via getStreamBase() pour que useSubtitles puisse calculer le source-time.
  const seekOffsetRef = useRef(0);
  const currentAudioRef = useRef(0);
  const currentTimeRef = useRef(0);
  const seekGenRef = useRef(0);
  const lastTimeRef = useRef(0);

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
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);

  // streamEpoch : compteur incrémenté à chaque mutation video.src.
  // Sert de signal à useSubtitles → effacer le sous-titre courant pour ne pas
  // afficher un cue de l'ancien flux pendant le chargement du nouveau.
  // (Pour HLS/mpegts, le src interne ne change pas après attachMedia → pas de bump.)
  const [streamEpoch, setStreamEpoch] = useState(0);
  const bumpEpoch = useCallback(() => setStreamEpoch((e) => e + 1), []);

  // Getter stable du décalage de timestamp du flux courant.
  // useSubtitles l'appelle à chaque frame pour convertir mediaTime → source time.
  const getStreamBase = useCallback(() => seekOffsetRef.current, []);

  // Getter de l'URL média (pour useSubtitles → /api/subtitle)
  const getMediaUrl = useCallback(() => mediaUrlRef.current, []);

  // Listeners persistants sur le <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const ct = video.currentTime + seekOffsetRef.current;
      setCurrentTime(ct);
      currentTimeRef.current = ct;
      const advanced = video.currentTime - lastTimeRef.current;
      lastTimeRef.current = video.currentTime;
      if (!video.paused && advanced > 0.05 && advanced < 1) {
        setStatus((s) => (s === 'loading' || s === 'buffering' ? 'playing' : s));
      }
    };
    const onDurationChange = () => {
      if (probeDurationRef.current > 0) {
        setDuration(probeDurationRef.current);
        setIsLive(false);
        return;
      }
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
      if (video.buffered.length > 0)
        setBufferedEnd(video.buffered.end(video.buffered.length - 1) + seekOffsetRef.current);
    };
    const onPlay    = () => setStatus('playing');
    const onPause   = () => setStatus('paused');
    const onWaiting = () => setStatus('buffering');
    const onPlaying = () => setStatus('playing');
    const onVolumeChange = () => {
      setVolumeState(video.volume);
      setIsMuted(video.muted);
    };
    const onError = () => {
      if (mpegtsRef.current) return;
      const src = sourceUrlRef.current;
      if (src && !directSourceRef.current) {
        const pos = video.currentTime || 0;
        directSourceRef.current = src;
        seekOffsetRef.current = pos;
        currentTimeRef.current = pos;
        const audio = Math.max(0, currentAudioRef.current);
        const url = buildStreamUrl(src, audio, pos > 2 ? pos : undefined);
        setStatus('loading');
        bumpEpoch();
        video.src = url;
        video.load();
        video.play().catch(() => setStatus('paused'));
        return;
      }
      setStatus('error');
      setError('Erreur de lecture (source incompatible ou CORS)');
    };
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);

    const onLoadedMetadata = () => {
      if (hlsRef.current) return;

      const aTracks = readNativeAudioTracks(video);
      if (aTracks.length > 1) {
        setAudioTracks(aTracks);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enabledIdx = aTracks.findIndex((_, i) => (video as any).audioTracks[i]?.enabled);
        setCurrentAudio(enabledIdx >= 0 ? enabledIdx : 0);
      }

      // Désactiver TOUS les textTracks natifs — le rendu se fait via SubtitleOverlay
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
      }
    };

    const onAudioTrackAdd = () => {
      if (hlsRef.current) return;
      const aTracks = readNativeAudioTracks(video);
      if (aTracks.length > 1) {
        setAudioTracks(aTracks);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enabledIdx = aTracks.findIndex((_, i) => (video as any).audioTracks[i]?.enabled);
        setCurrentAudio(enabledIdx >= 0 ? enabledIdx : 0);
      }
    };

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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeAudioTracks = (video as any).audioTracks as ({ addEventListener: (e: string, cb: () => void) => void; removeEventListener: (e: string, cb: () => void) => void }) | undefined;
    if (nativeAudioTracks) {
      nativeAudioTracks.addEventListener('addtrack', onAudioTrackAdd);
    }

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
      if (nativeAudioTracks) {
        nativeAudioTracks.removeEventListener('addtrack', onAudioTrackAdd);
      }
    };
  }, [bumpEpoch]);

  const extractUpstreamUrl = useCallback((proxyUrl: string): string => {
    try {
      const parsed = new URL(proxyUrl, window.location.origin);
      return parsed.searchParams.get('url') ?? proxyUrl;
    } catch {
      return proxyUrl;
    }
  }, []);

  const runProbe = useCallback((probeSource: string) => {
    if (!probeSource) return;
    probeUrl(probeSource).then((probe) => {
      if (probe.duration && probe.duration > 0) {
        probeDurationRef.current = probe.duration;
        setDuration(probe.duration);
        setIsLive(false);
      }

      if (!hlsRef.current && probe.audio.length > 0) {
        const tracks: AudioTrack[] = probe.audio.map((t) => ({
          index: t.index,
          name: t.title || t.language || `Audio ${t.index + 1}`,
          language: t.language,
        }));
        setAudioTracks(tracks);
        setCurrentAudio(0);
        currentAudioRef.current = 0;
      }

      if (probe.subtitles.length > 0) {
        const subTracks: SubtitleTrack[] = probe.subtitles.map((t) => ({
          index: t.index,
          streamIndex: t.streamIndex,
          name: t.title || t.language || `Sous-titres ${t.index + 1}`,
          language: t.language,
        }));
        setSubtitleTracks(subTracks);
      }
    }).catch(() => {/* probe échoue silencieusement */});
  }, []);

  const loadSource = useCallback((src: string) => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (mpegtsRef.current) { mpegtsRef.current.destroy(); mpegtsRef.current = null; }
    sourceUrlRef.current = null;
    directSourceRef.current = null;
    mediaUrlRef.current = null;
    probeDurationRef.current = 0;
    seekOffsetRef.current = 0;
    currentAudioRef.current = 0;
    currentTimeRef.current = 0;
    lastTimeRef.current = 0;
    Array.from(video.querySelectorAll('track')).forEach((t) => t.remove());

    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setLevels([]);
    setCurrentLevelState(-1);
    setIsLive(false);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setSubtitleTracks([]);
    bumpEpoch();

    const probeSource = mediaUrl
      ? extractUpstreamUrl(mediaUrl)
      : extractUpstreamUrl(src);
    mediaUrlRef.current = probeSource;

    const tryPlay = () => {
      video.play().catch(() => {
        setStatus('paused');
      });
    };

    if (src.startsWith('/api/liveproxy') && mpegts.isSupported()) {
      setIsLive(true);
      const absoluteSrc = `${window.location.origin}${src}`;
      const player = mpegts.createPlayer(
        { type: 'mpegts', url: absoluteSrc, isLive: true, hasAudio: true, hasVideo: true },
        {
          enableWorker: true,
          enableStashBuffer: true,
          stashInitialSize: 384 * 1024,
          autoCleanupSourceBuffer: true,
          autoCleanupMinBackwardDuration: 15,
          autoCleanupMaxBackwardDuration: 30,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 12.0,
          liveBufferLatencyMinRemain: 6.0,
          fixAudioTimestampGap: true,
        },
      );
      mpegtsRef.current = player;
      player.attachMediaElement(video);

      player.on(mpegts.Events.ERROR, (_type: string, data: object) => {
        setStatus('error');
        setError(`Erreur stream : ${JSON.stringify(data)}`);
      });

      player.on(mpegts.Events.MEDIA_INFO, () => {
        if (mpegtsRef.current === player && video.paused) tryPlay();
      });

      player.load();
      tryPlay();
      return;
    }

    if (isHlsUrl(src) && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startFragPrefetch: true,
        manifestLoadingMaxRetry: 0,
        levelLoadingMaxRetry: 0,
        fragLoadingMaxRetry: 2,
      });
      hlsRef.current = hls;

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

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      });

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          const isServerRejection = data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;
          setStatus('error');
          setError(
            isServerRejection
              ? 'Flux indisponible (trop de connexions simultanées ou source inaccessible)'
              : `Erreur HLS : ${data.details}`,
          );
        }
      });

      runProbe(probeSource);
      return;
    }

    if (isHlsUrl(src) && video.canPlayType('application/vnd.apple.mpegurl')) {
      bumpEpoch();
      video.src = src;
      tryPlay();
      return;
    }

    // ── Fichier direct (mkv, mp4…) ─────────────────────────────────────────
    sourceUrlRef.current = src;
    directSourceRef.current = src;

    const loadDirect = (streamSrc: string) => {
      bumpEpoch();
      video.src = streamSrc;
      video.load();
      const onCanPlay = () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('loadeddata', onLoadedData);
        tryPlay();
      };
      const onLoadedData = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('canplay', onCanPlay);
        tryPlay();
      };
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('loadeddata', onLoadedData);
    };

    loadDirect(buildStreamUrl(src, 0));

    runProbe(probeSource);
  }, [mediaUrl, extractUpstreamUrl, runProbe, bumpEpoch]);

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      return;
    }

    loadSource(url);

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (mpegtsRef.current) { mpegtsRef.current.destroy(); mpegtsRef.current = null; }
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [url, loadSource]);

  // --- Contrôles ---

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (directSourceRef.current) {
      const src = directSourceRef.current;
      const audio = Math.max(0, currentAudioRef.current);
      const maxTime = probeDurationRef.current;
      const clampedTime = Math.max(0, maxTime > 0 ? Math.min(time, maxTime) : time);

      const targetVideoTime = clampedTime - seekOffsetRef.current;

      // Seek dans le buffer → seek natif instantané, pas de rechargement.
      // PAS de bump epoch : seekOffsetRef ne change pas, donc le mediaTime de
      // la prochaine frame + base = bonne source time. Pas de désync.
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (targetVideoTime >= start - 0.5 && targetVideoTime <= end) {
          video.currentTime = Math.max(0, targetVideoTime);
          return;
        }
      }

      // Sinon : redémarrer ffmpeg à la nouvelle position
      const myGen = ++seekGenRef.current;
      bumpEpoch();
      seekOffsetRef.current = clampedTime;
      currentTimeRef.current = clampedTime;
      lastTimeRef.current = 0;
      setCurrentTime(clampedTime);
      setStatus('loading');

      const url = buildStreamUrl(src, audio, clampedTime > 0.5 ? clampedTime : undefined);
      video.src = url;
      video.load();
      video.play().catch(() => {
        if (seekGenRef.current === myGen && video.paused) setStatus('paused');
      });
      return;
    }

    video.currentTime = Math.max(0, Math.min(time, video.duration || 0));
  }, [bumpEpoch]);

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
    // HLS.js : pas de transition de flux côté video.src, HLS.js gère en interne
    if (hlsRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hlsRef.current as any).audioTrack = index;
      setCurrentAudio(index);
      return;
    }

    // Mode ffmpeg actif → recharger /api/stream avec la nouvelle piste audio
    const ffmpegSrc = directSourceRef.current;
    if (ffmpegSrc) {
      const video = videoRef.current;
      if (!video) return;
      const myGen = ++seekGenRef.current;
      const currentPos = currentTimeRef.current;
      bumpEpoch();
      setCurrentAudio(index);
      currentAudioRef.current = index;
      seekOffsetRef.current = currentPos;
      setStatus('loading');
      const streamUrl = buildStreamUrl(ffmpegSrc, index, currentPos > 2 ? currentPos : undefined);
      video.src = streamUrl;
      video.load();
      video.play().catch(() => {
        if (seekGenRef.current === myGen && video.paused) setStatus('paused');
      });
      return;
    }

    const nativeSrc = sourceUrlRef.current;
    if (nativeSrc) {
      const video = videoRef.current;
      if (!video) return;
      const currentPos = video.currentTime || 0;
      bumpEpoch();
      directSourceRef.current = nativeSrc;
      currentAudioRef.current = index;
      currentTimeRef.current = currentPos;
      seekOffsetRef.current = currentPos;
      setCurrentAudio(index);
      setStatus('loading');
      const streamUrl = buildStreamUrl(nativeSrc, index, currentPos > 2 ? currentPos : undefined);
      video.src = streamUrl;
      video.load();
      video.play().catch(() => setStatus('paused'));
      return;
    }

    const video = videoRef.current;
    if (video) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (video as any).audioTracks as ({ length: number; [i: number]: { enabled: boolean } }) | undefined;
      if (list) {
        for (let i = 0; i < list.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (list[i] as any).enabled = i === index;
        }
      }
    }
    setCurrentAudio(index);
  }, [bumpEpoch]);

  const toggleFullscreen = useCallback(async () => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapper.requestFullscreen();
  }, []);

  const retry = useCallback(() => {
    if (url) loadSource(url);
  }, [url, loadSource]);

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
    // Primitives pour useSubtitles
    streamEpoch,
    getStreamBase,
    getMediaUrl,
    // Contrôles
    toggle,
    seek,
    setVolume,
    toggleMute,
    setLevel,
    setAudio,
    toggleFullscreen,
    retry,
  };
}
