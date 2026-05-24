/**
 * Pont Luna Service Bus pour LG webOS — voir docs/native-port.md §Phase 4e.
 *
 * Les apps natives webOS communiquent avec les services système (`luna://…`)
 * via l'objet global `PalmServiceBridge` injecté par le shell webOS. Chaque
 * instance de bridge fait un appel (one-shot ou subscribe) ; on enveloppe ça
 * pour exposer une API Promise + flux d'updates côté TypeScript.
 *
 * Documentation officielle :
 *   https://webostv.developer.lge.com/develop/references/luna-service-introduction
 *
 * Pourquoi `PalmServiceBridge` plutôt que `webOSTV.js` :
 *   - `PalmServiceBridge` est globalement présent dans toute app webOS native
 *     (zéro dépendance) ;
 *   - `webOSTV.js` est une lib externe à bundler (~30 KB) qui n'apporte qu'un
 *     wrapper trivial. On préfère économiser le poids du bundle.
 *
 * Ce module est PUREMENT natif webOS : tous les appels supposent
 * `isWebOS === true`. Sur web/Capacitor/Tizen, `PalmServiceBridge` est absent
 * → `lunaRequest` lève immédiatement.
 */

interface PalmServiceBridge {
  onservicecallback: ((msg: string) => void) | null;
  call(uri: string, params: string): void;
  cancel(): void;
}

interface LunaResponseBase {
  returnValue?: boolean;
  errorText?: string;
  errorCode?: number;
  subscribed?: boolean;
}

export type LunaResponse<T = Record<string, unknown>> = LunaResponseBase & T;

declare global {
  interface Window {
    PalmServiceBridge?: new () => PalmServiceBridge;
  }
}

function getBridge(): PalmServiceBridge {
  const Ctor = window.PalmServiceBridge;
  if (!Ctor) throw new Error('PalmServiceBridge indisponible (hors shell webOS ?)');
  return new Ctor();
}

/**
 * Appel one-shot à un service Luna.
 *
 * @param service  URI du service, ex. "luna://com.webos.media"
 * @param method   Nom de la méthode, ex. "load"
 * @param params   Payload JSON-sérialisable
 * @returns        Promise résolue avec la réponse, rejetée si `returnValue === false`
 */
export function lunaRequest<T = Record<string, unknown>>(
  service: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<LunaResponse<T>> {
  return new Promise<LunaResponse<T>>((resolve, reject) => {
    let bridge: PalmServiceBridge;
    try {
      bridge = getBridge();
    } catch (e) {
      reject(e);
      return;
    }
    let done = false;
    bridge.onservicecallback = (msg: string) => {
      if (done) return;
      done = true;
      let data: LunaResponse<T>;
      try {
        data = JSON.parse(msg) as LunaResponse<T>;
      } catch {
        reject(new Error(`Luna ${service}/${method} : réponse non-JSON`));
        bridge.cancel();
        return;
      }
      if (data.returnValue === false) {
        reject(new Error(data.errorText || `Luna ${service}/${method} : échec`));
      } else {
        resolve(data);
      }
      bridge.cancel();
    };
    bridge.call(`${service}/${method}`, JSON.stringify(params));
  });
}

/**
 * Abonnement à un service Luna (`subscribe: true`).
 *
 * Le callback `onUpdate` est invoqué pour CHAQUE message reçu — pas seulement
 * le premier. Appeler `.cancel()` libère le bridge et stoppe le flux.
 *
 * @param onError  Optionnel : appelé pour chaque message avec `returnValue === false`.
 *                 Les erreurs intermittentes (ex. piste momentanément indispo)
 *                 ne doivent pas arrêter la souscription.
 */
export interface LunaSubscription {
  cancel(): void;
}

export function lunaSubscribe<T = Record<string, unknown>>(
  service: string,
  method: string,
  params: Record<string, unknown>,
  onUpdate: (res: LunaResponse<T>) => void,
  onError?: (err: Error) => void,
): LunaSubscription {
  let bridge: PalmServiceBridge | null;
  try {
    bridge = getBridge();
  } catch (e) {
    onError?.(e as Error);
    return { cancel: () => {} };
  }
  let cancelled = false;
  bridge.onservicecallback = (msg: string) => {
    if (cancelled) return;
    let data: LunaResponse<T>;
    try {
      data = JSON.parse(msg) as LunaResponse<T>;
    } catch {
      onError?.(new Error('Luna réponse non-JSON'));
      return;
    }
    if (data.returnValue === false) {
      onError?.(new Error(data.errorText || 'Luna update : échec'));
      return;
    }
    onUpdate(data);
  };
  bridge.call(`${service}/${method}`, JSON.stringify({ ...params, subscribe: true }));
  return {
    cancel: () => {
      cancelled = true;
      bridge?.cancel();
      bridge = null;
    },
  };
}

/** `true` si l'app tourne dans un shell qui expose `PalmServiceBridge`. */
export function hasLunaBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.PalmServiceBridge === 'function';
}
