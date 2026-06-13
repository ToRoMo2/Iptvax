import { useEffect, useState, type ReactNode } from 'react';
import { safeImgUrl } from '../utils/image';
import { Focusable } from './Focusable';
import { useI18n } from '../contexts/I18nContext';
import { RateBlock } from './RateBlock/RateBlock';
import type { WatchedInput } from '../types/ratings.types';
import styles from './DetailHero.module.css';

interface Props {
  /** Images HD (backdrops TMDB) du diaporama de fond — URLs brutes. */
  backdrops: string[];
  /** Logo TMDB du titre (URL brute) ; repli sur `<h1>` si absent. */
  logo?: string;
  title: string;
  /** Ligne de métadonnées (année · genre · saisons…) construite par la page. */
  meta: ReactNode;
  /** Ligne note/durée (badge TMDb % ou ★) construite par la page. */
  ratingRow?: ReactNode;
  synopsis?: string;
  /** Boutons d'action (Regarder/Reprendre/version/favori) construits par la page. */
  actions: ReactNode;
  rateInput: WatchedInput | null;
  starsFocusKey?: string;
  onBack: () => void;
  backFocusKey?: string;
  /** Flèche bas depuis « Retour » (télécommande) → cible la lecture. */
  onBackArrowDown?: () => void;
  /** Révèle le bas de page (casting / épisodes). */
  onScrollDown: () => void;
  showScrollCue: boolean;
}

const DIAPO_MS = 6500;

function ChevDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="m6 9 6 6 6-6" /></svg>
  );
}
function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m15 18-6-6 6-6" /></svg>
  );
}

/**
 * Hero de la fiche détail DESKTOP (§Phase 4) : fond plein écran en DIAPORAMA des
 * images HD TMDB (sans scroll, image entière), infos superposées en bas à
 * gauche (logo TMDB, méta, note, synopsis, actions, note compacte), et une
 * flèche animée invitant à scroller pour révéler le casting / les épisodes.
 * Le rendu mobile reste l'affiche portrait (géré côté pages).
 */
export function DetailHero({
  backdrops,
  logo,
  title,
  meta,
  ratingRow,
  synopsis,
  actions,
  rateInput,
  starsFocusKey,
  onBack,
  backFocusKey,
  onBackArrowDown,
  onScrollDown,
  showScrollCue,
}: Props) {
  const { t } = useI18n();
  const imgs = backdrops.map((b) => safeImgUrl(b)).filter((s): s is string => !!s);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (imgs.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % imgs.length), DIAPO_MS);
    return () => clearInterval(id);
  }, [imgs.length]);

  return (
    <section className={styles.stage}>
      <div className={styles.diapo}>
        {imgs.length > 0 ? (
          imgs.map((src, i) => (
            <img
              key={src}
              src={src}
              alt=""
              aria-hidden="true"
              decoding="async"
              className={`${styles.diapoImg} ${i === idx ? styles.diapoActive : ''}`}
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
          ))
        ) : (
          <div className={styles.diapoPh} />
        )}
      </div>
      <div className={styles.overlayBottom} />
      <div className={styles.overlayLeft} />

      <Focusable
        className={styles.back}
        focusKey={backFocusKey}
        focusedClassName="rc-focused"
        onEnter={onBack}
        onClick={onBack}
        ariaLabel={t('common.backWord')}
        onArrow={(d) => {
          if (d === 'down' && onBackArrowDown) { onBackArrowDown(); return false; }
          return true;
        }}
      >
        <BackArrow /> {t('common.back')}
      </Focusable>

      <div className={styles.content}>
        {logo ? (
          <img className={styles.logo} src={safeImgUrl(logo)} alt={title} />
        ) : (
          <h1 className={styles.title}>{title}</h1>
        )}
        <div className={styles.meta}>{meta}</div>
        {ratingRow && <div className={styles.ratingRow}>{ratingRow}</div>}
        {synopsis && <p className={styles.synopsis}>{synopsis}</p>}
        <div className={styles.actions}>{actions}</div>
        {rateInput && (
          <RateBlock overlay input={rateInput} starsFocusKey={starsFocusKey} />
        )}
      </div>

      {showScrollCue && (
        <button className={styles.scrollCue} onClick={onScrollDown} aria-label={t('detail.casting')}>
          <ChevDown />
        </button>
      )}
    </section>
  );
}
