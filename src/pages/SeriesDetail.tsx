import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import type { SeriesInfo, Episode, PlayerState, SeriesItem } from '../types/xtream.types';
import { safeImgUrl } from '../utils/image';
import styles from './SeriesDetail.module.css';

interface LocationState {
  series?: SeriesItem;
}

export function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();

  const seriesMeta = (location.state as LocationState)?.series ?? null;

  const [info, setInfo] = useState<SeriesInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string>('1');

  useEffect(() => {
    if (!credentials || !id) return;
    setLoading(true);
    xtreamService
      .getSeriesInfo(credentials, parseInt(id))
      .then((data) => {
        setInfo(data);
        const firstSeason = Object.keys(data.episodes).sort((a, b) => Number(a) - Number(b))[0];
        if (firstSeason) setSelectedSeason(firstSeason);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [credentials, id]);

  const handlePlayEpisode = (episode: Episode) => {
    if (!credentials) return;
    const state: PlayerState = {
      url: xtreamService.getSeriesStreamUrl(credentials, episode.id, episode.container_extension),
      fallbackUrl: xtreamService.getSeriesDirectUrl(credentials, episode.id, episode.container_extension),
      title: `${info?.info.name ?? seriesMeta?.name ?? ''} – ${episode.title || `Épisode ${episode.episode_num}`}`,
      type: 'episode',
      poster: episode.info.movie_image ?? info?.info.cover ?? seriesMeta?.cover,
      description: episode.info.plot,
    };
    navigate('/player', { state });
  };

  const seasons = info ? Object.keys(info.episodes).sort((a, b) => Number(a) - Number(b)) : [];
  const episodes: Episode[] = info?.episodes[selectedSeason] ?? [];
  const cover = info?.info.cover ?? seriesMeta?.cover;
  const backdrop = info?.info.backdrop_path?.[0];
  const title = info?.info.name ?? seriesMeta?.name ?? 'Série';

  return (
    <div className={styles.page}>
      {/* Hero banner */}
      <div
        className={styles.hero}
        style={{ backgroundImage: backdrop ? `url(${backdrop})` : undefined }}
      >
        <div className={styles.heroOverlay}>
          <button className={styles.back} onClick={() => navigate(-1)}>← Retour</button>
          <div className={styles.heroContent}>
            {safeImgUrl(cover) && <img src={safeImgUrl(cover)} alt={title} className={styles.cover} />}
            <div className={styles.heroInfo}>
              <h1 className={styles.heroTitle}>{title}</h1>
              {(info?.info.genre ?? seriesMeta?.genre) && (
                <p className={styles.genre}>{info?.info.genre ?? seriesMeta?.genre}</p>
              )}
              {(info?.info.rating ?? seriesMeta?.rating) && (
                <p className={styles.rating}>★ {info?.info.rating ?? seriesMeta?.rating}</p>
              )}
              {info?.info.plot && (
                <p className={styles.plot}>{info.info.plot}</p>
              )}
              {info?.info.cast && (
                <p className={styles.cast}><strong>Casting :</strong> {info.info.cast}</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Episodes */}
      <div className={styles.episodes}>
        {loading && (
          <div className={styles.loading}>
            <div className="spinner" />
          </div>
        )}

        {error && <div className={styles.error}>⚠ {error}</div>}

        {!loading && !error && (
          <>
            {/* Season selector */}
            {seasons.length > 1 && (
              <div className={styles.seasons}>
                {seasons.map((s) => (
                  <button
                    key={s}
                    className={`${styles.seasonBtn} ${selectedSeason === s ? styles.seasonActive : ''}`}
                    onClick={() => setSelectedSeason(s)}
                  >
                    Saison {s}
                  </button>
                ))}
              </div>
            )}

            <div className={styles.episodeList}>
              {episodes.map((ep) => (
                <div key={ep.id} className={styles.episode} onClick={() => handlePlayEpisode(ep)}>
                  {safeImgUrl(ep.info.movie_image) ? (
                    <img src={safeImgUrl(ep.info.movie_image)} alt={ep.title} className={styles.epThumb} />
                  ) : (
                    <div className={styles.epThumbPlaceholder}>{ep.episode_num}</div>
                  )}
                  <div className={styles.epInfo}>
                    <span className={styles.epNum}>Épisode {ep.episode_num}</span>
                    <span className={styles.epTitle}>{ep.title || `Épisode ${ep.episode_num}`}</span>
                    {ep.info.plot && <p className={styles.epPlot}>{ep.info.plot}</p>}
                    {ep.info.duration && (
                      <span className={styles.epDuration}>{ep.info.duration}</span>
                    )}
                  </div>
                  <div className={styles.epPlay}>▶</div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
