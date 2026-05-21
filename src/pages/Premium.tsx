import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslationKey } from '../i18n';
import { AppLogo } from '../components/AppLogo';
import { Focusable } from '../components/Focusable';
import {
  PLAN_OPTIONS,
  type PlanInterval,
} from '../types/subscription.types';
import styles from './Premium.module.css';

// Libellés traduits par formule (le prix/devise reste dans subscription.types).
const PLAN_I18N: Record<
  PlanInterval,
  { labelKey: TranslationKey; periodKey: TranslationKey; hintKey?: TranslationKey }
> = {
  yearly: {
    labelKey: 'premium.planYearly',
    periodKey: 'premium.periodYear',
    hintKey: 'premium.planYearlyHint',
  },
  monthly: { labelKey: 'premium.planMonthly', periodKey: 'premium.periodMonth' },
};

const PERKS_I18N: { icon: string; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  { icon: '👥', titleKey: 'premium.perkProfilesTitle', descKey: 'premium.perkProfilesDesc' },
  { icon: '☁️', titleKey: 'premium.perkSyncTitle', descKey: 'premium.perkSyncDesc' },
  { icon: '🎬', titleKey: 'premium.perkCineTitle', descKey: 'premium.perkCineDesc' },
  { icon: '🌐', titleKey: 'premium.perkCommunityTitle', descKey: 'premium.perkCommunityDesc' },
  { icon: '🖼️', titleKey: 'premium.perkVisualsTitle', descKey: 'premium.perkVisualsDesc' },
  { icon: '⚡', titleKey: 'premium.perkSupportTitle', descKey: 'premium.perkSupportDesc' },
];

interface Props {
  /** Si rendu via le garde de route : nom de la section bloquée. */
  lockedFeature?: string;
  /** Si fourni, affiche un lien « Retour » (contexte hors-routeur). */
  onBack?: () => void;
}

const PREMIUM_PUBLIC_URL =
  (import.meta.env.VITE_PREMIUM_URL as string | undefined)?.replace(/\/$/, '') || '';

export function Premium({ lockedFeature, onBack }: Props) {
  const { isPremium, subscription, startCheckout, refresh } = useSubscription();
  const { t, fmtDate } = useI18n();
  const fmtD = (ms: number | null): string => (ms ? fmtDate(ms) : '—');
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
      setError(e instanceof Error ? e.message : t('premium.unavailable'));
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
        <button className={styles.back} onClick={onBack} aria-label={t('premium.back')}>
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
          <div className={styles.activeBadge}>{t('premium.subActive')}</div>
          <h1 className={styles.title}>{t('premium.youArePremium')}</h1>
          <p className={styles.sub}>
            {opt
              ? t('premium.planFmt', {
                  plan: t(PLAN_I18N[opt.interval].labelKey).toLowerCase(),
                })
              : t('premium.planActive')}
            {subscription.currentPeriodEnd && (
              <>
                {' · '}
                {subscription.cancelAtPeriodEnd
                  ? t('premium.endsOn')
                  : t('premium.renewsOn')}
                {fmtD(subscription.currentPeriodEnd)}
              </>
            )}
          </p>
          <div className={styles.perksMini}>
            {PERKS_I18N.map((p) => (
              <span key={p.titleKey} className={styles.perkChip}>
                {p.icon} {t(p.titleKey)}
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
            {isPremium ? t('premium.paymentConfirmed') : t('premium.activating')}
          </div>
          <h1 className={styles.title}>
            {isPremium ? t('premium.welcome') : t('premium.paymentReceived')}
          </h1>
          <p className={styles.sub}>
            {isPremium ? t('premium.unlockedAll') : t('premium.activatingDesc')}
          </p>
          {isPremium && (
            <Focusable
              className={`btn btn-primary ${styles.cta}`}
              onEnter={clearStatus}
              onClick={clearStatus}
            >
              {t('premium.continue')}
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
            {t('premium.lockedFeature', { feature: lockedFeature })}
          </div>
        )}
        <h1 className={styles.title}>{t('premium.unlockAll')}</h1>
        <p className={styles.sub}>{t('premium.pitch')}</p>
      </div>

      {checkoutStatus === 'cancel' && (
        <div className={styles.notice}>{t('premium.cancelled')}</div>
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
                <span className={styles.planName}>{t(PLAN_I18N[o.interval].labelKey)}</span>
                <span className={styles.planPrice}>
                  {o.price}
                  <span className={styles.planPeriod}>{t(PLAN_I18N[o.interval].periodKey)}</span>
                </span>
                {PLAN_I18N[o.interval].hintKey && (
                  <span className={styles.planHint}>{t(PLAN_I18N[o.interval].hintKey!)}</span>
                )}
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
              <><AppLogo spin size={18} />{t('premium.redirecting')}</>
            ) : (
              t('premium.subscribe', {
                price: selected.price,
                period: t(PLAN_I18N[selected.interval].periodKey),
              })
            )}
          </Focusable>

          <p className={styles.secure}>{t('premium.secure')}</p>

          {/* ── QR TV ── */}
          {qr && (
            <div className={styles.tvBox}>
              <div className={styles.tvText}>
                <strong>{t('premium.onTv')}</strong>
                <span>{t('premium.scanQr')}</span>
              </div>
              <img className={styles.qr} src={qr} alt={t('premium.qrAlt')} width={120} height={120} />
            </div>
          )}
        </div>

        {/* ── Avantages ── */}
        <div className={styles.perks}>
          {PERKS_I18N.map((p) => (
            <div key={p.titleKey} className={styles.perk}>
              <span className={styles.perkIcon}>{p.icon}</span>
              <div className={styles.perkText}>
                <span className={styles.perkTitle}>{t(p.titleKey)}</span>
                <span className={styles.perkDesc}>{t(p.descKey)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
