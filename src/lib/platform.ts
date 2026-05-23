/**
 * Mode d'exécution de l'application — voir docs/native-port.md.
 *
 * - `web`    : app servie dans un navigateur, avec le backend proxy `/api/*`
 *              co-localisé (modèle historique). Le proxy fait tourner ffmpeg
 *              et relaie les requêtes Xtream — toute la lecture transite par
 *              le serveur. C'est le mode du SITE VITRINE.
 * - `native` : app empaquetée (Capacitor Android / Android TV, Electron
 *              Windows, Tizen, webOS). PAS de backend proxy : l'app parle
 *              DIRECTEMENT aux serveurs Xtream depuis l'appareil de
 *              l'utilisateur (son IP) et lit les flux via un lecteur natif.
 *              C'est ce qui élimine les blocages d'IP datacenter et permet de
 *              scaler sans serveur de streaming.
 *
 * Le mode est figé au build via `VITE_RUNTIME` (défaut : `web`). Chaque shell
 * natif construit le bundle avec `VITE_RUNTIME=native`.
 */
export type RuntimeMode = 'web' | 'native';

export const runtimeMode: RuntimeMode =
  import.meta.env.VITE_RUNTIME === 'native' ? 'native' : 'web';

/** `true` dans les apps empaquetées (Capacitor / Tizen / webOS).
 *
 *  ⚠ FAUX en Electron : on a choisi l'Option B (proxy local embarqué) → l'app
 *  Electron tourne exactement en mode `web` (cf. CLAUDE.md §XI Phase 3a). Pour
 *  une bascule spécifique Electron (ex. OAuth via navigateur système), utiliser
 *  `isElectron` plutôt que `isNative`. */
export const isNative = runtimeMode === 'native';

/** `true` pour le site web (vitrine + lecture via le proxy `/api/*`). */
export const isWeb = runtimeMode === 'web';

/** Pont préload Electron — exposé par `electron/preload.cjs`. Présent UNIQUEMENT
 *  dans l'app Electron empaquetée ; absent sur le site web et dans Capacitor. */
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
