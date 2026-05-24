import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import type {
  PlayerStatus,
  AudioTrack,
  SubtitleTrack,
  QualityLevel,
} from '../types/player.types';
import type { WebPlayerController } from './usePlayer';
import { WebOSMedia, type MediaTrack } from '../native/webosMedia';
import { hasLunaBridge } from '../native/webosLuna';

/**
 * Implémentation `PlayerController` pour LG webOS — voir docs/native-port.md
 * §Phase 4e.
 *
 * Stratégie en DEUX modes selon l'URL :
 *
 *  1. **HLS** (`.m3u8`) — typiquement Live et certains VOD :
 *     `<video>` HTML5 + `hls.js`. Le décodeur Chromium webOS lit nativement
 *     les segments TS. Le multi-audio HLS est exposé par hls.js via les events
 *     `AUDIO_TRACKS_UPDATED` (cas rare côté Xtream — la plupart des manifests
 *     Live sont single-audio multiplexé).
 *
 *  2. **Fichier direct** (`.mkv`, `.mp4`, `.ts`…) — typiquement VOD / épisodes :
 *     **Media Pipeline webOS** (`luna://com.webos.media`). C'est l'équivalent
 *     de libVLC côté Android. Le `<video>` HTML5 ne suffit pas ici parce que
 *     Chromium-webOS NE renseigne PAS `audioTracks` / `textTracks` pour les
 *     MKV (le démuxeur GStreamer décode mais n'expose pas la table de pistes
 *     au DOM). La pipeline, elle, expose toutes les pistes via l'event
 *     `sourceInfo` et offre `selectTrack` pour basculer à chaud.
 *     La vidéo est rendue sur un plan hardware DERRIÈRE la WebView : on pose
 *     la classe `iptvax-native-playback` sur `<html>` pendant la lecture
 *     (transparence chaîne web → la vidéo apparaît à travers).
 *
 * Différences avec `usePlayer` (web/ffmpeg) :
 *   - Pas de proxy `/api/*` → URL Xtream parlée DIRECTEMENT depuis l'IP
 *     utilisateur (plus de blocage 403 d'IP datacenter).
 *   - Pas d'extraction VTT custom : pour les fichiers directs, les
 *     sous-titres embarqués sont rendus PAR la pipeline (en surface
 *     hardware). Pas d'overlay React → `subtitleText` reste vide.
 *   - Pas de seek ffmpeg : la pipeline gère le seek MKV/MP4 nativement.
 *
 * Le type de retour est `WebPlayerController` (= `PlayerController` + refs DOM)
 * pour rester compatible avec l'UI `VideoPlayer.tsx`.
 */
