import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { useSupabaseAuth } from './SupabaseAuthContext';
import { useIptvProfile } from './IptvProfileContext';
import { libraryService } from '../services/library.service';
import type { FavoriteItem, WatchHistoryItem, ContentType } from '../types/library.types';

interface LibraryContextValue {
  loading: boolean;
  history: WatchHistoryItem[];
  favorites: FavoriteItem[];
  isFavorite: (type: ContentType, id: string) => boolean;
  toggleFavorite: (fav: FavoriteItem) => void;
  addToHistory: (item: Omit<WatchHistoryItem, 'watchedAt'>) => void;
  removeFromHistory: (historyId: string) => void;
  clearHistory: () => void;
  saveProgress: (
    historyId: string,
    data: { resumeTime: number; durationSec: number; audioTrack: number; subtitleTrack: number },
  ) => void;
  getResume: (
    historyId: string,
  ) => { time: number; audio?: number; subtitle?: number } | undefined;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

const favKey = (type: ContentType, id: string) => `${type}:${id}`;

export function LibraryProvider({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  const { activeProfile } = useIptvProfile();

  const userId = user?.id ?? null;
  const profileId = activeProfile?.id ?? null;

  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<WatchHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Set d'index pour un `isFavorite` O(1) — dérivé de la liste (source unique).
  const favoriteKeys = useMemo(
    () => new Set(favorites.map((f) => favKey(f.type, f.id))),
    [favorites],
  );

  // Garde la dernière liste d'historique accessible dans les callbacks
  const historyRef = useRef<WatchHistoryItem[]>([]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  // Chargement initial pour le profil actif
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      libraryService.listFavorites(profileId),
      libraryService.listHistory(profileId),
    ]).then(([favs, hist]) => {
      if (cancelled) return;
      setFavorites(favs);
      setHistory(hist);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const isFavorite = useCallback(
    (type: ContentType, id: string) => favoriteKeys.has(favKey(type, id)),
    [favoriteKeys],
  );

  const toggleFavorite = useCallback(
    (fav: FavoriteItem) => {
      if (!userId || !profileId) return;
      const key = favKey(fav.type, fav.id);
      const wasFav = favoriteKeys.has(key);

      // Mise à jour optimiste : nouveaux favoris en tête de liste.
      setFavorites((prev) =>
        wasFav
          ? prev.filter((f) => favKey(f.type, f.id) !== key)
          : [fav, ...prev],
      );

      const op = wasFav
        ? libraryService.removeFavorite(profileId, fav.type, fav.id)
        : libraryService.addFavorite(userId, profileId, fav);

      op.catch(() => {
        // Revert en cas d'échec réseau
        setFavorites((prev) =>
          wasFav
            ? [fav, ...prev.filter((f) => favKey(f.type, f.id) !== key)]
            : prev.filter((f) => favKey(f.type, f.id) !== key),
        );
      });
    },
    [userId, profileId, favoriteKeys],
  );

  const addToHistory = useCallback(
    (item: Omit<WatchHistoryItem, 'watchedAt'>) => {
      if (!userId || !profileId) return;
      const prev = historyRef.current.find((h) => h.id === item.id);
      const merged: WatchHistoryItem = {
        ...item,
        // Ne pas écraser une reprise existante en relançant depuis la fiche
        progress: prev?.progress ?? item.progress,
        resumeTime: prev?.resumeTime,
        durationSec: prev?.durationSec,
        audioTrack: prev?.audioTrack,
        subtitleTrack: prev?.subtitleTrack,
        watchedAt: Date.now(),
      };
      setHistory((list) => [merged, ...list.filter((h) => h.id !== merged.id)].slice(0, 24));
      libraryService.upsertHistory(userId, profileId, merged).catch(() => {});
    },
    [userId, profileId],
  );

  const removeFromHistory = useCallback(
    (historyId: string) => {
      if (!profileId) return;
      const entry = historyRef.current.find((h) => h.id === historyId);
      if (!entry) return;
      setHistory((list) => list.filter((h) => h.id !== historyId));
      libraryService.removeHistoryItem(profileId, historyId, entry.type).catch(() => {
        setHistory((list) =>
          [entry, ...list].sort((a, b) => b.watchedAt - a.watchedAt),
        );
      });
    },
    [profileId],
  );

  const clearHistory = useCallback(() => {
    if (!profileId) return;
    const prev = historyRef.current;
    setHistory([]);
    libraryService.clearHistory(profileId).catch(() => {
      setHistory(prev);
    });
  }, [profileId]);

  const saveProgress = useCallback(
    (
      historyId: string,
      data: { resumeTime: number; durationSec: number; audioTrack: number; subtitleTrack: number },
    ) => {
      if (!userId || !profileId) return;
      const entry = historyRef.current.find((h) => h.id === historyId);
      if (!entry) return;
      const updated: WatchHistoryItem = {
        ...entry,
        resumeTime: data.resumeTime,
        durationSec: data.durationSec,
        audioTrack: data.audioTrack,
        subtitleTrack: data.subtitleTrack >= 0
            ? data.subtitleTrack
            : (entry.subtitleTrack !== undefined && entry.subtitleTrack >= 0
                ? entry.subtitleTrack
                : data.subtitleTrack),
        progress:
          data.durationSec > 0
            ? Math.min(100, Math.round((data.resumeTime / data.durationSec) * 100))
            : entry.progress,
        watchedAt: Date.now(),
      };
      setHistory((list) => [updated, ...list.filter((h) => h.id !== historyId)].slice(0, 24));
      libraryService.upsertHistory(userId, profileId, updated).catch(() => {});
    },
    [userId, profileId],
  );

  const getResume = useCallback(
    (historyId: string) => {
      const entry = historyRef.current.find((h) => h.id === historyId);
      if (!entry || typeof entry.resumeTime !== 'number') return undefined;
      const t = entry.resumeTime;
      const dur = entry.durationSec ?? 0;
      if (t < 10 || (dur > 0 && t > dur * 0.95)) return undefined;
      return { time: t, audio: entry.audioTrack, subtitle: entry.subtitleTrack };
    },
    [],
  );

  const value = useMemo(
    () => ({
      loading,
      history,
      favorites,
      isFavorite,
      toggleFavorite,
      addToHistory,
      removeFromHistory,
      clearHistory,
      saveProgress,
      getResume,
    }),
    [loading, history, favorites, isFavorite, toggleFavorite, addToHistory, removeFromHistory, clearHistory, saveProgress, getResume],
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}
    </LibraryContext.Provider>
  );
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary doit être utilisé dans LibraryProvider');
  return ctx;
}
