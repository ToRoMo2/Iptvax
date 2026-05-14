import { useState } from 'react';
import styles from './MediaCard.module.css';
import { safeImgUrl } from '../utils/image';

type CardVariant = 'channel' | 'movie' | 'series';

interface Props {
  title: string;
  image?: string;
  rating?: number;
  genre?: string;
  variant: CardVariant;
  isLive?: boolean;
  isFavorite?: boolean;
  onClick: () => void;
  onFavorite?: () => void;
}

// Gradient backgrounds for thumbnail fallbacks
const THUMB_GRADIENTS = [
  'radial-gradient(circle at 60% 30%, rgba(108,99,255,.45), transparent 60%), linear-gradient(135deg,#1a1a2e,#0d0d1a)',
  'radial-gradient(circle at 40% 70%, rgba(168,85,247,.4), transparent 55%), linear-gradient(135deg,#2a1a3e,#0a0a14)',
  'radial-gradient(circle at 70% 20%, rgba(95,210,255,.3), rgba(108,99,255,.3), transparent 65%), linear-gradient(135deg,#0d1a2e,#0d0d1a)',
  'radial-gradient(circle at 30% 60%, rgba(255,107,140,.25), rgba(255,184,77,.2), transparent 60%), linear-gradient(135deg,#2e0d1a,#0d0d1a)',
];

function getGradient(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) | 0;
  return THUMB_GRADIENTS[Math.abs(hash) % THUMB_GRADIENTS.length];
}

export function MediaCard({
  title,
  image,
  rating,
  genre,
  variant,
  isLive,
  isFavorite,
  onClick,
  onFavorite,
}: Props) {
  const [imgError, setImgError] = useState(false);
  // safeImgUrl rejette les URLs relatives (simples noms de fichier) renvoyées par certains
  // serveurs Xtream → évite les 404 dans la console du navigateur.
  const showImage = Boolean(safeImgUrl(image)) && !imgError;
  const initial  = title.charAt(0).toUpperCase();
  const gradient = getGradient(title);
  const showRating = rating != null && rating > 0;

  /* ──────────────────────────────────────────────────────────────────────
     Thumbnail dimensions:
     • .card = display:block  →  normal block layout (NO flex-column)
     • .thumb = aspect-ratio:16/9 via inline style (bypasses CSS cache;
       works correctly in block context where % padding also works)
  ─────────────────────────────────────────────────────────────────────── */

  return (
    <div
      className={`${styles.card} ${styles[variant]}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      {/* ── Thumbnail ── */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: variant === 'channel' ? '16 / 9' : '2 / 3',
          overflow: 'hidden',
          background: gradient,
        }}
        className={variant === 'channel' ? styles.thumbGrid : undefined}
      >
        {showImage && (
          <img
            src={safeImgUrl(image)}
            alt={title}
            onError={() => setImgError(true)}
            loading="lazy"
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: variant === 'channel' ? 'contain' : 'cover',
              display: 'block',
            }}
          />
        )}

        {!showImage && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1,
            }}
          >
            <span
              style={{
                fontFamily: "'Outfit', sans-serif",
                fontSize: 52,
                fontWeight: 900,
                color: 'rgba(255,255,255,0.12)',
                letterSpacing: '-0.03em',
                textTransform: 'uppercase',
              }}
            >
              {initial}
            </span>
          </div>
        )}

        {/* LIVE badge */}
        {isLive && (
          <div className={styles.livePill}>
            <span className={styles.liveDot} />
            LIVE
          </div>
        )}

        {/* Play overlay */}
        <div className={styles.overlay}>
          <div className={styles.playBtn}>▶</div>
        </div>
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
          title={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      )}
    </div>
  );
}
