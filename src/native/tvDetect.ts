import { registerPlugin } from '@capacitor/core';
import { isCapacitor, isTizen, isWebOS } from '../lib/platform';

/**
 * Détection du type d'appareil natif : TV vs téléphone/tablette.
 *
 * - **Capacitor (Android)** : le même APK s'installe sur les deux (téléphone
 *   ET box Android TV) → la distinction est faite au runtime par le plugin
 *   natif `TvDetect` (android/.../TvDetectPlugin.java) qui interroge
 *   `UiModeManager.UI_MODE_TYPE_TELEVISION`.
 * - **Tizen / webOS** : ce sont des plateformes EXCLUSIVEMENT TV → `true`
 *   constant, sans appel plugin.
 * - **Web** : toujours `false` → web et site vitrine strictement inchangés.
 *
 * Sur une TV, l'app affiche l'écran d'appairage par QR code à la place du
 * formulaire de connexion (Phase 2f — voir docs/native-port.md §4).
 */
interface TvDetectPlugin {
  isTv(): Promise<{ isTv: boolean }>;
}

const TvDetect = registerPlugin<TvDetectPlugin>('TvDetect');

let resolved = false;

/**
 * Résout le type d'appareil une seule fois, au démarrage (`main.tsx`). En web
 * c'est instantané (court-circuit). En Tizen/webOS c'est instantané aussi (par
 * définition TV). En Capacitor, un appel plugin de quelques ms.
 */
export async function initTvDetection(): Promise<void> {
  // Tizen et webOS sont des plateformes TV par construction → pas besoin
  // d'interroger l'OS.
  if (isTizen || isWebOS) {
    resolved = true;
    return;
  }
  // Capacitor : Android phone OU Android TV — on demande à l'OS.
  if (!isCapacitor) return;
  try {
    const res = await TvDetect.isTv();
    resolved = res.isTv === true;
  } catch {
    // Plugin absent ou erreur → repli sûr : considéré comme non-TV
    // (l'utilisateur retombe sur le formulaire de connexion classique).
    resolved = false;
  }
}

/** `true` sur une box Android TV / Tizen / webOS. Toujours `false` en web. */
export function isTvDevice(): boolean {
  return resolved;
}
