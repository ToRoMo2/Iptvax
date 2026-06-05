import { supabase } from '../lib/supabase';
import { isNative } from '../lib/platform';
import { WEB_URL } from '../config/vitrine';
import type { Subscription, SubscriptionStatus, PlanInterval } from '../types/subscription.types';

interface SubscriptionRow {
  status: string;
  plan: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
}

const FREE: Subscription = {
  status: 'free',
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

function rowToSub(r: SubscriptionRow): Subscription {
  return {
    status: (r.status as SubscriptionStatus) ?? 'free',
    plan: (r.plan as PlanInterval | null) ?? null,
    currentPeriodEnd: r.current_period_end ? Date.parse(r.current_period_end) : null,
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
  };
}

const FUNCTIONS_BASE = `${(import.meta.env.VITE_SUPABASE_URL as string).replace(/\/$/, '')}/functions/v1`;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const subscriptionService = {
  /**
   * Lit l'abonnement du compte. ⚠ Distingue STRICTEMENT « pas de ligne »
   * (tier gratuit légitime) d'une « erreur de lecture » :
   * `maybeSingle()` renvoie `data:null, error:null` quand il n'y a pas de
   * ligne — donc une `error` non nulle est TOUJOURS un aléa transitoire
   * (réseau, JWT pas encore propagé juste après connexion/changement de
   * compte, RLS le temps que la session s'établisse). On retente ces erreurs ;
   * un échec persistant est PROPAGÉ (jamais transformé en « gratuit »
   * silencieux). Sans ça, un membre payant bascule sur l'UI gratuite au
   * moindre hoquet réseau et doit relancer l'app pour récupérer son Premium.
   */
  async get(userId: string): Promise<Subscription> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await supabase
        .from('subscriptions')
        .select('status, plan, current_period_end, cancel_at_period_end')
        .eq('user_id', userId)
        .maybeSingle();
      if (!error) {
        // Requête aboutie : `null` = aucune ligne = tier gratuit légitime.
        return data ? rowToSub(data as SubscriptionRow) : FREE;
      }
      lastError = error;
      if (attempt < 3) await delay(400 * 2 ** attempt); // 400ms, 800ms, 1.6s
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("Lecture de l'abonnement impossible");
  },

  /**
   * Crée une session Stripe Checkout via l'Edge Function et renvoie l'URL
   * hébergée Stripe. Le JWT Supabase authentifie l'appel côté serveur.
   */
  async createCheckout(plan: PlanInterval): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('Connexion requise');

    const res = await fetch(`${FUNCTIONS_BASE}/create-checkout-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        plan,
        // En natif, `window.location.origin` vaut `https://localhost` (non
        // joignable depuis l'onglet Stripe externe) → on renvoie vers la vraie
        // page publique de la vitrine. Sur web/Electron : origin courant.
        returnUrl: `${isNative ? WEB_URL : window.location.origin}/premium`,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || 'Création du paiement impossible');
    }
    const { url } = (await res.json()) as { url?: string };
    if (!url) throw new Error('Réponse de paiement invalide');
    return url;
  },

  /**
   * Écoute en Realtime les changements de la ligne d'abonnement du compte.
   * Permet à la TV de se débloquer automatiquement après paiement mobile.
   */
  subscribeToChanges(userId: string, onChange: (sub: Subscription) => void): () => void {
    const channel = supabase
      .channel(`sub:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'subscriptions', filter: `user_id=eq.${userId}` },
        (payload) => {
          const next = payload.new as SubscriptionRow | undefined;
          onChange(next ? rowToSub(next) : FREE);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  },
};
