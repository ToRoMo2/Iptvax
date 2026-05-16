/**
 * Code court (1-2 lettres) dérivé d'un nom de chaîne, pour les placeholders
 * logo quand aucune icône n'est disponible. Fonction pure, zéro import.
 */
export function channelCode(title: string): string {
  return (
    title
      .replace(/[^a-zA-Z0-9 ]/g, '')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || title.charAt(0).toUpperCase()
  );
}
