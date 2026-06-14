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
 * (`/#pricing`) après navigation. L'onglet de nav actif est dérivé de la route
 * directement dans `HeaderVitrine`.
 */
export function VitrineLayout({ children }: { children: ReactNode }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { pathname, hash } = useLocation();
  useVitrineChrome(rootRef, pathname);

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
    <div ref={rootRef} className="vitrine">
      <div className="grain" />
      <div className="edge-vignette" />
      <div className="cursor-glow" />
      <HeaderVitrine />
      <main>{children}</main>
      <FooterVitrine />
    </div>
  );
}
