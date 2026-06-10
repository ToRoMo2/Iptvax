import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerStatus, AudioTrack, SubtitleTrack } from '../types/player.types';
import type { WebPlayerController } from './usePlayer';
import {
  VlcPlayer,
  type VlcStateEvent,
  type VlcTimeEvent,
  type VlcTracksEvent,
  type VlcSubtitleStyle,
} from '../native/vlcPlayer';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Implémentation NATIVE du contrat `PlayerController` — voir docs/native-port.md.
 *
 * Pilote le plugin `VlcPlayer` (libVLC). Le pendant de `usePlayer` (web/ffmpeg).
 * La couche UI (`VideoPlayer`) choisit l'un ou l'autre via `isNative`.
 *
 * Différences assumées avec le lecteur web :
 * - les sous-titres sont rendus PAR libVLC sur la surface native → `subtitleText`
 *   reste vide et l'overlay React ne s'affiche pas (le décalage g/h pilote
 *   `setSpuDelay`) ;
 * - pas de niveaux de qualité HLS exposés (`levels` vide) ;
 * - le plein écran est géré par l'OS (l'app native est déjà immersive).
 *
 * Le type de retour est `WebPlayerController` pour rester interchangeable avec
 * `usePlayer` ; `videoRef` n'est rattaché à aucun élément en natif (la vidéo
 * vit dans une surface native), `wrapperRef` reste utilisé par le conteneur.
 */
