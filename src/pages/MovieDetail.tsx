import { useState, useEffect, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import type { VodStream, PlayerState } from '../types/xtream.types';
import type { TmdbEnrichment } from '../types/tmdb.types';
import { cleanTitle, extractYear, versionLabel, titleKey } from '../utils/catalog';
import { splitMeta } from '../utils/ratings';
import { fmtRuntime } from '../utils/format';
import { safeImgUrl } from '../utils/image';
import { RateBlock } from '../components/RateBlock/RateBlock';
import type { WatchedInput } from '../types/ratings.types';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Focusable } from '../components/Focusable';
import { AppLogo } from '../components/AppLogo';
import { DETAIL_BACK_FOCUS_KEY, DETAIL_PLAY_FOCUS_KEY } from '../components/RemoteControl';
import styles from './SeriesDetail.module.css';

interface LocationState {
  movie?: VodStream;
  variants?: VodStream[];
}

function ChevDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m6 9 6 6 6-6" /></svg>
  );
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 2.6l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 18.6l-5.9 3.1 1.12-6.56L2.45 9.54l6.6-.96z" />
    </svg>
  );
}

export function MovieDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const { addToHistory, isFavorite, toggleFavorite } = useLibrary();
  const { t } = useI18n();

  const passed = (location.state as LocationState)?.movie ?? null;
  const passedVariants = (location.state as LocationState)?.variants ?? null;

  const [movie, setMovie] = useState<VodStream | null>(passed);
  const [variants, setVariants] = useState<VodStream[]>(passedVariants ?? (passed ? [passed] : []));
  const [selected, setSelected] = useState<VodStream | null>(passed);
  const [tmdb, setTmdb] = useState<TmdbEnrichment | null>(null);
  const [loading, setLoading] = useState(!passed);
  const [error, setError] = useState<string | null>(null);
  // Accordéon « À propos » (mobile uniquement — desktop l'ignore via CSS).
  const [aboutOpen, setAboutOpen] = useState(false);
  // Synopsis replié par défaut (bouton « Plus / Moins »).
  const [synopsisOpen, setSynopsisOpen] = useState(false);

  // Deep-link / refresh : pas d'état de navigation → on retrouve le film par id.
  useEffect(() => {
    if (passed || !credentials || !id) return;
    setLoading(true);
    xtreamService
      .getVodStreams(credentials)
      .then((all) => {
        const found = all.find((v) => String(v.stream_id) === id) ?? null;
        if (!found) setError(t('detail.movieNotFound'));
        setMovie(found);
        setSelected(found);
        setVariants(found ? [found] : []);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [passed, credentials, id, t]);

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
      subtitle: year ?? t('detail.film'),
      playerState: state,
    });
    navigate('/player', { state });
  };

  // Affiche portrait pour le hero : poster TMDB > icône Xtream > backdrop.
  // URL BRUTE (safeImgUrl appliqué au rendu).
  const heroPoster = useMemo(
    () => safeImgUrl(tmdb?.poster ?? movie?.stream_icon ?? movie?.backdrop_path?.[0]),
    [tmdb, movie],
  );
  const genre = movie?.genre;
  const ratingNum = tmdb?.rating ?? (movie?.rating && movie.rating !== '0' ? Number(movie.rating) : undefined);
  const rating = ratingNum && !Number.isNaN(ratingNum) ? ratingNum.toFixed(1) : undefined;
  // Pourcentage façon TMDb (note /10 → /100) — seulement si TMDB a répondu.
  const pct = tmdb?.rating ? Math.round(tmdb.rating * 10) : undefined;
  const runtime = fmtRuntime(tmdb?.runtime);
  const synopsis = tmdb?.overview ?? movie?.plot;
  const longSynopsis = (synopsis?.length ?? 0) > 150;
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
        {heroPoster ? (
          <img className={styles.heroPoster} src={heroPoster} alt={displayTitle} decoding="async" />
        ) : (
          <div className={`${styles.art} ${styles.artPlaceholder}`}>
            <span className={styles.artTag}>// POSTER · 2:3</span>
          </div>
        )}
        <div className={styles.overlayBottom} />
        <Focusable
          className={styles.back}
          focusKey={DETAIL_BACK_FOCUS_KEY}
          onEnter={() => navigate(-1)}
          onClick={() => navigate(-1)}
          ariaLabel={t('common.backWord')}
          onArrow={(direction) => {
            if (direction === 'down') {
              setFocus(DETAIL_PLAY_FOCUS_KEY);
              return false;
            }
            return true;
          }}
        >
          {t('common.back')}
        </Focusable>
      </section>

      <div className={styles.body}>
        {loading && (
          <div className={styles.loading}>
            <AppLogo spin size={44} />
          </div>
        )}

        {error && <div className={styles.error}>⚠ {error}</div>}

        {!loading && !error && movie && (
          <div className={styles.grid}>
            <div className={styles.headRow}>
              <div className={styles.headInfo}>
                <h1 className={styles.title}>{displayTitle}</h1>

                <div className={styles.meta}>
                  {year && <span>{year}</span>}
                  {year && genre && <span className={styles.metaSep} />}
                  {genre && <span>{genre}</span>}
                </div>

                {(pct != null || rating || runtime) && (
                  <div className={styles.ratingRow}>
                    {pct != null ? (
                      <>
                        <span className={styles.tmdbBadge}>TMDb</span>
                        <span className={styles.ratingPct}>{pct}%</span>
                      </>
                    ) : rating ? (
                      <span className={styles.starBadge}>★ {rating}</span>
                    ) : null}
                    {(pct != null || rating) && runtime && <span className={styles.dotSep} />}
                    {runtime && <span className={styles.runtime}>{runtime}</span>}
                  </div>
                )}

                <div className={styles.actions}>
                  <Focusable
                    className={styles.playBtn}
                    focusKey={DETAIL_PLAY_FOCUS_KEY}
                    onEnter={handlePlay}
                    onClick={handlePlay}
                  >
                    <PlayIcon />
                    {t('detail.watch')}
                  </Focusable>
                  <Focusable
                    className={`${styles.favBtn} ${isFavorite('movie', String(movie.stream_id)) ? styles.favActive : ''}`}
                    ariaLabel={isFavorite('movie', String(movie.stream_id)) ? t('common.inList') : t('common.addToList')}
                    onEnter={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                    onClick={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                  >
                    <StarIcon filled={isFavorite('movie', String(movie.stream_id))} />
                  </Focusable>
                </div>

                {synopsis && (
                  <div className={styles.synopsisWrap}>
                    <p className={`${styles.synopsis} ${synopsisOpen ? '' : styles.synopsisClamp}`}>{synopsis}</p>
                    {longSynopsis && (
                      <button type="button" className={styles.moreBtn} onClick={() => setSynopsisOpen((o) => !o)}>
                        {synopsisOpen ? t('detail.less') : t('detail.more')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {watchedInput && (
              <RateBlock input={watchedInput} starsFocusKey="rc-rate-stars" />
            )}

            {showVariants && (
              <div className={styles.versionBlock}>
                <div className={styles.sectionLabel}>{t('detail.version')}</div>
                <div className={styles.versionBtns}>
                  {variants.map((v, i) => (
                    <Focusable
                      key={v.stream_id}
                      className={`${styles.versionBtn} ${selected?.stream_id === v.stream_id ? styles.versionActive : ''}`}
                      onEnter={() => setSelected(v)}
                      onClick={() => setSelected(v)}
                    >
                      {versionLabel(v.name, t('detail.source', { n: i + 1 }))}
                    </Focusable>
                  ))}
                </div>
              </div>
            )}

            {tmdb && tmdb.cast.length > 0 ? (
              <div className={styles.castBlock}>
                <div className={styles.sectionLabel}>{t('detail.casting')}</div>
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
                  <div className={styles.sectionLabel}>{t('detail.casting')}</div>
                  <div className={styles.castGrid}>
                    {xtreamCast.map((name) => (
                      <Focusable key={name} className={styles.castRow} ariaLabel={name}>
                        <div className={styles.castAvatarPh}>
                          {name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
                        </div>
                        <span className={styles.castName}>{name}</span>
                        <span className={styles.castRole}>{t('detail.actor')}</span>
                      </Focusable>
                    ))}
                  </div>
                </div>
              )
            )}

            <aside className={styles.side}>
              <button
                type="button"
                className={`${styles.sideHead} ${aboutOpen ? styles.sideHeadOpen : ''}`}
                onClick={() => setAboutOpen((o) => !o)}
                aria-expanded={aboutOpen}
              >
                <h4 className={styles.sideTitle}>{t('detail.about')}</h4>
                <span className={styles.sideChev}><ChevDown /></span>
              </button>
              <div className={`${styles.sideBody} ${aboutOpen ? styles.sideBodyOpen : ''}`}>
              {genre && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.genre')}</span>
                  <span className={styles.factVal}>{genre}</span>
                </div>
              )}
              {movie.releaseDate && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.release')}</span>
                  <span className={styles.factVal}>{movie.releaseDate}</span>
                </div>
              )}
              {movie.director && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.director')}</span>
                  <span className={styles.factVal}>{movie.director}</span>
                </div>
              )}
              {rating && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.rating')}</span>
                  <span className={styles.factVal}>★ {rating}</span>
                </div>
              )}
              {showVariants && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.versions')}</span>
                  <span className={styles.factVal}>{variants.length}</span>
                </div>
              )}
              <div className={styles.factRow}>
                <span className={styles.factKey}>{t('detail.format')}</span>
                <span className={styles.factVal}>{(selected ?? movie).container_extension?.toUpperCase() || '—'}</span>
              </div>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
