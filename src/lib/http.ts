import { isNative } from './platform';
import { CapacitorHttp } from '@capacitor/core';

/**
 * Couche HTTP bas-niveau — voir docs/native-port.md.
 *
 * - web    : `fetch` standard. Les appels passent par le proxy `/api/*`
 *            same-origin → pas de CORS.
 * - native : `CapacitorHttp` — client HTTP natif. Indispensable : les appels
 *            Xtream sont DIRECTS et cross-origin (le `fetch` du WebView serait
 *            bloqué par CORS) et il faut pouvoir poser un `User-Agent` que les
 *            serveurs Xtream attendent.
 *
 * Le streaming vidéo, lui, ne passe PAS par ici : c'est le lecteur natif
 * (libVLC, Phase 2c) qui gère son propre client HTTP.
 */

// UA navigateur pour les appels à player_api.php — même valeur que l'ancien
// proxy /api/xtream.
const NATIVE_API_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

export async function httpGetJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (isNative) {
    const res = await CapacitorHttp.get({ url, headers: NATIVE_API_HEADERS });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
    // CapacitorHttp auto-parse le JSON ; selon le content-type renvoyé par le
    // serveur, `data` peut rester une chaîne → on parse alors nous-mêmes.
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
  }
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
