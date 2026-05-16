import { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import type { SeriesInfo, Episode, PlayerState, SeriesItem } from '../types/xtream.types';
import type { TmdbEnrichment, TmdbEpisodeStills } from '../types/tmdb.types';
import { cleanTitle, extractYear, versionLabel } from '../utils/catalog';
import { safeImgUrl } from '../utils/image';
import { BackdropSlideshow } from '../components/BackdropSlideshow';
import styles from './SeriesDetail.module.css';

interface LocationState {
  series?: SeriesItem;
  variants?: SeriesItem[];
}

export function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const { addToHistory } = useLibrary();

  const seriesMeta = (location.state as LocationState)?.series ?? null;
  const passedVariants = (location.state as LocationState)?.variants ?? null;

  const [variants] = useState<SeriesItem[]>(passedVariants ?? (seriesMeta ? [seriesMeta] : []));
  const [variant, setVariant] = useState<SeriesItem | null>(seriesMeta);
  const [info, setInfo] = useState<SeriesInfo | null>(null);
  const [tmdb, setTmdb] = useState<TmdbEnrichment | null>(null);
  const [stills, setStills] = useState<TmdbEpisodeStills>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<string>('1');
  const [inList, setInList] = useState(false);

  const seriesId = variant?.series_id ?? (id ? parseInt(id) : NaN);

  useEffect(() => {
    if (!credentials || Number.isNaN(seriesId)) return;
    setLoading(true);
    setInfo(null);
    xtreamService
      .getSeriesInfo(credentials, seriesId)
      .then((data) => {
        setInfo(data);
        const firstSeason = Object.keys(data.episodes).sort((a, b) => Number(a) - Number(b))[0];
        if (firstSeason) setSelectedSeason(firstSeason);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [credentials, seriesId]);

  const title = info?.info.name ?? variant?.name ?? seriesMeta?.name ?? 'Série';
  const displayTitle = cleanTitle(title);
  const releaseDate = info?.info.releaseDate;
  const year = useMemo(
    () => extractYear(title) ?? (releaseDate ? releaseDate.slice(0, 4) : undefined),
    [title, releaseDate],
  );

  // Enrichissement TMDB (image paysage / casting / note / synopsis).
  useEffect(() => {
    setTmdb(null);
    if (!tmdbService.isEnabled() || displayTitle === 'Série') return;
    let alive = true;
    tmdbService.enrichSeries(displayTitle, year).then((res) => {
      if (alive) setTmdb(res);
    });
    return () => { alive = false; };
  }, [displayTitle, year]);

  // Vignettes d'épisodes TMDB pour la saison sélectionnée.
  useEffect(() => {
    setStills({});
    if (!tmdb?.tmdbId) return;
    let alive = true;
    tmdbService.getEpisodeStills(tmdb.tmdbId, Number(selectedSeason)).then((map) => {
      if (alive) setStills(map);
    });
    return () => { alive = false; };
  }, [tmdb, selectedSeason]);

  const handlePlayEpisode = (episode: Episode) => {
    if (!credentials) return;
    const epLabel = episode.title || `Épisode ${episode.episode_num}`;
    const historyId = `episode-${episode.id}`;
    // Image paysage (16:9) pour « Reprendre » + poster vidéo : le still
    // d'épisode TMDB est déjà du 16:9 → idéal. URLs BRUTES (safeImgUrl est
    // appliqué au rendu Home / VideoPlayer, jamais stocké pré-proxifié).
    const landscape =
      episode.info.movie_image ||
      stills[episode.episode_num] ||
      tmdb?.backdrop ||
      info?.info.cover ||
      variant?.cover;
    const state: PlayerState = {
      url: xtreamService.getSeriesStreamUrl(credentials, episode.id, episode.container_extension),
      fallbackUrl: xtreamService.getSeriesDirectUrl(credentials, episode.id, episode.container_extension),
      title: `${displayTitle} – ${epLabel}`,
      type: 'episode',
      poster: landscape,
      description: episode.info.plot,
      historyId,
    };
    addToHistory({
      id: historyId,
      type: 'series',
      title: `${displayTitle} – ${epLabel}`,
      image: landscape ?? '',
      progress: 0,
      subtitle: `S${episode.season} · É${episode.episode_num}`,
      playerState: state,
    });
    navigate('/player', { state });
  };

  const handlePlayFirst = () => {
    const first = episodes[0];
    if (first) handlePlayEpisode(first);
  };

  const seasons = info ? Object.keys(info.episodes).sort((a, b) => Number(a) - Number(b)) : [];
  const episodes: Episode[] = info?.episodes[selectedSeason] ?? [];
  // Diaporama de tous les fonds d'écran TMDB ; repli sur backdrop/cover
  // Xtream. URLs BRUTES (le slideshow applique safeImgUrl au rendu).
  const backdrops = useMemo(() => {
    if (tmdb?.backdrops.length) return tmdb.backdrops;
    const fb = info?.info.backdrop_path?.[0] || info?.info.cover || variant?.cover;
    return fb ? [fb] : [];
  }, [tmdb, info, variant]);
  const genre = info?.info.genre ?? variant?.genre;
  const ratingRaw = info?.info.rating ?? variant?.rating;
  const ratingNum = tmdb?.rating ?? (ratingRaw && ratingRaw !== '0' ? Number(ratingRaw) : undefined);
  const rating = ratingNum && !Number.isNaN(ratingNum) ? ratingNum.toFixed(1) : undefined;
  const synopsis = tmdb?.overview ?? info?.info.plot;
  const xtreamCast = (info?.info.cast ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const director = info?.info.director;
  const episodeCount = seasons.reduce((acc, s) => acc + (info?.episodes[s]?.length ?? 0), 0);
  const showVariants = variants.length > 1;

  return (
    <div className={styles.page}>
      {/* Hero banner */}
      <section className={styles.hero}>
        {backdrops.length > 0 ? (
          <BackdropSlideshow images={backdrops} />
        ) : (
          <div className={`${styles.art} ${styles.artPlaceholder}`}>
            <span className={styles.artTag}>// BACKDROP · 16:9</span>
          </div>
        )}
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
              <h1 className={styles.title}>{displayTitle}</h1>

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
              </div>

              {showVariants && (
                <div className={styles.versionBlock}>
                  <div className={styles.sectionLabel}>Version</div>
                  <div className={styles.versionBtns}>
                    {variants.map((v, i) => (
                      <button
                        key={v.series_id}
                        className={`${styles.versionBtn} ${variant?.series_id === v.series_id ? styles.versionActive : ''}`}
                        onClick={() => setVariant(v)}
                      >
                        {versionLabel(v.name, `Source ${i + 1}`)}
                      </button>
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
                      <div key={`${c.name}-${c.character}`} className={styles.castRow}>
                        {c.profile ? (
                          <img src={safeImgUrl(c.profile)} alt={c.name} className={styles.castAvatar} />
                        ) : (
                          <div className={styles.castAvatarPh}>
                            {c.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                          </div>
                        )}
                        <span className={styles.castName}>{c.name}</span>
                        <span className={styles.castRole}>{c.character}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                xtreamCast.length > 0 && (
                  <div className={styles.castBlock}>
                    <div className={styles.sectionLabel}>Casting</div>
                    <div className={styles.castGrid}>
                      {xtreamCast.map((name) => (
                        <div key={name} className={styles.castRow}>
                          <div className={styles.castAvatarPh}>
                            {name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                          </div>
                          <span className={styles.castName}>{name}</span>
                          <span className={styles.castRole}>Acteur</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
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
                  {episodes.map((ep) => {
                    const thumb = safeImgUrl(ep.info.movie_image) || safeImgUrl(stills[ep.episode_num]);
                    return (
                      <div key={ep.id} className={styles.episode} onClick={() => handlePlayEpisode(ep)}>
                        {thumb ? (
                          <img src={thumb} alt={ep.title} className={styles.epThumb} />
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
                    );
                  })}
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
              {showVariants && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>Versions</span>
                  <span className={styles.factVal}>{variants.length}</span>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
