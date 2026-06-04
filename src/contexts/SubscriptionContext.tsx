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
import { App as CapacitorApp } from '@capacitor/app';
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

  // Récupère l'abonnement, l'applique, et renvoie l'état Premium calculé —
  // le retour booléen sert au polling de reprise (sonder sans dépendre du
  // re-render React pour lire `isPremium`).
  const fetchAndApply = useCallback(async (): Promise<boolean> => {
    if (!userId) {
      setSubscription(FREE);
      setLoading(false);
      return false;
    }
    const sub = await subscriptionService.get(userId);
    setSubscription(sub);
    setLoading(false);
    return computeIsPremium(sub);
  }, [userId]);

  const load = useCallback(async () => {
    await fetchAndApply();
  }, [fetchAndApply]);

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
  // Un paiement est en attente de confirmation : reste vrai jusqu'à ce que
  // l'abonnement bascule Premium (ou que le cycle de reprise s'épuise). Pilote
  // le ré-échantillonnage au retour dans l'app (cf. effet `appStateChange`).
  const checkoutPendingRef = useRef(false);
  // Empêche deux cycles de polling de reprise concurrents.
  const resumePollRef = useRef(false);

  // Refermeture auto de l'onglet Stripe quand le paiement aboutit : le webhook
  // écrit `subscriptions`, le Realtime nous le pousse, `isPremium` bascule → on
  // ferme l'onglet et l'utilisateur retombe dans l'app (déjà Premium). Web :
  // pas concerné (redirection page entière via success_url).
  useEffect(() => {
    if (!isCapacitor) return;
    if (isPremium && (checkoutOpenRef.current || checkoutPendingRef.current)) {
      checkoutOpenRef.current = false;
      checkoutPendingRef.current = false;
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

  // Retour dans l'app depuis l'onglet Stripe (Custom Tab). Stripe n'autorise pas
  // les schémas custom en `success_url` (cf. §X) : impossible de deep-linker vers
  // l'app comme pour l'OAuth Google. Or, l'app passée en arrière-plan voit son
  // JS/Realtime gelé par Android → l'activation peut passer inaperçue, et au
  // retour rien ne re-sondait l'abonnement (l'utilisateur devait fermer/rouvrir
  // l'app pour voir son Premium). Ici, dès que l'app repasse au premier plan
  // après un paiement, on re-sonde l'abonnement (court polling, le webhook a en
  // général déjà écrit). Dès que Premium bascule, l'effet ci-dessus referme
  // l'onglet → l'utilisateur retombe directement dans l'app, déjà Premium.
  useEffect(() => {
    if (!isCapacitor) return;
    let handle: PluginListenerHandle | undefined;
    let stopped = false;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive || !checkoutPendingRef.current || resumePollRef.current) return;
      resumePollRef.current = true;
      let tries = 0;
      const tick = async () => {
        if (stopped) { resumePollRef.current = false; return; }
        tries += 1;
        const premium = await fetchAndApply();
        if (premium) {
          checkoutPendingRef.current = false;
          resumePollRef.current = false;
          return;
        }
        if (tries < 6) {
          setTimeout(() => void tick(), 1500);
          return;
        }
        // Cycle épuisé : on arrête de sonder (le Realtime prend le relais
        // maintenant que l'app est au premier plan, JS dégelé).
        checkoutPendingRef.current = false;
        resumePollRef.current = false;
      };
      void tick();
    }).then((h) => { handle = h; });
    return () => { stopped = true; handle?.remove(); };
  }, [fetchAndApply]);

  // TMDB est une fonctionnalité Premium : on coupe l'enrichissement pour le
  // tier gratuit (l'UI retombe gracieusement sur les données Xtream — §IV).
  useEffect(() => {
    tmdbService.setEnabled(isPremium);
  }, [isPremium]);

  const startCheckout = useCallback(async (plan: PlanInterval) => {
    const url = await subscriptionService.createCheckout(plan);
    if (isCapacitor) {
      // Onglet système (Custom Tab) : garde l'app vivante en arrière-plan →
      // on peut refermer l'onglet à l'activation (cf. effet ci-dessus) et
      // re-sonder l'abonnement au retour au premier plan (effet appStateChange).
      checkoutOpenRef.current = true;
      checkoutPendingRef.current = true;
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
