import { useCallback, useEffect, useRef, useState } from 'react';
import type { PlayerStatus, AudioTrack, SubtitleTrack } from '../types/player.types';
import type { WebPlayerController } from './usePlayer';
import {
  getAvPlay,
  hasAvPlay,
  getTvAudioControl,
  parseTrackLang,
  type AvPlay,
} from '../native/tizenAvplay';

/**
 * Implémentation `PlayerController` pour Samsung Tizen — voir docs/native-port.md
 * §Phase 4c.
 *
 * Pilote le lecteur natif AVPlay (`webapis.avplay`). C'est le pendant de
 * `useNativePlayer` (libVLC/Android) : AVPlay lit TOUT (HLS, MP4, MKV, MPEG-TS)
 * et expose les pistes audio/sous-titres embarquées. La vidéo est rendue sur un
 * plan hardware DERRIÈRE la WebView → `usesNativeSurface = true` et la couche UI
 * (`VideoPlayer`) affiche un `<object type="application/avplayer">` transparent à
 * la place du `<video>`.
 *
 * Différences assumées avec le lecteur web :
 *   - Pas de proxy `/api/*` : l'URL Xtream est lue DIRECTEMENT depuis l'IP de la
 *     TV (plus de blocage 403 d'IP datacenter).
 *   - Sous-titres rendus PAR AVPlay sur le plan vidéo (pas d'overlay React,
 *     pas de `/api/subtitle`) → `subtitleText` reste vide. Le décalage g/h n'est
 *     pas géré par AVPlay (pas d'API publique) → no-op, état conservé pour compat.
 *   - Pas de niveaux de qualité HLS exposés (`levels` vide) — AVPlay fait l'ABR
 *     tout seul.
 *   - Volume = volume SYSTÈME de la TV via `tizen.tvaudiocontrol` (AVPlay n'a
 *     pas de volume propre). Échelle 0..100 ↔ 0..1 côté UI.
 *
 * Le type de retour est `WebPlayerController` pour rester interchangeable avec
 * `usePlayer` ; `videoRef` n'est rattaché à aucun élément (la vidéo vit sur le
 * plan natif), `wrapperRef` reste utilisé par le conteneur.
 */
