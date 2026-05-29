import { useEffect, type RefObject } from 'react';

/**
 * Révèle les éléments `[data-reveal]` à l'intérieur de `rootRef` quand ils
 * entrent dans le viewport (IntersectionObserver → ajoute la classe `.in`).
 *
 * Portage du `initReveal()` du moteur vanilla du design. Dégrade sous
 * `prefers-reduced-motion` (tout révélé immédiatement). Filet : un passage
 * différé révèle tout ce qui est déjà au-dessus de la ligne de flottaison
 * (évite un contenu coincé invisible dans un onglet en arrière-plan).
 */
export function useScrollReveal(rootRef: RefObject<HTMLElement>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduce) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    );
    els.forEach((e) => io.observe(e));

    const t = window.setTimeout(() => {
      els.forEach((e) => {
        if (e.getBoundingClientRect().top < window.innerHeight * 0.92) {
          e.classList.add('in');
        }
      });
    }, 60);

    return () => {
      io.disconnect();
      window.clearTimeout(t);
    };
  }, [rootRef]);
}
