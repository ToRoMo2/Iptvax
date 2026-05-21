import { useEffect, useState } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { RatingStars } from '../RatingStars/RatingStars';
import { safeImgUrl } from '../../utils/image';
import { useI18n } from '../../contexts/I18nContext';
import type { WatchedTitle } from '../../types/ratings.types';
import styles from './WatchedCard.module.css';

interface Props {
  item: WatchedTitle;
  onOpen: () => void;
  /** Absent ou `readOnly` → pas de bouton retirer (ciné d'un autre membre). */
  onRemove?: () => void;
  readOnly?: boolean;
}

/**
 * Carte poster du mur « Mon ciné ». Étoiles utilisateur en lecture seule,
 * pastille « À noter » si non noté (workflow de notation), bouton retirer
 * avec confirmation en deux temps (faux positif / vu par erreur, sûr à la
 * télécommande). `useFocusable` direct (parité MediaCard).
 */
export function WatchedCard({ item, onOpen, onRemove, readOnly }: Props) {
  const { t } = useI18n();
  const canRemove = !readOnly && !!onRemove;
  const { ref, focused } = useFocusable({ onEnterPress: () => onOpen() });
  const [imgError, setImgError] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [focused, ref]);

  // Le retrait du focus referme la confirmation laissée ouverte.
  useEffect(() => {
    if (!focused) setConfirming(false);
  }, [focused]);

  const resolved = safeImgUrl(item.poster);
  const showImage = Boolean(resolved) && !imgError;
  const rated = item.rating != null;

  return (
    <div
      ref={ref}
      className={`${styles.card} ${focused ? styles.focused : ''}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
    >
      <div className={styles.poster}>
        {showImage ? (
          <img
            src={resolved}
            alt={item.title}
            loading="lazy"
            className={styles.img}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className={styles.placeholder}>
            <span className={styles.phTag}>// POSTER · 2:3</span>
            <span className={styles.phName}>{item.title}</span>
          </div>
        )}

        {!rated && <span className={styles.todo}>{t('watchedCard.toRate')}</span>}

        {canRemove && (
          <button
            className={`${styles.removeBtn} ${
              confirming ? styles.removeConfirm : ''
            }`}
            title={confirming ? t('watchedCard.confirmRemove') : t('watchedCard.removeFromWatched')}
            onClick={(e) => {
              e.stopPropagation();
              if (confirming) {
                onRemove?.();
              } else {
                setConfirming(true);
              }
            }}
          >
            {confirming ? t('watchedCard.removeQ') : '✕'}
          </button>
        )}
      </div>

      <div className={styles.info}>
        <div className={styles.title} title={item.title}>
          {item.title}
        </div>
        <div className={styles.sub}>
          {item.year && <span>{item.year}</span>}
          <span className={styles.type}>
            {item.contentType === 'series' ? t('watchedCard.series') : t('watchedCard.film')}
          </span>
        </div>
        {rated ? (
          <RatingStars value={item.rating} readOnly size={16} />
        ) : (
          <span className={styles.unrated}>{t('watchedCard.notRatedYet')}</span>
        )}
      </div>
    </div>
  );
}
