import { Children, useCallback, useEffect, useRef, type ReactNode } from 'react';
import styles from './PopularRail.module.css';

/**
 * Carrousel « Populaires » — rupture visuelle avec les rails de catégorie.
 *
 * Posters plus grands, centrés : l'élément au centre est mis en valeur à
 * `scale(1)`, ses voisins rapetissent progressivement selon leur distance au
 * centre. En scrollant, le suivant grossit pendant que le précédent rapetisse
 * (effet « coverflow » léger).
 *
 * ⚠ Défilement **piloté, un item par geste** : le scroll natif (avec
 * `scroll-snap`) laissait le momentum d'un flick survoler plusieurs posters.
 * Ici la liste n'est PAS scrollable nativement (`overflow-x: hidden` +
 * `touch-action: pan-y` pour laisser passer le scroll vertical de page) — chaque
 * swipe / molette horizontale avance d'**exactement un** item via `scrollTo`,
 * quelle que soit la force. Le scaling reste piloté en JS (rAF sur l'event
 * `scroll` émis par le `scrollTo` animé) ; les centres des items sont mesurés
 * une fois puis mis en cache (zéro reflow par frame).
 */
export function PopularRail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Centre (px) de chaque item, mesuré une fois, relu sans forcer de reflow.
  const centersRef = useRef<number[]>([]);
  // Verrou anti-rafale : une « bouffée » de molette = un seul pas.
  const wheelLockRef = useRef(false);
  // Suivi du geste tactile/souris en cours.
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  // Ignore le click de fin de swipe (sinon la carte sous le doigt s'ouvre).
  const suppressClickRef = useRef(false);

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

  /** Recentre la vue sur l'item d'index `i` (clampé), instantané. */
  const goTo = useCallback((i: number) => {
    const el = ref.current;
    const centers = centersRef.current;
    if (!el || centers.length === 0) return;
    const clamped = Math.max(0, Math.min(i, centers.length - 1));
    const target = centers[clamped] - el.clientWidth / 2;
    const max = el.scrollWidth - el.clientWidth;
    // Instant scroll — CSS transitions on .popItem animate scale/opacity smoothly.
    // Smooth scroll caused a timing window where a tap during the animation fired
    // on the container gap instead of the card, swallowing the first tap.
    el.scrollTo({
      left: Math.max(0, Math.min(target, max)),
      behavior: 'auto',
    });
  }, []);

  /** Avance d'un item (`dir` = +1 / -1) depuis l'item actuellement le plus centré. */
  const step = useCallback((dir: number) => {
    const el = ref.current;
    const centers = centersRef.current;
    if (!el || centers.length === 0) return;
    const viewCenter = el.scrollLeft + el.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < centers.length; i++) {
      const d = Math.abs(centers[i] - viewCenter);
      if (d < best) { best = d; nearest = i; }
    }
    goTo(nearest + dir);
  }, [goTo]);

  // Molette / trackpad : on n'agit que sur un geste à dominante horizontale
  // (laisse le scroll vertical de la page passer). Listener non-passif pour
  // pouvoir `preventDefault`.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (wheelLockRef.current) return;
      wheelLockRef.current = true;
      step(e.deltaX > 0 ? 1 : -1);
      window.setTimeout(() => { wheelLockRef.current = false; }, 360);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [step]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    // Reset any stale suppress flag from a previous swipe that ended outside
    // the container (in that case no click fires to reset it, so the next tap
    // would be swallowed).
    suppressClickRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.x) > 8 && Math.abs(e.clientX - d.x) > Math.abs(e.clientY - d.y)) {
      d.moved = true;
    }
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d || !d.moved) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) < 30) return; // simple effleurement → on ne bouge pas
    suppressClickRef.current = true; // neutralise le click de fin de swipe
    step(dx < 0 ? 1 : -1); // swipe vers la gauche → item suivant
  }, [step]);

  // Empêche l'ouverture de la carte quand le pointerup termine un swipe.
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!suppressClickRef.current) return;
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  }, []);

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
    <div
      ref={ref}
      className={styles.popRail}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { dragRef.current = null; }}
      onClickCapture={onClickCapture}
    >
      {Children.map(children, (child, i) => (
        <div key={i} className={styles.popItem}>
          {child}
        </div>
      ))}
    </div>
  );
}
