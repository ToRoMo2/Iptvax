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
}

function initials(name: string): string {
  return name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/**
 * Section « Casting » de la fiche détail (film & série) — grille de cartes
 * acteur (photo + nom + rôle). L'ancien onglet « Médias » a été retiré : sur
 * desktop les images TMDB servent de fond défilant au hero (§Phase 4), donc une
 * galerie redondante n'a plus lieu d'être. Composant partagé MovieDetail/
 * SeriesDetail.
 */
export function DetailMedia({ tmdbCast, xtreamCast }: Props) {
  const { t } = useI18n();
  const hasCast = tmdbCast.length > 0 || xtreamCast.length > 0;
  if (!hasCast) return null;

  return (
    <section className={styles.block}>
      <div className={styles.sectionLabel}>{t('detail.casting')}</div>
      <div className={styles.castGrid}>
        {tmdbCast.length > 0
          ? tmdbCast.map((c) => (
              <Focusable key={`${c.name}-${c.character}`} className={styles.castCard} focusedClassName="rc-focused" ariaLabel={c.name}>
                {c.profile ? (
                  <img src={safeImgUrl(c.profile)} alt={c.name} loading="lazy" decoding="async" className={styles.castAvatar} />
                ) : (
                  <div className={styles.castAvatarPh}>{initials(c.name)}</div>
                )}
                <div className={styles.castMeta}>
                  <span className={styles.castName}>{c.name}</span>
                  <span className={styles.castRole}>{c.character}</span>
                </div>
              </Focusable>
            ))
          : xtreamCast.map((name) => (
              <Focusable key={name} className={styles.castCard} focusedClassName="rc-focused" ariaLabel={name}>
                <div className={styles.castAvatarPh}>{initials(name)}</div>
                <div className={styles.castMeta}>
                  <span className={styles.castName}>{name}</span>
                  <span className={styles.castRole}>{t('detail.actor')}</span>
                </div>
              </Focusable>
            ))}
      </div>
    </section>
  );
}
