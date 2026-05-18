import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { PreviewCard } from '../components/PreviewCard';
import { RemoteSearch } from '../components/RemoteSearch';
import { CategoryBar } from '../components/CategoryBar';
import type { VodCategory, VodStream } from '../types/xtream.types';
import { groupByTitle } from '../utils/catalog';
import { useProgressiveList } from '../hooks/useProgressiveList';
import styles from './Browse.module.css';

const MIN_SEARCH_LEN = 3;
const RESULT_LIMIT = 80;

export function Movies() {
  const { credentials } = useXtream();
  const { isFavorite, toggleFavorite } = useLibrary();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<VodCategory[]>([]);
  const [streams, setStreams] = useState<VodStream[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global search — préchargé au montage pour une recherche instantanée
  const [allStreams, setAllStreams] = useState<VodStream[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const allLoadedRef = useRef(false);


  useEffect(() => {
    if (!credentials) return;
    setLoadingCats(true);
    xtreamService
      .getVodCategories(credentials)
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
      .getVodStreams(credentials, selectedCat)
      .then(setStreams)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingStreams(false));
  }, [credentials, selectedCat]);

  useEffect(() => {
    if (!credentials || allLoadedRef.current) return;
    allLoadedRef.current = true;
    setLoadingAll(true);
    xtreamService
      .getVodStreams(credentials)
      .then((all) => { setAllStreams(all); })
      .catch(() => { allLoadedRef.current = false; })
      .finally(() => setLoadingAll(false));
  }, [credentials]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const isGlobalSearch = query.length >= MIN_SEARCH_LEN;

  const filtered = useMemo(() => {
    if (!isGlobalSearch) return streams;
    if (!allStreams) return [];
    const q = query.toLowerCase();
    const out: VodStream[] = [];
    for (const s of allStreams) {
      if (s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return out;
  }, [streams, allStreams, query, isGlobalSearch]);

  // Fusion des doublons (langues / qualités) en une seule carte. La meilleure
  // note devient la variante primaire ; les autres restent jouables via le
  // sélecteur de version sur la fiche détail.
  const groups = useMemo(
    () => groupByTitle(filtered, (v) => v.name, (v) => v.rating_5based ?? 0),
    [filtered],
  );

  // Rendu progressif : premier paint rapide même sur une catégorie de
  // plusieurs milliers de films, puis extension en idle (cf. hook).
  const visibleGroups = useProgressiveList(groups);

  // Un clic sur un film ouvre d'abord sa fiche détail (design Vanta) ;
  // la lecture est lancée depuis le bouton « Lire le film ».
  const handleOpen = (vod: VodStream, variants: VodStream[]) => {
    navigate(`/movie/${vod.stream_id}`, { state: { movie: vod, variants } });
  };


  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Films</h1>
          <p className={styles.pageSub}>
            {isGlobalSearch
              ? 'Recherche globale'
              : `${groups.length} film${groups.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <RemoteSearch
          value={search}
          onChange={setSearch}
          placeholder="Rechercher dans tous les films…"
          wrapperClassName={styles.searchWrapper}
          iconClassName={styles.searchIcon}
          inputClassName={styles.search}
        />
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

      {(loadingStreams && !isGlobalSearch) || (isGlobalSearch && !allStreams) ? (
        <div className={styles.gridLoading}>
          {Array.from({ length: 15 }).map((_, i) => (
            <div key={i} className={`${styles.skeleton} ${styles.skeletonPoster}`} />
          ))}
        </div>
      ) : (
        <div className={`${styles.grid} ${styles.gridPoster}`}>
          {visibleGroups.map((g) => (
            <PreviewCard
              key={g.primary.stream_id}
              title={g.title}
              image={g.primary.stream_icon}
              backdrop={g.primary.backdrop_path?.[0]}
              synopsis={g.primary.plot}
              meta={[
                g.year,
                g.primary.rating_5based > 0 ? `★ ${g.primary.rating_5based.toFixed(1)}` : null,
                g.primary.genre?.split('/')[0].trim(),
              ].filter(Boolean).join(' · ')}
              variant="movie"
              isFavorite={isFavorite('movie', String(g.primary.stream_id))}
              trailerUrl={g.primary.youtube_trailer}
              resolveTrailer={() => tmdbService.getTrailer('movie', g.title, g.year)}
              onOpen={() => handleOpen(g.primary, g.variants)}
              onFavorite={() =>
                toggleFavorite({
                  type: 'movie',
                  id: String(g.primary.stream_id),
                  name: g.title,
                  image: g.primary.stream_icon ?? '',
                })
              }
            />
          ))}
        </div>
      )}

      {!loadingStreams && !loadingAll && filtered.length === 0 && !error && (
        <p className={styles.empty}>Aucun film trouvé.</p>
      )}
    </div>
  );
}
