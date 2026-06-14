import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useSupabaseAuth } from '../contexts/SupabaseAuthContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslationKey } from '../i18n';
import { AppLogo } from '../components/AppLogo';
import { Focusable } from '../components/Focusable';
import {
  IconCheckCircle,
  IconAlert,
  IconLock,
  IconShield,
  IconUsers,
  IconCloud,
  IconFilm,
  IconGlobe,
  IconImage,
  IconBolt,
} from '../components/PremiumIcons';
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

type IconCmp = ComponentType<{ size?: number; className?: string }>;

const PERKS_I18N: { Icon: IconCmp; titleKey: TranslationKey; descKey: TranslationKey }[] = [
  { Icon: IconUsers, titleKey: 'premium.perkProfilesTitle', descKey: 'premium.perkProfilesDesc' },
  { Icon: IconCloud, titleKey: 'premium.perkSyncTitle', descKey: 'premium.perkSyncDesc' },
  { Icon: IconFilm, titleKey: 'premium.perkCineTitle', descKey: 'premium.perkCineDesc' },
  { Icon: IconGlobe, titleKey: 'premium.perkCommunityTitle', descKey: 'premium.perkCommunityDesc' },
  { Icon: IconImage, titleKey: 'premium.perkVisualsTitle', descKey: 'premium.perkVisualsDesc' },
  { Icon: IconBolt, titleKey: 'premium.perkSupportTitle', descKey: 'premium.perkSupportDesc' },
];

interface Props {
  /** Si rendu via le garde de route : nom de la section bloquée. */
  lockedFeature?: string;
  /** Si fourni, affiche un lien « Retour » (contexte hors-routeur). */
  onBack?: () => void;
}

const PREMIUM_PUBLIC_URL =
  (import.meta.env.VITE_PREMIUM_URL as string | undefined)?.replace(/\/$/, '') || '';

// Combien de fois (× 2 s) on sonde l'abonnement après le retour de Stripe avant
// d'afficher l'état « activation à confirmer ». Le webhook met 1–2 s en général ;
// on laisse une marge confortable avant de proposer un nouvel essai.
const ACTIVATION_POLL_MAX = 10;

