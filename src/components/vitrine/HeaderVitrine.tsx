import { Link, useLocation } from 'react-router-dom';
import { AppLogo } from '../AppLogo';
import { useSupabaseAuth } from '../../contexts/SupabaseAuthContext';
import styles from './HeaderVitrine.module.css';

export function HeaderVitrine() {
  const { user } = useSupabaseAuth();
  const { pathname } = useLocation();

  const linkClass = (path: string) =>
    `${styles.link} ${pathname === path ? styles.linkActive : ''}`;

  return (
    <header className={styles.header}>
      <Link to="/" className={styles.brand} aria-label="Iptvax — accueil">
        <AppLogo size={32} />
        <span>Iptvax</span>
      </Link>

      <nav className={styles.nav} aria-label="Navigation principale">
        <Link to="/downloads" className={linkClass('/downloads')}>
          Télécharger
        </Link>
        <Link to="/premium" className={linkClass('/premium')}>
          Premium
        </Link>
        {user ? (
          <Link to="/settings" className={`${styles.link} ${styles.ctaLink}`}>
            Mon compte
          </Link>
        ) : (
          <Link to="/login" className={`${styles.link} ${styles.ctaLink}`}>
            Se connecter
          </Link>
        )}
      </nav>
    </header>
  );
}
