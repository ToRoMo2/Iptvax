import { supabase } from '../lib/supabase';
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

export const subscriptionService = {
  /** Lit l'abonnement du compte. Absence de ligne → tier gratuit. */
  async get(userId: string): Promise<Subscription> {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('status, plan, current_period_end, cancel_at_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return FREE;
    return rowToSub(data as SubscriptionRow);
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
        returnUrl: `${window.location.origin}/premium`,
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
