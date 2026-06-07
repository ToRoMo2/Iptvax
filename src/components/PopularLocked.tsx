import { useNavigate } from 'react-router-dom';
import { useI18n } from '../contexts/I18nContext';
import { Focusable } from './Focusable';
import styles from './PopularLocked.module.css';

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="26" height="26" aria-hidden="true">
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true">
      <path d="M12 2l1.9 5.6L19.5 9l-5.6 1.9L12 16l-1.9-5.1L4.5 9l5.6-1.4L12 2z" />
    </svg>
  );
}

/**
 * Call to action « Populaires » pour le tier GRATUIT, rendu à la place du
 * billboard `PopularSpotlight` / coverflow `PopularRail` (réservés Premium —
 * cf. §X : `tmdbService.isEnabled()` suit l'abonnement). Occupe le même
 * emplacement de tête sur Films / Séries et renvoie vers `/premium`.
 *
 * Branding gold cohérent avec `PremiumTeaseBar`. Le CTA est un `Focusable`
 * (parité souris / télécommande TV).
 */
export function PopularLocked() {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <span className={styles.glow} aria-hidden="true" />
        <span className={styles.badge}>
          <LockIcon />
        </span>
        <h3 className={styles.title}>{t('upsell.popularLockedTitle')}</h3>
        <p className={styles.text}>{t('upsell.popularLockedText')}</p>
        <Focusable
          className={styles.cta}
          onEnter={() => navigate('/premium')}
          onClick={() => navigate('/premium')}
          ariaLabel={t('upsell.popularLockedCta')}
        >
          <SparkIcon /> {t('upsell.popularLockedCta')}
        </Focusable>
      </div>
    </div>
  );
}
