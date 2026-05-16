import { supabase } from '../lib/supabase';
import type { PlayerState } from '../types/xtream.types';
import type { FavoriteItem, WatchHistoryItem, ContentType } from '../types/library.types';

interface HistoryRow {
  content_id: string;
  content_type: ContentType;
  content_name: string;
  content_image: string | null;
  display_subtitle: string | null;
  position_seconds: number | null;
  duration_seconds: number | null;
  audio_track: number | null;
  subtitle_track: number | null;
  player_state: PlayerState | null;
  watched_at: string;
}

function rowToHistory(r: HistoryRow): WatchHistoryItem {
  const pos = r.position_seconds ?? 0;
  const dur = r.duration_seconds ?? 0;
  return {
    id: r.content_id,
    type: r.content_type,
    title: r.content_name,
    image: r.content_image ?? '',
    subtitle: r.display_subtitle ?? '',
    progress: dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0,
    playerState: (r.player_state ?? { url: '', title: r.content_name, type: 'movie' }) as PlayerState,
    watchedAt: Date.parse(r.watched_at) || Date.now(),
    resumeTime: pos,
    durationSec: dur,
    audioTrack: r.audio_track ?? -1,
    subtitleTrack: r.subtitle_track ?? -1,
  };
}

export const libraryService = {
  // ── Favoris ───────────────────────────────────────────────────────────────
  async listFavorites(profileId: string): Promise<FavoriteItem[]> {
    const { data } = await supabase
      .from('favorites')
      .select('content_type, content_id, content_name, content_image')
      .eq('profile_id', profileId);
    return (data ?? []).map((r) => ({
      type: r.content_type as ContentType,
      id: r.content_id as string,
      name: (r.content_name as string) ?? '',
      image: (r.content_image as string) ?? '',
    }));
  },

  async addFavorite(userId: string, profileId: string, fav: FavoriteItem): Promise<void> {
    await supabase.from('favorites').upsert(
      {
        user_id: userId,
        profile_id: profileId,
        content_type: fav.type,
        content_id: fav.id,
        content_name: fav.name,
        content_image: fav.image,
      },
      { onConflict: 'profile_id,content_id,content_type' },
    );
  },

  async removeFavorite(profileId: string, type: ContentType, id: string): Promise<void> {
    await supabase
      .from('favorites')
      .delete()
      .eq('profile_id', profileId)
      .eq('content_type', type)
      .eq('content_id', id);
  },

  // ── Historique / reprise ──────────────────────────────────────────────────
  async listHistory(profileId: string): Promise<WatchHistoryItem[]> {
    const { data } = await supabase
      .from('watch_history')
      .select(
        'content_id, content_type, content_name, content_image, display_subtitle, position_seconds, duration_seconds, audio_track, subtitle_track, player_state, watched_at',
      )
      .eq('profile_id', profileId)
      .order('watched_at', { ascending: false })
      .limit(24);
    return (data ?? []).map((r) => rowToHistory(r as HistoryRow));
  },

  async upsertHistory(
    userId: string,
    profileId: string,
    item: WatchHistoryItem,
  ): Promise<void> {
    await supabase.from('watch_history').upsert(
      {
        user_id: userId,
        profile_id: profileId,
        content_id: item.id,
        content_type: item.type,
        content_name: item.title,
        content_image: item.image,
        display_subtitle: item.subtitle,
        position_seconds: Math.round(item.resumeTime ?? 0),
        duration_seconds: Math.round(item.durationSec ?? 0),
        audio_track: item.audioTrack ?? -1,
        subtitle_track: item.subtitleTrack ?? -1,
        player_state: item.playerState,
        watched_at: new Date(item.watchedAt).toISOString(),
      },
      { onConflict: 'profile_id,content_id,content_type' },
    );
  },
};
