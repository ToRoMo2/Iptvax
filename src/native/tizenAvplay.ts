/**
 * Typings + helpers minimaux pour Samsung Tizen AVPlay — voir
 * docs/native-port.md §Phase 4c.
 *
 * AVPlay (`webapis.avplay`) est le lecteur média natif des TV Samsung : il lit
 * tous les conteneurs/codecs (HLS, DASH, MP4, MKV, MPEG-TS…) et expose les
 * pistes audio/sous-titres embarquées — l'équivalent logique de libVLC côté
 * Android. La vidéo est rendue sur un PLAN HARDWARE derrière la WebView (comme
 * libVLC) : la chaîne web doit être transparente (`iptvax-native-playback`).
 *
 * Sur une TV Samsung, `window.webapis` et `window.tizen` sont injectés
 * automatiquement par le runtime web pour les apps empaquetées (.wgt). Le build
 * Tizen ajoute en plus `<script src="$WEBAPIS/webapis/webapis.js">` (cf.
 * scripts/build-tizen.mjs) comme filet de sécurité. Ce module est PUREMENT natif
 * Tizen : tous les appels supposent `isTizen === true`. Sur web/Capacitor/webOS,
 * `webapis.avplay` est absent → `getAvPlay()` lève immédiatement.
 *
 * Documentation officielle :
 *   https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html
 */

export type AvPlayState = 'NONE' | 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED';
export type AvTrackType = 'VIDEO' | 'AUDIO' | 'TEXT';

/** Une entrée de `getTotalTrackInfo()`. `extra_info` est une chaîne JSON dont
 *  les clés varient selon la version de Tizen (langue sous `language`,
 *  `track_lang` ou `lang`). */
export interface AvTrackInfo {
  index: number;
  type: AvTrackType;
  extra_info: string;
}

/** Callbacks passés à `setListener`. Tous optionnels. */
export interface AvPlayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  /** Position courante en MILLISECONDES — émis ~1×/s pendant la lecture. */
  oncurrentplaytime?: (currentTime: number) => void;
  onstreamcompleted?: () => void;
  onerror?: (eventType: string) => void;
  onevent?: (eventType: string, eventData: string) => void;
  /** Sous-titres délégués au JS (rare ; AVPlay rend nativement la plupart des
   *  pistes TEXT embarquées sur le plan vidéo). */
  onsubtitlechange?: (duration: number, text: string, type: number, attriCount: number, attributes: unknown) => void;
  ondrmevent?: (drmEvent: string, drmData: unknown) => void;
}

export interface AvPlay {
  /** Définit la source. Passe l'état à IDLE. */
  open(url: string): void;
  /** Libère toutes les ressources. Passe l'état à NONE. */
  close(): void;
  prepare(): void;
  prepareAsync(onSuccess: () => void, onError: (e: unknown) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(milliseconds: number, onSuccess?: () => void, onError?: (e: unknown) => void): void;
  /** Position courante en millisecondes. */
  getCurrentTime(): number;
  /** Durée totale en millisecondes — 0 pour un flux live. */
  getDuration(): number;
  getState(): AvPlayState;
  setListener(listener: AvPlayListener): void;
  /** Rectangle d'affichage en coordonnées logiques de l'app (1920×1080). */
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: string): void;
  getTotalTrackInfo(): AvTrackInfo[];
  setSelectTrack(type: AvTrackType, index: number): void;
  setStreamingProperty(type: string, value: string): void;
  /** `true` masque la piste de sous-titres rendue nativement. */
  setSilentSubtitle(silent: boolean): void;
  setExternalSubtitlePath(path: string): void;
  suspend(): void;
  restore(url?: string): void;
}

/** Contrôle du volume SYSTÈME de la TV (AVPlay n'expose pas de volume propre).
 *  Échelle entière 0..100. Nécessite le privilège `http://tizen.org/privilege/tv.audio`. */
interface TvAudioControl {
  getVolume(): number;
  setVolume(volume: number): void;
  setVolumeUp(): void;
  setVolumeDown(): void;
  setMute(mute: boolean): void;
  isMute(): boolean;
}

declare global {
  interface Window {
    webapis?: { avplay?: AvPlay };
    tizen?: { tvaudiocontrol?: TvAudioControl };
  }
}

export function getAvPlay(): AvPlay {
  const a = typeof window !== 'undefined' ? window.webapis?.avplay : undefined;
  if (!a) throw new Error('webapis.avplay indisponible (hors shell Tizen ?)');
  return a;
}

/** `true` si l'app tourne dans un shell exposant `webapis.avplay`. */
export function hasAvPlay(): boolean {
  return typeof window !== 'undefined' && !!window.webapis?.avplay;
}

export function getTvAudioControl(): TvAudioControl | null {
  return (typeof window !== 'undefined' && window.tizen?.tvaudiocontrol) || null;
}

/** Extrait le code langue d'une chaîne `extra_info` (clés variables selon Tizen). */
export function parseTrackLang(extraInfo: string): string {
  try {
    const o = JSON.parse(extraInfo) as Record<string, unknown>;
    const lang = o.language ?? o.track_lang ?? o.lang ?? '';
    return typeof lang === 'string' ? lang.trim() : '';
  } catch {
    return '';
  }
}