export function useWebOSPlayer(url: string | null, _mediaUrl?: string | null): WebPlayerController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const urlRef = useRef<string | null>(null);

  // ── État pipeline (Media Pipeline webOS) ───────────────────────────────────
  // `mediaIdRef` est non-null UNIQUEMENT quand la pipeline est active (lecture
  // fichier direct). En HLS il reste null → le hook bascule sur les chemins
  // <video> + hls.js (audioTracks via hls.js).
  const mediaIdRef = useRef<string | null>(null);
  const subscribeHandleRef = useRef<{ cancel: () => void } | null>(null);
  // Map index UI (0-based) → index pipeline (audio).
  const pipelineAudioMapRef = useRef<number[]>([]);
  // Map index UI (0-based) → index pipeline (sous-titres).
  const pipelineSubMapRef = useRef<number[]>([]);
  // Volume + mute mémorisés (pas exposés par les events pipeline).
  const volumeRef = useRef(1);
  const statusRef = useRef<PlayerStatus>('idle');

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
  const [currentSubtitle, setCurrentSubtitle] = useState(-1);
  const [subtitleOffset, setSubtitleOffsetState] = useState(0);
  // Pipeline active : la couche UI doit rendre une surface transparente.
  const [usesNativeSurface, setUsesNativeSurface] = useState(false);

  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Transparence WebView : posée tant que la pipeline est active ───────────
  useEffect(() => {
    if (!usesNativeSurface) return;
    document.documentElement.classList.add('iptvax-native-playback');
    return () => { document.documentElement.classList.remove('iptvax-native-playback'); };
  }, [usesNativeSurface]);

  // ── Pipeline : application d'un update reçu via subscribe ──────────────────
  const applyPipelineTracks = useCallback((tracks: MediaTrack[]) => {
    // Filtrage par type — la pipeline mélange audio / video / text dans une
    // même liste.
    const audios: AudioTrack[] = [];
    const subs: SubtitleTrack[] = [];
    const audMap: number[] = [];
    const subMap: number[] = [];
    let activeAudio = -1;
    let activeSub = -1;
    for (const t of tracks) {
      if (t.type === 'audio') {
        const uiIdx = audios.length;
        audios.push({
          index: uiIdx,
          name: t.description || t.language || `Audio ${uiIdx + 1}`,
          language: t.language || '',
        });
        audMap.push(t.index);
        if (t.selected) activeAudio = uiIdx;
      } else if (t.type === 'text') {
        const uiIdx = subs.length;
        subs.push({
          index: uiIdx,
          streamIndex: t.index,
          name: t.description || t.language || `Sous-titres ${uiIdx + 1}`,
          language: t.language || '',
        });
        subMap.push(t.index);
        if (t.selected) activeSub = uiIdx;
      }
    }
    pipelineAudioMapRef.current = audMap;
    pipelineSubMapRef.current = subMap;
    setAudioTracks(audios);
    setCurrentAudio(activeAudio);
    setSubtitleTracks(subs);
    setCurrentSubtitle(activeSub);
  }, []);

  // ── Démarrage Media Pipeline (fichier direct) ──────────────────────────────
  const startPipeline = useCallback(async (uri: string) => {
    try {
      setUsesNativeSurface(true);
      setStatus('loading');
      const mediaId = await WebOSMedia.load(uri, 'URI');
      mediaIdRef.current = mediaId;
      // Subscribe AVANT play : on capte le premier sourceInfo (tracks) sans race.
      subscribeHandleRef.current = WebOSMedia.subscribe(
        mediaId,
        (s) => {
          if (s.state === 'playing') setStatus('playing');
          else if (s.state === 'paused') setStatus('paused');
          else if (s.state === 'loaded' || s.state === 'load') setStatus('loading');
          else if (s.state === 'ended') setStatus('paused');
          else if (s.state === 'error') {
            setStatus('error');
            setError(s.errorText || 'Erreur Media Pipeline');
          }
          if (typeof s.currentTime === 'number') setCurrentTime(s.currentTime);
          if (typeof s.duration === 'number') {
            setDuration(s.duration);
            if (s.duration > 0) setIsLive(false);
          }
          if (s.tracks) applyPipelineTracks(s.tracks);
        },
        (err) => {
          // Erreurs intermittentes (ex. piste momentanément indispo) : on log.
          console.warn('[webosMedia] subscribe error:', err.message);
        },
      );
      await WebOSMedia.setVolume(mediaId, volumeRef.current);
      await WebOSMedia.play(mediaId);
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement Media Pipeline');
      setUsesNativeSurface(false);
    }
  }, [applyPipelineTracks]);

  const stopPipeline = useCallback(async () => {
    subscribeHandleRef.current?.cancel();
    subscribeHandleRef.current = null;
    const mediaId = mediaIdRef.current;
    mediaIdRef.current = null;
    if (mediaId) {
      try { await WebOSMedia.unload(mediaId); } catch { /* */ }
    }
    setUsesNativeSurface(false);
  }, []);

  // ── Listeners persistants sur le <video> (mode HLS uniquement) ─────────────
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
      document.removeEventListener('fullscreenchange', onFullscreenChange);
    };
  }, []);

  // ── Chargement de la source ────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    urlRef.current = url;

    // Nettoyage de la session précédente (quel que soit son mode)
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    // La pipeline éventuellement active doit être unloaded de façon ordonnée.
    if (mediaIdRef.current) {
      void stopPipeline();
    }

    if (!url) {
      setStatus('idle');
      if (video) {
        video.removeAttribute('src');
        video.load();
      }
      return;
    }

    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setIsLive(false);
    setLevels([]);
    setCurrentLevelState(-1);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setSubtitleTracks([]);
    setCurrentSubtitle(-1);
    pipelineAudioMapRef.current = [];
    pipelineSubMapRef.current = [];

    const isHls = url.includes('.m3u8');
    const isLiveStream = isHls && /\/live\//.test(url);
    if (isLiveStream) setIsLive(true);

    // ── Branche HLS : <video> + hls.js ────────────────────────────────────
    if (isHls && video) {
      setUsesNativeSurface(false);
      const tryPlay = () => video.play().catch(() => setStatus('paused'));

      if (Hls.isSupported()) {
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
          renderTextTracksNatively: true,
        } : {
          enableWorker: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startFragPrefetch: true,
          manifestLoadingMaxRetry: 0,
          levelLoadingMaxRetry: 0,
          fragLoadingMaxRetry: 2,
          renderTextTracksNatively: true,
        });
        hlsRef.current = hls;
        hls.loadSource(url);
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

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_, data: any) => {
          const list = (data.subtitleTracks ?? []) as { name?: string; lang?: string }[];
          const subs: SubtitleTrack[] = list.map((t, i) => ({
            index: i,
            streamIndex: i,
            name: t.name || t.lang || `Sous-titres ${i + 1}`,
            language: t.lang || '',
          }));
          setSubtitleTracks(subs);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hlsAny = hls as any;
          setCurrentSubtitle(hlsAny.subtitleTrack >= 0 ? hlsAny.subtitleTrack : -1);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_, data: any) => {
          setCurrentSubtitle(data.id ?? -1);
        });

        let liveRecoveryAttempts = 0;
        const MAX_LIVE_RECOVERY = 2;
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (isLiveStream && liveRecoveryAttempts < MAX_LIVE_RECOVERY) {
            liveRecoveryAttempts++;
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
            if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
          }
          setStatus('error');
          setError(`Erreur HLS : ${data.details}`);
        });
        return;
      }

      // HLS natif (Safari-like) — webOS modern n'en a pas besoin mais on couvre.
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        tryPlay();
        return;
      }
    }

    // ── Branche fichier direct : Media Pipeline ────────────────────────────
    if (hasLunaBridge()) {
      void startPipeline(url);
      return;
    }

    // Repli ultime (hors shell webOS, ou bridge absent) : <video> direct, sans
    // multi-piste. Sert pour le simulateur web qui exécute le bundle webOS sans
    // PalmServiceBridge.
    if (video) {
      setUsesNativeSurface(false);
      video.src = url;
      video.load();
      video.play().catch(() => setStatus('paused'));
    }
  }, [url, startPipeline, stopPipeline]);

  // Nettoyage final au démontage.
  useEffect(() => {
    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (mediaIdRef.current) {
        void stopPipeline();
      }
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [stopPipeline]);

  // ── Contrôles ──────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    const mediaId = mediaIdRef.current;
    if (mediaId) {
      if (statusRef.current === 'playing') WebOSMedia.pause(mediaId).catch(() => {});
      else WebOSMedia.play(mediaId).catch(() => {});
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  const seek = useCallback((time: number) => {
    const mediaId = mediaIdRef.current;
    if (mediaId) {
      WebOSMedia.seek(mediaId, Math.max(0, time)).catch(() => {});
      setCurrentTime(time);
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(time, video.duration || time));
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    setIsMuted(false);
    const mediaId = mediaIdRef.current;
    if (mediaId) {
      WebOSMedia.setVolume(mediaId, clamped).catch(() => {});
      WebOSMedia.setMuted(mediaId, false).catch(() => {});
      return;
    }
    const video = videoRef.current;
    if (!video) return;
    video.volume = clamped;
    video.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const mediaId = mediaIdRef.current;
    if (mediaId) {
      setIsMuted((muted) => {
        const next = !muted;
        WebOSMedia.setMuted(mediaId, next).catch(() => {});
        return next;
      });
      return;
    }
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
    // Pipeline : selectTrack
    const mediaId = mediaIdRef.current;
    if (mediaId) {
      const pipelineIdx = pipelineAudioMapRef.current[index];
      if (pipelineIdx === undefined) return;
      setCurrentAudio(index);
      WebOSMedia.selectTrack(mediaId, 'audio', pipelineIdx).catch(() => {});
      return;
    }
    // HLS
    if (hlsRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hlsRef.current as any).audioTrack = index;
      setCurrentAudio(index);
      return;
    }
  }, []);

  const setSubtitle = useCallback((index: number) => {
    // Pipeline : selectTrack pour le type 'text' (-1 désactive).
    const mediaId = mediaIdRef.current;
    if (mediaId) {
      setCurrentSubtitle(index);
      if (index < 0) {
        WebOSMedia.selectTrack(mediaId, 'text', -1).catch(() => {});
        return;
      }
      const pipelineIdx = pipelineSubMapRef.current[index];
      if (pipelineIdx === undefined) return;
      WebOSMedia.selectTrack(mediaId, 'text', pipelineIdx).catch(() => {});
      return;
    }
    // HLS
    if (hlsRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hlsRef.current as any).subtitleTrack = index;
      setCurrentSubtitle(index);
      return;
    }
    setCurrentSubtitle(index);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // La pipeline rend déjà plein écran sur le plan vidéo. En HLS, on
    // utilise le fullscreen DOM standard.
    if (mediaIdRef.current) return;
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapper.requestFullscreen().catch(() => {});
  }, []);

  const retry = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    setStatus('loading');
    setError(null);
    const isHls = u.includes('.m3u8');
    if (isHls && hlsRef.current) {
      hlsRef.current.startLoad();
      return;
    }
    if (isHls) {
      const video = videoRef.current;
      if (!video) return;
      video.src = u;
      video.load();
      video.play().catch(() => setStatus('paused'));
      return;
    }
    // Fichier direct : redémarre la pipeline.
    void (async () => {
      await stopPipeline();
      void startPipeline(u);
    })();
  }, [startPipeline, stopPipeline]);

  // Décalage de sous-titres : non géré côté pipeline webOS v1 (la pipeline
  // ne propose pas de subtitle delay public). Conservé pour compat.
  const adjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffsetState((prev) => Math.max(-10, Math.min(10, prev + delta)));
  }, []);

  const setSubtitleOffset = useCallback((value: number) => {
    setSubtitleOffsetState(Math.max(-10, Math.min(10, value)));
  }, []);

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
    currentSubtitle,
    subtitleText: '',
    subtitleLoading: false,
    subtitleOffset,
    usesNativeSurface,
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
