import { useEffect, useState } from 'react';

/**
 * Suit l'état d'une media query CSS et déclenche un re-render au franchissement.
 * Évite les hydration mismatches en initialisant à `false` côté SSR — l'effet
 * synchronise immédiatement au montage côté client.
 *
 * Usage typique : `const isMobile = useMediaQuery('(max-width: 640px)');`
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
