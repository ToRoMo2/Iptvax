import type { PlayerState, SeriesContext } from './xtream.types';

/** Statut d'un téléchargement dans le registre local. */
export type DownloadStatus =
  | 'queued'       // en file d'attente (pas encore commencé)
  | 'downloading'  // transfert en cours
  | 'paused'       // mis en pause par l'utilisateur (reprise possible par Range)
  | 'done'         // fichier complet sur le disque, lisible hors-ligne
  | 'error';       // échec (réseau / espace / source) — retry possible

/**
 * Une entrée du registre de téléchargements. Le registre est **local à
 * l'appareil** (un film téléchargé sur le téléphone n'est pas sur le PC) →
 * jamais synchronisé via Supabase, contrairement à la bibliothèque (§IV-12).
 *
 * On télécharge le **fichier direct Xtream complet** (MKV/MP4) avec toutes ses
 * pistes audio/sous-titres embarquées : le lecteur natif (mpv / ExoPlayer)
 * choisit la piste à la lecture, exactement comme en streaming → pas de mux
 * ffmpeg, pas de sélection de piste à la source, fonctionne hors-ligne.
 */
export interface DownloadItem {
  /** `${type}-${contentId}` — ex. `movie-123` / `episode-456`. Aligné sur
   *  `WatchHistoryItem.id` → la reprise hors-ligne réutilise la bibliothèque. */
  id: string;
  /** Profil IPTV propriétaire (isolation UI, comme la bibliothèque). */
  profileId: string;
  type: 'movie' | 'episode';
  /** Titre affiché (« Film » ou « Série – S1 · É2 »). */
  title: string;
  /** Sous-titre court (année pour un film, « S1 · É2 » pour un épisode). */
  subtitle: string;
  /** URL distante de l'affiche/vignette (BRUTE — `safeImgUrl` au rendu).
   *  Mise en cache localement par le moteur quand c'est possible (Electron). */
  poster: string;
  /** Chemin local de l'affiche une fois mise en cache (sinon `poster` distant). */
  posterLocalPath?: string;
  /** URL UPSTREAM directe du fichier Xtream (jamais l'URL proxifiée `/api/*`).
   *  C'est ce que le moteur télécharge depuis l'IP de l'appareil. */
  sourceUrl: string;
  /** Extension du conteneur (`mkv` / `mp4`). */
  ext: string;
  /** URI lisible du fichier local une fois téléchargé (`file://…`). */
  fileUri?: string;
  bytesTotal: number;
  bytesDownloaded: number;
  status: DownloadStatus;
  /** Message d'erreur en cas de `status === 'error'`. */
  error?: string;
  /** Durée (s) connue au déclenchement (depuis Xtream/TMDB) → libellé + reprise. */
  durationSec?: number;
  /** Contexte série (pour reconstruire le panneau « Épisodes » hors-ligne). */
  seriesContext?: SeriesContext;
  /** `PlayerState` distant d'origine (pour relancer en ligne si besoin). */
  onlinePlayerState?: PlayerState;
  addedAt: number;
}

/** Descripteur passé au moteur pour démarrer un téléchargement. */
export type DownloadRequest = Omit<
  DownloadItem,
  'bytesDownloaded' | 'bytesTotal' | 'status' | 'fileUri' | 'posterLocalPath' | 'addedAt'
> & {
  bytesTotal?: number;
};
