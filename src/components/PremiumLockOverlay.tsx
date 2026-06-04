import { IconLock } from './PremiumIcons';
import styles from './PremiumLockOverlay.module.css';

/**
 * Calque de verrouillage Premium réutilisable, posé en `position: absolute`
 * par-dessus une vignette de carte (le conteneur parent doit être `relative`).
 * Purement présentationnel : le clic / la navigation est géré par la carte
 * porteuse. Le teasing visuel (flou de la vignette) est appliqué côté carte
 * (classe dédiée sur l'`<img>`), pas ici, pour garder l'overlay générique.
 *
 * Identité visuelle « élégante & désirable » : pastille cadenas dorée (mêmes
 * tons que le badge Premium de la navbar), accroche courte, micro-CTA pilule.
 */
interface Props {
  title?: string;
  text?: string;
  cta?: string;
  /** Variante compacte (cartes de petite taille) : masque le texte secondaire. */
  compact?: boolean;
}

export function PremiumLockOverlay({ title, text, cta, compact }: Props) {
  return (
    <div className={`${styles.overlay} ${compact ? styles.compact : ''}`} aria-hidden="true">
      <span className={styles.lockChip}>
        <IconLock size={compact ? 16 : 19} />
      </span>
      {title && <span className={styles.title}>{title}</span>}
      {text && !compact && <span className={styles.text}>{text}</span>}
      {cta && (
        <span className={styles.cta}>
          <span className={styles.ctaStar}>✦</span>
          {cta}
        </span>
      )}
    </div>
  );
}
