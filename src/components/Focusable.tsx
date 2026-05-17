import { useEffect, type ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

/** Remonte au premier ancêtre réellement scrollable verticalement.
 *  Repli sur `.main-content` (le conteneur de scroll global du Shell). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  let node = el?.parentElement ?? null;
  while (node) {
    const oy = getComputedStyle(node).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return document.querySelector<HTMLElement>('.main-content');
}

interface Props {
  children: ReactNode;
  /** Action « OK » de la télécommande (touche Entrée). */
  onEnter?: () => void;
  /** Clic souris — gardé pour la parité souris/télécommande. */
  onClick?: () => void;
  /** Appelé quand l'élément prend le focus télécommande. */
  onFocused?: () => void;
  /** Appelé quand l'élément perd le focus télécommande. */
  onBlurred?: () => void;
  /** Interception d'une flèche : retourner `false` annule le déplacement par
   *  défaut (utilisé pour rediriger vers une cible précise). */
  onArrow?: (direction: string) => boolean;
  /**
   * Comportement de scroll quand l'élément prend le focus télécommande :
   *  - `'nearest'` (défaut) : `scrollIntoView` minimal — l'élément devient
   *    juste visible.
   *  - `'top'` / `'bottom'` : fait défiler le conteneur scrollable jusqu'en
   *    haut / en bas. Indispensable pour un grand hero en tête de page :
   *    `'nearest'` le laisse rasant le bord, on veut le voir EN ENTIER.
   */
  scrollHint?: 'nearest' | 'top' | 'bottom';
  className?: string;
  /** Classe ajoutée tant que l'élément est focus (halo de sélection TV). */
  focusedClassName?: string;
  focusKey?: string;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}

/**
 * Enrobe n'importe quel élément cliquable pour le rendre navigable à la
 * télécommande (flèches + Entrée) via norigin-spatial-navigation. Gère le
 * halo de focus et le scroll automatique de l'élément focus dans la vue
 * (indispensable sur TV : l'élément sélectionné doit toujours être visible).
 *
 * Couche `components/` : importe une lib npm + types/hooks uniquement.
 */
export function Focusable({
  children,
  onEnter,
  onClick,
  onFocused,
  onBlurred,
  onArrow,
  scrollHint = 'nearest',
  className,
  focusedClassName = 'rc-focused',
  focusKey,
  disabled,
  title,
  ariaLabel,
}: Props) {
  const { ref, focused } = useFocusable({
    focusable: !disabled,
    focusKey,
    onEnterPress: () => onEnter?.(),
    onFocus: () => onFocused?.(),
    onBlur: () => onBlurred?.(),
    onArrowPress: (direction: string) => (onArrow ? onArrow(direction) : true),
  });

  useEffect(() => {
    if (!focused) return;
    const el = ref.current;
    if (!el) return;
    if (scrollHint === 'top' || scrollHint === 'bottom') {
      // Hero / pied de page : on veut le bloc EN ENTIER, pas juste rasant
      // le bord → on défile le conteneur jusqu'à l'extrémité.
      const sc = scrollParent(el);
      sc?.scrollTo({
        top: scrollHint === 'top' ? 0 : sc.scrollHeight,
        behavior: 'smooth',
      });
    } else {
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [focused, ref, scrollHint]);

  return (
    <div
      ref={ref}
      className={`${className ?? ''} ${focused ? focusedClassName : ''}`.trim()}
      onClick={onClick}
      role="button"
      tabIndex={-1}
      aria-label={ariaLabel}
      title={title}
    >
      {children}
    </div>
  );
}
