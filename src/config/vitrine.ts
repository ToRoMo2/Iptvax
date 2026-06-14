/**
 * Constantes du site vitrine (Phase 5). Source de vérité unique pour le
 * domaine public, le repo GitHub et les liens de téléchargement des binaires.
 *
 * Ne pas hardcoder ces URLs ailleurs — tout passe par ce fichier.
 */

/** Domaine public canonique du site vitrine (meta og:url, liens absolus). */
export const WEB_URL = 'https://umbra.app';

/** Repo GitHub où sont publiées les releases (owner/name). */
export const GITHUB_REPO = 'ToRoMo2/Iptvax';

/** Préfixe URL GitHub Releases « latest ». Le binaire suit avec `/<filename>`. */
export const RELEASES_BASE = `https://github.com/${GITHUB_REPO}/releases/latest/download`;

export type DownloadId = 'android' | 'windows' | 'webos' | 'tizen';

export interface DownloadAsset {
  id: DownloadId;
  label: string;
  filename: string;
  url: string;
  description: string;
}

/** Liste des binaires distribués. Les `filename` DOIVENT correspondre aux assets
 *  uploadés sur la release GitHub `latest` (sinon 404 au clic). */
export const DOWNLOADS: DownloadAsset[] = [
  {
    id: 'android',
    label: 'Android',
    filename: 'umbra.apk',
    url: `${RELEASES_BASE}/umbra.apk`,
    description: 'Smartphone, tablette, Android TV — APK à installer directement.',
  },
  {
    id: 'windows',
    label: 'Windows',
    filename: 'Umbra-Setup.exe',
    url: `${RELEASES_BASE}/Umbra-Setup.exe`,
    description: 'Windows 10 / 11 — installeur classique.',
  },
  {
    id: 'webos',
    label: 'TV LG (webOS)',
    filename: 'com.umbra.app_1.0.0_all.ipk',
    url: `${RELEASES_BASE}/com.umbra.app_1.0.0_all.ipk`,
    description: 'TV LG webOS 4+ — sideload en mode développeur.',
  },
  {
    id: 'tizen',
    label: 'TV Samsung (Tizen)',
    filename: 'Umbra.wgt',
    url: `${RELEASES_BASE}/Umbra.wgt`,
    description: 'TV Samsung Tizen 5+ — sideload en mode développeur.',
  },
];

/** Devine la plateforme du visiteur depuis le User-Agent pour mettre en avant
 *  le binaire pertinent sur la page Downloads. Retourne `null` si indéterminé
 *  (Mac, Linux desktop, iOS — pas de binaire disponible). */
export function detectVisitorPlatform(): DownloadId | null {
  if (typeof navigator === 'undefined') return null;
  const ua = navigator.userAgent;
  if (/Android/i.test(ua)) return 'android';
  if (/Windows/i.test(ua)) return 'windows';
  return null;
}
