import { useEffect, useState } from 'react';
import type { TmdbCastMember } from '../types/tmdb.types';
import { safeImgUrl } from '../utils/image';
import { useI18n } from '../contexts/I18nContext';
import { Focusable } from './Focusable';
import styles from './DetailMedia.module.css';

interface Props {
  /** Casting TMDB (avec photos) — prioritaire sur `xtreamCast`. */
  tmdbCast: TmdbCastMember[];
  /** Casting Xtream (noms seuls) — repli si pas de casting TMDB. */
  xtreamCast: string[];
  /** Images HD TMDB (backdrops 16:9) pour l'onglet « Médias ». */
  images: string[];
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/**
 * Section « Casting / Médias » de la fiche détail (film & série).
 * Deux onglets bascule : le casting (grille de têtes) et une galerie d'images
 * HD TMDB avec visionneuse plein écran. L'onglet « Médias » n'apparaît que si
 * TMDB a renvoyé des images (purement additif §IV-TMDB).
 *
 * Composant partagé MovieDetail/SeriesDetail (bloc conséquent : tabs + grille +
 * lightbox) → factorisé plutôt que dupliqué dans les deux pages.
 */
export function DetailMedia({ tmdbCast, xtreamCast, images }: Props) {
  const { t } = useI18n();
  const hasCast = tmdbCast.length > 0 || xtreamCast.length > 0;
  const hasMedia = images.length > 0;
  const [tab, setTab] = useState<'cast' | 'media'>('cast');
  const [lightbox, setLightbox] = useState<number | null>(null);

  // Si une seule des deux vues a du contenu, on s'y cale (et la barre d'onglets
  // est masquée — un seul onglet n'a pas de sens).
  const showTabs = hasCast && hasMedia;
  const effectiveTab = !hasCast ? 'media' : !hasMedia ? 'cast' : tab;

  // Navigation clavier de la visionneuse (← → Échap).
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
      else if (e.key === 'ArrowRight') setLightbox((i) => (i === null ? i : (i + 1) % images.length));
      else if (e.key === 'ArrowLeft') setLightbox((i) => (i === null ? i : (i - 1 + images.length) % images.length));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox, images.length]);

  if (!hasCast && !hasMedia) return null;

  return (
    <div className={styles.block}>
      {showTabs ? (
        <div className={styles.tabs} role="tablist">
          <Focusable
            className={`${styles.tab} ${effectiveTab === 'cast' ? styles.tabActive : ''}`}
            onEnter={() => setTab('cast')}
            onClick={() => setTab('cast')}
            ariaLabel={t('detail.casting')}
          >
            {t('detail.casting')}
          </Focusable>
          <Focusable
            className={`${styles.tab} ${effectiveTab === 'media' ? styles.tabActive : ''}`}
            onEnter={() => setTab('media')}
            onClick={() => setTab('media')}
            ariaLabel={t('detail.media')}
          >
            {t('detail.media')}
          </Focusable>
        </div>
      ) : (
        <div className={styles.sectionLabel}>{effectiveTab === 'media' ? t('detail.media') : t('detail.casting')}</div>
      )}

      {effectiveTab === 'cast' ? (
        <div className={styles.castGrid}>
          {tmdbCast.length > 0
            ? tmdbCast.map((c) => (
                <Focusable key={`${c.name}-${c.character}`} className={styles.castRow} ariaLabel={c.name}>
                  {c.profile ? (
                    <img src={safeImgUrl(c.profile)} alt={c.name} loading="lazy" decoding="async" className={styles.castAvatar} />
                  ) : (
                    <div className={styles.castAvatarPh}>{initials(c.name)}</div>
                  )}
                  <span className={styles.castName}>{c.name}</span>
                  <span className={styles.castRole}>{c.character}</span>
                </Focusable>
              ))
            : xtreamCast.map((name) => (
                <Focusable key={name} className={styles.castRow} ariaLabel={name}>
                  <div className={styles.castAvatarPh}>{initials(name)}</div>
                  <span className={styles.castName}>{name}</span>
                  <span className={styles.castRole}>{t('detail.actor')}</span>
                </Focusable>
              ))}
        </div>
      ) : (
        <div className={styles.mediaGrid}>
          {images.map((src, i) => (
            <Focusable
              key={src}
              className={styles.mediaTile}
              onEnter={() => setLightbox(i)}
              onClick={() => setLightbox(i)}
              ariaLabel={t('detail.media')}
            >
              <img src={safeImgUrl(src)} alt="" loading="lazy" decoding="async" className={styles.mediaImg} />
            </Focusable>
          ))}
        </div>
      )}

      {lightbox !== null && (
        <div className={styles.lightbox} onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <button className={styles.lbClose} onClick={() => setLightbox(null)} aria-label={t('common.close')}>✕</button>
          {images.length > 1 && (
            <button
              className={`${styles.lbNav} ${styles.lbPrev}`}
              onClick={(e) => { e.stopPropagation(); setLightbox((idx) => (idx === null ? idx : (idx - 1 + images.length) % images.length)); }}
              aria-label={t('slideshow.prev')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="m15 18-6-6 6-6" /></svg>
            </button>
          )}
          <img className={styles.lbImg} src={safeImgUrl(images[lightbox])} alt="" onClick={(e) => e.stopPropagation()} />
          {images.length > 1 && (
            <button
              className={`${styles.lbNav} ${styles.lbNext}`}
              onClick={(e) => { e.stopPropagation(); setLightbox((idx) => (idx === null ? idx : (idx + 1) % images.length)); }}
              aria-label={t('slideshow.next')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="22" height="22"><path d="m9 18 6-6-6-6" /></svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
