import { useState } from 'react';
import { safeImgUrl } from '../utils/image';
import { Focusable } from './Focusable';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useI18n } from '../contexts/I18nContext';
import styles from './Top10Spotlight.module.css';

export interface Top10SpotlightItem {
  id: string | number;
  rank: number;
  title: string;
  /** Backdrop paysage HD (TMDB de préférence). */
  backdrop?: string;
  /** Affiche portrait (poster Xtream `stream_icon`/`cover`) — utilisée par le
   *  rendu mobile « Top 10 » (cartes verticales façon Netflix). */
  poster?: string;
  /** Note sur 10 déjà formatée (ex. « 6.7 »). */
  ratingBadge?: string;
  /** Métadonnées affichées en ligne (année, genre…), séparées par des points. */
  meta: string[];
  synopsis?: string;
  isFavorite?: boolean;
  onOpen: () => void;
  onPlay: () => void;
  onFavorite?: () => void;
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>;
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="17" height="17"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></svg>
  );
}
function PlusIcon({ on }: { on?: boolean }) {
  return on ? (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="M20 6 9 17l-5-5" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="20" height="20"><path d="M12 5v14M5 12h14" /></svg>
  );
}

/**
 * « Top 10 » des Films / Séries — accordéon d'images horizontal. Une rangée de
 * petites cartes ; celle qu'on survole (souris) ou cible (focus télécommande)
 * s'agrandit en douceur en CARTE HERO (titre, note, synopsis, Lire / Plus
 * d'infos), avec le grand numéro de rang doré qui grandit à gauche. Les autres
 * rétrécissent. Sans scroll ni saut (flex-grow animé) → aucun scintillement.
 *
 * Partagé Films / Séries. Données = tendances TMDB matchées au catalogue
 * (Premium ; le tier gratuit reçoit `PopularLocked` à la place côté page).
 */
export function Top10Spotlight({ items }: { items: Top10SpotlightItem[] }) {
  const { t } = useI18n();
  const [active, setActive] = useState(0);
  const n = items.length;
  // Mobile portrait : l'accordéon paysage écrase les cartes en fins copeaux
  // illisibles → on bascule sur un rail « Top 10 » d'affiches verticales (façon
  // Netflix mobile), bien plus tactile. Desktop/tablette gardent l'accordéon.
  // `useMediaQuery` (≤640px) plutôt qu'un toggle CSS : on ne monte qu'un seul
  // jeu d'images (posters OU backdrops, jamais les deux).
  const isMobile = useMediaQuery('(max-width: 640px)');

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setActive((a) => Math.min(a + 1, n - 1)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
  };

  // ── Rendu MOBILE : rail « Top 10 » d'affiches portrait + grand numéro doré ──
  if (isMobile) {
    return (
      <div className={styles.mWrap}>
        <div className={styles.mHead}>
          <span className={styles.mHeadTitle}>{t('common.popular')}</span>
          <span className={styles.mHeadTag}>TOP {Math.min(n, 10)}</span>
        </div>
        <div className={styles.mRail}>
          {items.map((it) => {
            const poster = safeImgUrl(it.poster) || safeImgUrl(it.backdrop);
            return (
              <button
                key={it.id}
                type="button"
                className={styles.mItem}
                onClick={it.onOpen}
                aria-label={`#${it.rank} ${it.title}`}
              >
                <span className={styles.mRank} aria-hidden="true">{it.rank}</span>
                <span className={styles.mPoster}>
                  {poster ? (
                    <img
                      className={styles.mPosterImg}
                      src={poster}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span className={styles.mPh}>{it.title}</span>
                  )}
                  {it.ratingBadge && <span className={styles.mRating}>★ {it.ratingBadge}</span>}
                  <span className={styles.mShade} aria-hidden="true" />
                  <span className={styles.mTitle}>{it.title}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Rendu DESKTOP / TABLETTE : accordéon paysage (inchangé) ─────────────────
  return (
    <div className={styles.rail} onKeyDown={onKeyDown}>
      {items.map((it, i) => {
        const isActive = i === active;
        const img = safeImgUrl(it.backdrop);
        return (
          <Focusable
            key={it.id}
            className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
            focusedClassName="rc-focused"
            onFocused={() => setActive(i)}
            onEnter={() => (isActive ? it.onOpen() : setActive(i))}
            onClick={() => (isActive ? it.onOpen() : setActive(i))}
            ariaLabel={it.title}
          >
            <span className={styles.inner} onMouseEnter={() => setActive(i)}>
              {img ? (
                <img className={styles.img} src={img} alt="" loading="lazy" decoding="async"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              ) : (
                <span className={styles.ph} aria-hidden="true" />
              )}
              <span className={styles.shadeBottom} />

              {/* Numéro compact (cartes au repos). */}
              <span className={styles.numSmall} aria-hidden="true">{it.rank}</span>

              {isActive && (
                <>
                  <span className={styles.shadeLeft} />
                  {/* Grand numéro doré (grandit à l'agrandissement). */}
                  <span className={styles.numBig} aria-hidden="true">{it.rank}</span>
                  <span className={styles.content}>
                    <span className={styles.badges}>
                      <span className={styles.badgeTop}>{t('common.popular')}</span>
                      <span className={styles.badgeRank}>#{it.rank}</span>
                    </span>
                    <span className={styles.title}>{it.title}</span>
                    <span className={styles.metaRow}>
                      {it.ratingBadge && <span className={styles.rating}>★ {it.ratingBadge}</span>}
                      {it.meta.map((m, k) => (
                        <span key={k} className={styles.metaItem}>
                          {(it.ratingBadge || k > 0) && <span className={styles.dot} />}
                          {m}
                        </span>
                      ))}
                      <span className={styles.tagHd}>HD</span>
                    </span>
                    {it.synopsis && <span className={styles.synopsis}>{it.synopsis}</span>}
                    {/* stopPropagation : un clic bouton ne doit pas aussi ouvrir la fiche. */}
                    <span className={styles.actions} onClick={(e) => e.stopPropagation()}>
                      <Focusable className={styles.playBtn} focusedClassName="rc-focused" onEnter={it.onPlay} onClick={it.onPlay}>
                        <PlayIcon /> {t('home.watch')}
                      </Focusable>
                      <Focusable className={styles.infoBtn} focusedClassName="rc-focused" onEnter={it.onOpen} onClick={it.onOpen}>
                        <InfoIcon /> {t('home.moreInfo')}
                      </Focusable>
                      {it.onFavorite && (
                        <Focusable
                          className={`${styles.favBtn} ${it.isFavorite ? styles.favOn : ''}`}
                          focusedClassName="rc-focused"
                          ariaLabel={t(it.isFavorite ? 'common.inList' : 'common.addToList')}
                          onEnter={it.onFavorite}
                          onClick={it.onFavorite}
                        >
                          <PlusIcon on={it.isFavorite} />
                        </Focusable>
                      )}
                    </span>
                  </span>
                </>
              )}
            </span>
          </Focusable>
        );
      })}
    </div>
  );
}
