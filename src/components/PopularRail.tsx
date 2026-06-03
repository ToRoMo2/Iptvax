import { Children, useCallback, useEffect, useRef, type ReactNode } from 'react';
import styles from './PopularRail.module.css';

/**
 * Carrousel « Populaires » — rupture visuelle avec les rails de catégorie.
 *
 * Objectifs (réécriture from-scratch, cf. design de référence) :
 *  1. **Le défilement suit le doigt** : scroll natif horizontal + `scroll-snap`
 *     centré. Pas de stepper JS « un item par geste » — l'inertie et le drag
 *     tactile sont gérés nativement par le navigateur (ressenti fluide,
 *     momentum, rebond), ce qui colle au « scroll qui suit le doigt » demandé.
 *  2. **La carte centrale est mise en valeur** : un passage rAF sur l'event
 *     `scroll` calcule la distance de chaque carte au centre du viewport et pose
 *     `scale`/`opacity`/`z-index` en conséquence (effet « coverflow » : centre à
 *     `scale(1)`, voisines rétrécies). La carte la plus centrée reçoit la classe
 *     `popItemActive` → halo accent (DA Aurora). Les centres des items sont
 *     mesurés une fois et mis en cache → zéro reflow par frame.
 *  3. **Tap = navigation, même pendant le slide** : on ne neutralise JAMAIS le
 *     click d'un tap tactile. Le navigateur annule lui-même le click quand un
 *     drag tactile a vraiment fait défiler (donc pas d'ouverture accidentelle
 *     après un swipe), mais un simple appui — y compris pendant que le snap
 *     glisse encore — tombe sur la carte sous le doigt et ouvre sa fiche.
 *     Seul le **drag souris** (desktop) suppress le click, et uniquement s'il a
 *     réellement déplacé le rail au-delà d'un seuil.
 *
 * Le scaling est posé **sans transition CSS sur `transform`** (il colle au
 * scroll en temps réel) ; seul le halo de la carte active a une transition
 * douce. Dégrade proprement sous `prefers-reduced-motion`.
 */
export function PopularRail({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  // Centre (px, repère contenu) de chaque item — mesuré une fois, relu sans reflow.
  const centersRef = useRef<number[]>([]);
  // Pas inter-items (pop-w + gap) — référence de l'atténuation du scaling.
  const pitchRef = useRef<number>(1);
  // Drag souris (desktop uniquement ; le tactile passe par le scroll natif).
  const dragRef = useRef<{ startX: number; startLeft: number; moved: boolean } | null>(null);
  // Ignore le click de fin de drag SOURIS (sinon la carte sous le curseur s'ouvre).
  const suppressClickRef = useRef(false);

  // ── Passe de scaling « coverflow » (rAF sur le scroll) ─────────────────────
  const apply = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const centers = centersRef.current;
    if (centers.length === 0) return;
    const viewCenter = el.scrollLeft + el.clientWidth / 2;
    const pitch = pitchRef.current || 1;
    const items = el.children;
    let nearest = 0;
    let best = Infinity;
    for (let i = 0; i < items.length; i++) {
      const child = items[i] as HTMLElement;
      const c = centers[i];
      if (c == null) continue;
      const dist = Math.abs(viewCenter - c);
      // Atténuation rapportée au pas inter-items → rendu cohérent quelle que
      // soit la largeur d'écran (la voisine immédiate est ~1 pas du centre).
      const norm = Math.min(dist / pitch, 1.5);
      child.style.transform = `scale(${(1 - norm * 0.2).toFixed(3)})`;
      child.style.opacity = (1 - norm * 0.42).toFixed(3);
      child.style.zIndex = String(Math.round((1.5 - norm) * 10));
      if (dist < best) {
        best = dist;
        nearest = i;
      }
    }
    for (let i = 0; i < items.length; i++) {
      (items[i] as HTMLElement).classList.toggle(styles.popItemActive, i === nearest);
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
    pitchRef.current = centers.length > 1 ? Math.abs(centers[1] - centers[0]) : el.clientWidth || 1;
    apply();
  }, [apply]);

  const onScroll = useCallback(() => {
    if (rafRef.current != null) return; // déjà programmé pour la prochaine frame
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      apply();
    });
  }, [apply]);

  // ── Drag-to-scroll SOURIS (desktop) ────────────────────────────────────────
  // Le tactile/stylet est volontairement ignoré ici : le scroll natif gère le
  // doigt (momentum + snap). On n'engage le drag manuel que pour la souris, qui
  // ne peut pas faire défiler un conteneur overflow autrement.
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const el = ref.current;
    if (!el) return;
    suppressClickRef.current = false;
    dragRef.current = { startX: e.clientX, startLeft: el.scrollLeft, moved: false };
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    const el = ref.current;
    if (!d || !el) return;
    const dx = e.clientX - d.startX;
    if (!d.moved) {
      if (Math.abs(dx) < 6) return;
      d.moved = true;
      el.classList.add(styles.dragging); // coupe le snap pendant le drag
      el.setPointerCapture?.(e.pointerId);
    }
    el.scrollLeft = d.startLeft - dx;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    const el = ref.current;
    dragRef.current = null;
    if (!d || !el) return;
    if (d.moved) {
      suppressClickRef.current = true; // neutralise le click de fin de drag souris
      el.classList.remove(styles.dragging); // ré-active le snap → recentre sur la + proche
      el.releasePointerCapture?.(e.pointerId);
    }
  }, []);

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

  // Re-mesure quand la liste d'items change (chargement asynchrone TMDB).
  useEffect(() => {
    measure();
  }, [children, measure]);

  return (
    <div
      ref={ref}
      className={styles.popRail}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClickCapture={onClickCapture}
    >
      {Children.map(children, (child, i) => (
        <div key={i} className={styles.popItem}>
          <span className={styles.popGlow} aria-hidden="true" />
          {child}
        </div>
      ))}
    </div>
  );
}
