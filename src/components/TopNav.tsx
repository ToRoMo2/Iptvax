import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { ProfilePanel } from './ProfilePanel';
import { Focusable } from './Focusable';
import { FIRST_NAV_FOCUS_KEY, HERO_FOCUS_KEY, DETAIL_BACK_FOCUS_KEY } from './RemoteControl';
import { SEARCH_FOCUS_KEY } from './RemoteSearch';
import './TopNav.css';

/* ── Icônes ─────────────────────────────────────────────────────────── */
const Ic = {
  home: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m3 11 9-8 9 8M5 10v10h5v-6h4v6h5V10"/></svg>
  ),
  tv: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3"/></svg>
  ),
  film: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4"/></svg>
  ),
  series: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M7 3l5 3 5-3"/></svg>
  ),
  star: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
  ),
};

const LINKS = [
  { to: '/',         label: 'Accueil', icon: Ic.home,   end: true  },
  { to: '/live',     label: 'Live TV', icon: Ic.tv,     end: false },
  { to: '/movies',   label: 'Films',   icon: Ic.film,   end: false },
  { to: '/series',   label: 'Séries',  icon: Ic.series, end: false },
  { to: '/favorites',label: 'Favoris', icon: Ic.star,   end: false },
];

export function TopNav() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { activeProfile } = useIptvProfile();

  // Depuis la navbar, flèche bas → cible explicite selon la page courante.
  // IMPORTANT : on utilise === (pas startsWith) pour les listes, sinon
  // /series/17103 matcherait /series et setFocus(SEARCH_FOCUS_KEY) partirait
  // dans le vide (pas de barre de recherche sur les pages de détail).
  const browseRoute = ['/movies', '/series', '/live'].includes(location.pathname);
  const detailRoute =
    location.pathname.startsWith('/series/') ||
    location.pathname.startsWith('/movie/');

  const navArrow = (direction: string): boolean => {
    if (direction !== 'down') return true;
    if (browseRoute) { setFocus(SEARCH_FOCUS_KEY); return false; }
    if (location.pathname === '/') { setFocus(HERO_FOCUS_KEY); return false; }
    if (detailRoute) { setFocus(DETAIL_BACK_FOCUS_KEY); return false; }
    return true;
  };

  const [scrolled,     setScrolled]     = useState(false);
  const [panelOpen,    setPanelOpen]    = useState(false);
  // Déploiement navbar (liens) au focus télécommande
  const [navOpen,      setNavOpen]      = useState(false);
  // Déploiement profil au focus télécommande
  const [profileOpen,  setProfileOpen]  = useState(false);

  const navBlurTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileWrapperRef = useRef<HTMLDivElement>(null);

  const onNavFocus = () => { if (navBlurTimer.current) clearTimeout(navBlurTimer.current); setNavOpen(true); };
  const onNavBlur  = () => {
    if (navBlurTimer.current) clearTimeout(navBlurTimer.current);
    navBlurTimer.current = setTimeout(() => setNavOpen(false), 80);
  };

  const onProfileFocus = () => { if (profileBlurTimer.current) clearTimeout(profileBlurTimer.current); setProfileOpen(true); };
  const onProfileBlur  = () => {
    if (profileBlurTimer.current) clearTimeout(profileBlurTimer.current);
    profileBlurTimer.current = setTimeout(() => setProfileOpen(false), 80);
  };

  useEffect(() => () => {
    if (navBlurTimer.current)     clearTimeout(navBlurTimer.current);
    if (profileBlurTimer.current) clearTimeout(profileBlurTimer.current);
  }, []);

  useEffect(() => {
    const main = document.querySelector('.main-content');
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 12);
    main.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  const profileName = activeProfile?.name ?? 'Profil';
  const avatarVar   = { '--pf': `var(--${activeProfile?.color ?? 'profile-1'})` } as CSSProperties;

  return (
    <>
      {/* ── Brand — fixé à gauche ───────────────────────────────────── */}
      <div className="brand-fixed" title="Iptvax">
        <span className="brand-mark" />
        <span className="brand-name">IPTVAX</span>
      </div>

      {/* ── Capsule navbar — centrée, liens uniquement ──────────────── */}
      <header className={`topnav ${scrolled ? 'scrolled' : ''} ${navOpen ? 'rc-open' : ''}`}>
        <nav className="links" aria-label="Primary">
          {LINKS.map(({ to, label, icon: Icon, end }, i) => (
            <Focusable
              key={to}
              focusKey={i === 0 ? FIRST_NAV_FOCUS_KEY : undefined}
              className="nav-foc"
              onEnter={() => navigate(to)}
              onFocused={onNavFocus}
              onBlurred={onNavBlur}
              onArrow={navArrow}
            >
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) => `link ${isActive ? 'active' : ''}`}
                title={label}
                tabIndex={-1}
              >
                <span className="ic"><Icon /></span>
                <span className="lbl">{label}</span>
              </NavLink>
            </Focusable>
          ))}
        </nav>

        <span className="nav-sep-right" />

        <Focusable
          className="icon-btn"
          onEnter={() => navigate('/search')}
          onClick={() => navigate('/search')}
          onFocused={onNavFocus}
          onBlurred={onNavBlur}
          onArrow={navArrow}
          title="Recherche"
          ariaLabel="Recherche"
        >
          <Ic.search />
        </Focusable>
      </header>

      {/* ── Profil — fixé à droite ──────────────────────────────────── */}
      <div
        className={`profile-fixed ${profileOpen ? 'rc-open' : ''}`}
        ref={profileWrapperRef}
      >
        <div className="profile-wrapper">
          <Focusable
            className="profile"
            title={profileName}
            onEnter={() => setPanelOpen((o) => !o)}
            onClick={() => setPanelOpen((o) => !o)}
            onFocused={onProfileFocus}
            onBlurred={onProfileBlur}
            onArrow={navArrow}
          >
            <div className="avatar-btn" style={avatarVar}>
              <span className="avatar-emoji">{activeProfile?.avatar ?? '🎬'}</span>
            </div>
            <div className="who">
              <span className="name">{profileName}</span>
              <span className="plan">Profil IPTV</span>
            </div>
          </Focusable>

          {panelOpen && <ProfilePanel onClose={() => setPanelOpen(false)} />}
        </div>
      </div>
    </>
  );
}
