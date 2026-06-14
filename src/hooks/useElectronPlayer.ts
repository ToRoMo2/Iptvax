import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerStatus, AudioTrack, SubtitleTrack } from '../types/player.types';
import type { WebPlayerController } from './usePlayer';
import { electronMpv, type MpvEvent, type MpvTrack } from '../native/electronMpv';

/**
 * Implémentation Electron du contrat `PlayerController` — voir docs/native-port.md
 * et CLAUDE.md §XI (dispatch Electron natif).
 *
 * Pilote le lecteur natif **mpv** (process séparé, IPC JSON) qui décode
 * DIRECTEMENT l'URL Xtream upstream (HEVC/AC3/MKV/MPEG-TS) depuis l'IP
 * résidentielle → démarrage 1-2 s, seek quasi instantané, sans remux ffmpeg.
 * Le pendant Electron de `usePlayer` (web/ffmpeg) et `useNativePlayer` (libVLC).
 *
 * Particularités assumées :
 * - la vidéo est rendue par mpv sur une surface NATIVE derrière la WebView
 *   (`usesNativeSurface = true`, classe `umbra-native-playback`) → `subtitleText`
 *   reste vide (sous-titres rendus par mpv) ;
 * - l'URL reçue est l'URL PROXIFIÉE (`/api/hlsproxy?url=…`) du mode web ; on en
 *   ré-extrait l'URL directe upstream (`url=` du query) pour la donner à mpv —
 *   le proxy local reste pour le NON-lecture (images, etc.).
 */

// UA HTTP alignés sur le proxy (server/proxy.cjs §IV-8) : live → UA VLC sans
// Referer/Origin ; VOD/série → UA navigateur + Referer/Origin de l'upstream.
const UA_LIVE = 'VLC/3.0.20 LibVLC/3.0.20';
const UA_DEFAULT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export interface MpvSubStyle {
  scale: number; // sub-scale (1.0 = taille native)
  color: string; // '#rrggbb'
  back: string; // sub-back-color '#aarrggbb' (boîte derrière le texte)
}

/** Ré-extrait l'URL directe upstream d'une URL proxifiée `/api/*?url=…`.
 *  Une URL déjà directe (sans `/api/`) est renvoyée telle quelle. */
