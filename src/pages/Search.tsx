import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import { PreviewCard } from '../components/PreviewCard';
import { MediaCard } from '../components/MediaCard';
import { RemoteSearch } from '../components/RemoteSearch';
import { ScrollRail } from '../components/ScrollRail';
import { useCatalogSearch, SEARCH_MIN_LEN } from '../hooks/useCatalogSearch';
import { star5Label } from '../utils/catalog';
import type { LiveStream, PlayerState } from '../types/xtream.types';
import browse from './Browse.module.css';
import styles from './Search.module.css';

const MIN_SEARCH_LEN = SEARCH_MIN_LEN;

// ── Rangée « rail » (en-tête + scroll horizontal) ───────────────────────────
// Même pattern que Movies / Series / Live (§IV-22/27) : chaque section de
// résultats est UNE rangée scrollable horizontalement → les 3 catégories
// (chaînes / films / séries) tiennent dans un seul écran, sans devoir
// scroller verticalement jusqu'en bas pour atteindre les séries.
function SearchShelf({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className={`${browse.shelf} ${styles.shelf}`}>
      <div className={`${browse.shelfHeader} ${styles.shelfHeader}`}>
        <div className={browse.shelfTitleGroup}>
          <h2 className={browse.shelfTitle}>{title}</h2>
          <span className={browse.shelfDivider} aria-hidden="true" />
          <span className={browse.shelfCount}>{count}</span>
        </div>
      </div>
      <ScrollRail railClassName={`${browse.shelfRail} ${styles.shelfRail}`}>{children}</ScrollRail>
    </section>
  );
}


export function Search() {
  const { credentials } = useXtream();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { t, tc } = useI18n();
  const navigate = useNavigate();

  const {
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
  } = useCatalogSearch();

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
    <div className={`${browse.page} ${styles.page}`}>
      <header className={`${browse.header} ${styles.searchHeader}`}>
        <div className={`${browse.titleBlock} ${styles.titleBlock}`}>
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
          animatedPlaceholders={[
            t('search.placeholder'),
            t('movies.searchPlaceholder'),
            t('series.searchPlaceholder'),
            t('live.searchPlaceholder'),
          ]}
          autoFocus
          wrapperClassName={`${browse.searchWrapper} ${styles.searchBar}`}
          iconClassName={browse.searchIcon}
          inputClassName={browse.search}
          clearClassName={browse.searchClear}
        />
        {search.trim().length > 0 && search.trim().length < MIN_SEARCH_LEN && (
          <span className={`${browse.searchBadge} ${styles.badge}`}>
            {t('common.minChars', { n: MIN_SEARCH_LEN })}
          </span>
        )}
        {isSearching && loading && (
          <span className={`${browse.searchBadge} ${styles.badge}`}>{t('search.loadingCatalog')}</span>
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

      {isSearching && !loading && totalResults > 0 && (
        <div className={`${browse.shelves} ${styles.searchShelves}`}>
          {liveResults.length > 0 && (
            <SearchShelf title={t('search.channels')} count={liveResults.length}>
              {liveResults.map((stream) => (
                <div key={stream.stream_id} className={styles.channelCell}>
                  <MediaCard
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
                </div>
              ))}
            </SearchShelf>
          )}

          {movieGroups.length > 0 && (
            <SearchShelf title={t('search.movies')} count={movieGroups.length}>
              {movieGroups.map((g) => (
                <PreviewCard
                  key={g.primary.stream_id}
                  className={`${browse.posterCell} ${styles.posterCell}`}
                  title={g.title}
                  image={g.primary.stream_icon}
                  backdrop={g.primary.backdrop_path?.[0]}
                  synopsis={g.primary.plot}
                  meta={[
                    g.year,
                    star5Label(g.primary.rating_5based),
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
                  resolvePoster={() => tmdbService.lookupPoster('movie', g.title, g.year)}
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
            </SearchShelf>
          )}

          {seriesGroups.length > 0 && (
            <SearchShelf title={t('search.series')} count={seriesGroups.length}>
              {seriesGroups.map((g) => (
                <PreviewCard
                  key={g.primary.series_id}
                  className={`${browse.posterCell} ${styles.posterCell}`}
                  title={g.title}
                  image={g.primary.cover}
                  backdrop={g.primary.backdrop_path?.[0]}
                  synopsis={g.primary.plot}
                  meta={[
                    g.year,
                    star5Label(g.primary.rating_5based),
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
                  resolvePoster={() => tmdbService.lookupPoster('tv', g.title, g.year)}
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
            </SearchShelf>
          )}
        </div>
      )}
    </div>
  );
}
