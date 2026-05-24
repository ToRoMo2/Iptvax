/**
 * Media Pipeline LG webOS — voir docs/native-port.md §Phase 4e.
 *
 * Enveloppe le service `luna://com.webos.media` (alias uMediaServer) qui pilote
 * GStreamer côté système. C'est l'API native de lecture vidéo bas-niveau de la
 * TV — l'équivalent de libVLC côté Android.
 *
 * Pourquoi cette couche au lieu du `<video>` HTML5 :
 *   - `<video>` sur webOS ne renvoie PAS les pistes audio/sous-titres
 *     embarquées dans les MKV/MP4 (le démuxeur GStreamer décode mais
 *     n'expose rien à Chromium via `audioTracks` / `textTracks`).
 *   - La Media Pipeline expose toutes les pistes via les events `sourceInfo`,
 *     et offre `selectTrack` pour basculer audio/sous-titres à chaud sans
 *     interruption de lecture.
 *
 * Couplage avec la transparence WebView : les frames sont rendues sur un plan
 * hardware DERRIÈRE la WebView (similaire au mécanisme libVLC sur Android).
 * Le hook consommateur (`useWebOSPlayer`) doit poser la classe
 * `iptvax-native-playback` sur `<html>` pendant la lecture pipeline pour que
 * la chaîne web devienne transparente et laisse voir la vidéo.
 *
 * ⚠ L'API exacte de `luna://com.webos.media` n'est pas figée entre versions
 * webOS : les noms de champs varient (ex. `position` en ms vs s). Toute
 * divergence observée à l'exécution se règle ici sans toucher au hook.
 */

import { lunaRequest, lunaSubscribe, type LunaSubscription, hasLunaBridge } from './webosLuna';

const MEDIA_SERVICE = 'luna://com.webos.media';

/** Type de piste exposée par la pipeline. */
export type MediaTrackType = 'audio' | 'video' | 'text';

export interface MediaTrack {
  type: MediaTrackType;
  index: number;
  language?: string;
  description?: string;
  /** Vrai uniquement pour la piste actuellement sélectionnée par la pipeline. */
  selected?: boolean;
}

export interface MediaStateUpdate {
  mediaId?: string;
  /** État de lecture brut renvoyé par la pipeline. */
  state?: 'load' | 'loaded' | 'playing' | 'paused' | 'ended' | 'error' | 'unloaded' | string;
  /** Position courante en SECONDES (la pipeline renvoie en ms — on convertit ici). */
  currentTime?: number;
  /** Durée en SECONDES. */
  duration?: number;
  /** Liste de pistes (présent uniquement sur l'event `sourceInfo`). */
  tracks?: MediaTrack[];
  /** Message d'erreur si `state === 'error'`. */
  errorText?: string;
}

/** Transport media (correspond à `mediaTransportType` côté Luna). */
export type MediaTransport = 'URI' | 'HLS' | 'DASH' | 'WIDEVINE';

export interface MediaLoadOptions {
  /** Fenêtre d'affichage de la vidéo en pixels (défaut : plein écran 1920×1080). */
  displayWindow?: { x: number; y: number; width: number; height: number };
  /** Override de l'appId envoyé à la pipeline (défaut : celui de l'app). */
  appId?: string;
}

/**
 * Charge une source dans la pipeline et retourne son `mediaId`.
 *
 * @param uri        URL HTTP(S) du média (m3u8, mkv, mp4, ts…)
 * @param transport  Type de transport — défaut `URI` (fichier direct).
 *                   `HLS` active la logique adaptive bitrate côté pipeline.
 */
async function load(
  uri: string,
  transport: MediaTransport = 'URI',
  opts: MediaLoadOptions = {},
): Promise<string> {
  const appId = opts.appId ?? 'com.iptvax.app';
  const win = opts.displayWindow ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const res = await lunaRequest<{ mediaId: string }>(MEDIA_SERVICE, 'load', {
    uri,
    type: 'media',
    payload: {
      mediaTransportType: transport,
      option: {
        appId,
        windowId: '_Window_Id_1',
        // Le shell donne un plan vidéo par défaut ; setDisplayWindow ci-dessous
        // est appelé séparément après le load.
        videoStreamInfo: { type: 'video' },
        audioStreamInfo: { type: 'audio' },
      },
    },
  });
  if (!res.mediaId) throw new Error('Media Pipeline : load sans mediaId');
  // Position immédiate sur le plan vidéo plein écran (ou la zone demandée).
  await setDisplayWindow(res.mediaId, win).catch(() => {/* non bloquant */});
  return res.mediaId;
}

