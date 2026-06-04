import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslationKey } from '../i18n';
import styles from './PremiumTeaseBar.module.css';

/**
 * Bandeau d'upsell persistant, ancré (pas une pop-up). Visible UNIQUEMENT pour
 * le tier gratuit. Stratégie « exposer la valeur » : rappelle en continu, mais
 * discrètement, les bénéfices Premium en faisant défiler une accroche.
 *
 * Repliable pour la session courante (sessionStorage) → réapparaît à la session
 * suivante : « constamment sous les yeux » sans devenir harcelant. Masqué sur la
 * page /premium (redondant) et pour les abonnés. Mobile : ancré au-dessus de la
 * bottom nav (token `--bottomnav-h`). Tout dégrade sous prefers-reduced-motion.
 */
const DISMISS_KEY = 'iptv.premiumBar.dismissed';
const BENEFITS: TranslationKey[] = [
  'upsell.benefit1',
  'upsell.benefit2',
  'upsell.benefit3',
  'upsell.benefit4',
];

export function PremiumTeaseBar() {
  const { isPremium, loading } = useSubscription();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(DISMISS_KEY) === '1',
  );
  const [idx, setIdx] = useState(0);

  const hidden = loading || isPremium || dismissed || pathname === '/premium';

  useEffect(() => {
    if (hidden) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % BENEFITS.length), 4200);
    return () => clearInterval(id);
  }, [hidden]);

  if (hidden) return null;

  const dismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className={styles.bar} role="complementary" aria-label={t('upsell.barCta')}>
      <button type="button" className={styles.main} onClick={() => navigate('/premium')}>
        <span className={styles.star} aria-hidden="true">✦</span>
        <span className={styles.benefits}>
          {BENEFITS.map((k, i) => (
            <span
              key={k}
              className={`${styles.benefit} ${i === idx ? styles.benefitActive : ''}`}
            >
              {t(k)}
            </span>
          ))}
        </span>
        <span className={styles.cta}>{t('upsell.barCta')}</span>
      </button>
      <button
        type="button"
        className={styles.close}
        onClick={dismiss}
        aria-label={t('upsell.dismiss')}
        title={t('upsell.dismiss')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="16" height="16" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
