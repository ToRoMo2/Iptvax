import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppLogo } from '../AppLogo';
import { useSupabaseAuth } from '../../contexts/SupabaseAuthContext';

/**
 * Header sticky vitrine (design Vanta) : blur progressif au scroll, hairline
 * cyan qui s'allume, underline « progress bar » sous les liens. Markup fidèle
 * au design ; classes globales scopées sous `.vitrine` (voir vitrine.css).
 */
export function HeaderVitrine() {
  const { user } = useSupabaseAuth();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const activeNav = pathname.startsWith('/downloads')
    ? 'downloads'
    : pathname === '/premium'
      ? 'premium'
      : undefined;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header className={`hdr${scrolled ? ' scrolled' : ''}`}>
      <Link className="brand" to="/" aria-label="Umbra — accueil">
        <AppLogo size={30} />
        <span>Umbra</span>
      </Link>
      <nav className="nav" aria-label="Navigation principale">
        <Link className={`nav-link${activeNav === 'downloads' ? ' active' : ''}`} to="/downloads">
          Télécharger
        </Link>
        <a className={`nav-link${activeNav === 'premium' ? ' active' : ''}`} href="/#pricing">
          Premium
        </a>
        <Link className="nav-link nav-cta-wrap" to={user ? '/settings' : '/login'} style={{ padding: 0 }}>
          <span className="nav-cta">{user ? 'Mon compte' : 'Se connecter'}</span>
        </Link>
      </nav>
    </header>
  );
}
