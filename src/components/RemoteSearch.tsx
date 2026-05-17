import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

/** Clé de focus stable de la barre de recherche (cible des redirections
 *  flèche haut depuis la grille/catégories et flèche bas depuis la navbar). */
export const SEARCH_FOCUS_KEY = 'rc-search';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Classes Browse.module.css passées par la page (pas d'import css cross-couche). */
  wrapperClassName: string;
  iconClassName: string;
  inputClassName: string;
}

/**
 * Champ de recherche navigable à la télécommande. norigin gère un focus
 * virtuel : « OK » (Entrée) donne le vrai focus DOM à l'input pour saisir ;
 * Échap / flèche fait sortir de la saisie pour reprendre la navigation 2D.
 */
export function RemoteSearch({
  value,
  onChange,
  placeholder,
  wrapperClassName,
  iconClassName,
  inputClassName,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { ref, focused } = useFocusable({
    focusKey: SEARCH_FOCUS_KEY,
    onEnterPress: () => inputRef.current?.focus(),
  });

  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [focused, ref]);

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // Sortir du mode saisie → la navigation flèches reprend (le focus virtuel
    // norigin est toujours sur le conteneur).
    if (e.key === 'Escape' || e.key === 'Enter' || e.key.startsWith('Arrow')) {
      inputRef.current?.blur();
    }
  };

  return (
    <div
      ref={ref}
      className={`${wrapperClassName} ${focused ? 'rc-focused' : ''}`}
      role="search"
      tabIndex={-1}
      onClick={() => inputRef.current?.focus()}
    >
      <span className={iconClassName}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="15" height="15">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input
        ref={inputRef}
        className={inputClassName}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onInputKeyDown}
      />
    </div>
  );
}
