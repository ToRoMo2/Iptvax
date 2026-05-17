/**
 * Logique pure du mur « Mon ciné » : normalisation des notes, découpage des
 * métadonnées Xtream, agrégation des facettes (acteur / réalisateur / genre),
 * filtrage et tri. AUCUN état, AUCun effet → trivialement testable.
 *
 * Couche `utils/` : pas de dépendance runtime (seul `import type`, effacé à la
 * compilation — corset §VII).
 */
import type {
  WatchedTitle,
  Facet,
  FacetKind,
  WatchedFilter,
  WatchedSort,
  WatchedStats,
} from '../types/ratings.types';

export const RATING_MIN = 0.5;
export const RATING_MAX = 5;
export const RATING_STEP = 0.5;
/** Valeurs autorisées : 0,5 · 1 · 1,5 … 5. */
export const RATING_VALUES: number[] = Array.from(
  { length: 10 },
  (_, i) => (i + 1) * 0.5,
);

/** Borne + aligne une valeur sur un pas arbitraire (générique, réutilisable
 *  pour la note de titre 0,5 et la note de membre entière). */
export function clampToStep(
  value: number,
  step: number,
  min: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return min;
  const snapped = Math.round(value / step) * step;
  return Math.min(max, Math.max(min, Number(snapped.toFixed(2))));
}

/** Borne + aligne une note de titre sur le pas de 0,5. */
export function clampRating(value: number): number {
  return clampToStep(value, RATING_STEP, RATING_MIN, RATING_MAX);
}

/** Un film/série est « terminé » (donc vu) à partir de 90 % de progression. */
export const FINISHED_THRESHOLD = 90;
export function isFinishedProgress(progress: number): boolean {
  return progress >= FINISHED_THRESHOLD;
}

const META_SEPARATORS = /[,/|;·•]+|\s-\s/;
const META_NOISE = new Set(['n/a', 'na', 'unknown', 'inconnu', '-', '—', '']);

/**
 * Découpe une chaîne Xtream `genre` / `cast` / `director` (séparateurs
 * hétérogènes selon les fournisseurs) en valeurs propres, dédupliquées
 * (insensible à la casse), bruit filtré.
 */
export function splitMeta(raw?: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(META_SEPARATORS)) {
    const v = part.trim().replace(/\s{2,}/g, ' ');
    const k = v.toLowerCase();
    if (!v || META_NOISE.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Clé de regroupement insensible casse + accents pour les facettes. */
export function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function facetValues(item: WatchedTitle, kind: FacetKind): string[] {
  if (kind === 'genre') return item.genres;
  if (kind === 'cast') return item.cast;
  return item.directors;
}

/**
 * Agrège les entrées par valeur de facette : nombre + note moyenne (sur les
 * seules entrées notées). Trié par occurrence décroissante puis libellé.
 */
export function buildFacets(
  items: WatchedTitle[],
  kind: FacetKind,
): Facet[] {
  interface Acc {
    count: number;
    sum: number;
    rated: number;
    labels: Map<string, number>;
  }
  const map = new Map<string, Acc>();

  for (const item of items) {
    for (const raw of facetValues(item, kind)) {
      const key = normalizeKey(raw);
      if (!key) continue;
      let acc = map.get(key);
      if (!acc) {
        acc = { count: 0, sum: 0, rated: 0, labels: new Map() };
        map.set(key, acc);
      }
      acc.count += 1;
      if (item.rating != null) {
        acc.sum += item.rating;
        acc.rated += 1;
      }
      acc.labels.set(raw, (acc.labels.get(raw) ?? 0) + 1);
    }
  }

  const facets: Facet[] = [];
  for (const [key, acc] of map) {
    // Libellé = forme d'origine la plus fréquente (« Tom Hanks » vs « tom hanks »).
    let label = key;
    let best = -1;
    for (const [lbl, n] of acc.labels) {
      if (n > best) {
        best = n;
        label = lbl;
      }
    }
    facets.push({
      key,
      label,
      count: acc.count,
      avg: acc.rated > 0 ? Number((acc.sum / acc.rated).toFixed(2)) : null,
    });
  }

  facets.sort((a, b) =>
    b.count - a.count || a.label.localeCompare(b.label, 'fr'),
  );
  return facets;
}

/** Applique les filtres actifs (type, statut de note, facettes). */
export function filterWatched(
  items: WatchedTitle[],
  filter: WatchedFilter,
): WatchedTitle[] {
  const fGenre = filter.genre ? normalizeKey(filter.genre) : null;
  const fCast = filter.castName ? normalizeKey(filter.castName) : null;
  const fDir = filter.director ? normalizeKey(filter.director) : null;

  return items.filter((it) => {
    if (filter.type !== 'all' && it.contentType !== filter.type) return false;
    if (filter.status === 'rated' && it.rating == null) return false;
    if (filter.status === 'unrated' && it.rating != null) return false;
    if (fGenre && !it.genres.some((g) => normalizeKey(g) === fGenre)) {
      return false;
    }
    if (fCast && !it.cast.some((c) => normalizeKey(c) === fCast)) return false;
    if (fDir && !it.directors.some((d) => normalizeKey(d) === fDir)) {
      return false;
    }
    return true;
  });
}

/** Tri stable des entrées du mur. Les non-notés passent après en tri par note. */
export function sortWatched(
  items: WatchedTitle[],
  sort: WatchedSort,
): WatchedTitle[] {
  const arr = [...items];
  switch (sort) {
    case 'rating-desc':
      arr.sort(
        (a, b) =>
          (b.rating ?? -1) - (a.rating ?? -1) || b.watchedAt - a.watchedAt,
      );
      break;
    case 'rating-asc':
      arr.sort(
        (a, b) =>
          (a.rating ?? Number.POSITIVE_INFINITY) -
            (b.rating ?? Number.POSITIVE_INFINITY) ||
          b.watchedAt - a.watchedAt,
      );
      break;
    case 'title':
      arr.sort((a, b) => a.title.localeCompare(b.title, 'fr'));
      break;
    case 'year':
      arr.sort(
        (a, b) => (b.year ?? -1) - (a.year ?? -1) || b.watchedAt - a.watchedAt,
      );
      break;
    case 'recent':
    default:
      arr.sort((a, b) => b.watchedAt - a.watchedAt);
      break;
  }
  return arr;
}

export function computeStats(items: WatchedTitle[]): WatchedStats {
  let sum = 0;
  let rated = 0;
  for (const it of items) {
    if (it.rating != null) {
      sum += it.rating;
      rated += 1;
    }
  }
  return {
    total: items.length,
    rated,
    unrated: items.length - rated,
    avg: rated > 0 ? Number((sum / rated).toFixed(2)) : null,
  };
}
