import type { PlayerState } from './xtream.types';

export type ContentType = 'live' | 'movie' | 'series';

export interface FavoriteItem {
  type: ContentType;
  id: string;
  name: string;
  image: string;
}

export interface WatchHistoryItem {
  id: string; // historyId, ex: 'movie-123' | 'episode-456'
  type: ContentType;
  title: string;
  image: string;
  progress: number; // 0–100
  subtitle: string; // libellé ex: "S1 · É2" ou année
  playerState: PlayerState;
  watchedAt: number;
  // Reprise : position exacte + pistes sélectionnées au dernier arrêt
  resumeTime?: number;
  durationSec?: number;
  audioTrack?: number;
  subtitleTrack?: number;
}