async function unload(mediaId: string): Promise<void> {
  await lunaRequest(MEDIA_SERVICE, 'unload', { mediaId });
}

async function play(mediaId: string): Promise<void> {
  await lunaRequest(MEDIA_SERVICE, 'play', { mediaId });
}

async function pause(mediaId: string): Promise<void> {
  await lunaRequest(MEDIA_SERVICE, 'pause', { mediaId });
}

/** Seek en SECONDES (converti en ms pour la pipeline). */
async function seek(mediaId: string, positionSec: number): Promise<void> {
  const ms = Math.max(0, Math.round(positionSec * 1000));
  await lunaRequest(MEDIA_SERVICE, 'seek', { mediaId, position: ms });
}

/** Volume normalisé 0..1 (converti en 0..100 pour la pipeline). */
async function setVolume(mediaId: string, volume: number): Promise<void> {
  const v = Math.max(0, Math.min(100, Math.round(volume * 100)));
  await lunaRequest(MEDIA_SERVICE, 'setVolume', { mediaId, volume: v });
}

async function setMuted(mediaId: string, muted: boolean): Promise<void> {
  await lunaRequest(MEDIA_SERVICE, 'setMuted', { mediaId, muted });
}

/**
 * Bascule la piste audio ou sous-titres.
 *
 * @param type   `audio` ou `text` (jamais `video` côté UI — l'ABR HLS s'en charge).
 * @param index  Index 0-based dans la liste des pistes du type donné, telle que
 *               renvoyée par l'event `sourceInfo`. `-1` désactive (sous-titres).
 */
async function selectTrack(mediaId: string, type: MediaTrackType, index: number): Promise<void> {
  await lunaRequest(MEDIA_SERVICE, 'selectTrack', { mediaId, type, index });
}

/** Positionne la fenêtre de rendu de la vidéo (plan hardware). */
async function setDisplayWindow(
  mediaId: string,
  window: { x: number; y: number; width: number; height: number },
): Promise<void> {
  await lunaRequest(MEDIA_SERVICE, 'setDisplayWindow', {
    mediaId,
    destination: window,
    fullScreen: false,
  });
}

/**
 * Souscrit aux updates d'état de la pipeline pour un `mediaId`.
 *
 * Émet à chaque changement d'état, à chaque tick de position, et quand la
 * table des pistes change (`sourceInfo`). Les valeurs temporelles sont
 * converties en secondes pour rester homogènes avec `PlayerController`.
 */
function subscribe(
  mediaId: string,
  onUpdate: (s: MediaStateUpdate) => void,
  onError?: (e: Error) => void,
): LunaSubscription {
  return lunaSubscribe<MediaStateUpdate & {
    position?: number;
    durationMs?: number;
    sourceInfo?: { tracks?: MediaTrack[] };
  }>(
    MEDIA_SERVICE,
    'subscribe',
    { mediaId },
    (res) => {
      const update: MediaStateUpdate = {
        mediaId,
        state: res.state,
        errorText: res.errorText,
      };
      if (typeof res.currentTime === 'number') update.currentTime = res.currentTime / 1000;
      else if (typeof res.position === 'number') update.currentTime = res.position / 1000;
      if (typeof res.duration === 'number') update.duration = res.duration / 1000;
      else if (typeof res.durationMs === 'number') update.duration = res.durationMs / 1000;
      if (res.tracks) update.tracks = res.tracks;
      else if (res.sourceInfo?.tracks) update.tracks = res.sourceInfo.tracks;
      onUpdate(update);
    },
    onError,
  );
}

export const WebOSMedia = {
  isAvailable: hasLunaBridge,
  load,
  unload,
  play,
  pause,
  seek,
  setVolume,
  setMuted,
  selectTrack,
  setDisplayWindow,
  subscribe,
};