export function useTizenPlayer(url: string | null, _mediaUrl?: string | null): WebPlayerController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

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

  // Refs lues dans les callbacks / listeners sans dépendances stales.
  const statusRef = useRef<PlayerStatus>('idle');
  const durationRef = useRef(0);
  const urlRef = useRef<string | null>(null);
  // Tables index UI (0-based) → index de piste AVPlay (absolu dans le conteneur).
  const audioIdxRef = useRef<number[]>([]);
  const subIdxRef = useRef<number[]>([]);

  useEffect(() => { statusRef.current = status; }, [status]);

  // ── Transparence : la WebView est rendue transparente pendant la lecture pour
  // laisser voir le plan vidéo AVPlay (même plombing que libVLC). ───────────────
  useEffect(() => {
    document.documentElement.classList.add('iptvax-native-playback');
    return () => { document.documentElement.classList.remove('iptvax-native-playback'); };
  }, []);

  // ── Reflète le volume système courant de la TV au montage ──────────────────
  useEffect(() => {
    const tac = getTvAudioControl();
    if (!tac) return;
    try {
      setVolumeState(Math.max(0, Math.min(1, tac.getVolume() / 100)));
      setIsMuted(tac.isMute());
    } catch { /* privilège tv.audio absent — slider inerte, volume au matériel */ }
  }, []);

  // ── Lecture des pistes audio/sous-titres après prepare ─────────────────────
  const readTracks = useCallback((avplay: AvPlay) => {
    let info: ReturnType<AvPlay['getTotalTrackInfo']> = [];
    try { info = avplay.getTotalTrackInfo(); } catch { return; }

    const audios: AudioTrack[] = [];
    const subs: SubtitleTrack[] = [];
    const audMap: number[] = [];
    const subMap: number[] = [];
    for (const t of info) {
      if (t.type === 'AUDIO') {
        const lang = parseTrackLang(t.extra_info);
        const ui = audios.length;
        audios.push({ index: ui, name: lang || `Audio ${ui + 1}`, language: lang });
        audMap.push(t.index);
      } else if (t.type === 'TEXT') {
        const lang = parseTrackLang(t.extra_info);
        const ui = subs.length;
        subs.push({ index: ui, streamIndex: t.index, name: lang || `Sous-titres ${ui + 1}`, language: lang });
        subMap.push(t.index);
      }
    }
    audioIdxRef.current = audMap;
    subIdxRef.current = subMap;
    setAudioTracks(audios);
    setCurrentAudio(audios.length > 0 ? 0 : -1);
    setSubtitleTracks(subs);
    setCurrentSubtitle(-1);
    // Sous-titres masqués par défaut (l'utilisateur les active via le menu CC).
    try { avplay.setSilentSubtitle(true); } catch { /* */ }
  }, []);

  // ── Démarrage d'une source ─────────────────────────────────────────────────
  const startPlayback = useCallback((src: string) => {
    let avplay: AvPlay;
    try {
      avplay = getAvPlay();
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'AVPlay indisponible');
      return;
    }

    // Teardown d'une éventuelle session précédente (re-open exige stop+close).
    try { avplay.stop(); } catch { /* pas de session active */ }
    try { avplay.close(); } catch { /* idem */ }

    try {
      avplay.open(src);

      avplay.setListener({
        onbufferingstart: () => setStatus('buffering'),
        onbufferingcomplete: () => {
          if (statusRef.current === 'buffering') setStatus('playing');
        },
        oncurrentplaytime: (ms) => setCurrentTime(ms / 1000),
        onstreamcompleted: () => {
          try { avplay.stop(); } catch { /* */ }
          setStatus('paused');
          if (durationRef.current > 0) setCurrentTime(durationRef.current);
        },
        onerror: (eventType) => {
          setStatus('error');
          setError(typeof eventType === 'string' && eventType ? eventType : 'Erreur AVPlay');
        },
        onevent: () => { /* évènements informatifs ignorés */ },
      });

      // Plan d'affichage plein écran en coordonnées logiques de l'app.
      const w = window.innerWidth || 1920;
      const h = window.innerHeight || 1080;
      try { avplay.setDisplayRect(0, 0, w, h); } catch { /* posé après prepare sur certains firmwares */ }
      try { avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch { /* */ }

      // Indice ABR pour les flux HLS (sans effet sur les fichiers directs).
      if (src.includes('.m3u8')) {
        try { avplay.setStreamingProperty('ADAPTIVE_INFO', 'BITRATES=ALL'); } catch { /* */ }
      }

      avplay.prepareAsync(
        () => {
          // Re-tente le display rect ici au cas où l'appel pré-prepare a échoué.
          try { avplay.setDisplayRect(0, 0, w, h); } catch { /* */ }
          readTracks(avplay);
          const durMs = avplay.getDuration();
          if (durMs > 0) {
            durationRef.current = durMs / 1000;
            setDuration(durMs / 1000);
            setIsLive(false);
          } else {
            durationRef.current = 0;
            setDuration(0);
            setIsLive(true);
          }
          try {
            avplay.play();
            setStatus('playing');
          } catch (e) {
            setStatus('error');
            setError(e instanceof Error ? e.message : 'Échec de la lecture');
          }
        },
        (e) => {
          setStatus('error');
          setError(typeof e === 'string' && e ? e : 'Échec de préparation AVPlay');
        },
      );
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'Échec du chargement');
    }
  }, [readTracks]);

  // ── Chargement / changement de source ──────────────────────────────────────
  useEffect(() => {
    urlRef.current = url;
    if (!url) {
      setStatus('idle');
      return;
    }
    if (!hasAvPlay()) {
      setStatus('error');
      setError('AVPlay indisponible (hors shell Tizen ?)');
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
    audioIdxRef.current = [];
    subIdxRef.current = [];
    startPlayback(url);
  }, [url, startPlayback]);

  // Arrêt + libération du plan vidéo au démontage du lecteur.
  useEffect(() => {
    return () => {
      if (!hasAvPlay()) return;
      try {
        const avplay = getAvPlay();
        avplay.stop();
        avplay.close();
      } catch { /* */ }
    };
  }, []);

  // ── Contrôles ──────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (!hasAvPlay()) return;
    const avplay = getAvPlay();
    if (statusRef.current === 'playing') {
      try { avplay.pause(); setStatus('paused'); } catch { /* */ }
    } else {
      try { avplay.play(); setStatus('playing'); } catch { /* */ }
    }
  }, []);

  const seek = useCallback((time: number) => {
    if (!hasAvPlay()) return;
    const clamped = Math.max(0, durationRef.current > 0 ? Math.min(time, durationRef.current) : time);
    setCurrentTime(clamped);
    try { getAvPlay().seekTo(Math.round(clamped * 1000)); } catch { /* */ }
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    setVolumeState(clamped);
    setIsMuted(false);
    const tac = getTvAudioControl();
    if (!tac) return;
    try {
      tac.setMute(false);
      tac.setVolume(Math.round(clamped * 100));
    } catch { /* privilège tv.audio absent */ }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((muted) => {
      const next = !muted;
      const tac = getTvAudioControl();
      if (tac) { try { tac.setMute(next); } catch { /* */ } }
      return next;
    });
  }, []);

  const setLevel = useCallback(() => {
    // AVPlay gère l'ABR HLS lui-même — pas de niveaux exposés, no-op.
  }, []);

  const setAudio = useCallback((index: number) => {
    const trackIdx = audioIdxRef.current[index];
    if (trackIdx === undefined || !hasAvPlay()) return;
    setCurrentAudio(index);
    try { getAvPlay().setSelectTrack('AUDIO', trackIdx); } catch { /* */ }
  }, []);

  const setSubtitle = useCallback((index: number) => {
    if (!hasAvPlay()) return;
    const avplay = getAvPlay();
    if (index < 0) {
      setCurrentSubtitle(-1);
      try { avplay.setSilentSubtitle(true); } catch { /* */ }
      return;
    }
    const trackIdx = subIdxRef.current[index];
    if (trackIdx === undefined) return;
    setCurrentSubtitle(index);
    try {
      avplay.setSelectTrack('TEXT', trackIdx);
      avplay.setSilentSubtitle(false);
    } catch { /* */ }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    // L'app native est déjà plein écran — rien à basculer.
  }, []);

  const retry = useCallback(() => {
    const u = urlRef.current;
    if (!u) return;
    setStatus('loading');
    setError(null);
    startPlayback(u);
  }, [startPlayback]);

  // Décalage des sous-titres : pas d'API AVPlay publique pour les pistes
  // embarquées → état conservé pour compat UI, mais sans effet.
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
    subtitleOffset,
    // AVPlay rend la vidéo sur un plan hardware DERRIÈRE la WebView → la couche
    // UI doit afficher un <object type="application/avplayer"> transparent.
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
