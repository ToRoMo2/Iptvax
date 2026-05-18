/** Préfixe l'URL du backend si VITE_API_BASE_URL est défini (builds TV/mobile).
 *  En web co-localisé la variable est vide → chemin relatif inchangé. */
export const apiUrl = (path: string): string =>
  `${import.meta.env.VITE_API_BASE_URL ?? ''}${path}`;