function directUpstream(proxied: string | null | undefined): string | null {
  if (!proxied) return null;
  try {
    const u = new URL(proxied, window.location.origin);
    if (u.pathname.includes('/api/')) {
      const inner = u.searchParams.get('url');
      if (inner) return inner;
    }
    return proxied;
  } catch {
    return proxied;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function useElectronPlayer(
  url: string | null,
  mediaUrl?: string | null,
  opts?: { isLive?: boolean; subStyle?: MpvSubStyle },
): WebPlayerController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const isLiveHint = !!opts?.isLive;
  const subStyle = opts?.subStyle;
  const subStyleRef = useRef(subStyle);
  subStyleRef.current = subStyle;

  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [currentAudio, setCurrentAudio] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState(-1);
  const [subtitleOffset, setSubtitleOffsetState] = useState(0);

  // Refs lues dans les callbacks sans dépendances stales.
  const statusRef = useRef<PlayerStatus>('idle');
  const durationRef = useRef(0);
  const volumeRef = useRef(1);
  const urlRef = useRef<string | null>(null);
  // Index UI (0-based) → id de piste mpv (aid/sid).
  const audioIdsRef = useRef<number[]>([]);
  const subIdsRef = useRef<number[]>([]);

  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Transparence : surface mpv DERRIÈRE la WebView pendant la lecture ────────
  useEffect(() => {
    document.documentElement.classList.add('umbra-native-playback');
    return () => { document.documentElement.classList.remove('umbra-native-playback'); };
  }, []);

  // ── Flux d'events mpv → state ───────────────────────────────────────────────
  useEffect(() => {
    const off = electronMpv.onEvent((ev: MpvEvent) => {
      switch (ev.type) {
        case 'time':
          setCurrentTime(ev.position);
          break;
        case 'duration':
          setDuration(ev.duration);
          durationRef.current = ev.duration;
          setIsLive(ev.duration <= 0);
          break;
        case 'state':
          if (ev.state === 'error') {
            setStatus('error');
            setError(ev.error ?? 'Erreur de lecture');
          } else if (ev.state === 'ended') {
            setStatus('paused');
            if (durationRef.current > 0) setCurrentTime(durationRef.current);
          } else {
            setStatus(ev.state);
            setError(null);
          }
          break;
        case 'tracks': {
          const mapTrack = (t: MpvTrack, i: number): AudioTrack => ({
            index: i,
            name: t.name || `Piste ${i + 1}`,
            language: t.language,
          });
          audioIdsRef.current = ev.audio.map((t) => t.id);
          setAudioTracks(ev.audio.map(mapTrack));
          setCurrentAudio(ev.currentAudio);
          subIdsRef.current = ev.sub.map((t) => t.id);
          setSubtitleTracks(
            ev.sub.map((t, i) => ({
              index: i,
              streamIndex: t.id,
              name: t.name || `Sous-titre ${i + 1}`,
              language: t.language,
            })),
          );
          setCurrentSubtitle(ev.currentSub);
          break;
        }
        case 'volume':
          volumeRef.current = ev.volume;
          setVolumeState(ev.volume);
          break;
        case 'mute':
          setIsMuted(ev.muted);
          break;
      }
    });
    return off;
  }, []);

  // ── Suivi du plein écran NATIF de la fenêtre Electron ───────────────────────
  // ⚠ PAS l'API Fullscreen HTML : son `::backdrop` opaque rend la WebView noire
  // → masque la surface mpv (écran noir en plein écran). On bascule la fenêtre
  // OS via IPC (`window.toggleFullscreen`) et on suit l'état via le main process.
  useEffect(() => {
    const w = typeof window !== 'undefined' ? window.electron?.window : undefined;
    if (!w) return;
    return w.onFullscreenChange(setIsFullscreen);
  }, []);

  // ── Chargement de la source ─────────────────────────────────────────────────
  // Live → URL HLS (.m3u8, `url`) ; VOD/série → fichier direct (`mediaUrl`).
  // L'URL reçue est proxifiée (mode web) → on en extrait l'upstream direct.
  useEffect(() => {
    urlRef.current = url;
    const proxied = isLiveHint ? url : (mediaUrl ?? url);
    const direct = directUpstream(proxied);
    if (!direct) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setIsLive(isLiveHint);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setSubtitleTracks([]);
    setCurrentSubtitle(-1);
    audioIdsRef.current = [];
    subIdsRef.current = [];

    const origin = originOf(direct);
    const loadOpts = isLiveHint
      ? { userAgent: UA_LIVE, headers: [] as string[] }
      : {
          userAgent: UA_DEFAULT,
          headers: origin ? [`Referer: ${origin}/`, `Origin: ${origin}`] : [],
        };
    electronMpv.load(direct, loadOpts).catch((e) => {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    });
  }, [url, mediaUrl, isLiveHint]);

  // Arrêt de mpv au démontage du lecteur (le process reste vivant, idle).
  // Sortie du plein écran borderless (no-op si pas en plein écran) → la touche
  // Échap/Retour ne laisse pas la fenêtre coincée plein écran sur le catalogue.
  useEffect(() => {
    return () => {
      electronMpv.stop().catch(() => {});
      window.electron?.window.exitFullscreen();
    };
  }, []);

  // ── Style des sous-titres à chaud (avantage mpv : pas de reconstruction) ─────
  useEffect(() => {
    if (!subStyle) return;
    electronMpv.setSubScale(subStyle.scale).catch(() => {});
    electronMpv.setSubColor(subStyle.color).catch(() => {});
    electronMpv.setSubBackColor(subStyle.back).catch(() => {});
    // Gras constant : la preview « Personnaliser » rend les sous-titres en
    // fontWeight 700 → on aligne mpv (sub-bold) pour matcher l'aperçu.
    electronMpv.setSubBold(true).catch(() => {});
    // subStyle est recréé à chaque rendu ; on ne dépend que de ses champs primitifs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subStyle?.scale, subStyle?.color, subStyle?.back]);

  // ── Contrôles ───────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') electronMpv.pause().catch(() => {});
    else electronMpv.play().catch(() => {});
  }, []);

  const seek = useCallback((time: number) => {
    const clamped = Math.max(0, durationRef.current > 0 ? Math.min(time, durationRef.current) : time);
    setCurrentTime(clamped);
    electronMpv.seek(clamped).catch(() => {});
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    setIsMuted(false);
    electronMpv.setVolume(clamped).catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      const next = !muted;
      electronMpv.setMute(next).catch(() => {});
      return next;
    });
  }, []);

  const setLevel = useCallback(() => {
    // Pas de niveaux ABR exposés par mpv ici — no-op (menu qualité masqué).
  }, []);

  const setAudio = useCallback((index: number) => {
    const id = audioIdsRef.current[index];
    if (id === undefined) return;
    setCurrentAudio(index);
    electronMpv.setAudio(id).catch(() => {});
  }, []);

  const setSubtitle = useCallback((index: number) => {
    if (index < 0) {
      setCurrentSubtitle(-1);
      electronMpv.setSubtitle(-1).catch(() => {});
      return;
    }
    const id = subIdsRef.current[index];
    if (id === undefined) return;
    setCurrentSubtitle(index);
    electronMpv.setSubtitle(id).catch(() => {});
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // Plein écran NATIF de la fenêtre (cf. effet plus haut).
    window.electron?.window.toggleFullscreen();
  }, []);

  // Lever les sous-titres au-dessus de l'overlay des contrôles (le pendant mpv
  // du `.wrapper.showControls .subtitleOverlay` CSS). sub-pos plus bas = plus haut.
  const setSubtitleRaised = useCallback((raised: boolean) => {
    electronMpv.setSubPos(raised ? 84 : 100).catch(() => {});
  }, []);

  const retry = useCallback(() => {
    const u = urlRef.current;
    const direct = directUpstream(isLiveHint ? u : (mediaUrl ?? u));
    if (!direct) return;
    setStatus('loading');
    setError(null);
    const origin = originOf(direct);
    const loadOpts = isLiveHint
      ? { userAgent: UA_LIVE, headers: [] as string[] }
      : { userAgent: UA_DEFAULT, headers: origin ? [`Referer: ${origin}/`, `Origin: ${origin}`] : [] };
    electronMpv.load(direct, loadOpts).catch((e) => {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    });
  }, [mediaUrl, isLiveHint]);

  const adjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffsetState((prev) => {
      const v = Math.max(-10, Math.min(10, prev + delta));
      electronMpv.setSubDelay(v).catch(() => {});
      return v;
    });
  }, []);

  const setSubtitleOffset = useCallback((value: number) => {
    const v = Math.max(-10, Math.min(10, value));
    setSubtitleOffsetState(v);
    electronMpv.setSubDelay(v).catch(() => {});
  }, []);

  return {
    videoRef,
    wrapperRef,
    status,
    error,
    isLive,
    currentTime,
    duration,
    bufferedEnd: currentTime,
    volume,
    isMuted,
    isFullscreen,
    levels: [],
    currentLevel: -1,
    audioTracks,
    currentAudio,
    subtitleTracks,
    currentSubtitle,
    subtitleText: '',
    subtitleLoading: false,
    subtitleOffset,
    // mpv rend la vidéo sur une surface native DERRIÈRE la WebView → la couche UI
    // doit afficher un <div> transparent à la place du <video>.
    usesNativeSurface: true,
    adjustSubtitleOffset,
    setSubtitleOffset,
    setSubtitleRaised,
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
