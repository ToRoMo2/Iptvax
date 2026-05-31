export interface XtreamCredentials {
  serverUrl: string;
  username: string;
  password: string;
}

export interface XtreamUserInfo {
  username: string;
  password: string;
  message: string;
  auth: number;
  status: string;
  exp_date: string | null;
  is_trial: string;
  active_cons: string;
  created_at: string;
  max_connections: string;
  allowed_output_formats: string[];
}

export interface XtreamServerInfo {
  url: string;
  port: string;
  https_port: string;
  server_protocol: string;
  rtmp_port: string;
  timezone: string;
  timestamp_now: number;
  time_now: string;
}

export interface XtreamAuthResponse {
  user_info: XtreamUserInfo;
  server_info: XtreamServerInfo;
}

export interface LiveCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface LiveStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  epg_channel_id: string | null;
  added: string;
  category_id: string;
  tv_archive: number;
  tv_archive_duration: number;
  direct_source: string;
}

export interface VodCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface VodStream {
  num: number;
  name: string;
  stream_type: string;
  stream_id: number;
  stream_icon: string;
  rating: string;
  rating_5based: number;
  added: string;
  category_id: string;
  container_extension: string;
  direct_source: string;
  plot?: string;
  genre?: string;
  releaseDate?: string;
  director?: string;
  cast?: string;
  youtube_trailer?: string;
  backdrop_path?: string[];
}

export interface SeriesCategory {
  category_id: string;
  category_name: string;
  parent_id: number;
}

export interface SeriesItem {
  num: number;
  name: string;
  series_id: number;
  cover: string;
  plot: string;
  cast: string;
  director: string;
  genre: string;
  releaseDate: string;
  last_modified: string;
  rating: string;
  rating_5based: number;
  backdrop_path: string[];
  youtube_trailer: string;
  episode_run_time: string;
  category_id: string;
}

export interface Episode {
  id: string;
  episode_num: number;
  title: string;
  container_extension: string;
  info: {
    movie_image?: string;
    plot?: string;
    duration_secs?: number;
    duration?: string;
    rating?: number;
    season?: number;
  };
  added: string;
  season: number;
  direct_source: string;
}

export interface SeriesInfo {
  info: {
    name: string;
    cover: string;
    plot: string;
    cast: string;
    director: string;
    genre: string;
    releaseDate: string;
    rating: string;
    backdrop_path: string[];
    youtube_trailer: string;
    episode_run_time: string;
    category_id: string;
    last_modified: string;
  };
  episodes: Record<string, Episode[]>;
  seasons: Array<{ season_number: number; name: string; cover: string; air_date: string }> | null;
}

// Programme EPG renvoyé par `get_short_epg`. `title`/`description` sont
// encodés en base64 côté serveur Xtream → décodés à l'affichage.
export interface EpgListing {
  id: string;
  epg_id: string;
  title: string;
  lang: string;
  start: string;
  end: string;
  description: string;
  channel_id: string;
  start_timestamp: string;
  stop_timestamp: string;
  now_playing: number;
  has_archive: number;
}

export type MediaType = 'live' | 'movie' | 'episode';

// Référence minimale d'une chaîne live, utilisée pour la navigation
// prev/next directement depuis le lecteur sans repasser par la grille.
export interface LiveChannelRef {
  stream_id: number;
  name: string;
  stream_icon?: string;
}

// Contexte série pour le panneau « Épisodes » du lecteur. Posé par
// SeriesDetail au moment du play (`handlePlayEpisode`) — Player re-fetch la
// SeriesInfo et les stills TMDB pour la saison courante. On ne stocke ici que
// le strict minimum (pas la liste d'épisodes) pour que la persistance
// historique reste légère et que le panneau survive à un replay depuis
// « Reprendre » sans re-passer par la fiche série.
export interface SeriesContext {
  seriesId: number;
  // Titre nettoyé (pour reconstruire le `title` du nouveau PlayerState quand
  // l'utilisateur sélectionne un autre épisode depuis le panneau).
  title?: string;
  currentSeason: number;
  currentEpisodeNum: number;
  // ID TMDB déjà résolu par la fiche série (chemin rapide pour les stills).
  // Absent quand l'épisode est rejoué depuis l'historique « Reprendre » →
  // Player retombe sur enrichSeries(cleanTitle, year).
  tmdbId?: number;
}

export interface PlayerState {
  url: string;
  fallbackUrl?: string; // URL avec extension originale si m3u8 échoue
  title: string;
  type: MediaType;
  poster?: string;
  description?: string;
  // Clé d'historique pour la reprise de lecture (position + pistes).
  // Absente pour le live (pas de reprise).
  historyId?: string;
  // Live uniquement : snapshot de la liste affichée au moment du clic
  // + index courant, pour permettre prev/next depuis le player.
  liveChannels?: LiveChannelRef[];
  liveIndex?: number;
  // Épisode uniquement : déclenche le panneau « Épisodes » dans le lecteur.
  seriesContext?: SeriesContext;
}
