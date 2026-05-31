import { Children, useCallback, useEffect, useRef, type ReactNode } from 'react';
import styles from './PopularRail.module.css';

/**
 * Carrousel « Populaires » — rupture visuelle avec les rails de catégorie.
 *
 * Posters plus grands, centrés (scroll-snap center) : l'élément au centre est
 * mis en valeur à `scale(1)`, ses voisins rapetissent progressivement selon
 * leur distance au centre. En scrollant, le suivant grossit pendant que le
 * précédent rapetisse (effet « coverflow » léger).
 *
 * Le scaling est piloté en JS (rAF sur le scroll) plutôt qu'en CSS scroll-driven
 * (`animation-timeline`) pour rester robuste sur toutes les WebView natives.
 * Les métriques de position (offsetLeft/Width) sont mesurées une fois puis
 * mises en cache — seul `scrollLeft` est relu à chaque frame (zéro reflow).
 */
export function PopularRail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Centre (px) de chaque item, mesuré une fois, relu sans forcer de reflow.
  const centersRef = useRef<number[]>([]);

  const apply = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const viewCenter = el.scrollLeft + el.clientWidth / 2;
    const half = el.clientWidth / 2 || 1;
    const items = el.children;
    const centers = centersRef.current;
    for (let i = 0; i < items.length; i++) {
      const child = items[i] as HTMLElement;
      const c = centers[i];
      if (c == null) continue;
      const norm = Math.min(Math.abs(viewCenter - c) / half, 1); // 0 centre → 1 bord
      child.style.transform = `scale(${(1 - norm * 0.2).toFixed(3)})`;
      child.style.opacity = (1 - norm * 0.45).toFixed(3);
      child.style.zIndex = String(Math.round((1 - norm) * 10));
    }
  }, []);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.children;
    const centers: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const child = items[i] as HTMLElement;
      centers.push(child.offsetLeft + child.offsetWidth / 2);
    }
    centersRef.current = centers;
    apply();
  }, [apply]);

  const onScroll = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(apply);
  }, [apply]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [measure, onScroll]);

  // Re-mesure quand la liste d'items change (chargement asynchrone).
  useEffect(() => {
    measure();
  }, [children, measure]);

  return (
    <div ref={ref} className={styles.popRail}>
      {Children.map(children, (child, i) => (
        <div key={i} className={styles.popItem}>
          {child}
        </div>
      ))}
    </div>
  );
}
