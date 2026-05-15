import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { storageService } from '../services/storage.service';
import { MediaCard } from '../components/MediaCard';
import { CategoryBar } from '../components/CategoryBar';
import type { SeriesCategory, SeriesItem } from '../types/xtream.types';
import styles from './Browse.module.css';

const MIN_SEARCH_LEN = 3;
const RESULT_LIMIT = 80;

export function Series() {
  const { credentials } = useXtream();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<SeriesCategory[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => storageService.getFavorites());

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

  const handleFavorite = (id: string) => {
    storageService.toggleFavorite(id);
    setFavorites(storageService.getFavorites());
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Séries</h1>
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
            {loadingAll ? '⏳ Chargement…' : `${filtered.length}${filtered.length >= RESULT_LIMIT ? '+' : ''} résultat${filtered.length !== 1 ? 's' : ''}`}
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
          {filtered.map((s) => (
            <MediaCard
              key={s.series_id}
              title={s.name}
              image={s.cover}
              rating={s.rating_5based}
              genre={s.genre}
              variant="series"
              isFavorite={favorites.includes(String(s.series_id))}
              onClick={() => navigate(`/series/${s.series_id}`, { state: { series: s } })}
              onFavorite={() => handleFavorite(String(s.series_id))}
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
