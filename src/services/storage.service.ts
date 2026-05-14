import type { XtreamCredentials } from '../types/xtream.types';

export interface WatchHistoryItem {
  id: string;
  type: 'live' | 'movie' | 'series';
  title: string;
  image: string;
  progress: number; // 0–100
  subtitle: string; // e.g. "Reprise · 42 min"
  playerState: {
    url: string;
    fallbackUrl?: string;
    title: string;
    type: 'live' | 'movie' | 'episode';
    poster?: string;
    description?: string;
  };
  watchedAt: number;
}

const KEYS = {
  credentials: 'iptv_credentials',
  favorites: 'iptv_favorites',
  lastPlayed: 'iptv_last_played',
  watchHistory: 'iptv_watch_history',
} as const;

export const storageService = {
  getCredentials(): XtreamCredentials | null {
    const raw = localStorage.getItem(KEYS.credentials);
    return raw ? (JSON.parse(raw) as XtreamCredentials) : null;
  },

  saveCredentials(creds: XtreamCredentials): void {
    localStorage.setItem(KEYS.credentials, JSON.stringify(creds));
  },

  clearCredentials(): void {
    localStorage.removeItem(KEYS.credentials);
  },

  getFavorites(): string[] {
    return JSON.parse(localStorage.getItem(KEYS.favorites) ?? '[]') as string[];
  },

  toggleFavorite(id: string): boolean {
    const favs = this.getFavorites();
    const idx = favs.indexOf(id);
    if (idx >= 0) {
      favs.splice(idx, 1);
    } else {
      favs.push(id);
    }
    localStorage.setItem(KEYS.favorites, JSON.stringify(favs));
    return idx < 0;
  },

  isFavorite(id: string): boolean {
    return this.getFavorites().includes(id);
  },

  // ─── Watch history ─────────────────────────────────────────────────────────
  getWatchHistory(): WatchHistoryItem[] {
    try {
      return JSON.parse(localStorage.getItem(KEYS.watchHistory) ?? '[]') as WatchHistoryItem[];
    } catch {
      return [];
    }
  },

  addToWatchHistory(item: Omit<WatchHistoryItem, 'watchedAt'>): void {
    const history = this.getWatchHistory().filter((h) => h.id !== item.id);
    history.unshift({ ...item, watchedAt: Date.now() });
    // Keep at most 24 items
    localStorage.setItem(KEYS.watchHistory, JSON.stringify(history.slice(0, 24)));
  },

  updateWatchProgress(id: string, progress: number): void {
    const history = this.getWatchHistory();
    const idx = history.findIndex((h) => h.id === id);
    if (idx >= 0) {
      history[idx].progress = progress;
      history[idx].watchedAt = Date.now();
      localStorage.setItem(KEYS.watchHistory, JSON.stringify(history));
    }
  },
};
