import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRatings } from '../../contexts/RatingsContext';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useI18n } from '../../contexts/I18nContext';
import { RatingStars } from '../RatingStars/RatingStars';
import { Focusable } from '../Focusable';
import type { WatchedInput } from '../../types/ratings.types';
import styles from './RateBlock.module.css';

interface Props {
  /** Snapshot complet construit par la fiche détail (genre/cast/réal/tmdb). */
  input: WatchedInput;
  /** Clé de focus télécommande pour les étoiles. */
  starsFocusKey?: string;
  /** Variante compacte « îlot » pour le hero desktop (§Phase 4) : juste
   *  étoiles + note, sans date/critique → tient sans scroll, lisible et
   *  navigable à la télécommande. */
  overlay?: boolean;
}

const fmtRating = (v: number) => String(v).replace('.', ',');

/** Epoch ms → `YYYY-MM-DD` en heure locale (pour <input type="date">). */
function toDateInput(ms: number): string {
  const d = new Date(ms);
  return new Date(ms - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Bloc de notation des fiches Film / Série : étoiles 0,5–5, date de
 * visionnage, critique optionnelle, marquer vu / retirer des vues.
 * Consomme `useRatings` (lecture de context autorisée pour un composant).
 * Réactif via la liste `watched` (le ref `getWatched` n'est pas réactif).
 */
export function RateBlock({ input, starsFocusKey, overlay }: Props) {
  const navigate = useNavigate();
  const { isPremium } = useSubscription();
  const { t } = useI18n();
  const {
    watched,
    rate,
    markWatched,
    clearRating,
    setReview,
    setWatchedDate,
    removeWatched,
    applySnapshot,
  } = useRatings();

  const current = useMemo(
    () =>
      watched.find(
        (w) =>
          w.contentType === input.contentType &&
          w.titleKey === input.titleKey,
      ),
    [watched, input.contentType, input.titleKey],
  );

  // Backfill UNE fois : enrichit une entrée auto/incomplète avec le snapshot
  // complet de la fiche, sans write réseau inutile à chaque visite.
  const didBackfill = useRef(false);
  useEffect(() => {
    if (didBackfill.current || !current) return;
    const incomplete =
      current.autoAdded ||
      current.genres.length === 0 ||
      current.cast.length === 0;
    const hasSnapshot =
      (input.genres?.length ?? 0) > 0 ||
      (input.cast?.length ?? 0) > 0 ||
      input.tmdbId != null;
    if (incomplete && hasSnapshot) {
      didBackfill.current = true;
      applySnapshot(input);
    }
  }, [current, input, applySnapshot]);

  const [showReview, setShowReview] = useState(false);
  const [reviewDraft, setReviewDraft] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    setReviewDraft(current?.review ?? '');
  }, [current?.id, current?.review]);

  const commitReview = () => {
    if (!current || (current.review ?? '') === reviewDraft) return;
    setReview(input.contentType, input.titleKey, reviewDraft);
  };

  // ── Variante compacte « îlot » pour le hero desktop (étoiles + note) ──────
  if (overlay) {
    if (!isPremium) {
      return (
        <div className={styles.overlayBlock}>
          <span className={styles.overlayLabel}>{t('rate.yourRatingLocked')}</span>
          <Focusable
            className={styles.overlayCta}
            focusedClassName="rc-focused"
            onEnter={() => navigate('/premium')}
            onClick={() => navigate('/premium')}
          >
            {t('rate.discoverPremium')}
          </Focusable>
        </div>
      );
    }
    return (
      <div className={styles.overlayBlock}>
        <span className={styles.overlayLabel}>{t('rate.yourRating')}</span>
        <RatingStars
          value={current?.rating ?? null}
          onChange={(v) => rate(input, v)}
          size={26}
          focusKey={starsFocusKey}
          ariaLabel={t('rate.rateAria')}
        />
        {current?.rating != null && (
          <>
            <span className={styles.overlayValue}>
              {t('rate.ratingValue', { value: fmtRating(current.rating) })}
            </span>
            <button
              className={styles.overlayClear}
              onClick={() => clearRating(input.contentType, input.titleKey)}
            >
              {t('rate.clearRating')}
            </button>
          </>
        )}
      </div>
    );
  }

  if (!isPremium) {
    return (
      <div className={styles.block}>
        <div className={styles.head}>
          <span className={styles.label}>{t('rate.yourRatingLocked')}</span>
        </div>
        <p className={styles.lockedText}>{t('rate.lockedText')}</p>
        <Focusable
          className={`btn btn-primary ${styles.lockedCta}`}
          onEnter={() => navigate('/premium')}
          onClick={() => navigate('/premium')}
        >
          {t('rate.discoverPremium')}
        </Focusable>
      </div>
    );
  }

  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <span className={styles.label}>{t('rate.yourRating')}</span>
        <span className={styles.value}>
          {current?.rating != null
            ? t('rate.ratingValue', { value: fmtRating(current.rating) })
            : '—'}
        </span>
      </div>

      <div className={styles.starsRow}>
        <RatingStars
          value={current?.rating ?? null}
          onChange={(v) => rate(input, v)}
          size={30}
          focusKey={starsFocusKey}
          ariaLabel={t('rate.rateAria')}
        />
        {current?.rating != null && (
          <button
            className={styles.linkBtn}
            onClick={() => clearRating(input.contentType, input.titleKey)}
          >
            {t('rate.clearRating')}
          </button>
        )}
      </div>

      {!current ? (
        <Focusable
          className="btn btn-secondary"
          onEnter={() => markWatched(input)}
          onClick={() => markWatched(input)}
        >
          {t('rate.markWatched')}
        </Focusable>
      ) : (
        <>
          <div className={styles.metaRow}>
            <label className={styles.dateLabel}>
              <span>{t('rate.watchedOn')}</span>
              <input
                type="date"
                className={styles.dateInput}
                value={toDateInput(current.watchedAt)}
                max={toDateInput(Date.now())}
                onChange={(e) => {
                  const t = Date.parse(e.target.value);
                  if (!Number.isNaN(t)) {
                    setWatchedDate(input.contentType, input.titleKey, t);
                  }
                }}
              />
            </label>

            <Focusable
              className={`${styles.removeBtn} ${
                confirmRemove ? styles.removeArmed : ''
              }`}
              onEnter={() =>
                confirmRemove
                  ? removeWatched(input.contentType, input.titleKey)
                  : setConfirmRemove(true)
              }
              onClick={() =>
                confirmRemove
                  ? removeWatched(input.contentType, input.titleKey)
                  : setConfirmRemove(true)
              }
              onBlurred={() => setConfirmRemove(false)}
            >
              {confirmRemove ? t('rate.confirmRemove') : t('rate.removeFromWatched')}
            </Focusable>
          </div>

          {showReview || current.review ? (
            <textarea
              className={styles.review}
              placeholder={t('rate.reviewPlaceholder')}
              value={reviewDraft}
              onChange={(e) => setReviewDraft(e.target.value)}
              onBlur={commitReview}
              rows={4}
            />
          ) : (
            <button
              className={styles.linkBtn}
              onClick={() => setShowReview(true)}
            >
              {t('rate.addReview')}
            </button>
          )}
        </>
      )}
    </div>
  );
}