export function Premium({ lockedFeature, onBack }: Props) {
  const { isPremium, subscription, startCheckout, refresh } = useSubscription();
  const { user, loading: authLoading } = useSupabaseAuth();
  const { t, fmtDate } = useI18n();
  const fmtD = (ms: number | null): string => (ms ? fmtDate(ms) : '—');
  const [params] = useSearchParams();
  const [plan, setPlan] = useState<PlanInterval>('yearly');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [activationFailed, setActivationFailed] = useState(false);

  const checkoutStatus = params.get('status'); // 'success' | 'cancel' | null

  // `isPremium` lu dans les callbacks de polling (sinon valeur figée à la
  // fermeture du closure).
  const isPremiumRef = useRef(isPremium);
  isPremiumRef.current = isPremium;

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

  // Relance complète de l'app sur la racine : re-bootstrappe tous les contextes
  // (abonnement, profils, bibliothèque…) → l'utilisateur entre directement avec
  // son compte Premium, sans relancer l'app à la main. `BASE_URL` vaut `/` sur
  // le web et `./` sur les builds natifs.
  const relaunch = useCallback(() => {
    window.location.replace(import.meta.env.BASE_URL || '/');
  }, []);

  // Retour de Stripe : on sonde l'abonnement jusqu'au déblocage (le webhook met
  // 1–2 s ; le Realtime couvre aussi, ceci est un filet). Si rien ne bascule au
  // bout de ~20 s → état « activation à confirmer » avec bouton Réessayer.
  const polling = useRef(false);
  const startPolling = useCallback(() => {
    if (polling.current) return;
    polling.current = true;
    setActivationFailed(false);
    let tries = 0;
    const tick = async () => {
      if (isPremiumRef.current) { polling.current = false; return; }
      tries += 1;
      await refresh();
      if (isPremiumRef.current) { polling.current = false; return; }
      if (tries >= ACTIVATION_POLL_MAX) {
        polling.current = false;
        setActivationFailed(true);
        return;
      }
      setTimeout(() => void tick(), 2000);
    };
    void tick();
  }, [refresh]);

  // On ne sonde que si une session existe : dans l'onglet Stripe du Custom Tab
  // natif, la page tourne dans le navigateur système sans session Supabase →
  // l'abonnement y sera toujours « gratuit ». Inutile de sonder (cf. message
  // « retournez dans l'application » plus bas).
  useEffect(() => {
    if (checkoutStatus === 'success' && !isPremium && user) startPolling();
  }, [checkoutStatus, isPremium, user, startPolling]);

  // Dès que l'abonnement bascule Premium sur l'écran de confirmation, on relance
  // l'app après une courte pause (le temps de montrer le « Bienvenue »).
  useEffect(() => {
    if (checkoutStatus !== 'success' || !isPremium) return;
    const id = setTimeout(relaunch, 1600);
    return () => clearTimeout(id);
  }, [checkoutStatus, isPremium, relaunch]);

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

  const header = (
    <div className={styles.brand}>
      {onBack && (
        <button className={styles.back} onClick={onBack} aria-label={t('premium.back')}>
          ←
        </button>
      )}
      <AppLogo size={26} />
      UMBRA <span className={styles.plus}>Premium</span>
    </div>
  );

  /* ── Déjà Premium ───────────────────────────────────────────────────── */
  if (isPremium && checkoutStatus !== 'success') {
    const opt = PLAN_OPTIONS.find((o) => o.interval === subscription.plan);
    return (
      <div className={styles.screen}>
        {header}
        <div className={`${styles.statusCard} ${styles.statusOk}`}>
          <div className={`${styles.statusIcon} ${styles.iconOk}`}>
            <IconCheckCircle size={40} />
          </div>
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
            {PERKS_I18N.map(({ Icon, titleKey }) => (
              <span key={titleKey} className={styles.perkChip}>
                <Icon size={15} />
                {t(titleKey)}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Confirmation paiement ──────────────────────────────────────────── */
  if (checkoutStatus === 'success') {
    // 1) Succès : compte activé → on montre le « Bienvenue » puis relance auto.
    if (isPremium) {
      return (
        <div className={styles.screen}>
          {header}
          <div className={`${styles.statusCard} ${styles.statusOk}`}>
            <div className={`${styles.statusIcon} ${styles.iconOk}`}>
              <IconCheckCircle size={44} />
            </div>
            <div className={styles.activeBadge}>{t('premium.paymentConfirmed')}</div>
            <h1 className={styles.title}>{t('premium.welcome')}</h1>
            <p className={styles.sub}>{t('premium.unlockedAll')}</p>
            <div className={styles.spinnerRow}>
              <AppLogo spin size={20} />
              <span>{t('premium.openingPremium')}</span>
            </div>
            <Focusable
              className={`btn btn-primary ${styles.cta}`}
              onEnter={relaunch}
              onClick={relaunch}
            >
              {t('premium.enterPremium')}
            </Focusable>
          </div>
        </div>
      );
    }

    // 2) Onglet Stripe natif : la page tourne dans le navigateur système, sans
    // session → on ne peut pas confirmer le Premium ici. On invite à revenir
    // dans l'app (qui, elle, détecte l'activation et referme cet onglet).
    if (!authLoading && !user) {
      return (
        <div className={styles.screen}>
          {header}
          <div className={`${styles.statusCard} ${styles.statusOk}`}>
            <div className={`${styles.statusIcon} ${styles.iconOk}`}>
              <IconCheckCircle size={44} />
            </div>
            <div className={styles.activeBadge}>{t('premium.paymentConfirmed')}</div>
            <h1 className={styles.title}>{t('premium.paymentReceived')}</h1>
            <p className={styles.sub}>{t('premium.returnToAppDesc')}</p>
          </div>
        </div>
      );
    }

    // 3) Échec/délai : rien n'a basculé après le polling → on l'affiche.
    if (activationFailed) {
      return (
        <div className={styles.screen}>
          {header}
          <div className={`${styles.statusCard} ${styles.statusWarn}`}>
            <div className={`${styles.statusIcon} ${styles.iconWarn}`}>
              <IconAlert size={44} />
            </div>
            <div className={`${styles.activeBadge} ${styles.badgeWarn}`}>
              {t('premium.activationPending')}
            </div>
            <h1 className={styles.title}>{t('premium.activationFailedTitle')}</h1>
            <p className={styles.sub}>{t('premium.activationFailedDesc')}</p>
            <div className={styles.statusActions}>
              <Focusable
                className={`btn btn-primary ${styles.cta}`}
                onEnter={startPolling}
                onClick={startPolling}
              >
                {t('premium.retry')}
              </Focusable>
            </div>
          </div>
        </div>
      );
    }

    // 4) En cours : on sonde l'abonnement.
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.statusCard}>
          <div className={styles.statusIcon}>
            <AppLogo spin size={40} />
          </div>
          <div className={styles.activeBadge}>{t('premium.activating')}</div>
          <h1 className={styles.title}>{t('premium.paymentReceived')}</h1>
          <p className={styles.sub}>{t('premium.activatingDesc')}</p>
        </div>
      </div>
    );
  }

  /* ── Page de vente ──────────────────────────────────────────────────── */
  const selected = PLAN_OPTIONS.find((o) => o.interval === plan)!;

  return (
    <div className={styles.screen}>
      {header}

      <div className={styles.hero}>
        {lockedFeature && (
          <div className={styles.eyebrow}>
            <IconLock size={15} />
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

          <p className={styles.secure}>
            <IconShield size={15} />
            {t('premium.secure')}
          </p>

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
          {PERKS_I18N.map(({ Icon, titleKey, descKey }) => (
            <div key={titleKey} className={styles.perk}>
              <span className={styles.perkIcon}>
                <Icon size={22} />
              </span>
              <div className={styles.perkText}>
                <span className={styles.perkTitle}>{t(titleKey)}</span>
                <span className={styles.perkDesc}>{t(descKey)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
