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
import { useLibrary } from './LibraryContext';
import { ratingsService } from '../services/ratings.service';
import { titleKey as canonicalKey } from '../utils/catalog';
import { isFinishedProgress } from '../utils/ratings';
import type {
  WatchedTitle,
  WatchedInput,
  WatchedContentType,
} from '../types/ratings.types';

interface RatingsContextValue {
  loading: boolean;
  watched: WatchedTitle[];
  getWatched: (
    type: WatchedContentType,
    titleKey: string,
  ) => WatchedTitle | undefined;
  isWatched: (type: WatchedContentType, titleKey: string) => boolean;
  /** Note (création si absente) — implique « vu ». */
  rate: (input: WatchedInput, rating: number) => void;
  /** Marque vu sans note (bouton « ✓ Vu »). */
  markWatched: (input: WatchedInput) => void;
  /** Repasse l'entrée en « vu sans note » (garde le titre au mur). */
  clearRating: (type: WatchedContentType, titleKey: string) => void;
  setReview: (
    type: WatchedContentType,
    titleKey: string,
    review: string,
  ) => void;
  setWatchedDate: (
    type: WatchedContentType,
    titleKey: string,
    watchedAt: number,
  ) => void;
  /** Retire du mur (faux positif / vu par erreur). */
  removeWatched: (type: WatchedContentType, titleKey: string) => void;
  /** Enrichit une entrée existante avec un snapshot complet (fiche détail). */
  applySnapshot: (input: WatchedInput) => void;
}

const RatingsContext = createContext<RatingsContextValue | null>(null);

const wKey = (type: WatchedContentType, titleKey: string) =>
  `${type}:${titleKey}`;

/** Année depuis le sous-titre d'historique (« 2021 » ou « Film »). */
function parseYear(s?: string): number | undefined {
  const m = s?.match(/\b(19|20)\d{2}\b/);
  return m ? Number(m[0]) : undefined;
}

/** Préfère la valeur fraîche du snapshot si fournie & non vide, sinon base. */
function pick<T>(next: T | undefined, base: T | undefined): T | undefined {
  if (Array.isArray(next)) return next.length ? next : (base as T | undefined);
  return next ?? base;
}

function mergeSnapshot(
  base: WatchedTitle,
  input: WatchedInput,
): WatchedTitle {
  return {
    ...base,
    contentId: input.contentId || base.contentId,
    title: input.title || base.title,
    year: pick(input.year, base.year),
    poster: pick(input.poster, base.poster),
    backdrop: pick(input.backdrop, base.backdrop),
    tmdbId: pick(input.tmdbId, base.tmdbId),
    genres: pick(input.genres, base.genres) ?? [],
    cast: pick(input.cast, base.cast) ?? [],
    directors: pick(input.directors, base.directors) ?? [],
  };
}

function newEntry(input: WatchedInput, autoAdded: boolean): WatchedTitle {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    contentType: input.contentType,
    contentId: input.contentId,
    titleKey: input.titleKey,
    title: input.title,
    year: input.year,
    poster: input.poster,
    backdrop: input.backdrop,
    tmdbId: input.tmdbId,
    rating: null,
    review: null,
    genres: input.genres ?? [],
    cast: input.cast ?? [],
    directors: input.directors ?? [],
    autoAdded,
    watchedAt: now,
    updatedAt: now,
  };
}

