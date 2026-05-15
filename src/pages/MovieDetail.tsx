import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useLibrary } from '../contexts/LibraryContext';
import type { VodStream, PlayerState } from '../types/xtream.types';
import { safeImgUrl } from '../utils/image';
import styles from './SeriesDetail.module.css';

interface LocationState {
  movie?: VodStream;
}

export function MovieDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const { addToHistory } = useLibrary();

  const passed = (location.state as LocationState)?.movie ?? null;

  const [movie, setMovie] = useState<VodStream | null>(passed);
  const [loading, setLoading] = useState(!passed);
  const [error, setError] = useState<string | null>(null);
  const [inList, setInList] = useState(false);

  // Deep-link / refresh : pas d'état de navigation → on retrouve le film par id.
  useEffect(() => {
    if (passed || !credentials || !id) return;
    setLoading(true);
    xtreamService
      .getVodStreams(credentials)
      .then((all) => {
        const found = all.find((v) => String(v.stream_id) === id) ?? null;
        if (!found) setError('Film introuvable.');
        setMovie(found);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [passed, credentials, id]);

  const handlePlay = () => {
    if (!credentials || !movie) return;
    const historyId = `movie-${movie.stream_id}`;
    const state: PlayerState = {
      url: xtreamService.getVodStreamUrl(credentials, movie.stream_id, movie.container_extension),
      fallbackUrl: xtreamService.getVodDirectUrl(credentials, movie.stream_id, movie.container_extension),
      title: movie.name,
      type: 'movie',
      poster: movie.stream_icon,
      description: movie.plot,
      historyId,
    };
    addToHistory({
      id: historyId,
      type: 'movie',
      title: movie.name,
      image: movie.stream_icon || '',
      progress: 0,
      subtitle: movie.releaseDate ? movie.releaseDate.slice(0, 4) : 'Film',
      playerState: state,
    });
    navigate('/player', { state });
  };

  const heroImg = safeImgUrl(movie?.backdrop_path?.[0]) || safeImgUrl(movie?.stream_icon);
  const year = movie?.releaseDate ? movie.releaseDate.slice(0, 4) : undefined;
  const rating = movie?.rating && movie.rating !== '0' ? movie.rating : undefined;
  const castList = (movie?.cast ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div
          className={`${styles.art} ${heroImg ? '' : styles.artPlaceholder}`}
          style={heroImg ? { backgroundImage: `url(${heroImg})` } : undefined}
        >
          {!heroImg && <span className={styles.artTag}>// BACKDROP · 16:9</span>}
        </div>
        <div className={styles.overlayBottom} />
        <button className={styles.back} onClick={() => navigate(-1)}>
          ← Retour
        </button>
      </section>

      <div className={styles.body}>
        {loading && (
          <div className={styles.loading}>
            <div className="spinner" />
          </div>
        )}

        {error && <div className={styles.error}>⚠ {error}</div>}

        {!loading && !error && movie && (
          <div className={styles.grid}>
            <div>
              <div className={styles.cat}>
                <span className={styles.catDot} />
                Film
              </div>
              <h1 className={styles.title}>{movie.name}</h1>

              <div className={styles.meta}>
                {year && <span>{year}</span>}
                {year && movie.genre && <span className={styles.metaSep} />}
                {movie.genre && <span>{movie.genre}</span>}
                {rating && <span className={styles.metaSep} />}
                {rating && <span>★ {rating}</span>}
              </div>

              <div className={styles.actions}>
                <button className="btn btn-primary" onClick={handlePlay}>
                  ▶ Lire le film
                </button>
                <button className="btn btn-secondary" onClick={() => setInList((v) => !v)}>
                  {inList ? '✓ Dans ma liste' : '+ Ma liste'}
                </button>
              </div>

              {movie.plot && <p className={styles.synopsis}>{movie.plot}</p>}

              {castList.length > 0 && (
                <div className={styles.castBlock}>
                  <div className={styles.sectionLabel}>Casting</div>
                  <div className={styles.castGrid}>
                    {castList.map((name) => (
                      <div key={name} className={styles.castRow}>
                        <span className={styles.castName}>{name}</span>
                        <span className={styles.castRole}>Acteur</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <aside className={styles.side}>
              <h4 className={styles.sideTitle}>À propos</h4>
              {movie.genre && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Genre</span>
                  <span className={styles.factVal}>{movie.genre}</span>
                </div>
              )}
              {movie.releaseDate && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Sortie</span>
                  <span className={styles.factVal}>{movie.releaseDate}</span>
                </div>
              )}
              {movie.director && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Réal.</span>
                  <span className={styles.factVal}>{movie.director}</span>
                </div>
              )}
              {rating && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Note</span>
                  <span className={styles.factVal}>★ {rating}</span>
                </div>
              )}
              <div className={styles.factRow}>
                <span className={styles.factKey}>Format</span>
                <span className={styles.factVal}>{movie.container_extension?.toUpperCase() || '—'}</span>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
