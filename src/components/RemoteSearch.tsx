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
  /** Classe du bouton « effacer » (optionnelle — affiché seulement si fournie). */
  clearClassName?: string;
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
  clearClassName,
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
    // e.preventDefault() sur Enter : sans ça, l'action IME "Go"/"Search" de la
    // WebView Android traite type="search" comme une soumission de formulaire et
    // navigue vers "/" (accueil), même sans <form> dans le DOM.
    if (e.key === 'Escape' || e.key === 'Enter' || e.key.startsWith('Arrow')) {
      e.preventDefault();
      inputRef.current?.blur();
    }
  };

  return (
    // form + onSubmit preventDefault : filet DOM contre l'action IME "Go"/"Search"
    // d'Android WebView qui, même sans action= explicite, soumet vers "/" et
    // déclenche un retour à l'accueil via React Router (e.preventDefault() sur
    // keydown seul ne suffit pas — l'action IME native peut contourner les events JS).
    <form
      ref={ref}
      className={`${wrapperClassName} ${focused ? 'rc-focused' : ''}`}
      role="search"
      tabIndex={-1}
      onClick={() => inputRef.current?.focus()}
      onSubmit={(e) => e.preventDefault()}
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
        type="text"
        inputMode="search"
        enterKeyHint="search"
        placeholder={`${placeholder} · fix2`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onInputKeyDown}
      />
      {clearClassName && value.length > 0 && (
        <button
          type="button"
          className={clearClassName}
          aria-label="Effacer la recherche"
          onClick={(e) => {
            e.stopPropagation();
            onChange('');
            inputRef.current?.focus();
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </form>
  );
}
