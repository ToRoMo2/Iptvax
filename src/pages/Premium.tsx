import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useSubscription } from '../contexts/SubscriptionContext';
import { AppLogo } from '../components/AppLogo';
import { Focusable } from '../components/Focusable';
import {
  PLAN_OPTIONS,
  PREMIUM_PERKS,
  type PlanInterval,
} from '../types/subscription.types';
import styles from './Premium.module.css';

interface Props {
  /** Si rendu via le garde de route : nom de la section bloquée. */
  lockedFeature?: string;
  /** Si fourni, affiche un lien « Retour » (contexte hors-routeur). */
  onBack?: () => void;
}

const PREMIUM_PUBLIC_URL =
  (import.meta.env.VITE_PREMIUM_URL as string | undefined)?.replace(/\/$/, '') || '';

function fmtDate(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function Premium({ lockedFeature, onBack }: Props) {
  const { isPremium, subscription, startCheckout, refresh } = useSubscription();
  const [params, setParams] = useSearchParams();
  const [plan, setPlan] = useState<PlanInterval>('yearly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const checkoutStatus = params.get('status'); // 'success' | 'cancel' | null

  // QR → ouvre /premium sur le téléphone (paiement difficile sur TV).
  useEffect(() => {
    const base = PREMIUM_PUBLIC_URL || window.location.origin;
    QRCode.toDataURL(`${base}/premium`, {
      margin: 1,
      width: 260,
      color: { dark: '#000000', light: '#FFFFFF' },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, []);

  // Retour de Stripe : on sonde l'abonnement jusqu'au déblocage (le webhook
  // peut prendre 1–2 s ; le Realtime couvre aussi, ceci est un filet).
  const polling = useRef(false);
  useEffect(() => {
    if (checkoutStatus !== 'success' || isPremium || polling.current) return;
    polling.current = true;
    let tries = 0;
    const tick = async () => {
      tries += 1;
      await refresh();
      if (tries < 8) setTimeout(() => void tick(), 2000);
    };
    void tick();
  }, [checkoutStatus, isPremium, refresh]);

  const handleSubscribe = async () => {
    setError(null);
    setBusy(true);
    try {
      await startCheckout(plan);
      // startCheckout redirige : si on revient ici, c'est une erreur.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Paiement indisponible');
      setBusy(false);
    }
  };

  const clearStatus = () => {
    params.delete('status');
    setParams(params, { replace: true });
  };

  const header = (
    <div className={styles.brand}>
      {onBack && (
        <button className={styles.back} onClick={onBack} aria-label="Retour">
          ←
        </button>
      )}
      <AppLogo size={26} />
      IPTVAX <span className={styles.plus}>Premium</span>
    </div>
  );

  /* ── Déjà Premium ───────────────────────────────────────────────────── */
  if (isPremium && checkoutStatus !== 'success') {
    const opt = PLAN_OPTIONS.find((o) => o.interval === subscription.plan);
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.activeCard}>
          <div className={styles.activeBadge}>✓ Abonnement actif</div>
          <h1 className={styles.title}>Vous êtes Premium</h1>
          <p className={styles.sub}>
            {opt ? `Formule ${opt.label.toLowerCase()}` : 'Abonnement actif'}
            {subscription.currentPeriodEnd && (
              <>
                {' · '}
                {subscription.cancelAtPeriodEnd ? 'se termine le ' : 'renouvellement le '}
                {fmtDate(subscription.currentPeriodEnd)}
              </>
            )}
          </p>
          <div className={styles.perksMini}>
            {PREMIUM_PERKS.map((p) => (
              <span key={p.title} className={styles.perkChip}>
                {p.icon} {p.title}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Confirmation paiement ──────────────────────────────────────────── */
  if (checkoutStatus === 'success') {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.activeCard}>
          <div className={styles.activeBadge}>
            {isPremium ? '✓ Paiement confirmé' : '⏳ Activation en cours…'}
          </div>
          <h1 className={styles.title}>
            {isPremium ? 'Bienvenue chez Premium !' : 'Paiement reçu'}
          </h1>
          <p className={styles.sub}>
            {isPremium
              ? 'Toutes les fonctionnalités Premium sont débloquées sur cet appareil et tous les autres.'
              : 'Nous activons votre compte… cela prend quelques secondes. Cette page se met à jour automatiquement.'}
          </p>
          {isPremium && (
            <Focusable
              className={`btn btn-primary ${styles.cta}`}
              onEnter={clearStatus}
              onClick={clearStatus}
            >
              Continuer
            </Focusable>
          )}
          {!isPremium && <AppLogo spin size={28} />}
        </div>
      </div>
    );
  }

  /* ── Page de vente ──────────────────────────────────────────────────── */
  const selected = PLAN_OPTIONS.find((o) => o.interval === plan)!;

  return (
    <div className={styles.screen}>
      <div className={styles.brand}>
        <AppLogo size={26} />
        IPTVAX <span className={styles.plus}>Premium</span>
      </div>

      <div className={styles.hero}>
        {lockedFeature && (
          <div className={styles.eyebrow}>
            🔒 {lockedFeature} est réservé aux membres Premium
          </div>
        )}
        <h1 className={styles.title}>Débloquez tout IPTVAX</h1>
        <p className={styles.sub}>
          Profils illimités, synchronisation sur tous vos appareils, votre mur
          de cinéma personnel et bien plus. Annulable à tout moment.
        </p>
      </div>

      {checkoutStatus === 'cancel' && (
        <div className={styles.notice}>
          Paiement annulé — aucun montant n'a été débité.
        </div>
      )}

      <div className={styles.layout}>
        {/* ── Offre + CTA ── */}
        <div className={styles.offer}>
          <div className={styles.planToggle}>
            {PLAN_OPTIONS.map((o) => (
              <Focusable
                key={o.interval}
                className={`${styles.planOpt} ${
                  plan === o.interval ? styles.planOptActive : ''
                }`}
                onEnter={() => setPlan(o.interval)}
                onClick={() => setPlan(o.interval)}
              >
                <span className={styles.planName}>{o.label}</span>
                <span className={styles.planPrice}>
                  {o.price}
                  <span className={styles.planPeriod}>{o.period}</span>
                </span>
                {o.hint && <span className={styles.planHint}>{o.hint}</span>}
              </Focusable>
            ))}
          </div>

          {error && <div className={styles.error}>{error}</div>}

          <Focusable
            className={`btn btn-primary ${styles.cta}`}
            onEnter={() => void handleSubscribe()}
            onClick={() => void handleSubscribe()}
          >
            {busy ? (
              <><AppLogo spin size={18} />Redirection vers le paiement…</>
            ) : (
              `S'abonner — ${selected.price} ${selected.period}`
            )}
          </Focusable>

          <p className={styles.secure}>
            🔒 Paiement sécurisé par Stripe · Sans engagement · Résiliable en 1 clic
          </p>

          {/* ── QR TV ── */}
          {qr && (
            <div className={styles.tvBox}>
              <div className={styles.tvText}>
                <strong>Vous êtes sur une TV ?</strong>
                <span>
                  Scannez ce code avec votre téléphone pour payer
                  facilement. Le déblocage est instantané sur la TV.
                </span>
              </div>
              <img className={styles.qr} src={qr} alt="QR code paiement" width={120} height={120} />
            </div>
          )}
        </div>

        {/* ── Avantages ── */}
        <div className={styles.perks}>
          {PREMIUM_PERKS.map((p) => (
            <div key={p.title} className={styles.perk}>
              <span className={styles.perkIcon}>{p.icon}</span>
              <div className={styles.perkText}>
                <span className={styles.perkTitle}>{p.title}</span>
                <span className={styles.perkDesc}>{p.desc}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
