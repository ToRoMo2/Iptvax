import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerStatus, AudioTrack, SubtitleTrack, QualityLevel } from '../types/player.types';
import type { WebPlayerController } from './usePlayer';
import {
  NativePlayer,
  type NativeStateEvent,
  type NativeTimeEvent,
  type NativeTracksEvent,
  type NativeCuesEvent,
} from '../native/nativePlayer';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Implémentation NATIVE du contrat `PlayerController` — lecteur AndroidX Media3
 * (ExoPlayer), voir docs/native-port.md.
 *
 * Sous-titres : Media3 émet les cues TEXTE en direct (event `cues`) → on les
 * bufferise et les affiche dans l'overlay React (mêmes inline styles que le web
 * et la preview « Personnaliser »). Conséquence : changer la taille/couleur/fond
 * OU changer de piste est INSTANTANÉ — aucune reconstruction de moteur, aucun
 * rechargement (ce qui plombait l'ancien lecteur libVLC 3.x). Les sous-titres
 * IMAGE (PGS/DVB) n'émettent pas de cue texte → ils ne sont pas listés (rares).
 *
 * Le type de retour est `WebPlayerController` pour rester interchangeable avec
 * `usePlayer` ; `videoRef` n'est rattaché à aucun élément (la vidéo vit dans une
 * SurfaceView native derrière la WebView), `wrapperRef` reste utilisé par le
 * conteneur.
 */

interface Cue { start: number; text: string } // start en secondes
const MAX_CUE_S = 8; // durée max d'affichage quand la cue suivante est lointaine

