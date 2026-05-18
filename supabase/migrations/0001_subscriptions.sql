-- ============================================================================
--  Abonnement Premium — table `subscriptions`
--  Niveau COMPTE (auth.users), pas profil IPTV : un abonnement débloque
--  tous les profils du compte (modèle Netflix).
--
--  À exécuter dans Supabase → SQL Editor.
--
--  Sécurité :
--   - L'utilisateur peut LIRE sa propre ligne (RLS select).
--   - AUCUN insert/update/delete côté client : seule la Edge Function
--     `stripe-webhook` (service-role) écrit ici → l'état d'abonnement
--     ne peut pas être falsifié depuis le frontend.
--   - Absence de ligne  ==  tier gratuit (le frontend traite null = free).
-- ============================================================================

create table if not exists public.subscriptions (
  user_id                uuid primary key
                           references auth.users (id) on delete cascade,
  status                 text not null default 'free',
  -- 'free' | 'trialing' | 'active' | 'past_due' | 'canceled' | 'incomplete'
  plan                   text,
  -- 'monthly' | 'yearly' | null
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  updated_at             timestamptz not null default now()
);

create index if not exists subscriptions_stripe_customer_idx
  on public.subscriptions (stripe_customer_id);

alter table public.subscriptions enable row level security;

-- Lecture : uniquement sa propre ligne.
drop policy if exists "read own subscription" on public.subscriptions;
create policy "read own subscription"
  on public.subscriptions
  for select
  using (auth.uid() = user_id);

-- AUCUNE policy insert/update/delete : la service-role (webhook Stripe)
-- bypass la RLS, le client n'a donc jamais le droit d'écrire.

-- Realtime : le frontend (TV) écoute sa ligne pour se débloquer
-- automatiquement après paiement sur le téléphone.
alter publication supabase_realtime add table public.subscriptions;
