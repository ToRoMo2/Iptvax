import { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import type { SeriesInfo, Episode, PlayerState, SeriesItem } from '../types/xtream.types';
import type { TmdbEnrichment, TmdbEpisodeStills } from '../types/tmdb.types';
import { cleanTitle, extractYear, versionLabel, titleKey, episodeLabel } from '../utils/catalog';
import { splitMeta, isFinishedProgress } from '../utils/ratings';
import { historyGroupKey, resumePosition } from '../utils/history';
import { nextEpisode } from '../utils/episodes';
import { fmtRuntime } from '../utils/format';
import { safeImgUrl } from '../utils/image';
import { RateBlock } from '../components/RateBlock/RateBlock';
import type { WatchedInput } from '../types/ratings.types';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { DetailMedia } from '../components/DetailMedia';
import { Focusable } from '../components/Focusable';
import { AppLogo } from '../components/AppLogo';
import { DETAIL_BACK_FOCUS_KEY, DETAIL_PLAY_FOCUS_KEY } from '../components/RemoteControl';
import styles from './SeriesDetail.module.css';

interface LocationState {
  series?: SeriesItem;
  variants?: SeriesItem[];
}

function ChevDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m6 9 6 6 6-6" /></svg>
  );
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>;
}

function VersionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
    </svg>
  );
}

function CheckIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="m5 12 5 5L20 7" /></svg>;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round">
      <path d="M12 2.6l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 18.6l-5.9 3.1 1.12-6.56L2.45 9.54l6.6-.96z" />
    </svg>
  );
}

