import { useEffect, type RefObject } from 'react';

/**
 * « Chrome » interactif partagé par toutes les pages vitrine (design Umbra) :
 *  - glow doré qui suit la souris (`.cursor-glow`, lissé), gardé derrière la
 *    classe `cursor-on` posée sur la racine au premier mouvement
 *  - boutons magnétiques (`.magnetic`)
 *
 * Actif uniquement sur pointeur fin (souris) hors `prefers-reduced-motion`.
 * `rerunKey` (ex. pathname) ré-attache le magnétisme aux boutons de la nouvelle
 * page après une navigation SPA.
 */
export function useVitrineChrome(
  rootRef: RefObject<HTMLElement>,
  rerunKey?: unknown,
): void {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduce) return;

    const cleanups: Array<() => void> = [];

    // ── Glow doré qui suit la souris ────────────────────────────────
    const glow = root.querySelector<HTMLElement>('.cursor-glow');
    if (glow) {
      let raf = 0;
      let tx = 0;
      let ty = 0;
      let x = 0;
      let y = 0;
      const loop = () => {
        x += (tx - x) * 0.16;
        y += (ty - y) * 0.16;
        glow.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        raf = Math.abs(tx - x) > 0.4 || Math.abs(ty - y) > 0.4 ? requestAnimationFrame(loop) : 0;
      };
      const onMove = (e: MouseEvent) => {
        tx = e.clientX;
        ty = e.clientY;
        root.classList.add('cursor-on');
        if (!raf) raf = requestAnimationFrame(loop);
      };
      window.addEventListener('mousemove', onMove, { passive: true });
      cleanups.push(() => {
        window.removeEventListener('mousemove', onMove);
        cancelAnimationFrame(raf);
        root.classList.remove('cursor-on');
      });
    }

    // ── Boutons magnétiques ─────────────────────────────────────────
    root.querySelectorAll<HTMLElement>('.magnetic').forEach((m) => {
      const onMove = (e: MouseEvent) => {
        const r = m.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) * 0.22;
        const dy = (e.clientY - (r.top + r.height / 2)) * 0.3;
        m.style.transform = `translate(${dx}px, ${dy}px)`;
      };
      const onLeave = () => {
        m.style.transform = '';
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
}
