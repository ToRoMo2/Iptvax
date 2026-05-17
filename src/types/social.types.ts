// Couche communautaire : annuaire des cinés publics, suivis, notes de membres.
// Aucune donnée sensible (jamais de credentials Xtream — exposés via la vue
// `public_profiles` côté SQL, sous-ensemble sûr). Couche `types/` : seulement
// des `import type` (corset §VII).
import type { ProfileColor } from './profile.types';

/** Identité publique d'un profil (sous-ensemble sûr de `iptv_profiles`). */
export interface PublicProfile {
  id: string;
  name: string;
  discriminator: string | null;
  avatar: string;
  color: ProfileColor;
}

/** Profil public + agrégats (vue `public_profile_stats`). */
export interface PublicProfileStats extends PublicProfile {
  watchedCount: number;
  ratedCount: number;
  /** Moyenne des notes que CE membre a données à ses films/séries. */
  avgRating: number | null;
  /** Epoch ms du dernier ajout/maj, ou null. */
  lastActivity: number | null;
  followers: number;
  /** Note moyenne REÇUE par ce membre (réputation), ou null. */
  memberAvg: number | null;
  memberVotes: number;
}

/** Critère de classement de l'annuaire communautaire. */
export type DirectorySort = 'active' | 'top-members' | 'recent' | 'most-watched';
