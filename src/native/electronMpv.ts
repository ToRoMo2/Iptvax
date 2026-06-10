// Pont typé vers le lecteur natif mpv exposé par le preload Electron
// (`window.electron.mpv`, cf. electron/preload.cjs + electron/mpv.cjs).
//
// Pendant Electron de `src/native/nativePlayer.ts` (Media3/Android) : une fine
// couche qui transforme les appels JS en messages IPC et normalise le flux
// d'events mpv. Consommé par `src/hooks/useElectronPlayer.ts`.
//
// Voir docs/native-port.md (dispatch Electron natif) et CLAUDE.md §XI.

import { isElectron } from '../lib/platform';

export interface MpvTrack {
  id: number;
  name: string;
  language: string;
  codec: string;
  selected: boolean;
}

/** Events normalisés émis par le contrôleur mpv (electron/mpv.cjs). */
export type MpvEvent =
  | { type: 'time'; position: number }
  | { type: 'duration'; duration: number }
  | { type: 'state'; state: 'loading' | 'playing' | 'paused' | 'buffering' | 'ended' | 'error'; error?: string }
  | { type: 'tracks'; audio: MpvTrack[]; sub: MpvTrack[]; currentAudio: number; currentSub: number }
  | { type: 'volume'; volume: number }
  | { type: 'mute'; muted: boolean };

export interface MpvLoadOpts {
  /** User-Agent HTTP (live → VLC ; VOD/série → navigateur). */
  userAgent?: string;
  /** En-têtes HTTP supplémentaires (`"Referer: …"`, `"Origin: …"`). */
  headers?: string[];
}

// ── Disponibilité (résolue une fois au boot, comme isTvDevice) ────────────────
// mpv est embarqué dans l'app (extraResources) → présent en prod ; ce flag
// retombe à `false` si le binaire manque (install corrompu) → repli proxy ffmpeg.
let ready = false;

export async function initElectronMpv(): Promise<void> {
  if (!isElectron || !window.electron) {
    ready = false;
    return;
  }
  try {
    ready = await window.electron.mpv.available();
  } catch {
    ready = false;
  }
}

/** `true` si le lecteur natif mpv est utilisable (Electron + binaire présent). */
export function isElectronMpvReady(): boolean {
  return ready;
}

function call(method: string, ...args: unknown[]): Promise<void> {
  if (!isElectron || !window.electron) return Promise.resolve();
  return window.electron.mpv.call(method, args).then(() => undefined);
}

export const electronMpv = {
  load: (url: string, opts?: MpvLoadOpts) => call('load', url, opts ?? {}),
  play: () => call('play'),
  pause: () => call('pause'),
  seek: (time: number) => call('seek', time),
  setVolume: (v: number) => call('setVolume', v),
  setMute: (m: boolean) => call('setMute', m),
  setAudio: (id: number) => call('setAudio', id),
  setSubtitle: (id: number) => call('setSubtitle', id),
  setSubScale: (scale: number) => call('setSubScale', scale),
  setSubColor: (hex: string) => call('setSubColor', hex),
  setSubBackColor: (rgba: string) => call('setSubBackColor', rgba),
  setSubBold: (on: boolean) => call('setSubBold', on),
  setSubPos: (pos: number) => call('setSubPos', pos),
  setSubDelay: (sec: number) => call('setSubDelay', sec),
  stop: () => call('stop'),
  /** Abonnement au flux d'events. Renvoie un unsubscribe. */
  onEvent: (handler: (ev: MpvEvent) => void): (() => void) => {
    if (!isElectron || !window.electron) return () => {};
    return window.electron.mpv.onEvent((ev) => handler(ev as MpvEvent));
  },
};
