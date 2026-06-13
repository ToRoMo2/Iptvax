import { useState, useEffect, useMemo, useRef } from 'react';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useI18n } from '../contexts/I18nContext';
import { groupByTitle, type TitleGroup } from '../utils/catalog';
import type { LiveStream, VodStream, SeriesItem } from '../types/xtream.types';

/** Longueur minimale de requête avant de filtrer (anti-jank). */
export const SEARCH_MIN_LEN = 3;
// Plafond PAR section (chaînes / films / séries) — borne le nombre de cartes
// montées à chaque frappe (anti-jank, voir docs/architecture.md §4).
const RESULT_LIMIT = 60;

export interface CatalogSearch {
  search: string;
  setSearch: (v: string) => void;
  query: string;
  isSearching: boolean;
  loading: boolean;
  error: string | null;
  liveResults: LiveStream[];
  movieGroups: TitleGroup<VodStream>[];
  seriesGroups: TitleGroup<SeriesItem>[];
  totalResults: number;
  /** Films suggérés (état au repos, avant toute frappe) — catalogue le plus
   *  récent, dédupliqué. Vide tant que le catalogue films n'est pas chargé. */
  suggestions: TitleGroup<VodStream>[];
  /** `true` une fois le catalogue films chargé (pour distinguer « vide » de
   *  « en cours de chargement » sur l'état au repos). */
  suggestionsReady: boolean;
}

// Groupage du catalogue films complet mis en cache par identité du tableau
// (réf. stable du cache service) → réouvrir la recherche ne regroupe pas à neuf.
const suggestionsCache = new WeakMap<VodStream[], TitleGroup<VodStream>[]>();

/**
 * Logique de recherche globale en mémoire — source de vérité partagée entre la
 * page `/search` (`Search.tsx`) et l'overlay de recherche superposé
 * (`SearchOverlay.tsx`). Précharge les 3 catalogues UNE fois (cache service →
 * instantané si déjà chaud via Home), puis filtre côté client à chaque frappe.
 * Films / séries fusionnés par titre (doublons langues/qualités) via
 * `groupByTitle`, comme les pages Films/Séries.
 */
export function useCatalogSearch(): CatalogSearch {
  const { credentials } = useXtream();
  const { t } = useI18n();

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Datasets globaux préchargés UNE fois au montage — la recherche filtre
  // ensuite en mémoire (pas de fetch par frappe, pas de résultats partiels).
  const [allLive, setAllLive] = useState<LiveStream[] | null>(null);
  const [allMovies, setAllMovies] = useState<VodStream[] | null>(null);
  const [allSeries, setAllSeries] = useState<SeriesItem[] | null>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    if (!credentials || loadedRef.current) return;
    loadedRef.current = true;

    let alive = true;

    // Filet de sécurité : si l'un des 3 catalogues stalle (réseau mobile
    // silencieusement coupé), Promise.allSettled n'arrive jamais → loading
    // reste true indéfiniment. Après 30 s on force les tableaux encore null
    // à [] pour débloquer l'UI avec les résultats partiels disponibles.
    const safetyTimer = setTimeout(() => {
      if (!alive) return;
      setAllLive((prev) => prev ?? []);
      setAllMovies((prev) => prev ?? []);
      setAllSeries((prev) => prev ?? []);
    }, 30_000);

    Promise.allSettled([
      xtreamService.getLiveStreams(credentials),
      xtreamService.getVodStreams(credentials),
      xtreamService.getSeries(credentials),
    ]).then(([live, movies, series]) => {
      if (!alive) return;
      clearTimeout(safetyTimer);
      setAllLive(live.status === 'fulfilled' ? live.value : []);
      setAllMovies(movies.status === 'fulfilled' ? movies.value : []);
      setAllSeries(series.status === 'fulfilled' ? series.value : []);
      if (
        live.status === 'rejected' &&
        movies.status === 'rejected' &&
        series.status === 'rejected'
      ) {
        loadedRef.current = false;
        setError(t('search.catalogError'));
      }
    });

    return () => {
      alive = false;
      clearTimeout(safetyTimer);
      // Permet au prochain montage (ou au re-run sur changement de credentials)
      // de relancer les fetches si les creds ont changé.
      loadedRef.current = false;
    };
  }, [credentials, t]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const isSearching = query.length >= SEARCH_MIN_LEN;
  const loading = !allLive || !allMovies || !allSeries;

  const liveResults = useMemo(() => {
    if (!isSearching || !allLive) return [];
    const q = query.toLowerCase();
    const out: LiveStream[] = [];
    for (const s of allLive) {
      if (s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return out;
  }, [allLive, query, isSearching]);

  // Films / séries : fusion des doublons (langues / qualités) en une carte,
  // identique aux pages Films/Séries (utils/catalog.groupByTitle).
  const movieGroups = useMemo(() => {
    if (!isSearching || !allMovies) return [];
    const q = query.toLowerCase();
    const out: VodStream[] = [];
    for (const s of allMovies) {
      if (s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return groupByTitle(out, (v) => v.name, (v) => v.rating_5based ?? 0);
  }, [allMovies, query, isSearching]);

  const seriesGroups = useMemo(() => {
    if (!isSearching || !allSeries) return [];
    const q = query.toLowerCase();
    const out: SeriesItem[] = [];
    for (const s of allSeries) {
      if (s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return groupByTitle(out, (s) => s.name, (s) => s.rating_5based ?? 0);
  }, [allSeries, query, isSearching]);

  const totalResults =
    liveResults.length + movieGroups.length + seriesGroups.length;

  // Suggestions au repos : tout le catalogue films, dédupliqué, trié du plus
  // récent au plus ancien (à défaut de « tendances » fiables côté Xtream) →
  // une grille de cartes paysage accueillante avant la première frappe.
  const suggestions = useMemo(() => {
    if (!allMovies) return [];
    let groups = suggestionsCache.get(allMovies);
    if (!groups) {
      groups = groupByTitle(allMovies, (v) => v.name, (v) => v.rating_5based ?? 0).sort(
        (a, b) =>
          (Number(b.year) || 0) - (Number(a.year) || 0) ||
          (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0),
      );
      suggestionsCache.set(allMovies, groups);
    }
    return groups.slice(0, 24);
  }, [allMovies]);

  return {
    search,
    setSearch,
    query,
    isSearching,
    loading,
    error,
    liveResults,
    movieGroups,
    seriesGroups,
    totalResults,
    suggestions,
    suggestionsReady: allMovies != null,
  };
}
