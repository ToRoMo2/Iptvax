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
import {
  SubtitleExtractor,
  type ExtractedCue,
  type ExtractedSubtitleTrack,
} from '../native/subtitleExtractor';
import type { PluginListenerHandle } from '@capacitor/core';

/**
 * Implémentation NATIVE du contrat `PlayerController` — voir docs/native-port.md.
 *
 * Pilote le plugin `VlcPlayer` (libVLC) pour la vidéo + l'audio. Pour les
 * sous-titres TEXTE, deux modes coexistent :
 *  - **rendu React** (préféré) : les cues sont extraites ON-DEVICE via
 *    `SubtitleExtractor` (MediaExtractor) et affichées dans l'overlay React →
 *    restyle taille/couleur/fond INSTANTANÉ (libVLC 3.x ne sait pas restyler à
 *    chaud). libVLC ne rend alors PAS la piste (`setSubtitleTrack(-1)`).
 *  - **rendu libVLC** (repli) : pour les sous-titres IMAGE (PGS/DVB/VobSub) ou
 *    si l'extraction échoue → libVLC rend la piste comme avant (`subtitleText`
 *    vide). Jamais de régression.
 *
 * Le type de retour est `WebPlayerController` pour rester interchangeable avec
 * `usePlayer` ; `videoRef` n'est rattaché à aucun élément en natif (la vidéo
 * vit dans une surface native), `wrapperRef` reste utilisé par le conteneur.
 */

// Grille de fenêtres d'extraction (ms) — pendant on-device du fenêtrage web
// (§IV-1) : on n'extrait qu'une tranche à la fois pour ne pas télécharger tout
// le fichier ni monopoliser la connexion fournisseur.
const SUB_WIN_MS = 120_000;
const SUB_OVERLAP_MS = 4_000;

function winIndex(tSec: number): number {
  return Math.max(0, Math.floor((tSec * 1000) / SUB_WIN_MS));
}

function subLabel(lang: string, i: number): string {
  return lang ? lang.toUpperCase() : `Sous-titres ${i + 1}`;
}

/** Nature d'une entrée de la liste de sous-titres unifiée. */
type SubKind =
  | { kind: 'react'; extractTrackIndex: number }
  | { kind: 'native'; vlcId: number };

