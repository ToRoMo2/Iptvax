// Modèle « Mon ciné » : mur des visionnages + notes utilisateur.
// Orthogonal à favorites/watch_history — table Supabase `watched_titles`,
// isolée par profil IPTV (RLS auth.uid() + profile_id). Couche `types/` :
// ZÉRO import (corset §VII).

/** Seuls les films et séries (entières) sont notables — pas le live. */
export type WatchedContentType = 'movie' | 'series';

/** Une entrée du mur : un film OU une série entière, vue par un profil. */
export interface WatchedTitle {
  /** UUID Supabase. */
  id: string;
  contentType: WatchedContentType;
  /** Id Xtream pour le deep-link retour (`movie-123` / `series-45`). */
  contentId: string;
  /** Clé canonique stable (catalog.titleKey) — survit au changement de
   *  serveur / de variante. Identité réelle d'un titre. */
  titleKey: string;
  title: string;
  year?: number;
  /** URL BRUTE (safeImgUrl appliqué au rendu, jamais stocké pré-proxifié). */
  poster?: string;
  backdrop?: string;
  tmdbId?: number;
  /** Note 0,5–5 par pas de 0,5. `null` = vu mais pas encore noté. */
  rating: number | null;
  /** Critique libre optionnelle. */
  review: string | null;
  /** Snapshots figés à la notation pour le filtrage hors-ligne (sans TMDB). */
  genres: string[];
  cast: string[];
  directors: string[];
  /** `true` si ajouté automatiquement (film terminé >90 %), `false` si manuel. */
  autoAdded: boolean;
  /** Epoch ms — date de visionnage (éditable). */
  watchedAt: number;
  updatedAt: number;
}

/**
 * Snapshot transmis par les fiches détail (ou l'auto-vu) pour créer / enrichir
 * une entrée. Les champs métadonnées sont optionnels : l'auto-vu n'a que le
 * minimum, la fiche détail complète via `applySnapshot`.
 */
export interface WatchedInput {
  contentType: WatchedContentType;
  contentId: string;
  titleKey: string;
  title: string;
  year?: number;
  poster?: string;
  backdrop?: string;
  tmdbId?: number;
  genres?: string[];
  cast?: string[];
  directors?: string[];
}

export type RatingStatusFilter = 'all' | 'unrated' | 'rated';
export type WatchedTypeFilter = 'all' | 'movie' | 'series';
export type WatchedSort =
  | 'recent'
  | 'rating-desc'
  | 'rating-asc'
  | 'title'
  | 'year';

export type FacetKind = 'genre' | 'cast' | 'director';

/** Une facette de filtre (un acteur, un réalisateur ou un genre). */
export interface Facet {
  /** Clé normalisée pour le regroupement. */
  key: string;
  /** Libellé d'affichage (forme la plus fréquente). */
  label: string;
  count: number;
  /** Moyenne des notes utilisateur parmi les entrées notées, sinon `null`. */
  avg: number | null;
}

export interface WatchedFilter {
  type: WatchedTypeFilter;
  status: RatingStatusFilter;
  genre?: string;
  castName?: string;
  director?: string;
}

export interface WatchedStats {
  total: number;
  rated: number;
  unrated: number;
  avg: number | null;
}
