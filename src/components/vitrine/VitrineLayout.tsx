import { useEffect, useRef, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { HeaderVitrine } from './HeaderVitrine';
import { FooterVitrine } from './FooterVitrine';
import { useVitrineChrome } from '../../hooks/useVitrineChrome';
import '../../styles/vitrine.css';

/**
 * Enveloppe commune à toutes les pages vitrine (design « OLED-First/Vanta »).
 * Pose la racine `.vitrine` (scope CSS), le grain, le curseur custom, le header
 * sticky et le footer. Gère le smooth-scroll et le scroll vers une ancre
 * (`/#pricing`) après navigation.
 *
 * @param activeNav  onglet de nav à surligner (« downloads » | « premium »)
 */
export function VitrineLayout({
  children,
  activeNav,
}: {
  children: ReactNode;
  activeNav?: 'downloads' | 'premium';
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { pathname, hash } = useLocation();
  const cursorReady = useVitrineChrome(rootRef, pathname);

  // Smooth scroll global pendant la durée de vie de la vitrine.
  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = 'smooth';
    return () => {
      html.style.scrollBehavior = prev;
    };
  }, []);

  // Scroll vers l'ancre après navigation (ex. arriver sur /#pricing).
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        // léger délai : laisser le DOM de la page se monter
        const t = window.setTimeout(() => el.scrollIntoView({ block: 'start' }), 60);
        return () => window.clearTimeout(t);
      }
    } else {
      window.scrollTo(0, 0);
    }
  }, [pathname, hash]);

  return (
    <div ref={rootRef} className={`vitrine${cursorReady ? ' cursor-ready' : ''}`}>
      <div className="grain" />
      <div className="cursor-ring" />
      <div className="cursor-dot" />
      <HeaderVitrine activeNav={activeNav} />
      <main>{children}</main>
      <FooterVitrine />
    </div>
  );
}
