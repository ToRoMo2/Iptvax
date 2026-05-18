import { supabase } from '../lib/supabase';
import type { PublicProfileStats, DirectorySort } from '../types/social.types';
import type { ProfileColor } from '../types/profile.types';
import type { WatchedTitle, WatchedContentType } from '../types/ratings.types';

// Couche communautaire. Lecture cross-profil autorisée UNIQUEMENT via les
// policies/vues publiques côté SQL (jamais de credentials — vue
// `public_profiles` = sous-ensemble sûr). Zéro état, mappers row↔modèle.

interface StatsRow {
  id: string;
  name: string;
  discriminator: string | null;
  avatar: string;
  color: ProfileColor;
  watched_count: number;
  rated_count: number;
  avg_rating: number | null;
  last_activity: string | null;
  followers: number;
  member_avg: number | null;
  member_votes: number;
}

function rowToStats(r: StatsRow): PublicProfileStats {
  return {
    id: r.id,
    name: r.name,
    discriminator: r.discriminator,
    avatar: r.avatar,
    color: r.color,
    watchedCount: r.watched_count ?? 0,
    ratedCount: r.rated_count ?? 0,
    avgRating: r.avg_rating,
    lastActivity: r.last_activity ? Date.parse(r.last_activity) : null,
    followers: r.followers ?? 0,
    memberAvg: r.member_avg,
    memberVotes: r.member_votes ?? 0,
  };
}

// Mapper dupliqué volontairement (un `services/` n'importe pas un autre
// `services/` — corset §3 ; ratings.service garde son mapper privé).
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

function sortDirectory(
  list: PublicProfileStats[],
  sort: DirectorySort,
): PublicProfileStats[] {
  const arr = [...list];
  switch (sort) {
    case 'top-members':
      arr.sort(
        (a, b) =>
          (b.memberAvg ?? -1) - (a.memberAvg ?? -1) ||
          b.memberVotes - a.memberVotes,
      );
      break;
    case 'recent':
      arr.sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
      break;
    case 'most-watched':
      arr.sort((a, b) => b.watchedCount - a.watchedCount);
      break;
    case 'active':
    default:
      arr.sort(
        (a, b) =>
          b.ratedCount - a.ratedCount ||
          (b.lastActivity ?? 0) - (a.lastActivity ?? 0),
      );
      break;
  }
  return arr;
}

export const socialService = {
  async listDirectory(sort: DirectorySort): Promise<PublicProfileStats[]> {
    const { data } = await supabase
      .from('public_profile_stats')
      .select(
        'id, name, discriminator, avatar, color, watched_count, rated_count, avg_rating, last_activity, followers, member_avg, member_votes',
      );
    const list = (data ?? []).map((r) => rowToStats(r as StatsRow));
    return sortDirectory(list, sort);
  },

  async getProfileStats(
    profileId: string,
  ): Promise<PublicProfileStats | null> {
    const { data } = await supabase
      .from('public_profile_stats')
      .select(
        'id, name, discriminator, avatar, color, watched_count, rated_count, avg_rating, last_activity, followers, member_avg, member_votes',
      )
      .eq('id', profileId)
      .maybeSingle();
    return data ? rowToStats(data as StatsRow) : null;
  },

  async getMemberWatched(profileId: string): Promise<WatchedTitle[]> {
    // RPC SECURITY DEFINER : contourne la RLS iptv_profiles qui bloquerait
    // la vérification is_public=true depuis un compte tiers.
    const { data } = await supabase.rpc('get_member_watched', {
      p_profile_id: profileId,
    });
    return (data as WatchedRow[] ?? []).map((r) => rowToWatched(r));
  },

  // ── Suivis ────────────────────────────────────────────────────────────────
  async listFollowing(followerProfileId: string): Promise<string[]> {
    const { data } = await supabase
      .from('profile_follows')
      .select('target_profile_id')
      .eq('follower_profile_id', followerProfileId);
    return (data ?? []).map((r) => r.target_profile_id as string);
  },

  async follow(
    followerProfileId: string,
    targetProfileId: string,
  ): Promise<void> {
    await supabase
      .from('profile_follows')
      .upsert(
        {
          follower_profile_id: followerProfileId,
          target_profile_id: targetProfileId,
        },
        { onConflict: 'follower_profile_id,target_profile_id' },
      );
  },

  async unfollow(
    followerProfileId: string,
    targetProfileId: string,
  ): Promise<void> {
    await supabase
      .from('profile_follows')
      .delete()
      .eq('follower_profile_id', followerProfileId)
      .eq('target_profile_id', targetProfileId);
  },

  // ── Note de membre (réputation) ───────────────────────────────────────────
  async listMemberRatingsGiven(
    raterProfileId: string,
  ): Promise<Record<string, number>> {
    const { data } = await supabase
      .from('profile_member_ratings')
      .select('target_profile_id, rating')
      .eq('rater_profile_id', raterProfileId);
    const out: Record<string, number> = {};
    for (const r of data ?? []) {
      out[r.target_profile_id as string] = r.rating as number;
    }
    return out;
  },

  async rateMember(
    raterProfileId: string,
    targetProfileId: string,
    rating: number,
  ): Promise<void> {
    await supabase.from('profile_member_ratings').upsert(
      {
        rater_profile_id: raterProfileId,
        target_profile_id: targetProfileId,
        rating,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'rater_profile_id,target_profile_id' },
    );
  },

  async clearMemberRating(
    raterProfileId: string,
    targetProfileId: string,
  ): Promise<void> {
    await supabase
      .from('profile_member_ratings')
      .delete()
      .eq('rater_profile_id', raterProfileId)
      .eq('target_profile_id', targetProfileId);
  },

  // ── Bascule public + allocation du discriminateur (RPC SECURITY DEFINER) ──
  async setProfilePublic(
    profileId: string,
    isPublic: boolean,
  ): Promise<string | null> {
    const { data, error } = await supabase.rpc('set_profile_public', {
      p_id: profileId,
      p_public: isPublic,
    });
    if (error) throw new Error(error.message);
    return (data as string | null) ?? null;
  },
};
