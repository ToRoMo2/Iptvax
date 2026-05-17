import { useEffect, useState, type MouseEvent } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { clampToStep, RATING_MIN, RATING_STEP, RATING_MAX } from '../../utils/ratings';
import styles from './RatingStars.module.css';

interface Props {
  /** Note courante ou `null` (non noté). */
  value: number | null;
  /** Affichage seul (carte / agrégat) — pas d'interaction. */
  readOnly?: boolean;
  /** Taille des étoiles en px (défaut 22). */
  size?: number;
  /** Pas de notation (défaut 0,5 — titres ; 1 pour la note de membre). */
  step?: number;
  /** Note minimale (défaut 0,5). */
  min?: number;
  onChange?: (value: number) => void;
  /** Clé de focus télécommande (mode interactif uniquement). */
  focusKey?: string;
  ariaLabel?: string;
}

const STARS = [1, 2, 3, 4, 5];

/** Largeur de remplissage (0 / 0,5 / 1) d'une étoile pour une note donnée. */
function fillFor(starIndex: number, value: number): number {
  return Math.max(0, Math.min(1, value - (starIndex - 1)));
}

/**
 * Étoiles 0,5–5 par demi-pas. Souris : moitié gauche/droite d'une étoile.
 * Télécommande/clavier : flèches gauche/droite (±0,5). Lecture seule pour
 * les cartes du mur. `useFocusable` direct (parité MediaCard, pas de
 * couplage composant→composant — corset §3).
 */
export function RatingStars({
  value,
  readOnly,
  size = 22,
  step = RATING_STEP,
  min = RATING_MIN,
  onChange,
  focusKey,
  ariaLabel,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const snap = (v: number) => clampToStep(v, step, min, RATING_MAX);

  const { ref, focused } = useFocusable({
    focusable: !readOnly,
    focusKey,
    onArrowPress: (direction: string) => {
      if (readOnly || !onChange) return true;
      if (direction === 'left') {
        onChange(snap((value ?? min) - step));
        return false;
      }
      if (direction === 'right') {
        onChange(snap((value ?? min - step) + step));
        return false;
      }
      return true; // haut/bas → navigation normale
    },
  });

  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'smooth',
      });
    }
  }, [focused, ref]);

  const shown = hover ?? value ?? 0;

  const pickFromPointer = (e: MouseEvent<HTMLElement>, star: number) => {
    const r = e.currentTarget.getBoundingClientRect();
    const half = e.clientX - r.left < r.width / 2;
    return snap(star - (half ? 0.5 : 0));
  };

  return (
    <div
      ref={ref}
      className={`${styles.stars} ${readOnly ? styles.ro : ''} ${
        focused ? 'rc-focused' : ''
      }`}
      style={{ fontSize: size }}
      role={readOnly ? 'img' : 'slider'}
      aria-label={
        ariaLabel ??
        (value != null ? `Note ${value} sur ${RATING_MAX}` : 'Non noté')
      }
      aria-valuenow={value ?? undefined}
      aria-valuemin={min}
      aria-valuemax={RATING_MAX}
      onMouseLeave={() => setHover(null)}
    >
      {STARS.map((s) => {
        const fill = fillFor(s, shown);
        return (
          <span
            key={s}
            className={styles.star}
            onMouseMove={
              readOnly ? undefined : (e) => setHover(pickFromPointer(e, s))
            }
            onClick={
              readOnly || !onChange
                ? undefined
                : (e) => onChange(pickFromPointer(e, s))
            }
          >
            <span className={styles.bg}>★</span>
            <span
              className={styles.fg}
              style={{ width: `${fill * 100}%` }}
              aria-hidden="true"
            >
              ★
            </span>
          </span>
        );
      })}
    </div>
  );
}
