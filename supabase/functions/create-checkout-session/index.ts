// Edge Function : crée une session Stripe Checkout pour l'abonnement Premium.
//
// Sécurité : authentifie l'appelant via son JWT Supabase (header Authorization).
// Les Price IDs et la clé secrète Stripe restent côté serveur (secrets) —
// le client n'envoie que "monthly" | "yearly".
//
// Secrets requis (supabase secrets set ...) :
//   STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY
// Auto-injectés par Supabase : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//   SUPABASE_ANON_KEY.

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, {
  apiVersion: '2025-01-27.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});

const PRICES: Record<string, string | undefined> = {
  monthly: Deno.env.get('STRIPE_PRICE_MONTHLY'),
  yearly: Deno.env.get('STRIPE_PRICE_YEARLY'),
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return new Response('Non authentifié', { status: 401, headers: cors });
    }

    const { plan, returnUrl } = await req.json();
    const price = PRICES[plan];
    if (!price) {
      return new Response('Formule invalide', { status: 400, headers: cors });
    }

    // Réutilise le customer Stripe existant si déjà connu (service-role :
    // bypass RLS pour lire la ligne d'abonnement).
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
    }

    const base = (returnUrl as string) || `${new URL(req.url).origin}/premium`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      success_url: `${base}?status=success`,
      cancel_url: `${base}?status=cancel`,
      allow_promotion_codes: true,
      // Avec un coupon 100 % (ex. PROCHES100 pour les testeurs), le total devient
      // 0 € → 'if_required' évite de demander une carte. Pour un abonnement payant
      // normal, Stripe collecte la carte comme d'habitude.
      payment_method_collection: 'if_required',
      subscription_data: { metadata: { user_id: user.id } },
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(
      e instanceof Error ? e.message : 'Erreur interne',
      { status: 500, headers: cors },
    );
  }
});
