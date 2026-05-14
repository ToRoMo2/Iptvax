/**
 * Valide qu'une URL d'image est absolue (commence par http:// ou https://).
 * Les serveurs Xtream renvoient parfois juste un nom de fichier (ex: "poster_big.jpg")
 * au lieu d'une URL complète. Le navigateur l'interpréterait comme une URL relative
 * → requête vers localhost → 404 dans la console.
 *
 * @returns L'URL si elle est valide, undefined sinon (le composant affichera le fallback gradient).
 */
export function safeImgUrl(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  const trimmed = url.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  return undefined;
}
