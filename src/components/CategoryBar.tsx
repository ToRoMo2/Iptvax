import { useRef, useState, useEffect, useCallback } from 'react';
import { useFocusable, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { SEARCH_FOCUS_KEY } from './RemoteSearch';
import styles from './CategoryBar.module.css';

interface Category {
  id: string;
  name: string;
}

function Pill({
  cat,
  active,
  onSelect,
}: {
  cat: Category;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { ref, focused } = useFocusable({
    onEnterPress: () => onSelect(cat.id),
    // Flèche haut depuis les catégories → barre de recherche (au-dessus,
    // mais décalée à droite : la géométrie seule ne l'atteint pas).
    onArrowPress: (direction: string) => {
      if (direction === 'up') {
        setFocus(SEARCH_FOCUS_KEY);
        return false;
      }
      return true;
    },
  });
  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  }, [focused, ref]);
  return (
    <button
      ref={ref}
      data-catid={cat.id}
      className={`${styles.pill} ${active ? styles.pillActive : ''} ${focused ? styles.pillFocused : ''}`}
      onClick={() => onSelect(cat.id)}
      tabIndex={-1}
    >
      {cat.name}
    </button>
  );
}

interface Props {
  categories: Category[];
  selected: string | null;
  onSelect: (id: string) => void;
}

export function CategoryBar({ categories, selected, onSelect }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft]   = useState(false);
  const [canRight, setCanRight] = useState(false);

  // Recalculate arrow visibility
  const refresh = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
  }, []);

  // On mount + on categories change
  useEffect(() => {
    refresh();
  }, [categories, refresh]);

  // Scroll the active pill into view whenever selection changes
  useEffect(() => {
    const el = railRef.current;
    if (!el || !selected) return;
    const btn = el.querySelector<HTMLButtonElement>(`[data-catid="${selected}"]`);
    if (!btn) return;
    const btnLeft  = btn.offsetLeft;
    const btnRight = btnLeft + btn.offsetWidth;
    const barLeft  = el.scrollLeft;
    const barRight = barLeft + el.clientWidth;

    if (btnLeft < barLeft + 40) {
      el.scrollTo({ left: btnLeft - 40, behavior: 'smooth' });
    } else if (btnRight > barRight - 40) {
      el.scrollTo({ left: btnRight - el.clientWidth + 40, behavior: 'smooth' });
    }
  }, [selected]);

  const scroll = (dir: 'left' | 'right') => {
    railRef.current?.scrollBy({ left: dir === 'right' ? 320 : -320, behavior: 'smooth' });
  };

  if (categories.length === 0) return null;

  return (
    <div className={styles.outer}>
      {/* Left arrow */}
      <button
        className={`${styles.arrow} ${styles.arrowLeft} ${!canLeft ? styles.arrowHidden : ''}`}
        onClick={() => scroll('left')}
        aria-label="Défiler à gauche"
        tabIndex={canLeft ? 0 : -1}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
          <path d="m15 18-6-6 6-6"/>
        </svg>
      </button>

      {/* Scrollable rail */}
      <div
        ref={railRef}
        className={styles.rail}
        onScroll={refresh}
      >
        {categories.map((cat) => (
          <Pill
            key={cat.id}
            cat={cat}
            active={selected === cat.id}
            onSelect={onSelect}
          />
        ))}
      </div>

      {/* Right arrow */}
      <button
        className={`${styles.arrow} ${styles.arrowRight} ${!canRight ? styles.arrowHidden : ''}`}
        onClick={() => scroll('right')}
        aria-label="Défiler à droite"
        tabIndex={canRight ? 0 : -1}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </button>
    </div>
  );
}
