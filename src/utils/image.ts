import { apiUrl } from '../lib/api';
import { isNative } from '../lib/platform';

/**
 * Valide qu'une URL d'image est absolue (commence par http:// ou https://) et
 * la fait transiter par le proxy `/api/img`.
 *
 * Pourquoi le proxy :
 *  1. Les serveurs Xtream renvoient parfois juste un nom de fichier (ex: "poster_big.jpg")
 *     au lieu d'une URL complète. Le navigateur l'interpréterait comme une URL relative
 *     → requête vers localhost → 404 dans la console.
 *  2. Beaucoup de serveurs d'icônes IPTV (ex: covers.ddns.net) servent leurs PNG en HTTPS
 *     avec un certificat expiré ou invalide. Chrome refuse alors les requêtes
 *     (`ERR_CERT_DATE_INVALID`) — aucune image ne s'affiche. Le proxy Node ignore cette
 *     erreur de cert et renvoie l'image au navigateur en same-origin (donc sans contrôle TLS).
 *
 * @returns Une URL vers le proxy image prête à passer dans <img src>,
 *          ou `undefined` si l'URL d'entrée n'est pas absolue (le composant affichera son fallback).
 */
// CDN de confiance : certificat valide + aucune CORS requise pour l'affichage
// d'une <img> cross-origin. On les charge en DIRECT (jamais via /api/img) même
// sur web/Electron. Bénéfice : le proxy local est plafonné à ~6 connexions
// concurrentes par origine (HTTP/1.1 sur loopback) ; y faire transiter les
// affiches TMDB rivalise avec les affiches IPTV et fait traîner l'apparition
// des posters. En direct, TMDB dispose de son PROPRE pool de connexions
// (origine distincte) → les deux jeux d'images chargent en parallèle.
const DIRECT_IMG_PREFIXES = ['https://image.tmdb.org/'];

export function safeImgUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return undefined;
  // Natif : l'image est chargée directement par le WebView (pas de proxy). Le
  // contournement de certificat HTTPS expiré qu'offre /api/img devra être géré
  // au niveau du shell natif si nécessaire — voir docs/native-port.md.
  if (isNative) return trimmed;
  for (const p of DIRECT_IMG_PREFIXES) {
    if (trimmed.startsWith(p)) return trimmed;
  }
  return apiUrl(`/api/img?url=${encodeURIComponent(trimmed)}`);
}
