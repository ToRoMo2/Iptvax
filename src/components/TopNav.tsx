import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslationKey } from '../i18n';
import { ProfilePanel } from './ProfilePanel';
import { Focusable } from './Focusable';
import { FIRST_NAV_FOCUS_KEY, HERO_FOCUS_KEY, DETAIL_BACK_FOCUS_KEY } from './RemoteControl';
import { SEARCH_FOCUS_KEY } from './RemoteSearch';
import { AppLogo } from './AppLogo';
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
  cine: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/></svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
  ),
};

const LINKS: { to: string; labelKey: TranslationKey; icon: () => JSX.Element; end: boolean }[] = [
  { to: '/',         labelKey: 'nav.home',   icon: Ic.home,   end: true  },
  { to: '/live',     labelKey: 'nav.live',   icon: Ic.tv,     end: false },
  { to: '/movies',   labelKey: 'nav.movies', icon: Ic.film,   end: false },
  { to: '/series',   labelKey: 'nav.series', icon: Ic.series, end: false },
  { to: '/favorites',labelKey: 'nav.myList', icon: Ic.star,   end: false },
  { to: '/journal',  labelKey: 'nav.myCine', icon: Ic.cine,   end: false },
];

export function TopNav() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { activeProfile } = useIptvProfile();
  const { t } = useI18n();

  // Depuis la navbar, flèche bas → cible explicite selon la page courante.
  // IMPORTANT : on utilise === (pas startsWith) pour les listes, sinon
  // /series/17103 matcherait /series et setFocus(SEARCH_FOCUS_KEY) partirait
  // dans le vide (pas de barre de recherche sur les pages de détail).
  const browseRoute = ['/movies', '/series', '/live', '/search'].includes(location.pathname);
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

  const profileName = activeProfile?.name ?? t('nav.profile');
  const avatarVar   = { '--pf': `var(--${activeProfile?.color ?? 'profile-1'})` } as CSSProperties;

  return (
    <>
      {/* ── Brand — fixé à gauche ───────────────────────────────────── */}
      <div className="brand-fixed" title="Iptvax">
        <AppLogo size={22} />
        <span className="brand-name">IPTVAX</span>
      </div>

      {/* ── Search button — mobile only (en haut à droite, à côté du profil)
            Sur desktop il vit dans la capsule .topnav ; sur mobile la capsule
            est masquée par CSS donc on rend un bouton autonome ici. ──── */}
      <button
        type="button"
        className="search-fixed-mobile"
        title={t('nav.search')}
        aria-label={t('nav.search')}
        onClick={() => navigate('/search')}
      >
        <Ic.search />
      </button>

      {/* ── Capsule navbar — centrée, liens uniquement (desktop / tablette) */}
      <header className={`topnav ${scrolled ? 'scrolled' : ''} ${navOpen ? 'rc-open' : ''}`}>
        <nav className="links" aria-label="Primary">
          {LINKS.map(({ to, labelKey, icon: Icon, end }, i) => {
            const label = t(labelKey);
            return (
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
            );
          })}
        </nav>

        <span className="nav-sep-right" />

        <Focusable
          className="icon-btn"
          onEnter={() => navigate('/search')}
          onClick={() => navigate('/search')}
          onFocused={onNavFocus}
          onBlurred={onNavBlur}
          onArrow={navArrow}
          title={t('nav.search')}
          ariaLabel={t('nav.search')}
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
              <span className="plan">{t('nav.iptvProfile')}</span>
            </div>
          </Focusable>

          {panelOpen && <ProfilePanel onClose={() => setPanelOpen(false)} />}
        </div>
      </div>

      {/* ── Bottom nav — mobile only (≤ 640px)
            Onglets primaires fixés au bas de l'écran (style app native iOS/Android).
            Reprend les mêmes LINKS que la capsule desktop — pas de duplication
            de structure de routes : un seul array source de vérité. ──────── */}
      <nav className="bottomnav" aria-label="Primary mobile">
        {LINKS.map(({ to, labelKey, icon: Icon, end }) => {
          const label = t(labelKey);
          return (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              className={({ isActive }) => `bn-tab ${isActive ? 'active' : ''}`}
            >
              <span className="bn-ic"><Icon /></span>
              <span className="bn-lbl">{label}</span>
            </NavLink>
          );
        })}
      </nav>
    </>
  );
}