export function RatingsProvider({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  const { activeProfile } = useIptvProfile();
  const { history } = useLibrary();

  const userId = user?.id ?? null;
  const profileId = activeProfile?.id ?? null;

  const [watched, setWatched] = useState<WatchedTitle[]>([]);
  const [loading, setLoading] = useState(true);

  // Index O(1) + ref pour lecture dans les callbacks (source = la liste).
  const watchedMap = useMemo(() => {
    const m = new Map<string, WatchedTitle>();
    for (const w of watched) m.set(wKey(w.contentType, w.titleKey), w);
    return m;
  }, [watched]);
  const mapRef = useRef(watchedMap);
  useEffect(() => {
    mapRef.current = watchedMap;
  }, [watchedMap]);

  // Chargement initial pour le profil actif (remonté via la key XtreamProvider).
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setLoading(true);
    ratingsService.listWatched(profileId).then((rows) => {
      if (cancelled) return;
      setWatched(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // Persistance optimiste : maj état immédiate + upsert async + revert si échec.
  const persist = useCallback(
    (next: WatchedTitle) => {
      if (!userId || !profileId) return;
      const key = wKey(next.contentType, next.titleKey);
      const prev = mapRef.current.get(key);
      setWatched((list) => {
        const rest = list.filter(
          (w) => wKey(w.contentType, w.titleKey) !== key,
        );
        return [next, ...rest];
      });
      ratingsService.upsertWatched(userId, profileId, next).catch(() => {
        setWatched((list) => {
          const rest = list.filter(
            (w) => wKey(w.contentType, w.titleKey) !== key,
          );
          return prev ? [prev, ...rest] : rest;
        });
      });
    },
    [userId, profileId],
  );

  const getWatched = useCallback(
    (type: WatchedContentType, titleKey: string) =>
      mapRef.current.get(wKey(type, titleKey)),
    [],
  );

  const isWatched = useCallback(
    (type: WatchedContentType, titleKey: string) =>
      mapRef.current.has(wKey(type, titleKey)),
    [],
  );

  const rate = useCallback(
    (input: WatchedInput, rating: number) => {
      const existing = mapRef.current.get(
        wKey(input.contentType, input.titleKey),
      );
      const base = existing
        ? mergeSnapshot(existing, input)
        : newEntry(input, false);
      persist({
        ...base,
        rating,
        // Une note explicite « adopte » l'entrée auto-ajoutée.
        autoAdded: false,
        updatedAt: Date.now(),
      });
    },
    [persist],
  );

  const markWatched = useCallback(
    (input: WatchedInput) => {
      const existing = mapRef.current.get(
        wKey(input.contentType, input.titleKey),
      );
      if (existing) {
        persist({ ...mergeSnapshot(existing, input), autoAdded: false });
        return;
      }
      persist(newEntry(input, false));
    },
    [persist],
  );

  const applySnapshot = useCallback(
    (input: WatchedInput) => {
      const existing = mapRef.current.get(
        wKey(input.contentType, input.titleKey),
      );
      if (!existing) return; // ne crée jamais sur simple visite de fiche
      persist(mergeSnapshot(existing, input));
    },
    [persist],
  );

  const clearRating = useCallback(
    (type: WatchedContentType, titleKey: string) => {
      const existing = mapRef.current.get(wKey(type, titleKey));
      if (!existing || existing.rating == null) return;
      persist({ ...existing, rating: null, updatedAt: Date.now() });
    },
    [persist],
  );

  const setReview = useCallback(
    (type: WatchedContentType, titleKey: string, review: string) => {
      const existing = mapRef.current.get(wKey(type, titleKey));
      if (!existing) return;
      persist({
        ...existing,
        review: review.trim() ? review : null,
        updatedAt: Date.now(),
      });
    },
    [persist],
  );

  const setWatchedDate = useCallback(
    (type: WatchedContentType, titleKey: string, watchedAt: number) => {
      const existing = mapRef.current.get(wKey(type, titleKey));
      if (!existing) return;
      persist({ ...existing, watchedAt, updatedAt: Date.now() });
    },
    [persist],
  );

  const removeWatched = useCallback(
    (type: WatchedContentType, titleKey: string) => {
      if (!profileId) return;
      const key = wKey(type, titleKey);
      const prev = mapRef.current.get(key);
      if (!prev) return;
      setWatched((list) =>
        list.filter((w) => wKey(w.contentType, w.titleKey) !== key),
      );
      ratingsService.removeWatched(profileId, type, titleKey).catch(() => {
        setWatched((list) => [prev, ...list]);
      });
    },
    [profileId],
  );

  // Auto-vu : un FILM terminé (>90 %) entre au mur (note vide). Les séries
  // sont volontairement manuelles (l'historique stocke des épisodes isolés,
  // pas d'identité série fiable + « série vue » est une décision explicite).
  // Snapshot minimal ici → genres/casting complétés à l'ouverture de la fiche.
  useEffect(() => {
    if (!userId || !profileId) return;
    for (const h of history) {
      if (h.type !== 'movie' || !isFinishedProgress(h.progress)) continue;
      const tk = canonicalKey(h.title);
      if (!tk || mapRef.current.has(wKey('movie', tk))) continue;
      persist(
        newEntry(
          {
            contentType: 'movie',
            contentId: h.id,
            titleKey: tk,
            title: h.title,
            year: parseYear(h.subtitle),
            poster: h.image || undefined,
          },
          true,
        ),
      );
    }
  }, [history, userId, profileId, persist]);

  const value = useMemo(
    () => ({
      loading,
      watched,
      getWatched,
      isWatched,
      rate,
      markWatched,
      clearRating,
      setReview,
      setWatchedDate,
      removeWatched,
      applySnapshot,
    }),
    [
      loading,
      watched,
      getWatched,
      isWatched,
      rate,
      markWatched,
      clearRating,
      setReview,
      setWatchedDate,
      removeWatched,
      applySnapshot,
    ],
  );

  return (
    <RatingsContext.Provider value={value}>
      {children}
    </RatingsContext.Provider>
  );
}

export function useRatings(): RatingsContextValue {
  const ctx = useContext(RatingsContext);
  if (!ctx) throw new Error('useRatings doit être utilisé dans RatingsProvider');
  return ctx;
}
