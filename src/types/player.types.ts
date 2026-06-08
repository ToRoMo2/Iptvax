/**
 * Types de la couche lecture — voir docs/native-port.md.
 *
 * `PlayerController` est le contrat AGNOSTIQUE de la plateforme : il décrit
 * l'API publique d'un lecteur (état, pistes, contrôles) sans rien supposer du
 * moteur sous-jacent. Implémenté côté web par `usePlayer` (ffmpeg + <video>),
 * et plus tard côté natif par un hook pilotant libVLC. La couche UI ne doit
 * dépendre que de cette interface — jamais d'un détail d'implémentation web.
 */

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
  index: number;        // index 0-based dans la liste UI (après filtrage)
  streamIndex: number;  // index absolu du stream dans le fichier source
  name: string;
  language: string;
}

/** Contrat de lecture agnostique de la plateforme (web ffmpeg ou natif libVLC). */
export interface PlayerController {
  status: PlayerStatus;
  error: string | null;
  isLive: boolean;
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  levels: QualityLevel[];
  currentLevel: number;
  audioTracks: AudioTrack[];
  currentAudio: number;
  subtitleTracks: SubtitleTrack[];
  currentSubtitle: number;
  subtitleText: string;
  subtitleLoading: boolean;
  subtitleOffset: number;
  /**
   * `true` quand la vidéo est rendue par une surface NATIVE (plan hardware sous
   * la WebView) au lieu de l'élément `<video>` HTML5 — cas de libVLC sur
   * Capacitor et de la Media Pipeline webOS. La couche UI doit alors rendre un
   * `<div>` transparent à la place du `<video>` et activer la chaîne CSS
   * `iptvax-native-playback` sur `<html>`. Défaut implicite : `false`.
   */
  usesNativeSurface?: boolean;
  adjustSubtitleOffset: (delta: number) => void;
  setSubtitleOffset: (value: number) => void;
  /**
   * Optionnel — utilisé quand les sous-titres sont rendus par une surface NATIVE
   * (mpv/Electron) : remonte les sous-titres au-dessus de l'overlay des contrôles
   * quand il apparaît (le pendant natif du `.wrapper.showControls .subtitleOverlay`
   * CSS du rendu web). No-op / absent pour les lecteurs qui rendent les sous-titres
   * en React (web) ou nativement à position fixe.
   */
  setSubtitleRaised?: (raised: boolean) => void;
  toggle: () => void;
  seek: (time: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  setLevel: (level: number) => void;
  setAudio: (index: number) => void;
  setSubtitle: (index: number) => void;
  toggleFullscreen: () => Promise<void>;
  retry: () => void;
}
