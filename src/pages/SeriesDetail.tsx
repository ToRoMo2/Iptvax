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
  const [inList, setInList] = useState(false);

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

  const handlePlayFirst = () => {
    const first = episodes[0];
    if (first) handlePlayEpisode(first);
  };

  const seasons = info ? Object.keys(info.episodes).sort((a, b) => Number(a) - Number(b)) : [];
  const episodes: Episode[] = info?.episodes[selectedSeason] ?? [];
  const cover = info?.info.cover ?? seriesMeta?.cover;
  const backdrop = info?.info.backdrop_path?.[0];
  const heroImg = safeImgUrl(backdrop) || safeImgUrl(cover);
  const title = info?.info.name ?? seriesMeta?.name ?? 'Série';
  const genre = info?.info.genre ?? seriesMeta?.genre;
  const rating = info?.info.rating ?? seriesMeta?.rating;
  const releaseDate = info?.info.releaseDate;
  const year = releaseDate ? releaseDate.slice(0, 4) : undefined;
  const plot = info?.info.plot;
  const castList = (info?.info.cast ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const director = info?.info.director;
  const episodeCount = seasons.reduce((acc, s) => acc + (info?.episodes[s]?.length ?? 0), 0);

  return (
    <div className={styles.page}>
      {/* Hero banner */}
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

      {/* Body */}
      <div className={styles.body}>
        {loading && (
          <div className={styles.loading}>
            <div className="spinner" />
          </div>
        )}

        {error && <div className={styles.error}>⚠ {error}</div>}

        {!loading && !error && (
          <div className={styles.grid}>
            <div>
              <div className={styles.cat}>
                <span className={styles.catDot} />
                Série
              </div>
              <h1 className={styles.title}>{title}</h1>

              <div className={styles.meta}>
                {year && <span>{year}</span>}
                {year && genre && <span className={styles.metaSep} />}
                {genre && <span>{genre}</span>}
                {(year || genre) && seasons.length > 0 && <span className={styles.metaSep} />}
                {seasons.length > 0 && (
                  <span>
                    {seasons.length} saison{seasons.length > 1 ? 's' : ''}
                  </span>
                )}
                {rating && <span className={styles.metaSep} />}
                {rating && <span>★ {rating}</span>}
              </div>

              <div className={styles.actions}>
                <button className="btn btn-primary" onClick={handlePlayFirst}>
                  ▶ Lire
                </button>
                <button className="btn btn-secondary" onClick={() => setInList((v) => !v)}>
                  {inList ? '✓ Dans ma liste' : '+ Ma liste'}
                </button>
                <button className={styles.iconBtn} title="Plus d'infos">
                  i
                </button>
              </div>

              {plot && <p className={styles.synopsis}>{plot}</p>}

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

              {/* Seasons / Episodes */}
              <div className={styles.seasonsBlock}>
                <div className={styles.sectionLabel}>Épisodes</div>

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
                        {ep.info.duration && <span className={styles.epDuration}>{ep.info.duration}</span>}
                      </div>
                      <div className={styles.epPlay}>▶</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <aside className={styles.side}>
              <h4 className={styles.sideTitle}>À propos</h4>
              {genre && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Genre</span>
                  <span className={styles.factVal}>{genre}</span>
                </div>
              )}
              {releaseDate && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Sortie</span>
                  <span className={styles.factVal}>{releaseDate}</span>
                </div>
              )}
              {director && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Réal.</span>
                  <span className={styles.factVal}>{director}</span>
                </div>
              )}
              {rating && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Note</span>
                  <span className={styles.factVal}>★ {rating}</span>
                </div>
              )}
              <div className={styles.factRow}>
                <span className={styles.factKey}>Saisons</span>
                <span className={styles.factVal}>{seasons.length}</span>
              </div>
              {episodeCount > 0 && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Épisodes</span>
                  <span className={styles.factVal}>{episodeCount}</span>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
