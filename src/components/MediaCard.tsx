import { memo, useEffect, useState, type ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import styles from './MediaCard.module.css';
import { safeImgUrl } from '../utils/image';
import { channelCode } from '../utils/channel';
import { useLazyPoster } from '../hooks/useLazyPoster';
import { useI18n } from '../contexts/I18nContext';

type CardVariant = 'channel' | 'movie' | 'series';

interface Props {
  title: string;
  image?: string;
  rating?: number;
  genre?: string;
  variant: CardVariant;
  isLive?: boolean;
  isFavorite?: boolean;
  selected?: boolean;
  /** Carte au-dessus de la ligne de flottaison (1er écran d'une grille) → l'affiche
   *  est chargée en `eager` + priorité réseau haute pour apparaître plus vite. */
  priority?: boolean;
  // Petite pastille en bas à gauche de l'art (ex. « 4 qualités » pour une
  // chaîne Live regroupant plusieurs variantes de qualité).
  badge?: string;
  onClick: () => void;
  onFavorite?: () => void;
  /** Résolveur d'affiche TMDB (paresseux, visible-only) — remplace l'affiche IPTV. */
  resolvePoster?: () => Promise<string | null>;
  // Slot optionnel — quand fourni, remplace l'image/placeholder dans la zone
  // « art » de la carte. Utilisé par Live mobile pour monter <ChannelPreview>
  // directement dans la carte sélectionnée (pas de panneau latéral).
  inlinePreview?: ReactNode;
}

function MediaCardInner({
  title,
  image,
  rating,
  genre,
  variant,
  isLive,
  isFavorite,
  selected,
  badge,
  onClick,
  onFavorite,
  resolvePoster,
  inlinePreview,
  priority,
}: Props) {
  const { t } = useI18n();
  const { ref, focused } = useFocusable({ onEnterPress: () => onClick() });
  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [focused, ref]);

  const [imgError, setImgError] = useState(false);
  // Affiche TMDB paresseuse (visible-only) substituée à l'IPTV (films/séries).
  const tmdbPoster = useLazyPoster(resolvePoster, ref);
  // safeImgUrl rejette les URLs relatives (simples noms de fichier) renvoyées par certains
  // serveurs Xtream → évite les 404 dans la console du navigateur.
  const resolved = (tmdbPoster ? safeImgUrl(tmdbPoster) : undefined) ?? safeImgUrl(image);
  const showImage = Boolean(resolved) && !imgError;
  const isChannel = variant === 'channel';
  const code = channelCode(title);
  const showRating = rating != null && rating > 0;

  return (
    <div
      ref={ref}
      className={`${styles.card} ${styles[variant]} ${selected ? styles.selected : ''} ${focused ? styles.focused : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      {/* ── Thumbnail ── */}
      <div className={`${isChannel ? styles.artChannel : styles.artPoster} ${inlinePreview ? styles.artInline : ''}`}>
        {inlinePreview ? (
          <div className={styles.inlineSlot}>{inlinePreview}</div>
        ) : showImage ? (
          <img
            src={resolved}
            alt={title}
            onError={() => setImgError(true)}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'auto'}
            decoding="async"
            className={styles.img}
            style={{ objectFit: isChannel ? 'contain' : 'cover' }}
          />
        ) : isChannel ? (
          <div className={styles.chPlaceholder}>
            <div className={styles.chLogo}>
              <span className={styles.chStripe} />
              <span>{code}</span>
            </div>
            <span className={styles.phTag}>// LIVE FEED</span>
          </div>
        ) : (
          <div className={styles.poPlaceholder}>
            <span className={styles.phTag}>// POSTER · 2:3</span>
            <div className={styles.phMark}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="M7 4v16M17 4v16M2 9h5M17 9h5M2 15h5M17 15h5" />
              </svg>
              <span className={styles.phMarkLabel}>IMG</span>
            </div>
            <div className={styles.phName}>{title}</div>
          </div>
        )}

        {/* LIVE pill */}
        {isLive && (
          <div className={styles.livePill}>
            <span className={styles.liveDot} />
            LIVE
          </div>
        )}

        {/* Pastille qualités (chaîne regroupée) */}
        {badge && <div className={styles.qualityBadge}>{badge}</div>}
      </div>

      {/* ── Info below image ── */}
      <div className={styles.info}>
        <div className={styles.title} title={title}>{title}</div>
        {(showRating || genre) && (
          <div className={styles.meta}>
            {showRating && <span className={styles.rating}>★ {rating!.toFixed(1)}</span>}
            {genre && <span className={styles.genre}>{genre.split('/')[0].trim()}</span>}
          </div>
        )}
      </div>

      {/* ── Favourite button ── */}
      {onFavorite && (
        <button
          className={`${styles.favBtn} ${isFavorite ? styles.favActive : ''}`}
          onClick={(e) => { e.stopPropagation(); onFavorite(); }}
          title={isFavorite ? t('common.removeFavorite') : t('common.addFavorite')}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      )}
    </div>
  );
}

// Mémoïsé : une grille Live/Films/Séries monte des centaines de cartes ; seul
// le changement d'une prop de donnée doit re-rendre une carte (ex. `selected`
// ne bascule que sur 2 cartes au changement de sélection). Props fonctions
// exclues : dispatchers liés à l'item, carte montée avec `key={id}`.
// `inlinePreview` comparé par présence (Boolean) : son JSX change à chaque
// render parent mais sa montée/démontage est tracée par selected → un seul
// re-render à la bascule selected.
export const MediaCard = memo(MediaCardInner, (a, b) =>
  a.title === b.title &&
  a.image === b.image &&
  a.rating === b.rating &&
  a.genre === b.genre &&
  a.variant === b.variant &&
  a.isLive === b.isLive &&
  a.isFavorite === b.isFavorite &&
  a.selected === b.selected &&
  a.badge === b.badge &&
  a.priority === b.priority &&
  Boolean(a.inlinePreview) === Boolean(b.inlinePreview),
);
