import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useDownloads } from '../contexts/DownloadsContext';
import { useI18n } from '../contexts/I18nContext';
import type { VodStream, PlayerState } from '../types/xtream.types';
import type { TmdbEnrichment } from '../types/tmdb.types';
import { cleanTitle, extractYear, versionLabel, titleKey, groupByTitle } from '../utils/catalog';
import { splitMeta } from '../utils/ratings';
import { historyGroupKey, resumePosition } from '../utils/history';
import { fmtRuntime } from '../utils/format';
import { safeImgUrl } from '../utils/image';
import { RateBlock } from '../components/RateBlock/RateBlock';
import type { WatchedInput } from '../types/ratings.types';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { DetailMedia } from '../components/DetailMedia';
import { DetailHero } from '../components/DetailHero';
import { DownloadButton } from '../components/DownloadButton';
import { Focusable } from '../components/Focusable';
import type { DownloadRequest } from '../types/download.types';
import { AppLogo } from '../components/AppLogo';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { DETAIL_BACK_FOCUS_KEY, DETAIL_PLAY_FOCUS_KEY } from '../components/RemoteControl';
import styles from './SeriesDetail.module.css';

interface LocationState {
  movie?: VodStream;
  variants?: VodStream[];
  // Posé par la vedette de l'accueil : déclenche « Regarder » au montage (popup
  // de version si plusieurs variantes, sinon lecture directe) → la vedette se
  // comporte comme le bouton « Regarder » de la fiche.
  autoplay?: boolean;
}

function ChevDown() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m6 9 6 6 6-6" /></svg>
  );
}

function PlayIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>;
}

function DownloadGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
    </svg>
  );
}

function VersionIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" />
    </svg>
  );
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
  const { history, addToHistory, isFavorite, toggleFavorite } = useLibrary();
  const { download } = useDownloads();
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
  // Popup « Choisir une version » (ouverte par « Regarder » OU « Télécharger »
  // si > 1 variante). `versionAction` mémorise l'action à exécuter sur le choix.
  const [showVersions, setShowVersions] = useState(false);
  const [versionAction, setVersionAction] = useState<'play' | 'download'>('play');

  // Deep-link / refresh / clic historique / vedette accueil : on (re)trouve le
  // film par id si besoin ET on reconstruit le groupe de variantes (langues /
  // qualités) depuis le catalogue. Sans ça, arriver ici sans `state.variants`
  // (historique, lien direct, vedette) collapse les variantes à une seule → le
  // sélecteur de version disparaît. Le catalogue est mis en cache par
  // `xtreamService` → pas de fetch superflu (Home l'a déjà chargé).
  useEffect(() => {
    if (!credentials || !id) return;
    // Variantes déjà complètes via l'état de navigation → rien à reconstruire.
    if (passed && passedVariants && passedVariants.length > 1) return;
    let alive = true;
    if (!passed) setLoading(true);
    xtreamService
      .getVodStreams(credentials)
      .then((all) => {
        if (!alive) return;
        const found = passed ?? all.find((v) => String(v.stream_id) === id) ?? null;
        if (!found) {
          if (!passed) setError(t('detail.movieNotFound'));
          return;
        }
        const key = titleKey(found.name) || found.name.trim().toLowerCase();
        const group = groupByTitle(all, (v) => v.name, (v) => v.rating_5based ?? 0).find(
          (g) => g.key === key,
        );
        if (!passed) {
          setMovie(found);
          setSelected(found);
        }
        setVariants(group && group.variants.length > 1 ? group.variants : [found]);
      })
      .catch((e: Error) => { if (alive && !passed) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [passed, passedVariants, credentials, id, t]);

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

  // Lance une variante précise (appelée directement, ou via la popup version).
  const playMovie = (target: VodStream) => {
    if (!credentials || !movie) return;
    setSelected(target);
    setShowVersions(false);
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

  // « Regarder » : > 1 variante → popup de choix ; sinon lecture directe.
  const handlePlay = () => {
    if (!movie) return;
    if (variants.length > 1) openVersions('play');
    else playMovie(selected ?? movie);
  };

  // Reprise : entrée d'historique du même film (toutes variantes confondues),
  // assez avancée pour proposer « Reprendre » plutôt que « Regarder ».
  const resumeEntry = useMemo(() => {
    if (!movie) return undefined;
    const gk = `movie:${titleKey(movie.name)}`;
    return history.find((h) => historyGroupKey(h) === gk);
  }, [history, movie]);
  const canResume = !!(resumeEntry && resumePosition(resumeEntry) != null);

  // « Reprendre » : relit la variante exacte de l'historique (position +
  // pistes appliquées par le lecteur via getResume), sans repasser par la popup.
  const handleResume = () => {
    if (resumeEntry) navigate('/player', { state: resumeEntry.playerState });
  };

  // Auto-« Regarder » depuis la vedette de l'accueil : reproduit le bouton de la
  // fiche (popup de version si plusieurs variantes, sinon lecture directe) une
  // seule fois. Le drapeau autoplay est retiré de l'historique de navigation
  // (replace) pour ne pas re-déclencher au retour arrière.
  const autoWatch = (location.state as LocationState)?.autoplay ?? false;
  const autoFiredRef = useRef(false);
  useEffect(() => {
    if (!autoWatch || autoFiredRef.current || !movie) return;
    autoFiredRef.current = true;
    navigate(location.pathname, {
      replace: true,
      state: passed ? { movie: passed, variants } : undefined,
    });
    if (canResume) handleResume();
    else handlePlay();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoWatch, movie, canResume]);

  // Affiche portrait pour le hero : poster TMDB > icône Xtream > backdrop.
  // URL BRUTE (safeImgUrl appliqué au rendu).
  const heroPoster = useMemo(
    () => safeImgUrl(tmdb?.poster ?? movie?.stream_icon ?? movie?.backdrop_path?.[0]),
    [tmdb, movie],
  );
  // Backdrop paysage (16:9) pour le hero DESKTOP. Repli sur l'affiche si absent
  // (sur grand écran elle est étirée/assombrie en fond derrière la carte
  // flottante). Inutilisé en dessous de 901px (masqué par CSS). URL BRUTE.
  const heroBackdrop = useMemo(
    () => safeImgUrl(tmdb?.backdrop ?? movie?.backdrop_path?.[0] ?? tmdb?.poster ?? movie?.stream_icon),
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

  // Descripteur de téléchargement d'une variante précise (fichier direct
  // UPSTREAM complet → mpv / ExoPlayer choisira audio/sous-titres à la lecture
  // hors-ligne). Premium-only / Android & Windows : géré par <DownloadButton>.
  const makeDownloadRequest = useCallback(
    (target: VodStream): Omit<DownloadRequest, 'profileId'> | null => {
      if (!credentials || !movie) return null;
      const landscape = tmdb?.backdrop ?? movie.backdrop_path?.[0] ?? tmdb?.poster ?? target.stream_icon;
      return {
        id: `movie-${target.stream_id}`,
        type: 'movie',
        title: displayTitle,
        subtitle: year ?? t('detail.film'),
        poster: landscape ?? '',
        sourceUrl: xtreamService.rawMovieUrl(credentials, target.stream_id, target.container_extension),
        ext: target.container_extension,
        durationSec: tmdb?.runtime ? tmdb.runtime * 60 : undefined,
      };
    },
    [credentials, movie, displayTitle, year, tmdb, t],
  );

  // Descripteur de la version COURANTE (= celle que « Regarder » lirait) →
  // état affiché par le bouton + téléchargement direct quand mono-variante.
  const downloadRequest = useMemo(
    () => (movie ? makeDownloadRequest(selected ?? movie) : null),
    [movie, selected, makeDownloadRequest],
  );

  // Ouvre la popup de versions pour l'action voulue (lecture ou téléchargement).
  const openVersions = (action: 'play' | 'download') => {
    setVersionAction(action);
    setShowVersions(true);
  };

  // Télécharge UNIQUEMENT la version choisie dans la popup (et la mémorise comme
  // version courante → le bouton reflète ensuite sa progression).
  const downloadMovie = (target: VodStream) => {
    setSelected(target);
    setShowVersions(false);
    setVersionAction('play');
    const req = makeDownloadRequest(target);
    if (req) void download(req);
  };

  // Clic sur une version dans la popup : route vers lecture ou téléchargement.
  const chooseVersion = (v: VodStream) => {
    if (versionAction === 'download') downloadMovie(v);
    else playMovie(v);
  };

  // Clic « Télécharger » du bouton : > 1 variante → popup ; sinon géré par le
  // bouton lui-même (téléchargement direct de la version courante).
  const handleDownloadClick = variants.length > 1 ? () => openVersions('download') : undefined;

  // ── Desktop (≥901px) : refonte « fond plein écran » (§Phase 4). Mobile garde
  //    l'affiche portrait (rendu inchangé plus bas). ──────────────────────────
  const isDesktop = useMediaQuery('(min-width: 901px)');
  const belowRef = useRef<HTMLDivElement>(null);
  const scrollDown = () => belowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Diaporama de fond : toutes les images TMDB ; repli sur le backdrop unique.
  const diaporamaImgs =
    tmdb?.backdrops && tmdb.backdrops.length > 0
      ? tmdb.backdrops
      : [tmdb?.backdrop ?? movie?.backdrop_path?.[0] ?? movie?.stream_icon].filter(
          (x): x is string => !!x,
        );

  const versionModalNode = showVersions && movie && (
    <div className={styles.versionModal} onClick={() => setShowVersions(false)} role="dialog" aria-modal="true">
      <div className={styles.versionCard} onClick={(e) => e.stopPropagation()}>
        <div className={styles.versionHead}>
          <span className={styles.versionTitle}>{versionAction === 'download' ? t('detail.chooseVersionDownload') : t('detail.chooseVersion')}</span>
          <button className={styles.versionClose} onClick={() => setShowVersions(false)} aria-label={t('common.close')}>✕</button>
        </div>
        <div className={styles.versionOpts}>
          {variants.map((v, i) => (
            <button key={v.stream_id} type="button" className={styles.versionOpt} onClick={() => chooseVersion(v)}>
              <span>{versionLabel(v.name, t('detail.source', { n: i + 1 }))}</span>
              {versionAction === 'download' ? <DownloadGlyph /> : <PlayIcon />}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <div className={`${styles.page} ${styles.pageDesktop}`}>
        {loading && <div className={styles.loadingFull}><AppLogo spin size={44} /></div>}
        {error && <div className={styles.error}>⚠ {error}</div>}
        {!loading && !error && movie && (
          <>
            <DetailHero
              backdrops={diaporamaImgs}
              logo={tmdb?.logo}
              title={displayTitle}
              meta={
                <>
                  {year && <span>{year}</span>}
                  {year && genre && <span className={styles.metaSep} />}
                  {genre && <span>{genre}</span>}
                </>
              }
              ratingRow={
                pct != null || rating || runtime ? (
                  <>
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
                  </>
                ) : undefined
              }
              synopsis={synopsis ?? undefined}
              actions={
                <>
                  <Focusable
                    className={styles.playBtn}
                    focusKey={DETAIL_PLAY_FOCUS_KEY}
                    onEnter={canResume ? handleResume : handlePlay}
                    onClick={canResume ? handleResume : handlePlay}
                  >
                    <PlayIcon />
                    {canResume ? t('detail.resume') : t('detail.watch')}
                  </Focusable>
                  {canResume && variants.length > 1 && (
                    <Focusable
                      className={styles.versionRoundBtn}
                      ariaLabel={t('detail.changeVersion')}
                      onEnter={() => openVersions('play')}
                      onClick={() => openVersions('play')}
                    >
                      <VersionIcon />
                    </Focusable>
                  )}
                  <Focusable
                    className={`${styles.favBtn} ${isFavorite('movie', String(movie.stream_id)) ? styles.favActive : ''}`}
                    ariaLabel={isFavorite('movie', String(movie.stream_id)) ? t('common.inList') : t('common.addToList')}
                    onEnter={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                    onClick={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                  >
                    <StarIcon filled={isFavorite('movie', String(movie.stream_id))} />
                  </Focusable>
                  {downloadRequest && <DownloadButton request={downloadRequest} onRequestDownload={handleDownloadClick} compact />}
                </>
              }
              rateInput={watchedInput}
              starsFocusKey="rc-rate-stars"
              onBack={() => navigate(-1)}
              backFocusKey={DETAIL_BACK_FOCUS_KEY}
              onBackArrowDown={() => setFocus(DETAIL_PLAY_FOCUS_KEY)}
              onScrollDown={scrollDown}
              showScrollCue
            />

            <div ref={belowRef} className={styles.belowFold}>
              <DetailMedia tmdbCast={tmdb?.cast ?? []} xtreamCast={xtreamCast} />
              <aside className={styles.aboutDesktop}>
                <div className={styles.sectionLabel}>{t('detail.about')}</div>
                <div className={styles.factsGrid}>
                  {genre && (
                    <div className={styles.factRow}><span className={styles.factKey}>{t('detail.genre')}</span><span className={styles.factVal}>{genre}</span></div>
                  )}
                  {movie.releaseDate && (
                    <div className={styles.factRow}><span className={styles.factKey}>{t('detail.release')}</span><span className={styles.factVal}>{movie.releaseDate}</span></div>
                  )}
                  {movie.director && (
                    <div className={styles.factRow}><span className={styles.factKey}>{t('detail.director')}</span><span className={styles.factVal}>{movie.director}</span></div>
                  )}
                  {rating && (
                    <div className={styles.factRow}><span className={styles.factKey}>{t('detail.rating')}</span><span className={styles.factVal}>★ {rating}</span></div>
                  )}
                  {showVariants && (
                    <div className={styles.factRow}><span className={styles.factKey}>{t('detail.versions')}</span><span className={styles.factVal}>{variants.length}</span></div>
                  )}
                  <div className={styles.factRow}><span className={styles.factKey}>{t('detail.format')}</span><span className={styles.factVal}>{(selected ?? movie).container_extension?.toUpperCase() || '—'}</span></div>
                </div>
              </aside>
            </div>
          </>
        )}
        {versionModalNode}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        {/* Desktop (≥901px) : backdrop paysage en fond (masqué en deçà). */}
        {heroBackdrop && (
          <img className={styles.heroBackdrop} src={heroBackdrop} alt="" aria-hidden="true" decoding="async" />
        )}
        {/* Mobile / tablette : affiche portrait plein cadre. */}
        {heroPoster ? (
          <img className={styles.heroPoster} src={heroPoster} alt={displayTitle} decoding="async" />
        ) : (
          <div className={`${styles.art} ${styles.artPlaceholder}`}>
            <span className={styles.artTag}>// POSTER · 2:3</span>
          </div>
        )}
        <div className={styles.overlayLeft} />
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
              {/* Carte affiche flottante — desktop uniquement (CSS). */}
              {heroPoster && (
                <img className={styles.posterFloat} src={heroPoster} alt={displayTitle} decoding="async" />
              )}
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
                    onEnter={canResume ? handleResume : handlePlay}
                    onClick={canResume ? handleResume : handlePlay}
                  >
                    <PlayIcon />
                    {canResume ? t('detail.resume') : t('detail.watch')}
                  </Focusable>
                  {canResume && variants.length > 1 && (
                    <Focusable
                      className={styles.versionRoundBtn}
                      ariaLabel={t('detail.changeVersion')}
                      onEnter={() => openVersions('play')}
                      onClick={() => openVersions('play')}
                    >
                      <VersionIcon />
                    </Focusable>
                  )}
                  <Focusable
                    className={`${styles.favBtn} ${isFavorite('movie', String(movie.stream_id)) ? styles.favActive : ''}`}
                    ariaLabel={isFavorite('movie', String(movie.stream_id)) ? t('common.inList') : t('common.addToList')}
                    onEnter={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                    onClick={() => toggleFavorite({ type: 'movie', id: String(movie.stream_id), name: displayTitle, image: tmdb?.poster ?? movie.stream_icon ?? '' })}
                  >
                    <StarIcon filled={isFavorite('movie', String(movie.stream_id))} />
                  </Focusable>
                  {downloadRequest && <DownloadButton request={downloadRequest} onRequestDownload={handleDownloadClick} compact />}
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
            />

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

      {showVersions && movie && (
        <div className={styles.versionModal} onClick={() => setShowVersions(false)} role="dialog" aria-modal="true">
          <div className={styles.versionCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.versionHead}>
              <span className={styles.versionTitle}>{versionAction === 'download' ? t('detail.chooseVersionDownload') : t('detail.chooseVersion')}</span>
              <button className={styles.versionClose} onClick={() => setShowVersions(false)} aria-label={t('common.close')}>✕</button>
            </div>
            <div className={styles.versionOpts}>
              {variants.map((v, i) => (
                <button key={v.stream_id} type="button" className={styles.versionOpt} onClick={() => chooseVersion(v)}>
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
