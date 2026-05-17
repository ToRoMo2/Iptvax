import { supabase } from '../lib/supabase';
import type { WatchedTitle, WatchedContentType } from '../types/ratings.types';

// Reflet exact des colonnes de la table Supabase `watched_titles`
// (isolée par profil — RLS auth.uid() + profile_id). Pattern identique à
// `library.service.ts` : zéro état, mappers row↔modèle, upsert idempotent.
interface WatchedRow {
  id: string;
  content_type: WatchedContentType;
  content_id: string;
  title_key: string;
  title: string;
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  tmdb_id: number | null;
  rating: number | null;
  review: string | null;
  genres: string[] | null;
  cast_names: string[] | null;
  directors: string[] | null;
  auto_added: boolean;
  watched_at: string;
  updated_at: string;
}

function rowToWatched(r: WatchedRow): WatchedTitle {
  return {
    id: r.id,
    contentType: r.content_type,
    contentId: r.content_id,
    titleKey: r.title_key,
    title: r.title,
    year: r.year ?? undefined,
    poster: r.poster ?? undefined,
    backdrop: r.backdrop ?? undefined,
    tmdbId: r.tmdb_id ?? undefined,
    rating: r.rating,
    review: r.review,
    genres: r.genres ?? [],
    cast: r.cast_names ?? [],
    directors: r.directors ?? [],
    autoAdded: r.auto_added,
    watchedAt: Date.parse(r.watched_at) || Date.now(),
    updatedAt: Date.parse(r.updated_at) || Date.now(),
  };
}

export const ratingsService = {
  async listWatched(profileId: string): Promise<WatchedTitle[]> {
    const { data } = await supabase
      .from('watched_titles')
      .select(
        'id, content_type, content_id, title_key, title, year, poster, backdrop, tmdb_id, rating, review, genres, cast_names, directors, auto_added, watched_at, updated_at',
      )
      .eq('profile_id', profileId)
      .order('watched_at', { ascending: false });
    return (data ?? []).map((r) => rowToWatched(r as WatchedRow));
  },

  /**
   * Upsert d'une entrée complète (le contexte construit la ligne fusionnée à
   * partir de son état → on n'écrase jamais involontairement note/critique).
   * Conflit sur l'identité canonique (profil + type + clé de titre).
   */
  async upsertWatched(
    userId: string,
    profileId: string,
    item: WatchedTitle,
  ): Promise<void> {
    await supabase.from('watched_titles').upsert(
      {
        user_id: userId,
        profile_id: profileId,
        content_type: item.contentType,
        content_id: item.contentId,
        title_key: item.titleKey,
        title: item.title,
        year: item.year ?? null,
        poster: item.poster ?? null,
        backdrop: item.backdrop ?? null,
        tmdb_id: item.tmdbId ?? null,
        rating: item.rating,
        review: item.review,
        genres: item.genres,
        cast_names: item.cast,
        directors: item.directors,
        auto_added: item.autoAdded,
        watched_at: new Date(item.watchedAt).toISOString(),
      },
      { onConflict: 'profile_id,content_type,title_key' },
    );
  },

  async removeWatched(
    profileId: string,
    contentType: WatchedContentType,
    titleKey: string,
  ): Promise<void> {
    await supabase
      .from('watched_titles')
      .delete()
      .eq('profile_id', profileId)
      .eq('content_type', contentType)
      .eq('title_key', titleKey);
  },
};