export function SeriesDetail() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const { history, addToHistory, isFavorite, toggleFavorite } = useLibrary();
  const { t, tc } = useI18n();

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
  // Accordéon « À propos » (mobile uniquement — desktop l'ignore via CSS).
  const [aboutOpen, setAboutOpen] = useState(false);
  // Synopsis replié par défaut (bouton « Plus / Moins »).
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  // Popup « Choisir une version » (ouverte par « Regarder » si > 1 variante).
  const [showVersions, setShowVersions] = useState(false);
  // Lecture en attente : variante choisie dans la popup dont les épisodes se
  // chargent encore. `'first'` = 1er épisode ; `{season,num}` = épisode précis.
  const pendingPlay = useRef<{ season: number; num: number } | 'first' | null>(null);

  const seriesId = variant?.series_id ?? (id ? parseInt(id) : NaN);

  // Mémorise une intention « ↓ depuis Retour » arrivée pendant le chargement.
  // Appliquée automatiquement dès que le contenu est rendu.
  const downPending = useRef(false);

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

  // Quand le chargement se termine : si l'utilisateur avait déjà appuyé ↓
  // depuis le bouton Retour, le focus atterrit maintenant sur « Lire ».
  useEffect(() => {
    if (!loading && downPending.current) {
      downPending.current = false;
      const tid = setTimeout(() => setFocus(DETAIL_PLAY_FOCUS_KEY), 80);
      return () => clearTimeout(tid);
    }
  }, [loading]);

  const seriesFallback = t('detail.seriesDefault');
  const title = info?.info.name ?? variant?.name ?? seriesMeta?.name ?? seriesFallback;
  const displayTitle = cleanTitle(title);
  const releaseDate = info?.info.releaseDate;
  const year = useMemo(
    () => extractYear(title) ?? (releaseDate ? releaseDate.slice(0, 4) : undefined),
    [title, releaseDate],
  );

  // Enrichissement TMDB (image paysage / casting / note / synopsis).
  useEffect(() => {
    setTmdb(null);
    if (!tmdbService.isEnabled() || displayTitle === seriesFallback) return;
    let alive = true;
    tmdbService.enrichSeries(displayTitle, year).then((res) => {
      if (alive) setTmdb(res);
    });
    return () => { alive = false; };
  }, [displayTitle, year, seriesFallback]);

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
    const epLabel = episodeLabel(episode.title, displayTitle, t('detail.episodeN', { n: episode.episode_num }));
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
      // Contexte pour le panneau « Épisodes » du lecteur — Player re-fetch
      // la SeriesInfo + stills TMDB à partir de seriesId. tmdbId propagé si
      // déjà résolu ici (chemin rapide pour les stills).
      seriesContext: {
        seriesId,
        title: displayTitle,
        currentSeason: episode.season,
        currentEpisodeNum: episode.episode_num,
        tmdbId: tmdb?.tmdbId,
      },
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

  const findEpisode = (data: SeriesInfo, season: number, num: number): Episode | undefined =>
    Object.values(data.episodes).flat().find((e) => e.season === season && e.episode_num === num);

  const playFirstOf = (data: SeriesInfo) => {
    const fs = Object.keys(data.episodes).sort((a, b) => Number(a) - Number(b))[0];
    const first = fs ? data.episodes[fs]?.[0] : undefined;
    if (first) handlePlayEpisode(first);
  };

  // Lit la cible voulue dans une SeriesInfo chargée (1er épisode, ou un épisode
  // précis — repli sur le 1er si la source ne l'a pas).
  const playTarget = (data: SeriesInfo, target: { season: number; num: number } | 'first') => {
    if (target === 'first') { playFirstOf(data); return; }
    const ep = findEpisode(data, target.season, target.num);
    if (ep) handlePlayEpisode(ep);
    else playFirstOf(data);
  };

  const handlePlayFirst = () => {
    const first = episodes[0];
    if (first) handlePlayEpisode(first);
  };

  // « Regarder » : > 1 variante → popup de choix ; sinon 1er épisode direct.
  const handleWatch = () => {
    if (variants.length > 1) {
      pendingPlay.current = 'first';
      setShowVersions(true);
    } else handlePlayFirst();
  };

  // Clic sur un épisode : > 1 variante → popup de choix de source (l'épisode
  // visé est rejoué depuis la source choisie) ; sinon lecture directe.
  const handleEpisodeClick = (ep: Episode) => {
    if (variants.length > 1) {
      pendingPlay.current = { season: ep.season, num: ep.episode_num };
      setShowVersions(true);
    } else handlePlayEpisode(ep);
  };

  // Choix d'une variante dans la popup. Même source déjà chargée → lecture
  // immédiate ; sinon on bascule la source et on diffère (cf. effet ci-dessous).
  const playVersion = (v: SeriesItem) => {
    setShowVersions(false);
    const target = pendingPlay.current ?? 'first';
    if (v.series_id === variant?.series_id && info) {
      pendingPlay.current = null;
      playTarget(info, target);
    } else {
      pendingPlay.current = target;
      setVariant(v);
    }
  };

  const seasons = info ? Object.keys(info.episodes).sort((a, b) => Number(a) - Number(b)) : [];
  const episodes: Episode[] = info?.episodes[selectedSeason] ?? [];

  // Progression par épisode → tick « terminé » + barre d'avancement dans la
  // liste. ⚠ Indexé par (saison, n° d'épisode) et NON par `episode-<id>` : les
  // ids d'épisode diffèrent d'une variante/source à l'autre, mais la position
  // S/É est stable → la progression d'une variante (ex. 4K) s'affiche bien sur
  // la liste de la variante affichée.
  const episodeProgress = useMemo(() => {
    const m = new Map<string, number>();
    if (!displayTitle || displayTitle === seriesFallback) return m;
    const gk = `series:${titleKey(displayTitle)}`;
    for (const h of history) {
      if (h.type !== 'series' || historyGroupKey(h) !== gk) continue;
      const sc = h.playerState?.seriesContext;
      if (!sc) continue;
      const key = `${sc.currentSeason}:${sc.currentEpisodeNum}`;
      m.set(key, Math.max(m.get(key) ?? 0, h.progress));
    }
    return m;
  }, [history, displayTitle, seriesFallback]);

  // Lecture différée : la variante choisie dans la popup a fini de charger.
  useEffect(() => {
    if (loading || !pendingPlay.current || !info) return;
    const target = pendingPlay.current;
    pendingPlay.current = null;
    playTarget(info, target);
    // playTarget/handlePlayEpisode recréés à chaque rendu, mais l'effet est
    // gardé par pendingPlay (lecture unique) → deps volontairement minimales.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, info]);

  // Reprise : entrée d'historique de cette série (épisode le plus récemment
  // commencé, toutes sources/variantes confondues — regroupement par titre
  // canonique, cohérent avec historyGroupKey).
  const resumeEntry = useMemo(() => {
    if (!displayTitle || displayTitle === seriesFallback) return undefined;
    const gk = `series:${titleKey(displayTitle)}`;
    return history.find((h) => historyGroupKey(h) === gk);
  }, [history, displayTitle, seriesFallback]);
  // « Reprendre » dès qu'un épisode a été commencé (en cours OU terminé : on
  // enchaîne alors sur le suivant).
  const canResume = !!resumeEntry;

  // Cible de reprise :
  //  - position exploitable (épisode en cours, < seuil terminé) → cet épisode.
  //  - sinon, épisode TERMINÉ (≥ seuil) sans que l'historique ait déjà avancé →
  //    l'épisode SUIVANT (depuis le début).
  //  - sinon (épisode au tout début, p.ex. déjà avancé par le lecteur) → cet
  //    épisode depuis le début.
  // `null` si inconnu.
  const resumeTarget = (): { season: number; num: number } | null => {
    const sc = resumeEntry?.playerState?.seriesContext;
    if (!resumeEntry || !sc) return null;
    if (resumePosition(resumeEntry) != null) {
      return { season: sc.currentSeason, num: sc.currentEpisodeNum };
    }
    if (info && isFinishedProgress(resumeEntry.progress)) {
      const next = nextEpisode(info, sc.currentSeason, sc.currentEpisodeNum);
      if (next) return { season: next.season, num: next.episode_num };
    }
    return { season: sc.currentSeason, num: sc.currentEpisodeNum };
  };

  // « Reprendre » : reprise position de l'épisode en cours (relit son
  // playerState exact → getResume applique position + pistes) ; si l'épisode est
  // terminé, enchaîne sur le suivant depuis le début ; sinon (déjà avancé par le
  // lecteur, position 0) relit l'entrée telle quelle.
  const handleResume = () => {
    if (!resumeEntry) return;
    const sc = resumeEntry.playerState?.seriesContext;
    if (resumePosition(resumeEntry) != null) {
      navigate('/player', { state: resumeEntry.playerState });
      return;
    }
    if (sc && info && isFinishedProgress(resumeEntry.progress)) {
      const next = nextEpisode(info, sc.currentSeason, sc.currentEpisodeNum);
      if (next) { handlePlayEpisode(next); return; }
    }
    navigate('/player', { state: resumeEntry.playerState });
  };

  // Bouton rond « changer de version » (mode Reprendre) : rejoue la cible de
  // reprise (épisode en cours ou suivant) depuis une autre source via la popup.
  const handleChangeVersion = () => {
    pendingPlay.current = resumeTarget() ?? 'first';
    setShowVersions(true);
  };

  // Affiche portrait pour le hero : poster TMDB > cover Xtream. URL BRUTE.
  const heroPoster = useMemo(
    () => safeImgUrl(tmdb?.poster ?? info?.info.cover ?? variant?.cover),
    [tmdb, info, variant],
  );
  const genre = info?.info.genre ?? variant?.genre;
  const ratingRaw = info?.info.rating ?? variant?.rating;
  const ratingNum = tmdb?.rating ?? (ratingRaw && ratingRaw !== '0' ? Number(ratingRaw) : undefined);
  const rating = ratingNum && !Number.isNaN(ratingNum) ? ratingNum.toFixed(1) : undefined;
  const pct = tmdb?.rating ? Math.round(tmdb.rating * 10) : undefined;
  const runtimeRaw = info?.info.episode_run_time ?? variant?.episode_run_time;
  const runtime = fmtRuntime(tmdb?.runtime ?? (runtimeRaw ? Number(runtimeRaw) : undefined));
  const synopsis = tmdb?.overview ?? info?.info.plot;
  const longSynopsis = (synopsis?.length ?? 0) > 150;
  const xtreamCast = (info?.info.cast ?? '')
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean);
  const director = info?.info.director;
  const episodeCount = seasons.reduce((acc, s) => acc + (info?.episodes[s]?.length ?? 0), 0);
  const showVariants = variants.length > 1;

  // Snapshot figé pour le mur « Mon ciné » — série entière (granularité v1).
  // Métadonnées Xtream toujours présentes, TMDB additif si dispo.
  const watchedInput = useMemo<WatchedInput | null>(() => {
    if (Number.isNaN(seriesId)) return null;
    return {
      contentType: 'series',
      contentId: `series-${seriesId}`,
      titleKey: titleKey(title),
      title: displayTitle,
      year: year ? Number(year) : undefined,
      poster: tmdb?.poster ?? info?.info.cover ?? variant?.cover,
      backdrop: tmdb?.backdrop ?? info?.info.backdrop_path?.[0],
      tmdbId: tmdb?.tmdbId,
      genres: splitMeta(genre),
      cast: tmdb?.cast.length
        ? tmdb.cast.map((c) => c.name)
        : splitMeta(info?.info.cast ?? variant?.cast),
      directors: splitMeta(director),
    };
  }, [seriesId, title, displayTitle, year, tmdb, info, variant, genre, director]);

  return (
    <div className={styles.page}>
      {/* Hero — affiche portrait fondue vers le noir */}
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
              if (!loading) {
                setFocus(DETAIL_PLAY_FOCUS_KEY);
              } else {
                downPending.current = true;
              }
              return false;
            }
            return true;
          }}
        >
          {t('common.back')}
        </Focusable>
      </section>

      {/* Body */}
      <div className={styles.body}>
        {loading && (
          <div className={styles.loading}>
            <AppLogo spin size={44} />
          </div>
        )}

        {error && <div className={styles.error}>⚠ {error}</div>}

        {!loading && !error && (
          <div className={styles.grid}>
            <div className={styles.headRow}>
              <div className={styles.headInfo}>
                {tmdb?.logo ? (
                  <img className={styles.titleLogo} src={safeImgUrl(tmdb.logo)} alt={displayTitle} />
                ) : (
                  <h1 className={styles.title}>{displayTitle}</h1>
                )}

                <div className={styles.meta}>
                  {year && <span>{year}</span>}
                  {year && genre && <span className={styles.metaSep} />}
                  {genre && <span>{genre}</span>}
                  {(year || genre) && seasons.length > 0 && <span className={styles.metaSep} />}
                  {seasons.length > 0 && (
                    <span>
                      {tc('detail.seasonsCountOne', 'detail.seasonsCountOther', seasons.length)}
                    </span>
                  )}
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
                    onEnter={canResume ? handleResume : handleWatch}
                    onClick={canResume ? handleResume : handleWatch}
                  >
                    <PlayIcon />
                    {canResume ? t('detail.resume') : t('detail.watch')}
                  </Focusable>
                  {canResume && variants.length > 1 && (
                    <Focusable
                      className={styles.versionRoundBtn}
                      ariaLabel={t('detail.changeVersion')}
                      onEnter={handleChangeVersion}
                      onClick={handleChangeVersion}
                    >
                      <VersionIcon />
                    </Focusable>
                  )}
                  <Focusable
                    className={`${styles.favBtn} ${isFavorite('series', String(seriesId)) ? styles.favActive : ''}`}
                    ariaLabel={isFavorite('series', String(seriesId)) ? t('common.inList') : t('common.addToList')}
                    onEnter={() => toggleFavorite({ type: 'series', id: String(seriesId), name: displayTitle, image: tmdb?.poster ?? info?.info.cover ?? variant?.cover ?? '' })}
                    onClick={() => toggleFavorite({ type: 'series', id: String(seriesId), name: displayTitle, image: tmdb?.poster ?? info?.info.cover ?? variant?.cover ?? '' })}
                  >
                    <StarIcon filled={isFavorite('series', String(seriesId))} />
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

            <DetailMedia
              tmdbCast={tmdb?.cast ?? []}
              xtreamCast={xtreamCast}
              images={tmdb?.backdrops ?? []}
            />

            {/* Seasons / Episodes */}
            <div className={styles.seasonsBlock}>
              <div className={styles.sectionLabel}>{t('detail.episodesTitle')}</div>

              {seasons.length > 1 && (
                <div className={styles.seasons}>
                  {seasons.map((s) => (
                    <Focusable
                      key={s}
                      className={`${styles.seasonBtn} ${selectedSeason === s ? styles.seasonActive : ''}`}
                      onEnter={() => setSelectedSeason(s)}
                      onClick={() => setSelectedSeason(s)}
                    >
                      {t('detail.seasonN', { n: s })}
                    </Focusable>
                  ))}
                </div>
              )}

              <div className={styles.episodeList}>
                {episodes.map((ep) => {
                  const thumb = safeImgUrl(ep.info.movie_image) || safeImgUrl(stills[ep.episode_num]);
                  const epProg = episodeProgress.get(`${ep.season}:${ep.episode_num}`) ?? 0;
                  const epDone = isFinishedProgress(epProg);
                  return (
                    <Focusable
                      key={ep.id}
                      className={styles.episode}
                      onEnter={() => handleEpisodeClick(ep)}
                      onClick={() => handleEpisodeClick(ep)}
                    >
                      <div className={styles.epThumbWrap}>
                        {thumb ? (
                          <img src={thumb} alt={ep.title} loading="lazy" decoding="async" className={styles.epThumb} />
                        ) : (
                          <div className={styles.epThumbPlaceholder}>{ep.episode_num}</div>
                        )}
                        {epDone && <div className={styles.epDone}><CheckIcon /></div>}
                        {!epDone && epProg > 0 && (
                          <div className={styles.epProgress}>
                            <span style={{ width: `${epProg}%` }} />
                          </div>
                        )}
                      </div>
                      <div className={styles.epInfo}>
                        <span className={styles.epNum}>{t('detail.episodeN', { n: ep.episode_num })}</span>
                        <span className={styles.epTitle}>{episodeLabel(ep.title, displayTitle, t('detail.episodeN', { n: ep.episode_num }))}</span>
                        {ep.info.plot && <p className={styles.epPlot}>{ep.info.plot}</p>}
                        {ep.info.duration && <span className={styles.epDuration}>{ep.info.duration}</span>}
                      </div>
                      <div className={styles.epPlay}>▶</div>
                    </Focusable>
                  );
                })}
              </div>
            </div>

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
              {releaseDate && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.release')}</span>
                  <span className={styles.factVal}>{releaseDate}</span>
                </div>
              )}
              {director && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.director')}</span>
                  <span className={styles.factVal}>{director}</span>
                </div>
              )}
              {rating && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.rating')}</span>
                  <span className={styles.factVal}>★ {rating}</span>
                </div>
              )}
              <div className={styles.factRow}>
                <span className={styles.factKey}>{t('detail.seasons')}</span>
                <span className={styles.factVal}>{seasons.length}</span>
              </div>
              {episodeCount > 0 && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.episodesFact')}</span>
                  <span className={styles.factVal}>{episodeCount}</span>
                </div>
              )}
              {showVariants && (
                <div className={styles.factRow}>
                  <span className={styles.factKey}>{t('detail.versions')}</span>
                  <span className={styles.factVal}>{variants.length}</span>
                </div>
              )}
              </div>
            </aside>
          </div>
        )}
      </div>

      {showVersions && (
        <div className={styles.versionModal} onClick={() => setShowVersions(false)} role="dialog" aria-modal="true">
          <div className={styles.versionCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.versionHead}>
              <span className={styles.versionTitle}>{t('detail.chooseVersion')}</span>
              <button className={styles.versionClose} onClick={() => setShowVersions(false)} aria-label={t('common.close')}>✕</button>
            </div>
            <div className={styles.versionOpts}>
              {variants.map((v, i) => (
                <button key={v.series_id} type="button" className={styles.versionOpt} onClick={() => playVersion(v)}>
                  <span>{versionLabel(v.name, t('detail.source', { n: i + 1 }))}</span>
                  <PlayIcon />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
