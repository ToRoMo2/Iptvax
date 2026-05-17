import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';

/** Première entrée de navbar — point de départ du focus télécommande. */
export const FIRST_NAV_FOCUS_KEY = 'rc-nav-0';

/** Bouton principal du hero « à la une » (Accueil) — cible des redirections
 *  flèche haut depuis les rails et flèche bas depuis la navbar. */
export const HERO_FOCUS_KEY = 'rc-hero';

/** Bouton « ← Retour » des pages de détail (Film / Série) — premier
 *  élément focusable, toujours rendu même pendant le chargement. */
export const DETAIL_BACK_FOCUS_KEY = 'rc-detail-back';

/** Bouton de lecture principal des pages de détail — cible des redirections
 *  flèche bas depuis le bouton Retour. */
export const DETAIL_PLAY_FOCUS_KEY = 'rc-detail-play';

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  );
}

/**
 * Couche « télécommande » globale (montée dans le Shell, donc absente du
 * lecteur plein écran qui garde son propre Échap) :
 *  - Retour arrière / Échap → page précédente (ignoré dans un champ texte).
 *  - Flèches → empêche le scroll natif du navigateur (on gère le scroll
 *    nous-mêmes via scrollIntoView sur l'élément focus).
 *  - Pose le focus initial sur la navbar au montage.
 */
export function RemoteControl() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const editing = isEditable(document.activeElement);

      if ((e.key === 'Backspace' || e.key === 'Escape') && !editing) {
        e.preventDefault();
        navigate(-1);
        return;
      }
      // Évite le double défilement : norigin déplace le focus, on scrolle
      // l'élément focus dans la vue nous-mêmes.
      if (
        !editing &&
        (e.key === 'ArrowUp' ||
          e.key === 'ArrowDown' ||
          e.key === 'ArrowLeft' ||
          e.key === 'ArrowRight')
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  // Ré-ancre le focus sur la navbar à CHAQUE changement de route (et au
  // montage). Sans ça, après un « Entrée » sur une carte, l'élément focus se
  // démonte avec l'ancienne page et norigin pointe sur un nœud disparu → les
  // flèches ne répondent plus jusqu'à un rafraîchissement. La navbar est
  // persistante (montée dans le Shell) donc toujours une cible valide.
  useEffect(() => {
    const id = setTimeout(() => setFocus(FIRST_NAV_FOCUS_KEY), 120);
    return () => clearTimeout(id);
  }, [pathname]);

  return null;
}
