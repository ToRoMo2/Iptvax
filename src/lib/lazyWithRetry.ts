import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

/**
 * Variante robuste de `React.lazy` pour les routes en code-splitting.
 *
 * Problème corrigé : `React.lazy(() => import(...))` appelle le factory UNE
 * seule fois et **met en cache la promesse rejetée**. Si le fetch du chunk
 * échoue (réseau mobile flaky, chunk évincé, déploiement ayant changé les noms
 * hachés), la route relance éternellement la même erreur à chaque rendu — le
 * tap sur l'onglet ne navigue plus tant que l'app n'est pas relancée. Sur la
 * bottom nav mobile, cela se manifestait sur « Ma liste » et « Mon ciné », les
 * deux seuls onglets chargés en lazy.
 *
 * Stratégie :
 *  1. Réessayer l'`import()` quelques fois avec un backoff court — absorbe les
 *     échecs réseau transitoires sans casser la navigation.
 *  2. En dernier recours, si le chunk est introuvable après un déploiement
 *     (nouveaux noms hachés), recharger la page une seule fois (garde-fou
 *     sessionStorage anti-boucle) pour repartir sur le manifeste à jour.
 *
 * IMPORTANT : le factory passé ici DOIT être réinvocable (une simple flèche
 * `() => import('...')`), pas une promesse déjà créée — sinon le retry réimporte
 * la même promesse rejetée.
 */
// `ComponentType<any>` (et non `unknown`) pour préserver le type exact des props
// du composant chargé — même signature que `React.lazy` lui-même.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
  chunkName: string,
  retries = 3,
  intervalMs = 350,
): LazyExoticComponent<T> {
  return lazy(() => retryImport(factory, chunkName, retries, intervalMs));
}

async function retryImport<T>(
  factory: () => Promise<T>,
  chunkName: string,
  retries: number,
  intervalMs: number,
): Promise<T> {
  const reloadKey = `iptv.chunkReload.${chunkName}`;
  try {
    return await factory();
  } catch (err) {
    if (retries > 0) {
      await new Promise((r) => setTimeout(r, intervalMs));
      // Backoff progressif : 350ms, 700ms, 1050ms…
      return retryImport(factory, chunkName, retries - 1, intervalMs + 350);
    }

    // Tous les retries ont échoué. Si on n'a pas déjà rechargé pour ce chunk,
    // tenter un reload unique (chunk périmé après déploiement). Le garde-fou
    // sessionStorage évite une boucle de rechargement si le chunk est vraiment
    // inaccessible (hors ligne) — dans ce cas l'erreur remonte à l'ErrorBoundary.
    try {
      if (
        typeof window !== 'undefined' &&
        !sessionStorage.getItem(reloadKey)
      ) {
        sessionStorage.setItem(reloadKey, '1');
        window.location.reload();
        // reload() est asynchrone : on rend une promesse jamais résolue pour
        // figer le rendu jusqu'au rechargement effectif.
        return new Promise<T>(() => {});
      }
    } catch {
      /* sessionStorage indisponible → on laisse l'erreur remonter */
    }

    throw err;
  }
}

/**
 * À appeler après un chargement de route réussi : purge les marqueurs de reload
 * pour qu'un futur échec (nouveau déploiement) puisse de nouveau déclencher un
 * rechargement unique.
 */
export function clearChunkReloadFlags() {
  try {
    if (typeof window === 'undefined') return;
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith('iptv.chunkReload.')) sessionStorage.removeItem(k);
    }
  } catch {
    /* no-op */
  }
}
