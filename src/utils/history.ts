import type { WatchHistoryItem } from '../types/library.types';
import { titleKey } from './catalog';

/**
 * Clé de regroupement d'un item d'historique, **stable indépendamment de la
 * variante** (langue/qualité) et, pour une série, **indépendamment de
 * l'épisode**. → l'historique n'affiche qu'une carte par contenu : relancer
 * « Game of Thrones » en VOSTFR puis en 4K (ou changer d'épisode) écrase la
 * carte précédente au lieu d'en empiler une nouvelle.
 *
 * - film : `movie:<titleKey>` (le `stream_id` change d'une variante à l'autre).
 * - série : `series:<titleKey>` — ⚠ PAS le `series_id` : chaque source/variante
 *   (VOSTFR, 4K…) est une entrée Xtream distincte avec son propre `series_id`.
 *   On regroupe donc sur le titre canonique → toutes les variantes ET tous les
 *   épisodes d'une série tombent dans la même carte.
 * - live : clé par chaîne (pas de regroupement).
 */
export function historyGroupKey(item: WatchHistoryItem): string {
  if (item.type === 'series') {
    // Titre de la série (sans le libellé d'épisode "Série – Épisode 2").
    const base = item.playerState?.seriesContext?.title ?? item.title.split(' – ')[0];
    return `series:${titleKey(base)}`;
  }
  if (item.type === 'movie') return `movie:${titleKey(item.title)}`;
  return `${item.type}:${item.id}`;
}

/**
 * Position de reprise exploitable (assez avancée pour reprendre, pas terminée),
 * sinon `null`. Seuils alignés sur `LibraryContext.getResume`.
 */
export function resumePosition(entry: WatchHistoryItem): number | null {
  const t = entry.resumeTime;
  if (typeof t !== 'number') return null;
  const dur = entry.durationSec ?? 0;
  if (t < 10 || (dur > 0 && t > dur * 0.95)) return null;
  return t;
}

/** Déduplique une liste d'historique par groupe, en gardant la plus récente. */
export function dedupeHistoryByGroup(list: WatchHistoryItem[]): WatchHistoryItem[] {
  const seen = new Set<string>();
  const out: WatchHistoryItem[] = [];
  for (const item of [...list].sort((a, b) => b.watchedAt - a.watchedAt)) {
    const k = historyGroupKey(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}
