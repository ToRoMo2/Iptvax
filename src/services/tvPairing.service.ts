import { supabase } from '../lib/supabase';

/**
 * Appairage TV ↔ téléphone (Phase 2f — onboarding TV par QR code).
 *
 * La TV crée une session d'appairage et affiche un QR ; le téléphone scanne,
 * authentifie l'utilisateur, choisit un profil et y dépose la session du
 * compte ; la TV la récupère et se débloque. Voir docs/native-port.md §4.
 *
 * La table `tv_pairings` est scellée (RLS sans policy) : tout passe par 3 RPC
 * `SECURITY DEFINER` (voir supabase/migrations/0002_tv_pairings.sql). Le réveil
 * instantané de la TV utilise Realtime Broadcast (indépendant du RLS) ; un
 * poll de repli côté TV couvre un éventuel signal manqué.
 */

/** Session d'appairage fraîchement créée par la TV. */
export interface PairingHandle {
  code: string;
  /** Échéance (ms epoch) au-delà de laquelle le code n'est plus valide. */
  expiresAt: number;
}

/** Session du compte récupérée par la TV après autorisation du téléphone. */
export interface ClaimedSession {
  userId: string;
  profileId: string;
  accessToken: string;
  refreshToken: string;
}

function channelName(code: string): string {
  return `tv-pairing:${code}`;
}

export const tvPairingService = {
  /** TV : crée une session d'appairage `pending`. */
  async create(): Promise<PairingHandle> {
    const { data, error } = await supabase.rpc('create_tv_pairing');
    const row = (data as { code: string; expires_at: string }[] | null)?.[0];
    if (error || !row) {
      throw new Error(error?.message ?? "Création de l'appairage impossible");
    }
    return { code: row.code, expiresAt: Date.parse(row.expires_at) };
  },

  /** Téléphone : dépose la session du compte + le profil choisi sur la ligne. */
  async authorize(
    code: string,
    profileId: string,
    accessToken: string,
    refreshToken: string,
  ): Promise<void> {
    const { error } = await supabase.rpc('authorize_tv_pairing', {
      p_code: code,
      p_profile_id: profileId,
      p_access_token: accessToken,
      p_refresh_token: refreshToken,
    });
    if (error) throw new Error(error.message);
  },

  /**
   * TV : tente de récupérer la session. Renvoie `null` tant que le téléphone
   * n'a pas autorisé (ou si la session est expirée / déjà consommée).
   */
  async claim(code: string): Promise<ClaimedSession | null> {
    const { data, error } = await supabase.rpc('claim_tv_pairing', {
      p_code: code,
    });
    if (error) throw new Error(error.message);
    const row = (data as {
      user_id: string;
      profile_id: string;
      access_token: string;
      refresh_token: string;
    }[] | null)?.[0];
    if (!row) return null;
    return {
      userId: row.user_id,
      profileId: row.profile_id,
      accessToken: row.access_token,
      refreshToken: row.refresh_token,
    };
  },

  /**
   * TV : écoute le signal Realtime « autorisé ». Renvoie une fonction de
   * désabonnement. La table étant scellée, on ne peut pas utiliser
   * `postgres_changes` (RLS) → on utilise Broadcast, indépendant du RLS.
   */
  listen(code: string, onAuthorized: () => void): () => void {
    const channel = supabase
      .channel(channelName(code))
      .on('broadcast', { event: 'authorized' }, () => onAuthorized())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  },

  /**
   * Téléphone : émet le signal « autorisé » pour réveiller la TV
   * instantanément. Best-effort (le poll de la TV est le filet de sécurité).
   */
  async notifyAuthorized(code: string): Promise<void> {
    const channel = supabase.channel(channelName(code));
    try {
      await new Promise<void>((resolve) => {
        const finish = () => resolve();
        const timer = setTimeout(finish, 3000);
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            channel
              .send({ type: 'broadcast', event: 'authorized', payload: {} })
              .finally(() => {
                clearTimeout(timer);
                finish();
              });
          }
        });
      });
    } finally {
      void supabase.removeChannel(channel);
    }
  },
};
