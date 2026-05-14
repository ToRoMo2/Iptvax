import { NavLink } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import styles from './Sidebar.module.css';

/* ── Inline SVG icons ────────────────────────────────────────────────────── */
const Icon = {
  home: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/>
      <path d="M9 21V12h6v9"/>
    </svg>
  ),
  tv: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3"/>
    </svg>
  ),
  film: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4"/>
    </svg>
  ),
  popcorn: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M5 9h14l-1.5 12h-11L5 9z"/>
      <path d="M5 9a3 3 0 0 1 0-6 3 3 0 0 1 5-2 3 3 0 0 1 5 0 3 3 0 0 1 4 5"/>
    </svg>
  ),
  search: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18">
      <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>
    </svg>
  ),
  star: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
    </svg>
  ),
  settings: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.36.32.59.79.6 1.31"/>
    </svg>
  ),
  power: () => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
      <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10"/>
    </svg>
  ),
  play: () => (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
      <path d="M8 5v14l11-7z"/>
    </svg>
  ),
};

const NAV_SECTIONS = [
  {
    label: 'Découvrir',
    items: [
      { to: '/',     label: 'Accueil',  IconComp: Icon.home },
      { to: '/live', label: 'Live TV',  IconComp: Icon.tv,   badge: 'LIVE' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { to: '/movies', label: 'Films',  IconComp: Icon.film },
      { to: '/series', label: 'Séries', IconComp: Icon.popcorn },
    ],
  },
  {
    label: 'Vous',
    items: [
      { to: '/search',    label: 'Recherche',  IconComp: Icon.search },
      { to: '/favorites', label: 'Favoris',    IconComp: Icon.star },
      { to: '/settings',  label: 'Paramètres', IconComp: Icon.settings },
    ],
  },
];

export function Sidebar() {
  const { userInfo, logout } = useXtream();
  const initial = userInfo?.username?.charAt(0).toUpperCase() ?? 'A';

  return (
    <nav className={styles.sidebar}>
      {/* Brand */}
      <div className={styles.brand}>
        <div className={styles.brandMark}>
          <Icon.play />
        </div>
        <span className={styles.brandText}>
          aurora<span className={styles.brandDot}>.</span>
        </span>
      </div>

      {/* Navigation */}
      {NAV_SECTIONS.map((section) => (
        <div key={section.label}>
          <div className={styles.sectionLabel}>{section.label}</div>
          <ul className={styles.nav}>
            {section.items.map(({ to, label, IconComp, badge }) => (
              <li key={to}>
                <NavLink
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `${styles.link} ${isActive ? styles.active : ''}`
                  }
                >
                  <span className={styles.icon}>
                    <IconComp />
                  </span>
                  <span className={styles.label}>{label}</span>
                  {badge && <span className={styles.badge}>{badge}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {/* Footer */}
      <div className={styles.footer}>
        {userInfo && (
          <div className={styles.userCard}>
            <div className={styles.avatar}>{initial}</div>
            <div className={styles.userMeta}>
              <span className={styles.userName}>{userInfo.username}</span>
              {userInfo.exp_date && (
                <span className={styles.userSub}>
                  Expire {new Date(parseInt(userInfo.exp_date) * 1000).toLocaleDateString('fr-FR')}
                </span>
              )}
            </div>
          </div>
        )}
        <button className={styles.logoutBtn} onClick={logout}>
          <Icon.power />
          <span>Déconnexion</span>
        </button>
      </div>
    </nav>
  );
}
