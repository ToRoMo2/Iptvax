export type SubscriptionStatus =
  | 'free'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete';

export type PlanInterval = 'monthly' | 'yearly';

export interface Subscription {
  status: SubscriptionStatus;
  plan: PlanInterval | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
}

export interface PlanOption {
  interval: PlanInterval;
  label: string;
  price: string;
  period: string;
  hint?: string;
}

export const PLAN_OPTIONS: PlanOption[] = [
  { interval: 'yearly', label: 'Annuel', price: '17,99 €', period: '/ an', hint: 'Économisez ~40 %' },
  { interval: 'monthly', label: 'Mensuel', price: '2,49 €', period: '/ mois' },
];

export const PREMIUM_PERKS: { icon: string; title: string; desc: string }[] = [
  { icon: '👥', title: 'Profils illimités', desc: 'Un profil par membre du foyer, comme sur Netflix.' },
  { icon: '☁️', title: 'Sync multi-appareils', desc: 'Favoris, reprise et historique synchronisés TV, mobile et PC.' },
  { icon: '🎬', title: 'Mon ciné', desc: 'Votre mur de visionnages, notes 0,5–5 et critiques personnelles.' },
  { icon: '🌐', title: 'Communauté', desc: 'Suivez d\'autres cinéphiles, partagez vos notes, comparez vos goûts.' },
  { icon: '🖼️', title: 'Visuels HD + bandes-annonces', desc: 'Affiches, fonds, casting et trailers enrichis via TMDB.' },
  { icon: '⚡', title: 'Support prioritaire', desc: 'Vos retours et demandes traités en priorité.' },
];
