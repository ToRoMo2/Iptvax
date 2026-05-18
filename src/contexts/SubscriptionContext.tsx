import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { useSupabaseAuth } from './SupabaseAuthContext';
import { subscriptionService } from '../services/subscription.service';
import { tmdbService } from '../services/tmdb.service';
import type { Subscription, PlanInterval } from '../types/subscription.types';

interface SubscriptionContextValue {
  loading: boolean;
  subscription: Subscription;
  /** Accès aux fonctionnalités payantes (statut actif/essai non expiré). */
  isPremium: boolean;
  /** Recharge l'abonnement (retour de Stripe Checkout). */
  refresh: () => Promise<void>;
  /** Lance le paiement Stripe (redirige vers la page hébergée). */
  startCheckout: (plan: PlanInterval) => Promise<void>;
}

const FREE: Subscription = {
  status: 'free',
  plan: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

// Bypass DEV uniquement : permet de tester le gating sans Stripe configuré.
const DEV_FORCE_PREMIUM =
  import.meta.env.DEV && import.meta.env.VITE_DEV_FORCE_PREMIUM === 'true';

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

function computeIsPremium(sub: Subscription): boolean {
  if (DEV_FORCE_PREMIUM) return true;
  if (sub.status !== 'active' && sub.status !== 'trialing') return false;
  if (sub.currentPeriodEnd != null && sub.currentPeriodEnd < Date.now()) return false;
  return true;
}

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user } = useSupabaseAuth();
  const userId = user?.id ?? null;

  const [subscription, setSubscription] = useState<Subscription>(FREE);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!userId) {
      setSubscription(FREE);
      setLoading(false);
      return;
    }
    const sub = await subscriptionService.get(userId);
    setSubscription(sub);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      if (!userId) {
        setSubscription(FREE);
        setLoading(false);
        return;
      }
      const sub = await subscriptionService.get(userId);
      if (!cancelled) {
        setSubscription(sub);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Realtime : déblocage auto après paiement (notamment scénario QR/TV).
  useEffect(() => {
    if (!userId) return;
    return subscriptionService.subscribeToChanges(userId, setSubscription);
  }, [userId]);

  const isPremium = useMemo(() => computeIsPremium(subscription), [subscription]);

  // TMDB est une fonctionnalité Premium : on coupe l'enrichissement pour le
  // tier gratuit (l'UI retombe gracieusement sur les données Xtream — §IV).
  useEffect(() => {
    tmdbService.setEnabled(isPremium);
  }, [isPremium]);

  const startCheckout = useCallback(async (plan: PlanInterval) => {
    const url = await subscriptionService.createCheckout(plan);
    window.location.href = url;
  }, []);

  const value = useMemo(
    () => ({ loading, subscription, isPremium, refresh: load, startCheckout }),
    [loading, subscription, isPremium, load, startCheckout],
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription doit être utilisé dans SubscriptionProvider');
  return ctx;
}
