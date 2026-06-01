import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { PluginListenerHandle } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { useSupabaseAuth } from './SupabaseAuthContext';
import { subscriptionService } from '../services/subscription.service';
import { tmdbService } from '../services/tmdb.service';
import { isCapacitor } from '../lib/platform';
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

  // Natif (Capacitor) : un onglet Stripe est ouvert via `Browser.open`. On note
  // son ouverture pour pouvoir le refermer dès que l'abonnement passe actif.
  const checkoutOpenRef = useRef(false);

  // Refermeture auto de l'onglet Stripe quand le paiement aboutit : le webhook
  // écrit `subscriptions`, le Realtime nous le pousse, `isPremium` bascule → on
  // ferme l'onglet et l'utilisateur retombe dans l'app (déjà Premium). Web :
  // pas concerné (redirection page entière via success_url).
  useEffect(() => {
    if (!isCapacitor) return;
    if (isPremium && checkoutOpenRef.current) {
      checkoutOpenRef.current = false;
      Browser.close().catch(() => {/* onglet déjà fermé */});
    }
  }, [isPremium]);

  // Si l'utilisateur ferme l'onglet Stripe lui-même (sans payer), on oublie le flag.
  useEffect(() => {
    if (!isCapacitor) return;
    let handle: PluginListenerHandle | undefined;
    Browser.addListener('browserFinished', () => { checkoutOpenRef.current = false; })
      .then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  // TMDB est une fonctionnalité Premium : on coupe l'enrichissement pour le
  // tier gratuit (l'UI retombe gracieusement sur les données Xtream — §IV).
  useEffect(() => {
    tmdbService.setEnabled(isPremium);
  }, [isPremium]);

  const startCheckout = useCallback(async (plan: PlanInterval) => {
    const url = await subscriptionService.createCheckout(plan);
    if (isCapacitor) {
      // Onglet système (Custom Tab) : garde l'app vivante en arrière-plan →
      // on peut refermer l'onglet à l'activation (cf. effet ci-dessus).
      checkoutOpenRef.current = true;
      await Browser.open({ url });
    } else {
      // Web / Electron / TV : redirection page entière, retour via success_url.
      window.location.href = url;
    }
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