export function useNativePlayer(
  url: string | null,
  _mediaUrl?: string | null,
  isLiveHint = false,
): WebPlayerController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevel] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [currentAudio, setCurrentAudio] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState(-1);
  const [subtitleOffset, setSubtitleOffsetState] = useState(0);
  const [subtitleText, setSubtitleText] = useState('');
  const [aspectRatio, setAspectRatioState] = useState<'fit' | 'fill'>('fit');

  // Refs lues dans les callbacks / boucles sans dépendances stales.
  const statusRef = useRef<PlayerStatus>('idle');
  const durationRef = useRef(0);
  const volumeRef = useRef(1);
  const urlRef = useRef<string | null>(null);
  const subOffsetRef = useRef(0);
  const currentSubRef = useRef(-1);
  // Ancre de temps pour interpoler la position entre deux events `time` (émis
  // ~2 Hz côté natif) → barre + sous-titres lisses (~7 Hz côté JS).
  const timeAnchorRef = useRef({ pos: 0, wall: 0 });
  // Buffer de cues (trié par start, dédupliqué) alimenté par l'event `cues`.
  const cuesRef = useRef<Cue[]>([]);

  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Transparence : la WebView est rendue transparente pendant la lecture ;
  // cette classe propage la transparence à toute la chaîne web pour laisser voir
  // la vidéo rendue par ExoPlayer derrière. ───────────────────────────────────
  useEffect(() => {
    document.documentElement.classList.add('umbra-native-playback');
    return () => {
      document.documentElement.classList.remove('umbra-native-playback');
    };
  }, []);

  // ── Écoute des évènements du lecteur natif ────────────────────────────────
  useEffect(() => {
    const handles: PluginListenerHandle[] = [];
    let cancelled = false;
    const track = (p: Promise<PluginListenerHandle>) => {
      p.then((h) => { if (cancelled) h.remove(); else handles.push(h); });
    };

    track(NativePlayer.addListener('state', (e: NativeStateEvent) => {
      if (e.state === 'ended') {
        setStatus('paused');
        setCurrentTime(durationRef.current);
        return;
      }
      if (e.state === 'error') {
        setStatus('error');
        setError(e.error ?? 'Erreur de lecture');
        return;
      }
      // 'loading' n'est jamais émis par le natif (ExoPlayer passe direct en
      // buffering) — on garde le 'loading' posé au load() jusqu'au 1er buffering.
      setStatus(e.state);
      if (e.state !== 'idle') setError(null);
    }));

    track(NativePlayer.addListener('time', (e: NativeTimeEvent) => {
      timeAnchorRef.current = { pos: e.position, wall: performance.now() };
      setCurrentTime(e.position);
      setBufferedEnd(e.buffered);
      setDuration(e.duration);
      durationRef.current = e.duration;
      setIsLive(e.duration <= 0 || isLiveHint);
    }));

    track(NativePlayer.addListener('tracks', (e: NativeTracksEvent) => {
      setAudioTracks(e.audio.map((t) => ({ index: t.index, name: t.name, language: t.language })));
      setCurrentAudio(e.currentAudio);
      setSubtitleTracks(
        e.subtitle.map((t) => ({ index: t.index, streamIndex: t.index, name: t.name, language: t.language })),
      );
      // Ne pas écraser un choix utilisateur déjà appliqué (ex. reprise) par la
      // re-sélection auto de Media3.
      if (currentSubRef.current < 0) {
        currentSubRef.current = e.currentSubtitle;
        setCurrentSubtitle(e.currentSubtitle);
      }
      setLevels(e.levels.map((l) => ({ index: l.index, label: l.label, bitrate: l.bitrate })));
      setCurrentLevel(e.currentLevel);
    }));

    track(NativePlayer.addListener('cues', (e: NativeCuesEvent) => {
      const text = (e.text ?? '').trim();
      if (!text) return; // groupe vide : la cue précédente s'éteindra par timeout
      const start = e.startMs >= 0 ? e.startMs / 1000 : timeAnchorRef.current.pos;
      const buf = cuesRef.current;
      const last = buf[buf.length - 1];
      if (last && Math.abs(last.start - start) < 0.05 && last.text === text) return; // dédup
      // Insertion ordonnée (les events arrivent quasi toujours en ordre).
      if (!last || start >= last.start) buf.push({ start, text });
      else {
        let lo = 0, hi = buf.length;
        while (lo < hi) { const m = (lo + hi) >> 1; if (buf[m].start < start) lo = m + 1; else hi = m; }
        buf.splice(lo, 0, { start, text });
      }
    }));

    // Rattrapage d'état : si le composant s'est remonté après le premier
    // onTracksChanged, ce call force le natif à ré-émettre tracks + time.
    NativePlayer.syncState().catch(() => {});

    return () => {
      cancelled = true;
      handles.forEach((h) => h.remove());
    };
  }, [isLiveHint]);

  // ── Chargement de la source ───────────────────────────────────────────────
  useEffect(() => {
    urlRef.current = url;
    cuesRef.current = [];
    currentSubRef.current = -1;
    subOffsetRef.current = 0;
    timeAnchorRef.current = { pos: 0, wall: performance.now() };
    setSubtitleText('');
    setSubtitleOffsetState(0);

    if (!url) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setBufferedEnd(0);
    setIsLive(isLiveHint);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setSubtitleTracks([]);
    setCurrentSubtitle(-1);
    setLevels([]);
    setCurrentLevel(-1);

    NativePlayer.load({ url, isLive: isLiveHint }).catch((e) => {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    });
  }, [url, isLiveHint]);

  // ── Boucle d'affichage des sous-titres + interpolation de la position ──────
  // Media3 n'émet `time` qu'à ~2 Hz → on interpole la position au fil de
  // l'horloge murale pour une barre fluide et des sous-titres à la bonne frame.
  useEffect(() => {
    let lastShown = '';
    let lastIdx = 0;
    const id = setInterval(() => {
      const a = timeAnchorRef.current;
      let t = a.pos;
      if (statusRef.current === 'playing') t += (performance.now() - a.wall) / 1000;
      if (durationRef.current > 0) t = Math.min(t, durationRef.current);

      // Position lissée (n'écrase pas pendant un seek/loading où l'ancre vaut 0).
      if (statusRef.current === 'playing') setCurrentTime(t);

      // Sous-titres : cue active à t + offset.
      let next = '';
      if (currentSubRef.current >= 0) {
        const cues = cuesRef.current;
        const rt = t + subOffsetRef.current;
        if (cues.length) {
          // Hint linéaire (cas courant) puis recherche arrière si seek.
          let i = Math.min(lastIdx, cues.length - 1);
          while (i > 0 && cues[i].start > rt) i--;
          while (i < cues.length - 1 && cues[i + 1].start <= rt) i++;
          const c = cues[i];
          const end = i + 1 < cues.length ? Math.min(cues[i + 1].start, c.start + MAX_CUE_S) : c.start + MAX_CUE_S;
          if (rt >= c.start && rt <= end) { next = c.text; lastIdx = i; }
        }
      }
      if (next !== lastShown) { lastShown = next; setSubtitleText(next); }
    }, 150);
    return () => clearInterval(id);
  }, []);

  // Arrêt + libération de la surface au démontage du lecteur.
  useEffect(() => {
    return () => { NativePlayer.stop().catch(() => {}); };
  }, []);

  // ── Contrôles ─────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') NativePlayer.pause().catch(() => {});
    else NativePlayer.play().catch(() => {});
  }, []);

  const seek = useCallback((time: number) => {
    const clamped = Math.max(0, durationRef.current > 0 ? Math.min(time, durationRef.current) : time);
    timeAnchorRef.current = { pos: clamped, wall: performance.now() };
    setCurrentTime(clamped);
    NativePlayer.seek({ position: clamped }).catch(() => {});
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    setIsMuted(false);
    NativePlayer.setVolume({ volume: clamped }).catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      const next = !muted;
      NativePlayer.setVolume({ volume: next ? 0 : volumeRef.current }).catch(() => {});
      return next;
    });
  }, []);

  const setLevel = useCallback((index: number) => {
    setCurrentLevel(index);
    NativePlayer.setVideoQuality({ index }).catch(() => {});
  }, []);

  const setAudio = useCallback((index: number) => {
    setCurrentAudio(index);
    NativePlayer.setAudioTrack({ index }).catch(() => {});
  }, []);

  const setSubtitle = useCallback((index: number) => {
    currentSubRef.current = index;
    setCurrentSubtitle(index);
    cuesRef.current = []; // repart à neuf — les cues de la nouvelle piste affluent
    setSubtitleText('');
    NativePlayer.setSubtitleTrack({ index }).catch(() => {});
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // L'app native est déjà plein écran — rien à basculer.
  }, []);

  const retry = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    setStatus('loading');
    setError(null);
    cuesRef.current = [];
    setSubtitleText('');
    NativePlayer.load({ url: u, isLive: isLiveHint }).catch((e) => {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    });
  }, [isLiveHint]);

  const adjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffsetState((prev) => {
      const v = Math.max(-10, Math.min(10, prev + delta));
      subOffsetRef.current = v;
      return v;
    });
  }, []);

  const setSubtitleOffset = useCallback((value: number) => {
    const v = Math.max(-10, Math.min(10, value));
    subOffsetRef.current = v;
    setSubtitleOffsetState(v);
  }, []);

  const setAspectRatio = useCallback((mode: 'fit' | 'fill') => {
    setAspectRatioState(mode);
    NativePlayer.setAspectRatio({ mode }).catch(() => {});
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
    isFullscreen: false,
    levels,
    currentLevel,
    audioTracks,
    currentAudio,
    subtitleTracks,
    currentSubtitle,
    subtitleText,
    subtitleLoading: false, // plus d'extraction réseau séparée → jamais de spinner
    subtitleOffset,
    // ExoPlayer rend la vidéo sur une SurfaceView DERRIÈRE la WebView → la couche
    // UI doit afficher un <div> transparent à la place du <video>.
    usesNativeSurface: true,
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
    aspectRatio,
    setAspectRatio,
  };
}
