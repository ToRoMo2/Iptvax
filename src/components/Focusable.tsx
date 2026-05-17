import { useEffect, type ReactNode } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

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
    if (focused) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [focused, ref]);

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
