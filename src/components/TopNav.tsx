import { NavLink, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useXtream } from '../context/XtreamContext';
import './TopNav.css';

/* ── Vanta line icons ────────────────────────────────────────────────────── */
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
  bell: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
  ),
  cast: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M2 16a3 3 0 0 1 3 3M2 12a7 7 0 0 1 7 7M2 8a11 11 0 0 1 11 11"/><rect x="2" y="4" width="20" height="14" rx="2"/></svg>
  ),
};

const LINKS = [
  { to: '/',       label: 'Accueil', icon: Ic.home,   end: true },
  { to: '/live',   label: 'Live TV', icon: Ic.tv,     end: false },
  { to: '/movies', label: 'Films',   icon: Ic.film,   end: false },
  { to: '/series', label: 'Séries',  icon: Ic.series, end: false },
  { to: '/favorites', label: 'Favoris', icon: Ic.star, end: false },
];

export function TopNav() {
  const navigate = useNavigate();
  const { userInfo } = useXtream();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const main = document.querySelector('.main-content');
    if (!main) return;
    const onScroll = () => setScrolled(main.scrollTop > 12);
    main.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => main.removeEventListener('scroll', onScroll);
  }, []);

  const username = userInfo?.username ?? 'User';
  const initial = username.charAt(0).toUpperCase();

  return (
    <header className={`topnav ${scrolled ? 'scrolled' : ''}`}>
      <div className="brand" title="Vanta">
        <span className="brand-mark" />
        <span className="brand-name">VANTA</span>
      </div>

      <span className="nav-sep" />

      <nav className="links" aria-label="Primary">
        {LINKS.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => `link ${isActive ? 'active' : ''}`}
            title={label}
          >
            <span className="ic"><Icon /></span>
            <span className="lbl">{label}</span>
          </NavLink>
        ))}
      </nav>

      <span className="nav-sep-right" />

      <div className="top-actions">
        <button className="icon-btn" title="Recherche" onClick={() => navigate('/search')}>
          <Ic.search />
        </button>
        <button className="icon-btn has-dot" title="Notifications" type="button">
          <Ic.bell />
        </button>
        <button className="icon-btn" title="Cast" type="button">
          <Ic.cast />
        </button>
        <button
          className="profile"
          title={`${username} — Premium`}
          onClick={() => navigate('/settings')}
        >
          <div className="avatar-btn">{initial}</div>
          <div className="who">
            <span className="name">{username}</span>
            <span className="plan">Premium</span>
          </div>
        </button>
      </div>
    </header>
  );
}
