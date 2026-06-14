import { useCallback, useEffect, useRef, useState } from 'react';
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

  // ── Rendu MOBILE : coverflow « Top 10 » d'affiches portrait + numéro doré ───
  if (isMobile) return <Top10MobileRail items={items} />;

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

/**
 * Rendu MOBILE du Top 10 (coverflow tactile). Rail à snap centré d'affiches
 * portrait : l'affiche centrée est en pleine taille avec son grand numéro de
 * rang doré ; les voisines rétrécissent/s'estompent. Le scaling « coverflow »
 * est posé en JS par frame de scroll (suit le doigt, métriques mises en cache →
 * zéro reflow). Hauteur fixe + overflow-y caché → pas de scroll vertical parasite
 * ni d'espace mort. Tap sur l'affiche centrée → ouvre la fiche ; tap sur une
 * voisine → la recentre.
 */
function Top10MobileRail({ items }: { items: Top10SpotlightItem[] }) {
  const { t } = useI18n();
  const railRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Centre (px, repère contenu) de chaque item — mesuré une fois, relu sans reflow.
  const centersRef = useRef<number[]>([]);
  // Pas inter-items (largeur + gap) — référence de l'atténuation du scaling.
  const pitchRef = useRef(1);
  // Index de l'affiche la plus centrée (relu au tap pour ouvrir vs recentrer).
  const nearestRef = useRef(0);

  const apply = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const centers = centersRef.current;
    if (centers.length === 0) return;
    const viewCenter = el.scrollLeft + el.clientWidth / 2;
    const pitch = pitchRef.current || 1;
    const kids = el.children;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i] as HTMLElement;
      const c = centers[i];
      if (c == null) continue;
      const dist = Math.abs(viewCenter - c);
      // Atténuation rapportée au pas inter-items → la voisine immédiate (~1 pas)
      // arrive au minimum de taille.
      const norm = Math.min(dist / pitch, 1);
      child.style.setProperty('--s', (1 - norm * 0.32).toFixed(3));
      child.style.setProperty('--o', (1 - norm * 0.45).toFixed(3));
      child.style.zIndex = String(Math.round((1 - norm) * 10));
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    nearestRef.current = nearest;
    for (let i = 0; i < kids.length; i++) {
      (kids[i] as HTMLElement).classList.toggle(styles.mActive, i === nearest);
    }
  }, []);

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    const kids = el.children;
    const centers: number[] = [];
    for (let i = 0; i < kids.length; i++) {
      const child = kids[i] as HTMLElement;
      centers.push(child.offsetLeft + child.offsetWidth / 2);
    }
    centersRef.current = centers;
    pitchRef.current = centers.length > 1 ? Math.abs(centers[1] - centers[0]) : el.clientWidth || 1;
    apply();
  }, [apply]);

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return; // déjà programmé pour la prochaine frame
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      apply();
    });
  }, [apply]);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [measure, onScroll]);

  // Re-mesure quand la liste change (chargement asynchrone TMDB).
  useEffect(() => {
    measure();
  }, [items, measure]);

  const handleClick = (i: number, onOpen: () => void) => {
    const el = railRef.current;
    if (!el) {
      onOpen();
      return;
    }
    // Affiche déjà centrée → ouvre ; sinon, recentre-la (un tap ne saute jamais
    // directement dans la fiche d'une carte « de côté »).
    if (i === nearestRef.current) {
      onOpen();
      return;
    }
    const c = centersRef.current[i];
    if (c != null) el.scrollTo({ left: c - el.clientWidth / 2, behavior: 'smooth' });
  };

  return (
    <div className={styles.mWrap}>
      <div className={styles.mHead}>
        <span className={styles.mHeadTitle}>{t('common.popular')}</span>
        <span className={styles.mHeadTag}>TOP {Math.min(items.length, 10)}</span>
      </div>
      <div ref={railRef} className={styles.mRail}>
        {items.map((it, i) => {
          const poster = safeImgUrl(it.poster) || safeImgUrl(it.backdrop);
          return (
            <button
              key={it.id}
              type="button"
              className={styles.mItem}
              onClick={() => handleClick(i, it.onOpen)}
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
