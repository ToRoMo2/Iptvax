// Edge Function : webhook Stripe → réconcilie l'état d'abonnement.
//
// SEUL écrivain de la table `subscriptions` (service-role, bypass RLS) →
// l'état Premium ne peut pas être falsifié depuis le frontend.
//
// Déployer SANS vérification JWT (Stripe n'envoie pas de JWT Supabase) :
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   (ou Dashboard → la fonction → Details → "Verify JWT" = OFF)
//
// Secrets requis : STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   STRIPE_PRICE_MONTHLY, STRIPE_PRICE_YEARLY
// Auto-injectés : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import Stripe from 'https://esm.sh/stripe@17.7.0?target=deno';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

// `.trim()` : un espace / saut de ligne collé en fin de secret (erreur de
// copier-coller fréquente dans le Dashboard) casse la vérif de signature.
const STRIPE_SECRET_KEY = (Deno.env.get('STRIPE_SECRET_KEY') ?? '').trim();
const WEBHOOK_SECRET = (Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '').trim();
const PRICE_MONTHLY = Deno.env.get('STRIPE_PRICE_MONTHLY');
const PRICE_YEARLY = Deno.env.get('STRIPE_PRICE_YEARLY');

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2025-01-27.acacia',
  httpClient: Stripe.createFetchHttpClient(),
});
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const admin = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
);

function planFromPrice(priceId: string | undefined): string | null {
  if (priceId && priceId === PRICE_YEARLY) return 'yearly';
  if (priceId && priceId === PRICE_MONTHLY) return 'monthly';
  return null;
}

function mapStatus(s: string): string {
  switch (s) {
    case 'active':
    case 'trialing':
    case 'past_due':
    case 'canceled':
    case 'incomplete':
      return s;
    case 'unpaid':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return 'incomplete';
  }
}

/**
 * `current_period_end` a été déplacé hors de l'objet Subscription dans les
 * versions d'API Stripe récentes (→ items[].current_period_end). On lit les
 * deux emplacements et on tolère l'absence (colonne nullable).
 */
function periodEndISO(sub: Stripe.Subscription): string | null {
  // deno-lint-ignore no-explicit-any
  const anySub = sub as any;
  const top = anySub.current_period_end;
  const item = anySub.items?.data?.[0];
  const ts =
    typeof top === 'number'
      ? top
      : typeof item?.current_period_end === 'number'
        ? item.current_period_end
        : null;
  return ts ? new Date(ts * 1000).toISOString() : null;
}

async function resolveUserId(
  sub: Stripe.Subscription,
  customerId: string,
  fallbackUserId?: string,
): Promise<string | undefined> {
  let userId = (sub.metadata?.user_id as string | undefined) ?? fallbackUserId;
  if (userId) return userId;

  // Via la ligne existante (clé customer)…
  const { data: byRow } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  if (byRow?.user_id) return byRow.user_id as string;

  // …sinon via les metadata du customer Stripe.
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!('deleted' in customer) || !customer.deleted) {
      userId = (customer.metadata?.user_id as string | undefined) ?? undefined;
    }
  } catch (e) {
    console.error('[stripe-webhook] customer.retrieve', e);
  }
  return userId;
}

async function upsertFromSubscription(
  sub: Stripe.Subscription,
  fallbackUserId?: string,
) {
  const customerId =
    typeof sub.customer === 'string' ? sub.customer : sub.customer.id;

  const userId = await resolveUserId(sub, customerId, fallbackUserId);
  if (!userId) {
    console.error('[stripe-webhook] user_id introuvable', { customerId, subId: sub.id });
    return;
  }

  const priceId = sub.items?.data?.[0]?.price?.id;
  const row = {
    user_id: userId,
    status: mapStatus(sub.status),
    plan: planFromPrice(priceId),
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    current_period_end: periodEndISO(sub),
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from('subscriptions')
    .upsert(row, { onConflict: 'user_id' });
  if (error) {
    console.error('[stripe-webhook] upsert', error.message);
  } else {
    console.log('[stripe-webhook] OK', { userId, status: row.status, plan: row.plan });
  }
}

Deno.serve(async (req) => {
  if (!STRIPE_SECRET_KEY || !WEBHOOK_SECRET) {
    console.error('[stripe-webhook] secrets manquants', {
      hasSecretKey: Boolean(STRIPE_SECRET_KEY),
      hasWebhookSecret: Boolean(WEBHOOK_SECRET),
    });
    return new Response('Secrets non configurés', { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  const body = await req.text();
  if (!sig) return new Response('Signature manquante', { status: 400 });

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      sig,
      WEBHOOK_SECRET,
      undefined,
      cryptoProvider,
    );
  } catch (e) {
    console.error('[stripe-webhook] signature', e instanceof Error ? e.message : e);
    return new Response(
      `Signature invalide : ${e instanceof Error ? e.message : ''}`,
      { status: 400 },
    );
  }

  console.log('[stripe-webhook] event', event.type);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object as Stripe.Checkout.Session;
        const subId =
          typeof s.subscription === 'string'
            ? s.subscription
            : s.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertFromSubscription(
            sub,
            (s.client_reference_id as string) || undefined,
          );
        } else {
          console.error('[stripe-webhook] session sans subscription', s.id);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertFromSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      default:
        break;
    }
  } catch (e) {
    console.error('[stripe-webhook]', e instanceof Error ? e.message : e);
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
