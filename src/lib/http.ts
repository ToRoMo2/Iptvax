/**
 * Couche HTTP bas-niveau — voir docs/native-port.md.
 *
 * Sur web, `fetch` standard suffit : les appels passent par le proxy `/api/*`
 * same-origin, donc pas de CORS. Sur les shells natifs, les appels Xtream sont
 * DIRECTS et cross-origin — le `fetch` du WebView serait bloqué par CORS et ne
 * peut pas poser de `User-Agent`. Chaque shell natif remplacera donc cette
 * implémentation par un client HTTP natif (plugin Capacitor HTTP, module `net`
 * d'Electron, XHR privilégié Tizen/webOS).
 *
 * Phase 1 : implémentation web uniquement. Le point de bascule natif est
 * volontairement isolé ici pour que les shells n'aient qu'UN fichier à fournir.
 */
export async function httpGetJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
