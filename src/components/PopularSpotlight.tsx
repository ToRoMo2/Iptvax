import { useCallback, useEffect, useState } from 'react';
import { safeImgUrl } from '../utils/image';
import { useI18n } from '../contexts/I18nContext';
import styles from './PopularSpotlight.module.css';

/**
 * Élément « populaire » pour le billboard desktop (données brutes — `safeImgUrl`
 * est appliqué dans le composant).
 */
export interface PopularSpotlightItem {
  id: string | number;
  title: string;
  /** Image paysage 16:9 (idéale). */
  backdrop?: string;
  /** Affiche portrait — repli si pas de backdrop. */
  poster?: string;
  /** Ligne méta déjà formatée (année · ★ · genre). */
  meta?: string;
  synopsis?: string;
  isFavorite?: boolean;
  onOpen: () => void;
  onFavorite?: () => void;
}

const AUTO_MS = 7000;

function ChevLeft() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="m15 18-6-6 6-6" /></svg>;
}
function ChevRight() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="m9 18 6-6-6-6" /></svg>;
}
function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>;
}

/**
 * Carrousel « Populaires » DESKTOP — billboard paysage : un grand visuel 16:9
 * mis en valeur (backdrop + titre + méta + synopsis + actions) avec des flèches
 * de navigation toujours visibles qui bouclent (dernier → premier et vice
 * versa). Auto-défilement (pause au survol, coupé sous prefers-reduced-motion).
 *
 * Rendu UNIQUEMENT sur desktop (toggle CSS côté page) ; le mobile/TV garde le
 * coverflow `PopularRail`. Pas de norigin ici — desktop souris uniquement.
 */
export function PopularSpotlight({
  items,
  className,
}: {
  items: PopularSpotlightItem[];
  className?: string;
}) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  const count = items.length;
  // Borne l'index si la liste rétrécit (changement de catalogue).
  const idx = count > 0 ? Math.min(active, count - 1) : 0;
  const cur = items[idx];

  const go = useCallback(
    (dir: number) => setActive((a) => (count === 0 ? 0 : (a + dir + count) % count)),
    [count],
  );

  // Auto-défilement (desktop, mouvement autorisé, non survolé).
  useEffect(() => {
    if (count <= 1 || paused) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const id = setInterval(() => setActive((a) => (a + 1) % count), AUTO_MS);
    return () => clearInterval(id);
  }, [count, paused]);

  if (count === 0 || !cur) return null;

  const heroImg = safeImgUrl(cur.backdrop) || safeImgUrl(cur.poster);

  return (
    <div
      className={`${styles.spot} ${className ?? ''}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className={styles.stage} role="button" tabIndex={-1} onClick={cur.onOpen} title={cur.title}>
        {heroImg ? (
          <img key={cur.id} className={styles.stageBg} src={heroImg} alt="" decoding="async" />
        ) : (
          <div className={styles.stageBgBlank} />
        )}
        <div className={styles.stageScrim} />

        <div className={styles.info}>
          <span className={styles.eyebrow}>
            <span className={styles.rank}>#{idx + 1}</span>
            {t('common.popular')}
          </span>
          <h3 className={styles.title}>{cur.title}</h3>
          {cur.meta && <div className={styles.meta}>{cur.meta}</div>}
          {cur.synopsis && <p className={styles.synopsis}>{cur.synopsis}</p>}
          <div className={styles.actions}>
            <button className={styles.play} onClick={(e) => { e.stopPropagation(); cur.onOpen(); }}>
              <PlayIcon /> {t('common.play')}
            </button>
            {cur.onFavorite && (
              <button
                className={`${styles.fav} ${cur.isFavorite ? styles.favOn : ''}`}
                onClick={(e) => { e.stopPropagation(); cur.onFavorite?.(); }}
                title={cur.isFavorite ? t('common.removeFavorite') : t('common.addFavorite')}
                aria-label={cur.isFavorite ? t('common.removeFavorite') : t('common.addFavorite')}
              >
                {cur.isFavorite ? '★' : '☆'}
              </button>
            )}
          </div>
        </div>

        {count > 1 && (
          <>
            <button
              className={`${styles.arrow} ${styles.arrowPrev}`}
              onClick={(e) => { e.stopPropagation(); go(-1); }}
              aria-label={t('slideshow.prev')}
            >
              <ChevLeft />
            </button>
            <button
              className={`${styles.arrow} ${styles.arrowNext}`}
              onClick={(e) => { e.stopPropagation(); go(1); }}
              aria-label={t('slideshow.next')}
            >
              <ChevRight />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
