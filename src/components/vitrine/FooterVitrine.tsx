import { Link } from 'react-router-dom';
import { AppLogo } from '../AppLogo';
import { GITHUB_REPO } from '../../config/vitrine';
import styles from './FooterVitrine.module.css';

export function FooterVitrine() {
  const year = new Date().getFullYear();
  return (
    <footer className={styles.footer}>
      <div className={styles.cols}>
        <div className={`${styles.col} ${styles.brandCol}`}>
          <div className={styles.brandLine}>
            <AppLogo size={24} />
            <span>Iptvax</span>
          </div>
          <p className={styles.tagline}>
            Votre client IPTV moderne, multi-plateforme. Sans publicité, sans
            compromis.
          </p>
        </div>

        <div className={styles.col}>
          <h4>Produit</h4>
          <div className={styles.colLinks}>
            <Link to="/downloads">Téléchargements</Link>
            <Link to="/premium">Premium</Link>
            <Link to="/tv-link">Appairage TV</Link>
          </div>
        </div>

        <div className={styles.col}>
          <h4>Compte</h4>
          <div className={styles.colLinks}>
            <Link to="/login">Se connecter</Link>
            <Link to="/settings">Mon compte</Link>
          </div>
        </div>

        <div className={styles.col}>
          <h4>Légal</h4>
          <div className={styles.colLinks}>
            <Link to="/mentions-legales">Mentions légales</Link>
            <Link to="/cgv">CGV</Link>
            <Link to="/confidentialite">Confidentialité</Link>
            <a
              href={`https://github.com/${GITHUB_REPO}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>

      <div className={styles.bottom}>
        <span className={styles.copyright}>© {year} Iptvax. Tous droits réservés.</span>
        <span className={styles.copyright}>Fait avec ❤ en France.</span>
      </div>
    </footer>
  );
}
