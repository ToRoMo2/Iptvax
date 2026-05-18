import { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import type { VodStream, PlayerState } from '../types/xtream.types';
import type { TmdbEnrichment } from '../types/tmdb.types';
import { cleanTitle, extractYear, versionLabel, titleKey } from '../utils/catalog';
import { splitMeta } from '../utils/ratings';
import { safeImgUrl } from '../utils/image';
import { RateBlock } from '../components/RateBlock/RateBlock';
import type { WatchedInput } from '../types/ratings.types';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { BackdropSlideshow } from '../components/BackdropSlideshow';
import { Focusable } from '../components/Focusable';
import { DETAIL_BACK_FOCUS_KEY, DETAIL_PLAY_FOCUS_KEY } from '../components/RemoteControl';
import styles from './SeriesDetail.module.css';

interface LocationState {
  movie?: VodStream;
  variants?: VodStream[];
}

export function MovieDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const { addToHistory, isFavorite, toggleFavorite } = useLibrary();

  const passed = (location.state as LocationState)?.movie ?? null;
  const passedVariants = (location.state as LocationState)?.variants ?? null;

  const [movie, setMovie] = useState<VodStream | null>(passed);
  const [variants, setVariants] = useState<VodStream[]>(passedVariants ?? (passed ? [passed] : []));
  const [selected, setSelected] = useState<VodStream | null>(passed);
  const [tmdb, setTmdb] = useState<TmdbEnrichment | null>(null);
  const [loading, setLoading] = useState(!passed);
  const [error, setError] = useState<string | null>(null);

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
        setSelected(found);
        setVariants(found ? [found] : []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [passed, credentials, id]);

  const displayTitle = movie ? cleanTitle(movie.name) : '';
  const year = useMemo(
    () => (movie ? extractYear(movie.name) ?? (movie.releaseDate ? movie.releaseDate.slice(0, 4) : undefined) : undefined),
    [movie],
  );

  // Enrichissement TMDB — purement additif : échec/clé absente → données Xtream.
  useEffect(() => {
    setTmdb(null);
    if (!movie || !tmdbService.isEnabled()) return;
    let alive = true;
    tmdbService.enrichMovie(displayTitle, year).then((res) => {
      if (alive) setTmdb(res);
    });
    return () => { alive = false; };
  }, [movie, displayTitle, year]);

  const handlePlay = () => {
    if (!credentials || !movie) return;
    const target = selected ?? movie;
    const historyId = `movie-${target.stream_id}`;
    // Image paysage (16:9) pour la vignette « Reprendre » + le poster vidéo —
    // évite le crop moche d'une affiche portrait. URLs BRUTES : safeImgUrl est
    // appliqué au rendu (Home / VideoPlayer), jamais stocké pré-proxifié.
    const landscape =
      tmdb?.backdrop ?? movie.backdrop_path?.[0] ?? tmdb?.poster ?? target.stream_icon;
    const state: PlayerState = {
      url: xtreamService.getVodStreamUrl(credentials, target.stream_id, target.container_extension),
      fallbackUrl: xtreamService.getVodDirectUrl(credentials, target.stream_id, target.container_extension),
      title: displayTitle,
      type: 'movie',
      poster: landscape,
      description: tmdb?.overview ?? target.plot,
      historyId,
    };
    addToHistory({
      id: historyId,
      type: 'movie',
      title: displayTitle,
      image: landscape || '',
      progress: 0,
      subtitle: year ?? 'Film',
      playerState: state,
    });
    navigate('/player', { state });
  };

  // Diaporama de tous les fonds d'écran TMDB ; repli sur l'unique backdrop
  // Xtream / poster si TMDB indisponible. URLs BRUTES (slideshow proxifie).
  const backdrops = useMemo(() => {
    if (tmdb?.backdrops.length) return tmdb.backdrops;
    const fb = movie?.backdrop_path?.[0] || tmdb?.poster || movie?.stream_icon;
    return fb ? [fb] : [];
  }, [tmdb, movie]);
  const genre = movie?.genre;
  const ratingNum = tmdb?.rating ?? (movie?.rating && movie.rating !== '0' ? Number(movie.rating) : undefined);
  const rating = ratingNum && !Number.isNaN(ratingNum) ? ratingNum.toFixed(1) : undefined;
  const synopsis = tmdb?.overview ?? movie?.plot;
  const xtreamCast = (movie?.cast ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const showVariants = variants.length > 1;

  // Snapshot figé pour le mur « Mon ciné » : métadonnées Xtream (toujours
  // présentes) enrichies par TMDB si dispo. Purement additif.
  const watchedInput = useMemo<WatchedInput | null>(() => {
    if (!movie) return null;
    const target = selected ?? movie;
    return {
      contentType: 'movie',
      contentId: `movie-${target.stream_id}`,
      titleKey: titleKey(movie.name),
      title: displayTitle,
      year: year ? Number(year) : undefined,
      poster: tmdb?.poster ?? movie.stream_icon ?? movie.backdrop_path?.[0],
      backdrop: tmdb?.backdrop ?? movie.backdrop_path?.[0],
      tmdbId: tmdb?.tmdbId,
      genres: splitMeta(movie.genre),
      cast: tmdb?.cast.length
        ? tmdb.cast.map((c) => c.name)
        : splitMeta(movie.cast),
      directors: splitMeta(movie.director),
    };
  }, [movie, selected, displayTitle, year, tmdb]);

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        {backdrops.length > 0 ? (
          <BackdropSlideshow images={backdrops} />
        ) : (
          <div className={`${styles.art} ${styles.artPlaceholder}`}>
            <span className={styles.artTag}>// BACKDROP · 16:9</span>
          </div>
        )}
        <div className={styles.overlayBottom} />
        <Focusable
          className={styles.back}
          focusKey={DETAIL_BACK_FOCUS_KEY}
          onEnter={() => navigate(-1)}
          onClick={() => navigate(-1)}
          ariaLabel="Retour"
          onArrow={(direction) => {
            if (direction === 'down') {
              setFocus(DETAIL_PLAY_FOCUS_KEY);
              return false;
            }
            return true;
          }}
        >
          ← Retour
        </Focusable>
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
              <h1 className={styles.title}>{displayTitle}</h1>

              <div className={styles.meta}>
                {year && <span>{year}</span>}
                {year && genre && <span className={styles.metaSep} />}
                {genre && <span>{genre}</span>}
                {rating && <span className={styles.metaSep} />}
                {rating && <span>★ {rating}</span>}
              </div>

              <div className={styles.actions}>
                <Focusable
                  className="btn btn-primary"
                  focusKey={DETAIL_PLAY_FOCUS_KEY}
                  onEnter={handlePlay}
                  onClick={handlePlay}
                >
                  ▶ Lire le film
                </Focusable>
                <Focusable
                  className="btn btn-secondary"
                  onEnter={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                  onClick={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                >
                  {isFavorite('movie', String(movie.stream_id)) ? '✓ Dans ma liste' : '+ Ma liste'}
                </Focusable>
              </div>

              {watchedInput && (
                <RateBlock input={watchedInput} starsFocusKey="rc-rate-stars" />
              )}

              {showVariants && (
                <div className={styles.versionBlock}>
                  <div className={styles.sectionLabel}>Version</div>
                  <div className={styles.versionBtns}>
                    {variants.map((v, i) => (
                      <Focusable
                        key={v.stream_id}
                        className={`${styles.versionBtn} ${selected?.stream_id === v.stream_id ? styles.versionActive : ''}`}
                        onEnter={() => setSelected(v)}
                        onClick={() => setSelected(v)}
                      >
                        {versionLabel(v.name, `Source ${i + 1}`)}
                      </Focusable>
                    ))}
                  </div>
                </div>
              )}

              {synopsis && <p className={styles.synopsis}>{synopsis}</p>}

              {tmdb && tmdb.cast.length > 0 ? (
                <div className={styles.castBlock}>
                  <div className={styles.sectionLabel}>Casting</div>
                  <div className={styles.castGrid}>
                    {tmdb.cast.map((c) => (
                      <Focusable
                        key={`${c.name}-${c.character}`}
                        className={styles.castRow}
                        ariaLabel={c.name}
                      >
                        {c.profile ? (
                          <img src={safeImgUrl(c.profile)} alt={c.name} loading="lazy" decoding="async" className={styles.castAvatar} />
                        ) : (
                          <div className={styles.castAvatarPh}>
                            {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                          </div>
                        )}
                        <span className={styles.castName}>{c.name}</span>
                        <span className={styles.castRole}>{c.character}</span>
                      </Focusable>
                    ))}
                  </div>
                </div>
              ) : (
                xtreamCast.length > 0 && (
                  <div className={styles.castBlock}>
                    <div className={styles.sectionLabel}>Casting</div>
                    <div className={styles.castGrid}>
                      {xtreamCast.map((name) => (
                        <Focusable key={name} className={styles.castRow} ariaLabel={name}>
                          <div className={styles.castAvatarPh}>
                            {name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                          </div>
                          <span className={styles.castName}>{name}</span>
                          <span className={styles.castRole}>Acteur</span>
                        </Focusable>
                      ))}
                    </div>
                  </div>
                )
              )}
            </div>

            <aside className={styles.side}>
              <h4 className={styles.sideTitle}>À propos</h4>
              {genre && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Genre</span>
                  <span className={styles.factVal}>{genre}</span>
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
              {showVariants && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Versions</span>
                  <span className={styles.factVal}>{variants.length}</span>
                </div>
              )}
              <div className={styles.factRow}>
                <span className={styles.factKey}>Format</span>
                <span className={styles.factVal}>{(selected ?? movie).container_extension?.toUpperCase() || '—'}</span>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
