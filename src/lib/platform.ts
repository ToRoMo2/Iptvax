/**
 * Mode d'exécution de l'application — voir docs/native-port.md.
 *
 * - `web`       : app servie dans un navigateur, avec le backend proxy `/api/*`
 *                 co-localisé (modèle historique). Le proxy fait tourner ffmpeg
 *                 et relaie les requêtes Xtream — toute la lecture transite par
 *                 le serveur. C'est le mode du SITE VITRINE.
 * - `capacitor` : app empaquetée Capacitor (Android phone & tablette, Android
 *                 TV). Lecteur natif libVLC, HTTP via `CapacitorHttp`.
 * - `tizen`     : app empaquetée Samsung Tizen (.wgt). Lecteur natif AVPlay
 *                 (`webapis.avplay`), HTTP via `fetch` (le shell wgt n'a pas
 *                 de CORS).
 * - `webos`     : app empaquetée LG webOS (.ipk). Lecteur natif `<video>` HTML5
 *                 (éventuellement Media Pipeline plus tard), HTTP via `fetch`.
 *
 * Les trois modes natifs (`capacitor`/`tizen`/`webos`) partagent la même
 * propriété fondamentale : PAS de backend proxy — l'app parle DIRECTEMENT aux
 * serveurs Xtream depuis l'IP de l'utilisateur, ce qui élimine les blocages
 * d'IP datacenter et permet de scaler sans serveur de streaming.
 *
 * Le mode est figé au build via `VITE_RUNTIME` (défaut : `web`). Chaque shell
 * natif construit le bundle avec sa propre valeur :
 *   - Capacitor (Android)  → `VITE_RUNTIME=capacitor`
 *   - Tizen (Samsung TV)   → `VITE_RUNTIME=tizen`
 *   - webOS (LG TV)        → `VITE_RUNTIME=webos`
 *   - Electron (Windows)   → laissé en `web` (Option B : proxy local embarqué).
 */
export type RuntimeMode = 'web' | 'capacitor' | 'tizen' | 'webos';

const RAW_RUNTIME = import.meta.env.VITE_RUNTIME;

export const runtimeMode: RuntimeMode =
  RAW_RUNTIME === 'capacitor' || RAW_RUNTIME === 'tizen' || RAW_RUNTIME === 'webos'
    ? RAW_RUNTIME
    : 'web';

/** `true` dans tous les shells empaquetés (Capacitor / Tizen / webOS).
 *
 *  Sémantique : pas de backend proxy, appels Xtream directs, URLs de stream
 *  directes (pas de `/api/*`). Bascule data layer partagée par les 3 cibles.
 *
 *  ⚠ FAUX en Electron : on a choisi l'Option B (proxy local embarqué) → l'app
 *  Electron tourne exactement en mode `web` (cf. CLAUDE.md §XI Phase 3a). Pour
 *  une bascule spécifique Electron (ex. OAuth via navigateur système), utiliser
 *  `isElectron` plutôt que `isNative`. */
export const isNative = runtimeMode !== 'web';

/** `true` pour le site web (vitrine + lecture via le proxy `/api/*`). */
export const isWeb = runtimeMode === 'web';

/** Sous-mode natif Capacitor (Android phone/tablette/TV). Lecteur libVLC,
 *  HTTP via `CapacitorHttp`, OAuth via deep link. */
export const isCapacitor = runtimeMode === 'capacitor';

/** Sous-mode natif Samsung Tizen. Lecteur AVPlay, HTTP via `fetch`. */
export const isTizen = runtimeMode === 'tizen';

/** Sous-mode natif LG webOS. Lecteur `<video>` HTML5, HTTP via `fetch`. */
export const isWebOS = runtimeMode === 'webos';

/** Pont préload Electron — exposé par `electron/preload.cjs`. Présent UNIQUEMENT
 *  dans l'app Electron empaquetée ; absent sur le site web et dans les shells
 *  natifs (Capacitor / Tizen / webOS). */
declare global {
  interface Window {
    electron?: {
      openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
      onAuthCallback: (handler: (url: string) => void) => () => void;
    };
  }
}

/** `true` quand l'app tourne dans le shell Electron (détection runtime via le
 *  preload). Sert au branchement OAuth « navigateur système » — l'app reste
 *  en mode `web` (`isNative=false`), seul ce point précis diverge. */
export const isElectron = typeof window !== 'undefined' && !!window.electron;
