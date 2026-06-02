import { isCapacitor } from './platform';
import { CapacitorHttp } from '@capacitor/core';

/**
 * Couche HTTP bas-niveau — voir docs/native-port.md.
 *
 * - web / Tizen / webOS : `fetch` standard (ou natif sans CORS pour les apps
 *   empaquetées .wgt / .ipk). Les appels web passent par le proxy `/api/*`
 *   same-origin ; les appels Tizen/webOS vont directement aux serveurs Xtream
 *   (les shells packagés n'appliquent pas de restrictions CORS cross-origin).
 * - Capacitor (Android) : `CapacitorHttp` — client HTTP natif Java. Indispensable :
 *   le `fetch` du WebView Android est bloqué par CORS sur les serveurs Xtream,
 *   et `CapacitorHttp` permet de poser un `User-Agent` personnalisé.
 *
 * Le streaming vidéo ne passe PAS par ici : c'est le lecteur natif
 * (libVLC / AVPlay / <video>) qui gère son propre client HTTP.
 */

// UA navigateur pour les appels à player_api.php — même valeur que l'ancien
// proxy /api/xtream.
const NATIVE_API_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

// Les catalogues Xtream peuvent peser plusieurs Mo sur réseau mobile lent.
// Sans timeout explicite, CapacitorHttp (HttpURLConnection Android) et fetch
// peuvent pendre indéfiniment si le réseau stalle en cours de transfert.
// 45 s laisse le temps aux gros catalogues de charger sur 3G tout en bornant
// la durée d'attente (cas de panne réseau silencieuse côté mobile).
const HTTP_TIMEOUT_MS = 45_000;

export async function httpGetJson<T>(url: string, init?: RequestInit): Promise<T> {
  if (isCapacitor) {
    // Android (Capacitor) : le WebView bloque les requêtes cross-origin → on
    // délègue au client HTTP natif Java qui ignore le CORS côté runtime.
    const res = await CapacitorHttp.get({
      url,
      headers: NATIVE_API_HEADERS,
      connectTimeout: HTTP_TIMEOUT_MS,
      readTimeout: HTTP_TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`HTTP ${res.status}`);
    }
    // CapacitorHttp auto-parse le JSON ; selon le content-type renvoyé par le
    // serveur, `data` peut rester une chaîne → on parse alors nous-mêmes.
    return (typeof res.data === 'string' ? JSON.parse(res.data) : res.data) as T;
  }
  // Web / Tizen / webOS : fetch standard.
  // Sur Tizen (.wgt) et webOS (.ipk), les apps empaquetées n'ont pas de
  // restriction CORS — les requêtes Xtream cross-origin passent librement.
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
