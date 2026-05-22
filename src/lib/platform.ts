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

/** `true` dans les apps empaquetées (Capacitor / Electron / Tizen / webOS). */
export const isNative = runtimeMode === 'native';

/** `true` pour le site web (vitrine + lecture via le proxy `/api/*`). */
export const isWeb = runtimeMode === 'web';
