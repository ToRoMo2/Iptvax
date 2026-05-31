import { registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Interface du plugin natif `VlcPlayer` — voir docs/native-port.md (Phase 2c).
 *
 * Le lecteur natif libVLC (Android) lit le flux directement depuis l'appareil
 * et le rend dans une surface native derrière la WebView. Ce module n'est
 * consommé qu'en mode natif (`isNative`) ; côté web, `usePlayer` reste seul.
 */

/** Piste audio ou sous-titre telle qu'exposée par libVLC (id = id libVLC). */
export interface VlcTrack {
  id: number;
  name: string;
}

export interface VlcStateEvent {
  state: 'idle' | 'loading' | 'buffering' | 'playing' | 'paused' | 'ended' | 'error';
  error?: string;
}

export interface VlcTimeEvent {
  /** Position courante en secondes. */
  position: number;
  /** Durée totale en secondes — 0 pour un flux live. */
  duration: number;
}

export interface VlcTracksEvent {
  audio: VlcTrack[];
  subtitle: VlcTrack[];
  /** id libVLC de la piste audio active. */
  currentAudio: number;
  /** id libVLC de la piste de sous-titres active (-1 = désactivée). */
  currentSubtitle: number;
}

/**
 * Style des sous-titres rendus par libVLC (le rendu natif ne lit pas l'overlay
 * React). Appliqué via media options au chargement.
 */
export interface VlcSubtitleStyle {
  /** Échelle du texte en pourcentage (libVLC sub-text-scale ; 100 = normal). */
  scale: number;
  /** Couleur du texte en RGB entier (0xRRGGBB). */
  color: number;
  /** Opacité du fond 0..255 (0 = transparent). */
  bgOpacity: number;
}

export interface VlcPlayerPlugin {
  /** Charge et démarre une URL de flux (HLS, MKV, MPEG-TS…). */
  load(options: { url: string; subStyle?: VlcSubtitleStyle }): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  /** Arrête la lecture et masque la surface vidéo. */
  stop(): Promise<void>;
  /** Saute à `position` (secondes). */
  seek(options: { position: number }): Promise<void>;
  /** Sélectionne la piste audio par son id libVLC. */
  setAudioTrack(options: { id: number }): Promise<void>;
  /** Sélectionne la piste de sous-titres par son id libVLC (-1 = désactiver). */
  setSubtitleTrack(options: { id: number }): Promise<void>;
  /** Volume 0..1. */
  setVolume(options: { volume: number }): Promise<void>;
  /** Décalage des sous-titres en secondes (positif = sous-titres en avance). */
  setSubtitleDelay(options: { delay: number }): Promise<void>;
  /**
   * Change le style des sous-titres en cours de lecture. libVLC 3.x ne sait pas
   * restyler à chaud → recharge le média à la position courante avec le nouveau
   * style (pistes audio/sous-titres préservées). Bref rechargement (~1s).
   */
  setSubtitleStyle(options: VlcSubtitleStyle): Promise<void>;

  addListener(event: 'state', cb: (e: VlcStateEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'time', cb: (e: VlcTimeEvent) => void): Promise<PluginListenerHandle>;
  addListener(event: 'tracks', cb: (e: VlcTracksEvent) => void): Promise<PluginListenerHandle>;
}

export const VlcPlayer = registerPlugin<VlcPlayerPlugin>('VlcPlayer');
