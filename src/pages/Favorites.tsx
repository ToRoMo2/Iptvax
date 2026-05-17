import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { MediaCard } from '../components/MediaCard';
import { PreviewCard } from '../components/PreviewCard';
import { cleanTitle } from '../utils/catalog';
import type { FavoriteItem } from '../types/library.types';
import type { LiveChannelRef, PlayerState } from '../types/xtream.types';
import styles from './Browse.module.css';
import fav from './Favorites.module.css';

export function Favorites() {
  const { credentials } = useXtream();
  const { favorites, loading, isFavorite, toggleFavorite } = useLibrary();
  const navigate = useNavigate();

  const channels = useMemo(
    () => favorites.filter((f) => f.type === 'live'),
    [favorites],
  );
  const movies = useMemo(
    () => favorites.filter((f) => f.type === 'movie'),
    [favorites],
  );
  const series = useMemo(
    () => favorites.filter((f) => f.type === 'series'),
    [favorites],
  );

  // Zapping limité aux chaînes en favoris : on passe au lecteur un snapshot de
  // TOUTES les chaînes favorites + l'index cliqué → prev/next ne parcourt que
  // les favoris (même mécanisme que la grille catégorie, liste restreinte).
  const playChannel = (channel: FavoriteItem) => {
    if (!credentials) return;
    const liveChannels: LiveChannelRef[] = channels.map((c) => ({
      stream_id: Number(c.id),
      name: c.name,
      stream_icon: c.image,
    }));
    const liveIndex = channels.findIndex((c) => c.id === channel.id);
    const streamId = Number(channel.id);
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, streamId),
      fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, streamId),
      title: channel.name,
      type: 'live',
      poster: channel.image,
      liveChannels,
      liveIndex,
    };
    navigate('/player', { state });
  };

  const isEmpty =
    !loading &&
    channels.length === 0 &&
    movies.length === 0 &&
    series.length === 0;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Favoris</h1>
          <p className={styles.pageSub}>
            {loading
              ? 'Chargement…'
              : `${favorites.length} favori${favorites.length !== 1 ? 's' : ''} · chaînes, films & séries`}
          </p>
        </div>
      </header>

      {loading && (
        <div className={styles.gridLoading}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`${styles.skeleton} ${styles.skeletonPoster}`} />
          ))}
        </div>
      )}

      {isEmpty && (
        <p className={styles.empty}>
          Aucun favori pour l'instant. Touchez l'étoile sur une chaîne, un film
          ou une série pour le retrouver ici.
        </p>
      )}

      {channels.length > 0 && (
        <section className={fav.section}>
          <div className={fav.sectionHead}>
            <h2 className={fav.sectionTitle}>Chaînes</h2>
            <span className={fav.sectionCount}>
              {channels.length} chaîne{channels.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={`${styles.grid} ${styles.gridChannel}`}>
            {channels.map((c) => (
              <MediaCard
                key={c.id}
                title={c.name}
                image={c.image}
                variant="channel"
                isLive
                isFavorite={isFavorite('live', c.id)}
                onClick={() => playChannel(c)}
                onFavorite={() => toggleFavorite(c)}
              />
            ))}
          </div>
        </section>
      )}

      {movies.length > 0 && (
        <section className={fav.section}>
          <div className={fav.sectionHead}>
            <h2 className={fav.sectionTitle}>Films</h2>
            <span className={fav.sectionCount}>
              {movies.length} film{movies.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={`${styles.grid} ${styles.gridPoster}`}>
            {movies.map((m) => (
              <PreviewCard
                key={m.id}
                title={m.name}
                image={m.image}
                variant="movie"
                isFavorite={isFavorite('movie', m.id)}
                resolveTrailer={() => tmdbService.getTrailer('movie', cleanTitle(m.name))}
                onOpen={() => navigate(`/movie/${m.id}`)}
                onFavorite={() => toggleFavorite(m)}
              />
            ))}
          </div>
        </section>
      )}

      {series.length > 0 && (
        <section className={fav.section}>
          <div className={fav.sectionHead}>
            <h2 className={fav.sectionTitle}>Séries</h2>
            <span className={fav.sectionCount}>
              {series.length} série{series.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className={`${styles.grid} ${styles.gridPoster}`}>
            {series.map((s) => (
              <PreviewCard
                key={s.id}
                title={s.name}
                image={s.image}
                variant="series"
                isFavorite={isFavorite('series', s.id)}
                resolveTrailer={() => tmdbService.getTrailer('tv', cleanTitle(s.name))}
                onOpen={() => navigate(`/series/${s.id}`)}
                onFavorite={() => toggleFavorite(s)}
              />
            ))}
          </div>

        </section>
      )}
    </div>
  );
}
