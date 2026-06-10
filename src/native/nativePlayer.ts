import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Interface du plugin natif `NativePlayer` — lecteur AndroidX Media3 (ExoPlayer).
 * Remplace l'ancien plugin libVLC (`VlcPlayer`). Voir docs/native-port.md.
 *
 * Différence clé avec libVLC : Media3 émet les cues sous-titres TEXTE en direct
 * (event `cues`) → on les rend dans l'overlay React (restyle/switch instantanés).
 * Le plugin ne porte donc PLUS de style de sous-titres ni de reload de restyle.
 *
 * Ce module n'est consommé qu'en mode natif Capacitor (`isCapacitor`) ; côté web
 * c'est `usePlayer` (ffmpeg /api/*) et sur desktop `useElectronPlayer` (mpv).
 */

export interface NativeAudioTrack {
  index: number;
  name: string;
  language: string;
}

export interface NativeSubtitleTrack {
  index: number;
  name: string;
  language: string;
  /**
   * `true` = sous-titre TEXTE (rendu dans l'overlay React, restyle instantané) ;
   * `false` = sous-titre IMAGE (PGS/VobSub/DVB, rendu nativement par la
   * SubtitleView — non restylable, l'offset React ne s'applique pas).
   */
  isText?: boolean;
}

/** Niveau de qualité vidéo (HLS) exposé par Media3 (ABR débrayable). */
export interface NativeQualityLevel {
  index: number;
  label: string;
  bitrate: number;
}

export interface NativeStateEvent {
  state: 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
  error?: string;
}

export interface NativeTimeEvent {
  /** Position courante en secondes. */
  position: number;
  /** Durée totale en secondes — 0 pour un flux live. */
  duration: number;
  /** Fin du buffer en secondes (pour la barre de progression). */
  buffered: number;
}

export interface NativeTracksEvent {
  audio: NativeAudioTrack[];
  subtitle: NativeSubtitleTrack[];
  levels: NativeQualityLevel[];
  /** index UI de la piste audio active (-1 = aucune). */
  currentAudio: number;
  /** index UI de la piste de sous-titres active (-1 = désactivée). */
  currentSubtitle: number;
  /** index UI du niveau de qualité verrouillé (-1 = ABR auto). */
  currentLevel: number;
}

/** Groupe de cues sous-titre émis par Media3 (rendu par l'overlay React). */
export interface NativeCuesEvent {
  /** Temps de présentation du groupe en ms (-1 si inconnu). */
  startMs: number;
  /** Texte (lignes jointes par \n) ; chaîne vide = aucun sous-titre actif. */
  text: string;
}

export interface NativePlayerPlugin {
  /** Charge et démarre une URL de flux directe (HLS, MKV, MP4, MPEG-TS…). */
  load(options: { url: string; isLive?: boolean }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Arrête la lecture et masque la surface vidéo. */
  stop(): Promise<void>;
  /** Saute à `position` (secondes). */
  seek(options: { position: number }): Promise<void>;
  /** Sélectionne la piste audio par son index UI. */
  setAudioTrack(options: { index: number }): Promise<void>;
  /** Sélectionne la piste de sous-titres par son index UI (-1 = désactiver). */
  setSubtitleTrack(options: { index: number }): Promise<void>;
  /** Verrouille un niveau de qualité vidéo par index UI (-1 = ABR auto). */
  setVideoQuality(options: { index: number }): Promise<void>;
  /** Volume 0..1. */
  setVolume(options: { volume: number }): Promise<void>;
  /** Ré-émet l'état courant (tracks + time) — rattrape le composant React remontant. */
  syncState(): Promise<void>;
  /** Bascule le mode d'aspect ratio : 'fit' = letterbox, 'fill' = recadrage plein écran. */
  setAspectRatio(options: { mode: 'fit' | 'fill' }): Promise<void>;

  addListener(event: 'state', cb: (e: NativeStateEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'time', cb: (e: NativeTimeEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tracks', cb: (e: NativeTracksEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'cues', cb: (e: NativeCuesEvent) => void): Promise<PluginListenerHandle>;
}

export const NativePlayer = registerPlugin<NativePlayerPlugin>('NativePlayer');
