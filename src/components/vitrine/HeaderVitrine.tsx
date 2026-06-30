import { Fragment, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppLogo } from '../AppLogo';
import { useSupabaseAuth } from '../../contexts/SupabaseAuthContext';
import { PREMIUM_ENABLED } from '../../config/monetization';

/**
 * Header sticky vitrine (design Umbra) : transparent puis blur + hairline dorée
 * au scroll, underline accent sous les liens, drawer mobile. Markup fidèle au
 * design ; classes globales scopées sous `.vitrine` (voir vitrine.css).
 */
export function HeaderVitrine() {
  const { user } = useSupabaseAuth();
  const { pathname } = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const account = user ? '/settings' : '/login';
  const activeNav = pathname.startsWith('/downloads') ? 'downloads' : undefined;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <Fragment>
      <header className={`hdr${scrolled ? ' scrolled' : ''}`}>
        <Link className="brand" to="/" aria-label="Umbra — accueil">
          <AppLogo size={30} className="logo-mark" />
          <span className="wordmark">Umbra</span>
        </Link>
        <nav className="nav" aria-label="Navigation principale">
          <Link className={`nav-link${activeNav === 'downloads' ? ' active' : ''}`} to="/downloads">
            Télécharger
          </Link>
          <a className="nav-link" href={PREMIUM_ENABLED ? '/#pricing' : '/#features'}>
            {PREMIUM_ENABLED ? 'Premium' : 'Fonctionnalités'}
          </a>
          <Link className="nav-link nav-cta-wrap" to={account} style={{ padding: 0 }}>
            <span className="nav-cta">{user ? 'Mon compte' : 'Se connecter'}</span>
          </Link>
          <button className="burger" aria-label="Ouvrir le menu" onClick={() => setOpen(true)}>
            <span />
          </button>
        </nav>
      </header>

      <div className={`drawer-scrim${open ? ' open' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <div className="drawer-head">
          <Link className="brand" to="/" onClick={() => setOpen(false)}>
            <AppLogo size={30} className="logo-mark" />
            <span className="wordmark">Umbra</span>
          </Link>
          <button className="drawer-close" aria-label="Fermer" onClick={() => setOpen(false)}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <Link to="/downloads" onClick={() => setOpen(false)}>
          Télécharger
        </Link>
        <a href={PREMIUM_ENABLED ? '/#pricing' : '/#features'} onClick={() => setOpen(false)}>
          {PREMIUM_ENABLED ? 'Premium' : 'Fonctionnalités'}
        </a>
        <Link to={account} onClick={() => setOpen(false)}>
          {user ? 'Mon compte' : 'Se connecter'}
        </Link>
        <Link className="drawer-cta" to="/downloads" onClick={() => setOpen(false)}>
          Télécharger Umbra
        </Link>
      </aside>
    </Fragment>
  );
}
