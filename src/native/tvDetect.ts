import { registerPlugin } from '@capacitor/core';
import { isNative } from '../lib/platform';

/**
 * Détection du type d'appareil natif : box Android TV vs téléphone/tablette.
 *
 * Le même APK s'installe sur les deux → la distinction est faite au runtime
 * par le plugin natif `TvDetect` (android/.../TvDetectPlugin.java). Sur une
 * TV, l'app affiche l'écran d'appairage par QR code à la place du formulaire
 * de connexion (Phase 2f — voir docs/native-port.md §4).
 *
 * Hors mode natif (web), c'est TOUJOURS `false` → web et app mobile inchangés.
 */
interface TvDetectPlugin {
  isTv(): Promise<{ isTv: boolean }>;
}

const TvDetect = registerPlugin<TvDetectPlugin>('TvDetect');

let resolved = false;

/**
 * Résout le type d'appareil une seule fois, au démarrage (`main.tsx`). En web
 * c'est instantané (court-circuit). En natif, un appel plugin de quelques ms.
 */
export async function initTvDetection(): Promise<void> {
  if (!isNative) return;
  try {
    const res = await TvDetect.isTv();
    resolved = res.isTv === true;
  } catch {
    // Plugin absent ou erreur → repli sûr : considéré comme non-TV
    // (l'utilisateur retombe sur le formulaire de connexion classique).
    resolved = false;
  }
}

/** `true` uniquement sur une box Android TV. Toujours `false` en web. */
export function isTvDevice(): boolean {
  return resolved;
}
