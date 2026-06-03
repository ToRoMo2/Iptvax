// Helpers de formatage purs (sans dépendance React/service).

/**
 * Formate une durée en minutes en « 1h 36m » / « 45m ».
 * Renvoie `undefined` pour une valeur absente ou nulle → l'appelant masque
 * simplement l'élément (purement additif, jamais bloquant).
 */
export function fmtRuntime(min?: number): string | undefined {
  if (!min || min <= 0 || Number.isNaN(min)) return undefined;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
