import { useEffect, useRef, useState } from 'react';

/**
 * Fenêtre de rendu progressive pour les très grandes listes (catalogues Xtream
 * de plusieurs milliers d'items). Rend `initial` items immédiatement (premier
 * paint rapide) puis étend la fenêtre par paquets de `chunk` pendant les temps
 * d'inactivité (`requestIdleCallback`) jusqu'à couvrir toute la liste.
 *
 * Pourquoi pas une virtualisation classique : la navigation télécommande
 * (norigin) mesure les cellules par `getBoundingClientRect` et casse si les
 * cellules focusables sont démontées/remontées au scroll. Ici le DOM ne fait
 * que CROÎTRE (jamais de démontage) → spatial-nav intact. Couplé à
 * `content-visibility:auto` côté CSS, les cellules hors écran ne coûtent ni
 * layout ni paint → l'expansion de fin de liste reste quasi gratuite.
 *
 * La fenêtre se réinitialise quand l'identité de `items` change (changement de
 * catégorie ou de recherche) → on ne garde jamais un offset périmé.
 */
export function useProgressiveList<T>(
  items: T[],
  initial = 60,
  chunk = 60,
): T[] {
  const [count, setCount] = useState(initial);
  const itemsRef = useRef(items);

  // Reset synchrone si la liste source change. On replanifie le state ET on
  // utilise `initial` pour CE rendu (sinon on monterait brièvement l'ancien
  // offset — potentiellement des centaines de cartes — sur la nouvelle liste).
  const reset = itemsRef.current !== items;
  if (reset) {
    itemsRef.current = items;
    if (count !== initial) setCount(initial);
  }
  const effective = reset ? initial : count;

  useEffect(() => {
    if (count >= items.length) return;

    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const grow = () => setCount((c) => Math.min(c + chunk, items.length));

    if (w.requestIdleCallback) {
      idleId = w.requestIdleCallback(grow, { timeout: 400 });
    } else {
      timerId = setTimeout(grow, 200);
    }

    return () => {
      if (idleId && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      if (timerId) clearTimeout(timerId);
    };
  }, [count, items.length, chunk]);

  return effective >= items.length ? items : items.slice(0, effective);
}
