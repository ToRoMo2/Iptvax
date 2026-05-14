import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { storageService } from '../services/storage.service';
import { MediaCard } from '../components/MediaCard';
import { CategoryBar } from '../components/CategoryBar';
import type { LiveCategory, LiveStream } from '../types/xtream.types';
import type { PlayerState } from '../types/xtream.types';
import styles from './Browse.module.css';

export function Live() {
  const { credentials } = useXtream();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<LiveCategory[]>([]);
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => storageService.getFavorites());

  // Global search — chargé paresseusement à la première recherche
  const [allStreams, setAllStreams] = useState<LiveStream[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const allLoadedRef = useRef(false);


  useEffect(() => {
    if (!credentials) return;
    setLoadingCats(true);
    xtreamService
      .getLiveCategories(credentials)
      .then((cats) => {
        setCategories(cats);
        if (cats.length > 0) setSelectedCat(cats[0].category_id);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingCats(false));
  }, [credentials]);

  useEffect(() => {
    if (!credentials || !selectedCat) return;
    setLoadingStreams(true);
    setStreams([]);
    xtreamService
      .getLiveStreams(credentials, selectedCat)
      .then(setStreams)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingStreams(false));
  }, [credentials, selectedCat]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (val && !allLoadedRef.current && !loadingAll && credentials) {
      allLoadedRef.current = true;
      setLoadingAll(true);
      xtreamService
        .getLiveStreams(credentials)
        .then((all) => { setAllStreams(all); })
        .catch(() => { allLoadedRef.current = false; })
        .finally(() => setLoadingAll(false));
    }
  };

  const isGlobalSearch = search.trim().length > 0;

  const filtered = useMemo(() => {
    if (!isGlobalSearch) return streams;
    const q = search.toLowerCase();
    const source = allStreams ?? streams;
    return source.filter((s) => s.name.toLowerCase().includes(q));
  }, [streams, allStreams, search, isGlobalSearch]);

  const handlePlay = (stream: LiveStream) => {
    if (!credentials) return;
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, stream.stream_id),
      title: stream.name,
      type: 'live',
      poster: stream.stream_icon,
    };
    navigate('/player', { state });
  };

  const handleFavorite = (id: string) => {
    storageService.toggleFavorite(id);
    setFavorites(storageService.getFavorites());
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Live TV</h1>
        <div className={styles.searchWrapper}>
          <span className={styles.searchIcon}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="15" height="15"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
          </span>
          <input
            className={styles.search}
            type="search"
            placeholder="Rechercher dans toutes les chaînes…"
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
          />
        </div>
        {isGlobalSearch && (
          <span className={styles.searchBadge}>
            {loadingAll ? '⏳ Chargement…' : `${filtered.length} résultat${filtered.length !== 1 ? 's' : ''}`}
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

      {loadingStreams && !isGlobalSearch ? (
        <div className={styles.gridLoading}>
          {Array.from({ length: 18 }).map((_, i) => (
            <div key={i} className={`${styles.skeleton} ${styles.skeletonChannel}`} />
          ))}
        </div>
      ) : (
        <div className={`${styles.grid} ${styles.gridChannel}`}>
          {filtered.map((stream) => (
            <MediaCard
              key={stream.stream_id}
              title={stream.name}
              image={stream.stream_icon}
              variant="channel"
              isLive
              isFavorite={favorites.includes(String(stream.stream_id))}
              onClick={() => handlePlay(stream)}
              onFavorite={() => handleFavorite(String(stream.stream_id))}
            />
          ))}
        </div>
      )}

      {!loadingStreams && !loadingAll && filtered.length === 0 && !error && (
        <p className={styles.empty}>Aucune chaîne trouvée.</p>
      )}
    </div>
  );
}
