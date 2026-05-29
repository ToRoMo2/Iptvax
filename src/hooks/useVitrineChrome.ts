import { useEffect, useState, type RefObject } from 'react';

/**
 * « Chrome » interactif partagé par toutes les pages vitrine :
 *  - curseur custom (point + anneau lissé, état « hot » sur les cibles)
 *  - boutons magnétiques (`.magnetic`)
 *
 * Portage de `initCursor()` + `initMagnetic()` du moteur vanilla. Actif
 * uniquement sur pointeur fin (souris) hors `prefers-reduced-motion`.
 * Retourne `cursorReady` à poser sur la racine `.vitrine` (active `cursor:none`
 * + la visibilité du curseur custom).
 */
export function useVitrineChrome(
  rootRef: RefObject<HTMLElement>,
  /** Clé de re-exécution (ex. pathname) : ré-attache le magnétisme aux boutons
   *  de la nouvelle page après une navigation SPA. */
  rerunKey?: unknown,
): boolean {
  const [cursorReady, setCursorReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduce) return;

    const dot = root.querySelector<HTMLElement>('.cursor-dot');
    const ring = root.querySelector<HTMLElement>('.cursor-ring');

    const cleanups: Array<() => void> = [];

    // ── Curseur custom ──────────────────────────────────────────────
    let raf = 0;
    if (dot && ring) {
      setCursorReady(true);
      let rx = window.innerWidth / 2;
      let ry = window.innerHeight / 2;
      let mx = rx;
      let my = ry;

      const onMove = (e: MouseEvent) => {
        mx = e.clientX;
        my = e.clientY;
        dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%, -50%)`;
      };
      const loop = () => {
        rx += (mx - rx) * 0.18;
        ry += (my - ry) * 0.18;
        ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
        raf = requestAnimationFrame(loop);
      };
      window.addEventListener('mousemove', onMove);
      raf = requestAnimationFrame(loop);

      const HOT = 'a, button, .magnetic, .bento-card, .plan, [data-hot]';
      const onOver = (e: Event) => {
        if ((e.target as Element).closest(HOT)) ring.classList.add('is-hot');
      };
      const onOut = (e: Event) => {
        if ((e.target as Element).closest(HOT)) ring.classList.remove('is-hot');
      };
      root.addEventListener('mouseover', onOver);
      root.addEventListener('mouseout', onOut);

      cleanups.push(() => {
        window.removeEventListener('mousemove', onMove);
        cancelAnimationFrame(raf);
        root.removeEventListener('mouseover', onOver);
        root.removeEventListener('mouseout', onOut);
      });
    }

    // ── Boutons magnétiques ─────────────────────────────────────────
    root.querySelectorAll<HTMLElement>('.magnetic').forEach((m) => {
      const el = (m.firstElementChild as HTMLElement) || m;
      const onMove = (e: MouseEvent) => {
        const r = m.getBoundingClientRect();
        const x = e.clientX - r.left - r.width / 2;
        const y = e.clientY - r.top - r.height / 2;
        m.style.transform = `translate(${x * 0.25}px, ${y * 0.35}px)`;
        el.style.transform = `translate(${x * 0.12}px, ${y * 0.18}px)`;
      };
      const onLeave = () => {
        m.style.transform = '';
        el.style.transform = '';
      };
      m.addEventListener('mousemove', onMove);
      m.addEventListener('mouseleave', onLeave);
      cleanups.push(() => {
        m.removeEventListener('mousemove', onMove);
        m.removeEventListener('mouseleave', onLeave);
      });
    });

    return () => cleanups.forEach((fn) => fn());
  }, [rootRef, rerunKey]);

  return cursorReady;
}