export function useNativePlayer(
  url: string | null,
  _mediaUrl?: string | null,
  subStyle?: VlcSubtitleStyle,
): WebPlayerController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  // Style courant lu au chargement sans relancer l'effet de load.
  const subStyleRef = useRef(subStyle);
  subStyleRef.current = subStyle;

  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [currentAudio, setCurrentAudio] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState(-1);
  const [subtitleOffset, setSubtitleOffsetState] = useState(0);
  // `true` le temps qu'un changement de style (taille/couleur/fond) recharge le
  // flux (libVLC 3.x ne restyle pas à chaud). Permet à l'UI de masquer le gros
  // overlay « Chargement » au profit d'un discret indicateur — la lecture n'a
  // pas vraiment été interrompue du point de vue de l'utilisateur.
  const [subtitleStyling, setSubtitleStyling] = useState(false);
  // Pendant ce reload, on AVALE les transitions loading/buffering du moteur pour
  // ne pas faire clignoter l'overlay de chargement ; on repasse `playing` dès
  // que la première frame du flux restylé est décodée.
  const restylingRef = useRef(false);

  // Refs lues dans les callbacks / listeners sans dépendances stales.
  const statusRef = useRef<PlayerStatus>('idle');
  const durationRef = useRef(0);
  const volumeRef = useRef(1);
  const urlRef = useRef<string | null>(null);
  // Tables index UI (0-based) → id de piste libVLC.
  const audioIdsRef = useRef<number[]>([]);
  const subIdsRef = useRef<number[]>([]);

  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Transparence : la WebView est rendue transparente côté natif pendant la
  // lecture ; cette classe propage la transparence à toute la chaîne web
  // (html/body/#root + surfaces du lecteur) pour laisser voir la vidéo. ────────
  useEffect(() => {
    document.documentElement.classList.add('iptvax-native-playback');
    return () => {
      document.documentElement.classList.remove('iptvax-native-playback');
    };
  }, []);

  // ── Écoute des évènements du lecteur natif ────────────────────────────────
  useEffect(() => {
    const handles: PluginListenerHandle[] = [];
    let cancelled = false;
    const track = (p: Promise<PluginListenerHandle>) => {
      p.then((h) => { if (cancelled) h.remove(); else handles.push(h); });
    };

    track(VlcPlayer.addListener('state', (e: VlcStateEvent) => {
      // ── Rechargement de restyle des sous-titres en cours ───────────────────
      // On garde l'UI en lecture (pas d'overlay de chargement) ; seul un retour
      // en `playing`/`error` clôt l'épisode de restyle.
      if (restylingRef.current) {
        if (e.state === 'playing') {
          restylingRef.current = false;
          setSubtitleStyling(false);
          setStatus('playing');
          setError(null);
        } else if (e.state === 'error') {
          restylingRef.current = false;
          setSubtitleStyling(false);
          setStatus('error');
          setError(e.error ?? 'Erreur de lecture');
        }
        // loading / buffering / paused / idle : avalés pendant le restyle.
        return;
      }
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
      setStatus(e.state);
      if (e.state !== 'idle') setError(null);
    }));

    track(VlcPlayer.addListener('time', (e: VlcTimeEvent) => {
      setCurrentTime(e.position);
      setDuration(e.duration);
      durationRef.current = e.duration;
      if (e.duration <= 0) setIsLive(true);
    }));

    track(VlcPlayer.addListener('tracks', (e: VlcTracksEvent) => {
      audioIdsRef.current = e.audio.map((t) => t.id);
      setAudioTracks(e.audio.map((t, i) => ({ index: i, name: t.name, language: '' })));
      setCurrentAudio(e.audio.findIndex((t) => t.id === e.currentAudio));

      subIdsRef.current = e.subtitle.map((t) => t.id);
      setSubtitleTracks(
        e.subtitle.map((t, i) => ({ index: i, streamIndex: t.id, name: t.name, language: '' })),
      );
      setCurrentSubtitle(e.subtitle.findIndex((t) => t.id === e.currentSubtitle));
    }));

    return () => {
      cancelled = true;
      handles.forEach((h) => h.remove());
    };
  }, []);

  // ── Chargement de la source ───────────────────────────────────────────────
  // Au changement d'URL on recharge sans `stop()` (libVLC bascule de média,
  // la surface reste visible → pas de flash entre deux chaînes live).
  useEffect(() => {
    urlRef.current = url;
    if (!url) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setIsLive(false);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setSubtitleTracks([]);
    setCurrentSubtitle(-1);
    audioIdsRef.current = [];
    subIdsRef.current = [];
    VlcPlayer.load({ url, subStyle: subStyleRef.current }).catch((e) => {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    });
  }, [url]);

  // Arrêt + libération de la surface uniquement au démontage du lecteur.
  useEffect(() => {
    return () => { VlcPlayer.stop().catch(() => {}); };
  }, []);

  // ── Restyle des sous-titres « quasi à chaud » ─────────────────────────────
  // libVLC 3.x ne sait pas restyler en cours de lecture (les options freetype
  // sont au niveau du moteur) → setSubtitleStyle recharge le média à la position
  // courante (pistes préservées côté natif). Deux soins pour rendre ça fluide :
  //  1. DÉBOUNCE : si l'utilisateur enchaîne les réglages (sm→md→lg…), on ne
  //     recharge qu'UNE fois, ~420 ms après le dernier changement.
  //  2. Pas de pause + on lève `subtitleStyling` pour que l'UI masque l'épisode
  //     (backdrop + petit indicateur au lieu du gros overlay « Chargement »).
  // On saute le 1er run (le style est déjà passé au load initial).
  const subStyleFirstRun = useRef(true);
  const restyleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restyleSafetyRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (subStyleFirstRun.current) { subStyleFirstRun.current = false; return; }
    if (!subStyle) return;
    if (restyleTimerRef.current) clearTimeout(restyleTimerRef.current);
    restyleTimerRef.current = setTimeout(() => {
      restyleTimerRef.current = null;
      if (statusRef.current !== 'playing' && statusRef.current !== 'paused') return;
      const s = subStyleRef.current;
      if (!s) return;
      restylingRef.current = true;
      setSubtitleStyling(true);
      // Filet de sécurité : si le moteur ne ré-émet jamais `playing` (cas rare),
      // on lève l'indicateur après 6 s plutôt que de le laisser collé.
      if (restyleSafetyRef.current) clearTimeout(restyleSafetyRef.current);
      restyleSafetyRef.current = setTimeout(() => {
        if (restylingRef.current) { restylingRef.current = false; setSubtitleStyling(false); }
      }, 6000);
      VlcPlayer.setSubtitleStyle(s).catch(() => {
        restylingRef.current = false;
        setSubtitleStyling(false);
      });
    }, 420);
    return () => {
      if (restyleTimerRef.current) { clearTimeout(restyleTimerRef.current); restyleTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subStyle?.scale, subStyle?.color, subStyle?.bgOpacity]);

  // Nettoyage du filet de sécurité au démontage.
  useEffect(() => () => {
    if (restyleSafetyRef.current) clearTimeout(restyleSafetyRef.current);
  }, []);

  // ── Contrôles ─────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') VlcPlayer.pause().catch(() => {});
    else VlcPlayer.play().catch(() => {});
  }, []);

  const seek = useCallback((time: number) => {
    const clamped = Math.max(0, durationRef.current > 0 ? Math.min(time, durationRef.current) : time);
    setCurrentTime(clamped);
    VlcPlayer.seek({ position: clamped }).catch(() => {});
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    volumeRef.current = clamped;
    setVolumeState(clamped);
    setIsMuted(false);
    VlcPlayer.setVolume({ volume: clamped }).catch(() => {});
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      const next = !muted;
      VlcPlayer.setVolume({ volume: next ? 0 : volumeRef.current }).catch(() => {});
      return next;
    });
  }, []);

  const setLevel = useCallback(() => {
    // Pas de niveaux de qualité HLS exposés par libVLC — no-op.
  }, []);

  const setAudio = useCallback((index: number) => {
    const id = audioIdsRef.current[index];
    if (id === undefined) return;
    setCurrentAudio(index);
    VlcPlayer.setAudioTrack({ id }).catch(() => {});
  }, []);

  const setSubtitle = useCallback((index: number) => {
    if (index < 0) {
      setCurrentSubtitle(-1);
      VlcPlayer.setSubtitleTrack({ id: -1 }).catch(() => {});
      return;
    }
    const id = subIdsRef.current[index];
    if (id === undefined) return;
    setCurrentSubtitle(index);
    VlcPlayer.setSubtitleTrack({ id }).catch(() => {});
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // L'app native est déjà plein écran — rien à basculer.
  }, []);

  const retry = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    setStatus('loading');
    setError(null);
    VlcPlayer.load({ url: u, subStyle: subStyleRef.current }).catch((e) => {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    });
  }, []);

  const adjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffsetState((prev) => {
      const v = Math.max(-10, Math.min(10, prev + delta));
      VlcPlayer.setSubtitleDelay({ delay: v }).catch(() => {});
      return v;
    });
  }, []);

  const setSubtitleOffset = useCallback((value: number) => {
    const v = Math.max(-10, Math.min(10, value));
    setSubtitleOffsetState(v);
    VlcPlayer.setSubtitleDelay({ delay: v }).catch(() => {});
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
    isFullscreen: false,
    levels: [],
    currentLevel: -1,
    audioTracks,
    currentAudio,
    subtitleTracks,
    currentSubtitle,
    subtitleText: '',
    subtitleLoading: false,
    subtitleStyling,
    subtitleOffset,
    // libVLC rend la vidéo sur une SurfaceView DERRIÈRE la WebView → la couche
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
  };
}
