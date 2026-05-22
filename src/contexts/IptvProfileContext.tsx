import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';
import { socialService } from '../services/social.service';
import { useSupabaseAuth } from './SupabaseAuthContext';
import { useSubscription } from './SubscriptionContext';
import type { IptvProfile, IptvProfileInput } from '../types/profile.types';

/** Clé localStorage du profil IPTV actif sur cet appareil. Exportée car
 *  l'appairage TV (Phase 2f) pré-amorce le profil choisi sur le téléphone. */
export const ACTIVE_PROFILE_KEY = 'active_iptv_profile_id';

interface IptvProfileContextValue {
  profiles: IptvProfile[];
  activeProfile: IptvProfile | null;
  loading: boolean;
  selectProfile: (profile: IptvProfile) => void;
  clearActiveProfile: () => void;
  createProfile: (input: IptvProfileInput) => Promise<IptvProfile>;
  updateProfile: (id: string, patch: Partial<IptvProfileInput>) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
  /** Bascule « ciné public » : RPC d'allocation du discriminateur + maj état. */
  setProfilePublic: (id: string, isPublic: boolean) => Promise<void>;
}

const IptvProfileContext = createContext<IptvProfileContextValue | null>(null);

export function IptvProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  const { isPremium } = useSubscription();
  const [profiles, setProfiles] = useState<IptvProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<IptvProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Charge la liste des profils du compte au démarrage
  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from('iptv_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (cancelled) return;
      const list = (data ?? []) as IptvProfile[];
      setProfiles(list);

      // Restaure le profil actif persisté sur cet appareil
      const savedId = localStorage.getItem(ACTIVE_PROFILE_KEY);
      const restored = savedId ? list.find((p) => p.id === savedId) ?? null : null;
      if (restored) {
        setActiveProfile(restored);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const selectProfile = useCallback((profile: IptvProfile) => {
    localStorage.setItem(ACTIVE_PROFILE_KEY, profile.id);
    setActiveProfile(profile);
  }, []);

  const clearActiveProfile = useCallback(() => {
    localStorage.removeItem(ACTIVE_PROFILE_KEY);
    setActiveProfile(null);
  }, []);

  const createProfile = useCallback(
    async (input: IptvProfileInput): Promise<IptvProfile> => {
      if (!user) throw new Error('Non authentifié');
      // Tier gratuit : 1 profil maximum (le multi-profil est Premium).
      if (!isPremium && profiles.length >= 1) {
        throw new Error('Les profils multiples sont réservés aux membres Premium');
      }
      const { data, error } = await supabase
        .from('iptv_profiles')
        .insert({ ...input, user_id: user.id })
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Création impossible');
      const created = data as IptvProfile;
      setProfiles((prev) => [...prev, created]);
      return created;
    },
    [user, isPremium, profiles.length],
  );

  const updateProfile = useCallback(
    async (id: string, patch: Partial<IptvProfileInput>) => {
      const { data, error } = await supabase
        .from('iptv_profiles')
        .update(patch)
        .eq('id', id)
        .select('*')
        .single();
      if (error || !data) throw new Error(error?.message ?? 'Mise à jour impossible');
      const updated = data as IptvProfile;
      setProfiles((prev) => prev.map((p) => (p.id === id ? updated : p)));
      setActiveProfile((prev) => (prev?.id === id ? updated : prev));
    },
    [],
  );

  const setProfilePublic = useCallback(
    async (id: string, isPublic: boolean) => {
      const disc = await socialService.setProfilePublic(id, isPublic);
      const apply = (p: IptvProfile): IptvProfile => ({
        ...p,
        is_public: isPublic,
        discriminator: disc ?? p.discriminator,
      });
      setProfiles((prev) => prev.map((p) => (p.id === id ? apply(p) : p)));
      setActiveProfile((prev) =>
        prev?.id === id ? apply(prev) : prev,
      );
    },
    [],
  );

  const deleteProfile = useCallback(
    async (id: string) => {
      const { error } = await supabase.from('iptv_profiles').delete().eq('id', id);
      if (error) throw new Error(error.message);
      setProfiles((prev) => prev.filter((p) => p.id !== id));
      setActiveProfile((prev) => (prev?.id === id ? null : prev));
      if (localStorage.getItem(ACTIVE_PROFILE_KEY) === id) {
        localStorage.removeItem(ACTIVE_PROFILE_KEY);
      }
    },
    [],
  );

  const value = useMemo(
    () => ({
      profiles,
      activeProfile,
      loading,
      selectProfile,
      clearActiveProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      setProfilePublic,
    }),
    [
      profiles,
      activeProfile,
      loading,
      selectProfile,
      clearActiveProfile,
      createProfile,
      updateProfile,
      deleteProfile,
      setProfilePublic,
    ],
  );

  return (
    <IptvProfileContext.Provider value={value}>
      {children}
    </IptvProfileContext.Provider>
  );
}

export function useIptvProfile(): IptvProfileContextValue {
  const ctx = useContext(IptvProfileContext);
  if (!ctx) throw new Error('useIptvProfile doit être utilisé dans IptvProfileProvider');
  return ctx;
}
