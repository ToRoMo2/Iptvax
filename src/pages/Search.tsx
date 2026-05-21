import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import { PreviewCard } from '../components/PreviewCard';
import { MediaCard } from '../components/MediaCard';
import { RemoteSearch } from '../components/RemoteSearch';
import { groupByTitle } from '../utils/catalog';
import type {
  LiveStream,
  VodStream,
  SeriesItem,
  PlayerState,
} from '../types/xtream.types';
import browse from './Browse.module.css';
import styles from './Search.module.css';

const MIN_SEARCH_LEN = 3;
// Plafond PAR section (chaînes / films / séries) — borne le nombre de cartes
// montées à chaque frappe (anti-jank, voir docs/architecture.md §4).
const RESULT_LIMIT = 60;

export function Search() {
  const { credentials } = useXtream();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { t, tc } = useI18n();
  const navigate = useNavigate();

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
    Promise.allSettled([
      xtreamService.getLiveStreams(credentials),
      xtreamService.getVodStreams(credentials),
      xtreamService.getSeries(credentials),
    ]).then(([live, movies, series]) => {
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
  }, [credentials, t]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const isSearching = query.length >= MIN_SEARCH_LEN;
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

  const openChannel = (stream: LiveStream) => {
    if (!credentials) return;
    const liveChannels = liveResults.map((s) => ({
      stream_id: s.stream_id,
      name: s.name,
      stream_icon: s.stream_icon,
    }));
    const liveIndex = liveResults.findIndex(
      (s) => s.stream_id === stream.stream_id,
    );
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, stream.stream_id),
      fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, stream.stream_id),
      title: stream.name,
      type: 'live',
      poster: stream.stream_icon,
      liveChannels,
      liveIndex,
    };
    navigate('/player', { state });
  };

  return (
    <div className={browse.page}>
      <header className={browse.header}>
        <div className={browse.titleBlock}>
          <h1 className={browse.title}>{t('search.title')}</h1>
          <p className={browse.pageSub}>
            {isSearching && !loading
              ? tc('search.subResultsOne', 'search.subResultsOther', totalResults)
              : t('search.subIdle')}
          </p>
        </div>
        <RemoteSearch
          value={search}
          onChange={setSearch}
          placeholder={t('search.placeholder')}
          wrapperClassName={browse.searchWrapper}
          iconClassName={browse.searchIcon}
          inputClassName={browse.search}
        />
        {search.trim().length > 0 && search.trim().length < MIN_SEARCH_LEN && (
          <span className={browse.searchBadge}>
            {t('common.minChars', { n: MIN_SEARCH_LEN })}
          </span>
        )}
        {isSearching && loading && (
          <span className={browse.searchBadge}>{t('search.loadingCatalog')}</span>
        )}
      </header>

      {error && <div className={browse.error}>⚠ {error}</div>}

      {!isSearching && !error && (
        <p className={browse.empty}>
          {t('search.hint', { n: MIN_SEARCH_LEN })}
        </p>
      )}

      {isSearching && loading && (
        <div className={browse.gridLoading}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className={`${browse.skeleton} ${browse.skeletonPoster}`}
            />
          ))}
        </div>
      )}

      {isSearching && !loading && totalResults === 0 && !error && (
        <p className={browse.empty}>{t('search.noResults', { query })}</p>
      )}

      {isSearching && !loading && liveResults.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t('search.channels')}</h2>
            <span className={styles.sectionCount}>{liveResults.length}</span>
          </div>
          <div className={`${browse.grid} ${browse.gridChannel}`}>
            {liveResults.map((stream) => (
              <MediaCard
                key={stream.stream_id}
                title={stream.name}
                image={stream.stream_icon}
                variant="channel"
                isLive
                isFavorite={isFavorite('live', String(stream.stream_id))}
                onClick={() => openChannel(stream)}
                onFavorite={() =>
                  toggleFavorite({
                    type: 'live',
                    id: String(stream.stream_id),
                    name: stream.name,
                    image: stream.stream_icon ?? '',
                  })
                }
              />
            ))}
          </div>
        </section>
      )}

      {isSearching && !loading && movieGroups.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t('search.movies')}</h2>
            <span className={styles.sectionCount}>{movieGroups.length}</span>
          </div>
          <div className={`${browse.grid} ${browse.gridPoster}`}>
            {movieGroups.map((g) => (
              <PreviewCard
                key={g.primary.stream_id}
                title={g.title}
                image={g.primary.stream_icon}
                backdrop={g.primary.backdrop_path?.[0]}
                synopsis={g.primary.plot}
                meta={[
                  g.year,
                  g.primary.rating_5based > 0
                    ? `★ ${g.primary.rating_5based.toFixed(1)}`
                    : null,
                  g.primary.genre?.split('/')[0].trim(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                variant="movie"
                isFavorite={isFavorite('movie', String(g.primary.stream_id))}
                trailerUrl={g.primary.youtube_trailer}
                resolveTrailer={() =>
                  tmdbService.getTrailer('movie', g.title, g.year)
                }
                onOpen={() =>
                  navigate(`/movie/${g.primary.stream_id}`, {
                    state: { movie: g.primary, variants: g.variants },
                  })
                }
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
        </section>
      )}

      {isSearching && !loading && seriesGroups.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{t('search.series')}</h2>
            <span className={styles.sectionCount}>{seriesGroups.length}</span>
          </div>
          <div className={`${browse.grid} ${browse.gridPoster}`}>
            {seriesGroups.map((g) => (
              <PreviewCard
                key={g.primary.series_id}
                title={g.title}
                image={g.primary.cover}
                backdrop={g.primary.backdrop_path?.[0]}
                synopsis={g.primary.plot}
                meta={[
                  g.year,
                  g.primary.rating_5based > 0
                    ? `★ ${g.primary.rating_5based.toFixed(1)}`
                    : null,
                  g.primary.genre?.split('/')[0].trim(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
                variant="series"
                isFavorite={isFavorite('series', String(g.primary.series_id))}
                trailerUrl={g.primary.youtube_trailer}
                resolveTrailer={() =>
                  tmdbService.getTrailer('tv', g.title, g.year)
                }
                onOpen={() =>
                  navigate(`/series/${g.primary.series_id}`, {
                    state: { series: g.primary, variants: g.variants },
                  })
                }
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
        </section>
      )}
    </div>
  );
}
