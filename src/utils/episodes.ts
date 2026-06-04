import type { Episode, SeriesInfo } from '../types/xtream.types';

/**
 * Épisode suivant dans une `SeriesInfo` après (saison, n°). Passe à la première
 * saison suivante non vide si l'épisode courant est le dernier de sa saison.
 * `undefined` si c'est le tout dernier épisode connu.
 *
 * Partagé entre `SeriesDetail` (bouton « Reprendre » → enchaîne le suivant) et
 * `Player` (avancement auto de l'historique quand un épisode est terminé).
 */
export function nextEpisode(
  data: SeriesInfo,
  season: number,
  num: number,
): Episode | undefined {
  const cur = data.episodes[String(season)] ?? [];
  const idx = cur.findIndex((e) => e.episode_num === num);
  if (idx >= 0 && idx + 1 < cur.length) return cur[idx + 1];
  const seasonsNum = Object.keys(data.episodes).map(Number).sort((a, b) => a - b);
  for (let i = seasonsNum.indexOf(season) + 1; i > 0 && i < seasonsNum.length; i++) {
    const eps = data.episodes[String(seasonsNum[i])];
    if (eps?.length) return eps[0];
  }
  return undefined;
}
