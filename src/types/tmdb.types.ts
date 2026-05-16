// Métadonnées TMDB normalisées, superposées aux données Xtream côté UI.
// Toujours optionnelles : sans clé API ou en cas d'échec, on retombe sur Xtream.

export interface TmdbCastMember {
  name: string;
  character: string;
  /** URL absolue de la photo de profil, ou undefined (placeholder initiales). */
  profile?: string;
}

export interface TmdbEnrichment {
  tmdbId: number;
  /** Image paysage principale (16:9) — alias de `backdrops[0]`. */
  backdrop?: string;
  /** Tous les fonds d'écran paysage (16:9) pour diaporama, sans texte d'abord. */
  backdrops: string[];
  /** Affiche (2:3). */
  poster?: string;
  /** Note /10 (échelle TMDB). */
  rating?: number;
  /** Synopsis FR (fallback EN si FR vide). */
  overview?: string;
  cast: TmdbCastMember[];
}

/** Map `episode_num` → URL de vignette (still) pour une saison. */
export type TmdbEpisodeStills = Record<number, string>;

/** Entrée des tendances TMDB (semaine) pour la sélection « À la une ». */
export interface TmdbTrendingItem {
  tmdbId: number;
  title: string;
  year?: string;
  backdrop?: string;
  overview?: string;
  rating?: number;
}
