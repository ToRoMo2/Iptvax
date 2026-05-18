import type { ReactNode } from 'react';
import { useSubscription } from '../contexts/SubscriptionContext';
import { Premium } from '../pages/Premium';

interface Props {
  /** Nom de la fonctionnalité bloquée — affiché en accroche sur la page Premium. */
  feature: string;
  children: ReactNode;
}

/**
 * Garde de route : rend l'enfant si Premium, sinon la page d'abonnement
 * avec une accroche contextuelle. Pendant le chargement de l'abonnement on
 * laisse passer (évite un flash de paywall pour un membre déjà payant).
 */
export function PremiumOnly({ feature, children }: Props) {
  const { isPremium, loading } = useSubscription();
  if (loading || isPremium) return <>{children}</>;
  return <Premium lockedFeature={feature} />;
}
