import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useIptvProfile } from './IptvProfileContext';
import { socialService } from '../services/social.service';

interface SocialContextValue {
  loading: boolean;
  /** Le profil actif suit-il ce membre ? */
  isFollowing: (targetProfileId: string) => boolean;
  toggleFollow: (targetProfileId: string) => void;
  /** Note (1–5) donnée par le profil actif à ce membre, ou undefined. */
  memberRating: (targetProfileId: string) => number | undefined;
  rateMember: (targetProfileId: string, rating: number) => void;
  clearMemberRating: (targetProfileId: string) => void;
}

const SocialContext = createContext<SocialContextValue | null>(null);

export function SocialProvider({ children }: { children: ReactNode }) {
  const { activeProfile } = useIptvProfile();
  const profileId = activeProfile?.id ?? null;

  const [following, setFollowing] = useState<Set<string>>(new Set());
  const [memberRatings, setMemberRatings] = useState<Record<string, number>>(
    {},
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      socialService.listFollowing(profileId),
      socialService.listMemberRatingsGiven(profileId),
    ]).then(([follows, ratings]) => {
      if (cancelled) return;
      setFollowing(new Set(follows));
      setMemberRatings(ratings);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const isFollowing = useCallback(
    (id: string) => following.has(id),
    [following],
  );

  const toggleFollow = useCallback(
    (targetId: string) => {
      if (!profileId || targetId === profileId) return;
      const was = following.has(targetId);
      setFollowing((prev) => {
        const next = new Set(prev);
        if (was) next.delete(targetId);
        else next.add(targetId);
        return next;
      });
      const op = was
        ? socialService.unfollow(profileId, targetId)
        : socialService.follow(profileId, targetId);
      op.catch(() => {
        setFollowing((prev) => {
          const next = new Set(prev);
          if (was) next.add(targetId);
          else next.delete(targetId);
          return next;
        });
      });
    },
    [profileId, following],
  );

  const memberRating = useCallback(
    (id: string) => memberRatings[id],
    [memberRatings],
  );

  const rateMember = useCallback(
    (targetId: string, rating: number) => {
      if (!profileId || targetId === profileId) return;
      const prev = memberRatings[targetId];
      setMemberRatings((m) => ({ ...m, [targetId]: rating }));
      socialService.rateMember(profileId, targetId, rating).catch(() => {
        setMemberRatings((m) => {
          const next = { ...m };
          if (prev === undefined) delete next[targetId];
          else next[targetId] = prev;
          return next;
        });
      });
    },
    [profileId, memberRatings],
  );

  const clearMemberRating = useCallback(
    (targetId: string) => {
      if (!profileId) return;
      const prev = memberRatings[targetId];
      if (prev === undefined) return;
      setMemberRatings((m) => {
        const next = { ...m };
        delete next[targetId];
        return next;
      });
      socialService.clearMemberRating(profileId, targetId).catch(() => {
        setMemberRatings((m) => ({ ...m, [targetId]: prev }));
      });
    },
    [profileId, memberRatings],
  );

  const value = useMemo<SocialContextValue>(
    () => ({
      loading,
      isFollowing,
      toggleFollow,
      memberRating,
      rateMember,
      clearMemberRating,
    }),
    [
      loading,
      isFollowing,
      toggleFollow,
      memberRating,
      rateMember,
      clearMemberRating,
    ],
  );

  return (
    <SocialContext.Provider value={value}>{children}</SocialContext.Provider>
  );
}

export function useSocial(): SocialContextValue {
  const ctx = useContext(SocialContext);
  if (!ctx) throw new Error('useSocial doit être utilisé dans SocialProvider');
  return ctx;
}
