import { apiUrl } from '../lib/api';

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
export function safeImgUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return undefined;
  return apiUrl(`/api/img?url=${encodeURIComponent(trimmed)}`);
}