export function useNativePlayer(
  url: string | null,
  _mediaUrl?: string | null,
  subStyle?: VlcSubtitleStyle,
  isLiveHint = false,
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
  // Sous-titres rendus en React (mode extraction) — vides en rendu libVLC.
  const [subtitleText, setSubtitleText] = useState('');
  const [subtitleLoading, setSubtitleLoading] = useState(false);

  // Refs lues dans les callbacks / listeners sans dépendances stales.
  const statusRef = useRef<PlayerStatus>('idle');
  const durationRef = useRef(0);
  const volumeRef = useRef(1);
  const urlRef = useRef<string | null>(null);
  const currentTimeRef = useRef(0);
  const subOffsetRef = useRef(0);
  // index UI (0-based) → id de piste libVLC (audio).
  const audioIdsRef = useRef<number[]>([]);

  // ── État sous-titres unifié (libVLC ⊕ extracteur React) ────────────────────
  // Pistes libVLC (id+nom) du dernier event `tracks`, pistes texte de
  // l'extracteur, et la nature (react|native) de chaque entrée de la liste UI.
  const vlcSubTracksRef = useRef<{ id: number; name: string }[]>([]);
  const extractorTracksRef = useRef<ExtractedSubtitleTrack[]>([]);
  const subKindRef = useRef<SubKind[]>([]);
  // Init unique de la sélection — différée jusqu'à ce que la sonde extracteur ET
  // l'event `tracks` de libVLC soient arrivés (sinon la liste se réordonne après
  // coup quand la sonde atterrit et les index deviennent caducs).
  const firstTracksInitRef = useRef(false);
  const tracksArrivedRef = useRef(false);
  const probeStartedRef = useRef(false);
  const probeSettledRef = useRef(false);
  const pendingVlcCurrentRef = useRef(-1);
  // Piste extracteur actuellement rendue en React (null = aucune / rendu libVLC).
  const activeExtractTrackRef = useRef<number | null>(null);
  const subWindowsRef = useRef<Map<number, ExtractedCue[]>>(new Map());
  const subInflightRef = useRef<Set<number>>(new Set());
  const subCuesRef = useRef<ExtractedCue[]>([]);

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

  // ── Helpers sous-titres React ──────────────────────────────────────────────

  // Reconstruit subCuesRef à partir de toutes les fenêtres chargées (triées,
  // dédupliquées sur start+text).
  const rebuildCues = useCallback(() => {
    const all: ExtractedCue[] = [];
    subWindowsRef.current.forEach((cues) => { for (const c of cues) all.push(c); });
    all.sort((a, b) => a.start - b.start);
    const dedup: ExtractedCue[] = [];
    let lastKey = '';
    for (const c of all) {
      const key = `${c.start}|${c.text}`;
      if (key === lastKey) continue;
      lastKey = key;
      dedup.push(c);
    }
    subCuesRef.current = dedup;
  }, []);

  // Récupère (best-effort) la fenêtre `w` de la piste extracteur active.
  const fetchWindow = useCallback((extractTrackIndex: number, w: number) => {
    if (w < 0) return;
    if (subWindowsRef.current.has(w) || subInflightRef.current.has(w)) return;
    const u = urlRef.current;
    if (!u) return;
    subInflightRef.current.add(w);
    const startMs = Math.max(0, w * SUB_WIN_MS - SUB_OVERLAP_MS);
    const durationMs = SUB_WIN_MS + SUB_OVERLAP_MS * 2;
    SubtitleExtractor.extract({ url: u, trackIndex: extractTrackIndex, startMs, durationMs })
      .then((r) => {
        subInflightRef.current.delete(w);
        // Ignore si la piste active a changé entre-temps.
        if (activeExtractTrackRef.current !== extractTrackIndex) return;
        subWindowsRef.current.set(w, r.cues ?? []);
        rebuildCues();
      })
      .catch(() => { subInflightRef.current.delete(w); });
  }, [rebuildCues]);

  // Coupe le mode React (retour au rendu libVLC ou désactivé).
  const clearReactSubs = useCallback(() => {
    activeExtractTrackRef.current = null;
    subWindowsRef.current.clear();
    subInflightRef.current.clear();
    subCuesRef.current = [];
    setSubtitleText('');
    setSubtitleLoading(false);
    SubtitleExtractor.release().catch(() => {});
  }, []);

  // Construit la liste UI unifiée : pistes extracteur (react) d'abord, puis les
  // pistes libVLC restantes (heuristique d'ordre : les sous-titres TEXTE sont
  // vus par les deux énumérateurs dans le même ordre ; au-delà = sous-titres
  // IMAGE, rendus par libVLC). Aucune extraction → tout en natif (historique).
  const rebuildSubtitleList = useCallback(() => {
    const ext = extractorTracksRef.current;
    const vlc = vlcSubTracksRef.current;
    const list: SubtitleTrack[] = [];
    const kinds: SubKind[] = [];
    ext.forEach((t, i) => {
      list.push({ index: list.length, streamIndex: t.trackIndex, name: subLabel(t.language, i), language: t.language });
      kinds.push({ kind: 'react', extractTrackIndex: t.trackIndex });
    });
    vlc.slice(ext.length).forEach((t) => {
      list.push({ index: list.length, streamIndex: t.id, name: t.name, language: '' });
      kinds.push({ kind: 'native', vlcId: t.id });
    });
    subKindRef.current = kinds;
    setSubtitleTracks(list);
  }, []);

  // Applique une sélection de sous-titre (index UI ; <0 = désactivé). Route vers
  // le rendu React (extraction) ou libVLC selon la nature de l'entrée.
  const applySubtitle = useCallback((index: number) => {
    if (index < 0) {
      clearReactSubs();
      setCurrentSubtitle(-1);
      VlcPlayer.setSubtitleTrack({ id: -1 }).catch(() => {});
      return;
    }
    const kind = subKindRef.current[index];
    if (!kind) return;
    setCurrentSubtitle(index);
    if (kind.kind === 'native') {
      clearReactSubs();
      VlcPlayer.setSubtitleTrack({ id: kind.vlcId }).catch(() => {});
      return;
    }
    // React : libVLC ne rend pas la piste, on extrait nous-mêmes.
    VlcPlayer.setSubtitleTrack({ id: -1 }).catch(() => {});
    activeExtractTrackRef.current = kind.extractTrackIndex;
    subWindowsRef.current.clear();
    subInflightRef.current.clear();
    subCuesRef.current = [];
    setSubtitleText('');
    setSubtitleLoading(true);
    const w = winIndex(currentTimeRef.current);
    fetchWindow(kind.extractTrackIndex, w);
    fetchWindow(kind.extractTrackIndex, w + 1);
  }, [clearReactSubs, fetchWindow]);

  // Route la sélection auto de libVLC vers react/native — une seule fois, quand
  // la liste est FINALE (sonde + tracks arrivés). Sous l'heuristique d'ordre,
  // l'index UI = la position de la piste dans la liste libVLC.
  const maybeInit = useCallback(() => {
    if (firstTracksInitRef.current) return;
    if (!tracksArrivedRef.current || !probeSettledRef.current) return;
    firstTracksInitRef.current = true;
    const p = vlcSubTracksRef.current.findIndex((t) => t.id === pendingVlcCurrentRef.current);
    applySubtitle(p >= 0 ? p : -1);
  }, [applySubtitle]);

  // ── Écoute des évènements du lecteur natif ────────────────────────────────
  useEffect(() => {
    const handles: PluginListenerHandle[] = [];
    let cancelled = false;
    const track = (p: Promise<PluginListenerHandle>) => {
      p.then((h) => { if (cancelled) h.remove(); else handles.push(h); });
    };

    track(VlcPlayer.addListener('state', (e: VlcStateEvent) => {
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
      currentTimeRef.current = e.position;
      setCurrentTime(e.position);
      setDuration(e.duration);
      durationRef.current = e.duration;
      if (e.duration <= 0) setIsLive(true);
    }));

    track(VlcPlayer.addListener('tracks', (e: VlcTracksEvent) => {
      audioIdsRef.current = e.audio.map((t) => t.id);
      setAudioTracks(e.audio.map((t, i) => ({ index: i, name: t.name, language: '' })));
      setCurrentAudio(e.audio.findIndex((t) => t.id === e.currentAudio));

      vlcSubTracksRef.current = e.subtitle.map((t) => ({ id: t.id, name: t.name }));
      rebuildSubtitleList();
      tracksArrivedRef.current = true;
      pendingVlcCurrentRef.current = e.currentSubtitle;

      // Sonde l'extracteur APRÈS que libVLC stream (connexion établie) → évite la
      // contention de connexion au démarrage (la lecture ne doit jamais régresser).
      // VOD/série uniquement ; une seule fois par source ; best-effort (échec →
      // liste vide → repli libVLC).
      if (!isLiveHint && !probeStartedRef.current && urlRef.current) {
        probeStartedRef.current = true;
        SubtitleExtractor.probe({ url: urlRef.current })
          .then((r) => { extractorTracksRef.current = r.tracks ?? []; })
          .catch(() => { extractorTracksRef.current = []; })
          .finally(() => { probeSettledRef.current = true; rebuildSubtitleList(); maybeInit(); });
      }
      maybeInit();
    }));

    return () => {
      cancelled = true;
      handles.forEach((h) => h.remove());
    };
  }, [rebuildSubtitleList, maybeInit, isLiveHint]);

  // ── Chargement de la source ───────────────────────────────────────────────
  // Au changement d'URL on recharge sans `stop()` (libVLC bascule de média,
  // la surface reste visible → pas de flash entre deux chaînes live).
  useEffect(() => {
    urlRef.current = url;
    // Reset sous-titres React + métadonnées de pistes.
    activeExtractTrackRef.current = null;
    subWindowsRef.current.clear();
    subInflightRef.current.clear();
    subCuesRef.current = [];
    extractorTracksRef.current = [];
    vlcSubTracksRef.current = [];
    subKindRef.current = [];
    firstTracksInitRef.current = false;
    tracksArrivedRef.current = false;
    probeStartedRef.current = false;
    probeSettledRef.current = isLiveHint; // live → pas de sonde → réglé d'emblée
    pendingVlcCurrentRef.current = -1;
    subOffsetRef.current = 0;
    SubtitleExtractor.release().catch(() => {});
    setSubtitleText('');
    setSubtitleLoading(false);
    setSubtitleOffsetState(0);

    if (!url) {
      setStatus('idle');
      return;
    }
    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setDuration(0);
    durationRef.current = 0;
    setIsLive(false);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setSubtitleTracks([]);
    setCurrentSubtitle(-1);
    audioIdsRef.current = [];

    // L'extraction des sous-titres est sondée plus tard, au 1er event `tracks`
    // (libVLC déjà en lecture) — cf. listener — pour ne pas concurrencer la
    // connexion vidéo au démarrage.

    VlcPlayer.load({ url, subStyle: subStyleRef.current }).catch((e) => {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    });
  }, [url, isLiveHint]);

  // Boucle d'affichage + préchargement des fenêtres (mode React uniquement).
  useEffect(() => {
    const id = setInterval(() => {
      const ext = activeExtractTrackRef.current;
      if (ext == null) return;
      const tSec = currentTimeRef.current + subOffsetRef.current;
      const tMs = tSec * 1000;
      const w = winIndex(tSec);
      fetchWindow(ext, w);
      fetchWindow(ext, w + 1);
      const cues = subCuesRef.current;
      let text = '';
      for (let i = 0; i < cues.length; i++) {
        const c = cues[i];
        if (tMs >= c.start && tMs <= c.end) { text = c.text; break; }
        if (c.start > tMs) break; // trié → inutile d'aller plus loin
      }
      setSubtitleText((prev) => (prev === text ? prev : text));
      const haveWindow = subWindowsRef.current.has(w);
      setSubtitleLoading((prev) => {
        const loading = !haveWindow && text === '';
        return prev === loading ? prev : loading;
      });
    }, 150);
    return () => clearInterval(id);
  }, [fetchWindow]);

  // Arrêt + libération de la surface uniquement au démontage du lecteur.
  useEffect(() => {
    return () => {
      VlcPlayer.stop().catch(() => {});
      SubtitleExtractor.release().catch(() => {});
    };
  }, []);

  // ── Restyle des sous-titres NATIFS (libVLC) ───────────────────────────────
  // Ne concerne QUE les sous-titres rendus par libVLC (image/repli) : ceux
  // rendus en React se restylent instantanément côté overlay, sans toucher au
  // moteur. libVLC 3.x ne sait pas restyler à chaud → setSubtitleStyle recharge
  // le média (débounce ~420 ms pour coalescer les réglages enchaînés).
  const subStyleFirstRun = useRef(true);
  const restyleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (subStyleFirstRun.current) { subStyleFirstRun.current = false; return; }
    if (!subStyle) return;
    if (activeExtractTrackRef.current != null) return; // piste React → rien à recharger
    if (restyleTimerRef.current) clearTimeout(restyleTimerRef.current);
    restyleTimerRef.current = setTimeout(() => {
      restyleTimerRef.current = null;
      if (activeExtractTrackRef.current != null) return;
      if (statusRef.current !== 'playing' && statusRef.current !== 'paused') return;
      const s = subStyleRef.current;
      if (!s) return;
      VlcPlayer.setSubtitleStyle(s).catch(() => {});
    }, 420);
    return () => {
      if (restyleTimerRef.current) { clearTimeout(restyleTimerRef.current); restyleTimerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subStyle?.scale, subStyle?.color, subStyle?.bgOpacity]);

  // ── Contrôles ─────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') VlcPlayer.pause().catch(() => {});
    else VlcPlayer.play().catch(() => {});
  }, []);

  const seek = useCallback((time: number) => {
    const clamped = Math.max(0, durationRef.current > 0 ? Math.min(time, durationRef.current) : time);
    currentTimeRef.current = clamped;
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
      subOffsetRef.current = v;
      // Piste React → l'offset décale l'overlay (boucle d'affichage). Piste
      // libVLC → on pilote le délai du moteur.
      if (activeExtractTrackRef.current == null) {
        VlcPlayer.setSubtitleDelay({ delay: v }).catch(() => {});
      }
      return v;
    });
  }, []);

  const setSubtitleOffset = useCallback((value: number) => {
    const v = Math.max(-10, Math.min(10, value));
    subOffsetRef.current = v;
    setSubtitleOffsetState(v);
    if (activeExtractTrackRef.current == null) {
      VlcPlayer.setSubtitleDelay({ delay: v }).catch(() => {});
    }
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
    subtitleText,
    subtitleLoading,
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
    setSubtitle: applySubtitle,
    toggleFullscreen,
    retry,
  };
}
