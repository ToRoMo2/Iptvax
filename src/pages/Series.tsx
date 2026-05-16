import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useLibrary } from '../contexts/LibraryContext';
import { MediaCard } from '../components/MediaCard';
import { CategoryBar } from '../components/CategoryBar';
import type { SeriesCategory, SeriesItem } from '../types/xtream.types';
import { groupByTitle } from '../utils/catalog';
import styles from './Browse.module.css';

const MIN_SEARCH_LEN = 3;
const RESULT_LIMIT = 80;

export function Series() {
  const { credentials } = useXtream();
  const { isFavorite, toggleFavorite } = useLibrary();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<SeriesCategory[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global search — préchargé au montage pour une recherche instantanée
  const [allSeries, setAllSeries] = useState<SeriesItem[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const allLoadedRef = useRef(false);


  useEffect(() => {
    if (!credentials) return;
    setLoadingCats(true);
    xtreamService
      .getSeriesCategories(credentials)
      .then((cats) => {
        setCategories(cats);
        if (cats.length > 0) setSelectedCat(cats[0].category_id);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingCats(false));
  }, [credentials]);

  useEffect(() => {
    if (!credentials || !selectedCat) return;
    setLoadingItems(true);
    setSeries([]);
    xtreamService
      .getSeries(credentials, selectedCat)
      .then(setSeries)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingItems(false));
  }, [credentials, selectedCat]);

  useEffect(() => {
    if (!credentials || allLoadedRef.current) return;
    allLoadedRef.current = true;
    setLoadingAll(true);
    xtreamService
      .getSeries(credentials)
      .then((all) => { setAllSeries(all); })
      .catch(() => { allLoadedRef.current = false; })
      .finally(() => setLoadingAll(false));
  }, [credentials]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const isGlobalSearch = query.length >= MIN_SEARCH_LEN;

  const filtered = useMemo(() => {
    if (!isGlobalSearch) return series;
    if (!allSeries) return [];
    const q = query.toLowerCase();
    const out: SeriesItem[] = [];
    for (const s of allSeries) {
      if (s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return out;
  }, [series, allSeries, query, isGlobalSearch]);

  // Fusion des doublons (langues / qualités) — voir Movies.tsx.
  const groups = useMemo(
    () => groupByTitle(filtered, (s) => s.name, (s) => s.rating_5based ?? 0),
    [filtered],
  );

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Séries</h1>
          <p className={styles.pageSub}>
            {isGlobalSearch
              ? 'Recherche globale'
              : `${groups.length} série${groups.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="15" height="15"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          </span>
          <input
            className={styles.search}
            type="search"
            placeholder="Rechercher dans toutes les séries…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {search.trim().length > 0 && search.trim().length < MIN_SEARCH_LEN && (
          <span className={styles.searchBadge}>Tapez au moins {MIN_SEARCH_LEN} caractères…</span>
        )}
        {isGlobalSearch && (
          <span className={styles.searchBadge}>
            {loadingAll ? '⏳ Chargement…' : `${groups.length}${filtered.length >= RESULT_LIMIT ? '+' : ''} résultat${groups.length !== 1 ? 's' : ''}`}
          </span>
        )}
      </header>

      {error && <div className={styles.error}>⚠ {error}</div>}

      {!isGlobalSearch && (
        loadingCats ? (
          <div className={styles.catSkeleton} />
        ) : (
          <CategoryBar
            categories={categories.map((c) => ({ id: c.category_id, name: c.category_name }))}
            selected={selectedCat}
            onSelect={(id) => setSelectedCat(id)}
          />
        )
      )}

      {(loadingItems && !isGlobalSearch) || (isGlobalSearch && !allSeries) ? (
        <div className={styles.gridLoading}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className={`${styles.skeleton} ${styles.skeletonPoster}`} />
          ))}
        </div>
      ) : (
        <div className={`${styles.grid} ${styles.gridPoster}`}>
          {groups.map((g) => (
            <MediaCard
              key={g.primary.series_id}
              title={g.title}
              image={g.primary.cover}
              rating={g.primary.rating_5based}
              genre={g.primary.genre}
              variant="series"
              isFavorite={isFavorite('series', String(g.primary.series_id))}
              onClick={() => navigate(`/series/${g.primary.series_id}`, { state: { series: g.primary, variants: g.variants } })}
              onFavorite={() =>
                toggleFavorite({
                  type: 'series',
                  id: String(g.primary.series_id),
                  name: g.title,
                  image: g.primary.cover ?? '',
                })
              }
            />
          ))}
        </div>
      )}

      {!loadingItems && !loadingAll && filtered.length === 0 && !error && (
        <p className={styles.empty}>Aucune série trouvée.</p>
      )}
    </div>
  );
}
