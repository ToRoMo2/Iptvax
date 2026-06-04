import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import { IconLock } from './PremiumIcons';
import styles from './FavoriteLimitToast.module.css';

/**
 * Toast transitoire affiché quand un utilisateur gratuit tente d'ajouter un
 * favori au-delà du plafond. Écoute `favLimitNonce` du LibraryContext (bumpé à
 * chaque ajout bloqué) → s'auto-masque après quelques secondes ; le clic mène à
 * la page Premium. Inerte (non rendu) pour le tier Premium (`favoritesLimit`
 * null). Feedback non bloquant, dans l'esprit « élégant & désirable ».
 */
export function FavoriteLimitToast() {
  const { favLimitNonce, favoritesLimit } = useLibrary();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (favLimitNonce === 0) return;
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), 4200);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [favLimitNonce]);

  if (!visible || favoritesLimit == null) return null;

  return (
    <button
      type="button"
      className={styles.toast}
      onClick={() => {
        setVisible(false);
        navigate('/premium');
      }}
    >
      <IconLock size={18} className={styles.icon} />
      <span className={styles.text}>{t('upsell.favLimitToast', { max: favoritesLimit })}</span>
      <span className={styles.cta}>{t('upsell.unlock')}</span>
    </button>
  );
}
