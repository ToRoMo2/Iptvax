import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Charge paresseusement une affiche (TMDB) pour une carte du catalogue.
 *
 * Stratégie (choix produit) : la carte affiche IMMÉDIATEMENT son visuel IPTV ;
 * dès qu'elle entre dans le viewport, `resolve` est appelé UNE fois et, s'il
 * renvoie une URL, l'affiche IPTV est remplacée. Aucun trou visuel, aucune
 * régression si TMDB est coupé (resolve → null). Le service TMDB met les
 * résultats en cache (session) → les re-montées sont gratuites.
 *
 * `resolve` peut changer d'identité à chaque rendu parent (closure inline) :
 * on le lit via une ref pour ne déclencher l'IntersectionObserver qu'une seule
 * fois par montage.
 */
export function useLazyPoster(
  resolve: (() => Promise<string | null>) | undefined,
  observeRef: RefObject<HTMLElement | null>,
): string | undefined {
  const [url, setUrl] = useState<string>();
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  useEffect(() => {
    const el = observeRef.current;
    if (!el || !resolveRef.current) return;
    let done = false;
    const io = new IntersectionObserver(
      (entries) => {
        if (done || !entries.some((e) => e.isIntersecting)) return;
        done = true;
        io.disconnect();
        resolveRef.current?.()
          .then((u) => { if (u) setUrl(u); })
          .catch(() => {});
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [observeRef]);

  return url;
}
