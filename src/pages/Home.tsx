import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { PreviewCard } from '../components/PreviewCard';
import { Focusable } from '../components/Focusable';
import { HERO_FOCUS_KEY } from '../components/RemoteControl';
import type { WatchHistoryItem } from '../types/library.types';
import type { LiveStream, VodStream, SeriesItem } from '../types/xtream.types';
import type { PlayerState } from '../types/xtream.types';
import type { TmdbTrendingItem } from '../types/tmdb.types';
import { groupByTitle, cleanTitle, titleKey, type TitleGroup } from '../utils/catalog';
import { safeImgUrl } from '../utils/image';
import styles from './Home.module.css';

// ── Inline SVG icons ──────────────────────────────────────────────────────────
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>
  );
}
function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="17" height="17"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
  );
}
function FilmIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 12h18M3 7.5h4M3 16.5h4M17 7.5h4M17 16.5h4"/></svg>
  );
}
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="m9 18 6-6-6-6"/></svg>
  );
}

// ── Hero slide type ────────────────────────────────────────────────────────────
interface HeroSlide {
  id: string;
  title: string;
  genre: string;
  rating: string;
  description: string;
  eyebrow: string;
  bgImage?: string;
  artTag: string;
  playerState: PlayerState;
}

// ── Striped poster/thumb placeholder ───────────────────────────────────────────
function ArtPlaceholder({ tag, name }: { tag: string; name?: string }) {
  return (
    <div className={styles.artPlaceholder}>
      <span className={styles.phTag}>// {tag}</span>
      <div className={styles.phMark}>
        <FilmIcon />
        <span className={styles.phMarkLabel}>IMG</span>
      </div>
      {name && <div className={styles.phName}>{name}</div>}
    </div>
  );
}

function ChannelPlaceholder({ code }: { code: string }) {
  return (
    <div className={styles.artPlaceholder}>
      <span className={styles.phTag}>// LIVE FEED</span>
      <div className={styles.phChannelCode}>
        <span className={styles.phChannelStripe} />
        <span>{code}</span>
      </div>
    </div>
  );
}

// ── Row skeleton ───────────────────────────────────────────────────────────────
function RowSkeleton({ type }: { type: 'cw' | 'channel' | 'poster' }) {
  const cls = type === 'cw' ? styles.skCw : type === 'channel' ? styles.skChannel : styles.skPoster;
  return (
    <div className={styles.rowRail}>
      {Array.from({ length: type === 'poster' ? 8 : 6 }).map((_, i) => (
        <div key={i} className={`${styles.skBase} ${cls}`} />
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export function Home() {
  const { credentials } = useXtream();
  const { history } = useLibrary();
  const navigate = useNavigate();

  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [heroLoading, setHeroLoading] = useState(true);

  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [movies, setMovies] = useState<TitleGroup<VodStream>[]>([]);
  const [series, setSeries] = useState<TitleGroup<SeriesItem>[]>([]);

  const [loadingLive, setLoadingLive] = useState(true);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingSeries, setLoadingSeries] = useState(true);

  // Backdrop paysage TMDB par item d'historique, résolu au rendu → corrige
  // rétroactivement les anciennes entrées « Reprendre » stockées en poster
  // portrait (pas de migration BDD). id historique → URL brute.
  const [cwBackdrops, setCwBackdrops] = useState<Record<string, string>>({});

  // Note TMDB (sur 10) par titleKey → remplace le rating Xtream sur les cartes.
  const [tmdbRatings, setTmdbRatings] = useState<Record<string, number>>({});

  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const heroLenRef = useRef(0);

  // Catalogue dédupliqué COMPLET (pour matcher les tendances TMDB) + tendances.
  const movieGroupsRef = useRef<TitleGroup<VodStream>[]>([]);
  const seriesGroupsRef = useRef<TitleGroup<SeriesItem>[]>([]);
  const trendingRef = useRef<{ movies: TmdbTrendingItem[]; series: TmdbTrendingItem[] } | null>(null);
  const trendingDone = useRef(false);

  // ── Auto-advance hero ────────────────────────────────────────────────────
  const startHeroTimer = useCallback(() => {
    if (heroTimer.current) clearInterval(heroTimer.current);
    heroTimer.current = setInterval(() => {
      setHeroIdx((i) => (i + 1) % Math.max(heroLenRef.current, 1));
    }, 7000);
  }, []);

  useEffect(() => {
    startHeroTimer();
    return () => { if (heroTimer.current) clearInterval(heroTimer.current); };
  }, [startHeroTimer]);

  const goToSlide = (i: number) => {
    setHeroIdx(i);
    startHeroTimer();
  };

  const stepSlide = (dir: 1 | -1) => {
    setHeroIdx((i) => {
      const n = Math.max(heroLenRef.current, 1);
      return (i + dir + n) % n;
    });
    startHeroTimer();
  };

  // ── Compose rows : tendances TMDB → Films populaires + Séries tendances ──
  // Appelé quand catalog ET trending sont prêts. Threshold de 6 matches requis
  // pour remplacer le fallback Xtream (évite des lignes quasi-vides).
  const composeRows = useCallback(() => {
    const trending = trendingRef.current;
    if (!trending) return;
    const movieGroups = movieGroupsRef.current;
    const seriesGroups = seriesGroupsRef.current;

    const mMap = new Map(movieGroups.map((g) => [g.key, g] as const));
    const matchedMovies: TitleGroup<VodStream>[] = [];
    for (const t of trending.movies) {
      const g = mMap.get(titleKey(t.title));
      if (g) matchedMovies.push(g);
      if (matchedMovies.length >= 18) break;
    }
    if (matchedMovies.length >= 6) setMovies(matchedMovies);

    const sMap = new Map(seriesGroups.map((g) => [g.key, g] as const));
    const matchedSeries: TitleGroup<SeriesItem>[] = [];
    for (const t of trending.series) {
      const g = sMap.get(titleKey(t.title));
      if (g) matchedSeries.push(g);
      if (matchedSeries.length >= 18) break;
    }
    if (matchedSeries.length >= 6) setSeries(matchedSeries);
  }, []);

  // ── Compose hero : tendances TMDB filtrées au catalogue (sinon top note) ──
  // Appelé quand chaque source (films, séries, tendances) est prête ; la
  // dernière à arriver produit le hero « Tendance ». Repli garanti non vide.
  const composeHero = useCallback(() => {
    if (!credentials) return;
    const movieGroups = movieGroupsRef.current;
    const seriesGroups = seriesGroupsRef.current;
    if (movieGroups.length === 0 && seriesGroups.length === 0) return;

    const mMap = new Map(movieGroups.map((g) => [g.key, g] as const));
    const sMap = new Map(seriesGroups.map((g) => [g.key, g] as const));
    const trending = trendingRef.current;
    const slides: HeroSlide[] = [];

    if (trending) {
      const movieSlides: HeroSlide[] = [];
      for (const t of trending.movies) {
        const g = mMap.get(titleKey(t.title));
        if (!g) continue;
        const m = g.primary;
        movieSlides.push({
          id: String(m.stream_id),
          title: g.title,
          genre: m.genre ?? 'Film',
          rating: t.rating?.toFixed(1) ?? (m.rating || '—'),
          description: t.overview ?? m.plot ?? '',
          eyebrow: 'Tendance · Film',
          bgImage: t.backdrop ?? m.backdrop_path?.[0] ?? m.stream_icon,
          artTag: 'BACKDROP · 16:9',
          playerState: {
            url: xtreamService.getVodStreamUrl(credentials, m.stream_id, m.container_extension),
            fallbackUrl: xtreamService.getVodDirectUrl(credentials, m.stream_id, m.container_extension),
            title: g.title,
            type: 'movie',
            poster: m.stream_icon,
            description: t.overview ?? m.plot,
          },
        });
        if (movieSlides.length >= 4) break;
      }
      const seriesSlides: HeroSlide[] = [];
      for (const t of trending.series) {
        const g = sMap.get(titleKey(t.title));
        if (!g) continue;
        const s = g.primary;
        seriesSlides.push({
          id: `s${s.series_id}`,
          title: g.title,
          genre: s.genre ?? 'Série',
          rating: t.rating?.toFixed(1) ?? (s.rating || '—'),
          description: t.overview ?? s.plot ?? '',
          eyebrow: 'Tendance · Série',
          bgImage: t.backdrop ?? s.cover,
          artTag: 'BACKDROP · 16:9',
          playerState: { url: '', title: g.title, type: 'episode', poster: s.cover, description: t.overview ?? s.plot },
        });
        if (seriesSlides.length >= 3) break;
      }
      const n = Math.max(movieSlides.length, seriesSlides.length);
      for (let i = 0; i < n; i++) {
        if (movieSlides[i]) slides.push(movieSlides[i]);
        if (seriesSlides[i]) slides.push(seriesSlides[i]);
      }
    }

    // Repli : pas de tendance matchée → top note (le hero n'est jamais vide).
    if (slides.length === 0) {
      const topMovies = [...movieGroups]
        .sort((a, b) => (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0))
        .slice(0, 3);
      for (const g of topMovies) {
        const m = g.primary;
        slides.push({
          id: String(m.stream_id),
          title: g.title,
          genre: m.genre ?? 'Film',
          rating: m.rating || (m.rating_5based ? (m.rating_5based * 2).toFixed(1) : '—'),
          description: m.plot ?? '',
          eyebrow: 'Film · À la une',
          bgImage: m.backdrop_path?.[0] ?? m.stream_icon,
          artTag: 'BACKDROP · 16:9',
          playerState: {
            url: xtreamService.getVodStreamUrl(credentials, m.stream_id, m.container_extension),
            fallbackUrl: xtreamService.getVodDirectUrl(credentials, m.stream_id, m.container_extension),
            title: g.title,
            type: 'movie',
            poster: m.stream_icon,
            description: m.plot,
          },
        });
      }
    }

    // Repli ultime : catalogue sans films → top séries (hero jamais vide).
    if (slides.length === 0) {
      const topSeries = [...seriesGroups]
        .sort((a, b) => (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0))
        .slice(0, 3);
      for (const g of topSeries) {
        const s = g.primary;
        slides.push({
          id: `s${s.series_id}`,
          title: g.title,
          genre: s.genre ?? 'Série',
          rating: s.rating || '—',
          description: s.plot ?? '',
          eyebrow: 'Série · À la une',
          bgImage: s.cover,
          artTag: 'BACKDROP · 16:9',
          playerState: { url: '', title: g.title, type: 'episode', poster: s.cover, description: s.plot },
        });
      }
    }

    if (slides.length === 0) return;
    const final = slides.slice(0, 6);
    heroLenRef.current = final.length;
    setHeroSlides(final);
    setHeroIdx(0);
    setHeroLoading(false);
    startHeroTimer();
  }, [credentials, startHeroTimer]);

  // ── Fetch live streams ───────────────────────────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    setLoadingLive(true);
    xtreamService
      .getLiveStreams(credentials)
      .then((all) => setLiveStreams(all.slice(0, 18)))
      .catch(() => {})
      .finally(() => setLoadingLive(false));
  }, [credentials]);

  // ── Fetch movies ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    setLoadingMovies(true);
    xtreamService
      .getVodStreams(credentials)
      .then((all) => {
        const grouped = groupByTitle(all, (v) => v.name, (v) => v.rating_5based ?? 0)
          .sort((a, b) => (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0));
        movieGroupsRef.current = grouped;
        setMovies(grouped.slice(0, 18));
        composeHero();
        composeRows();
      })
      .catch(() => {
        setHeroLoading(false);
      })
      .finally(() => setLoadingMovies(false));
  }, [credentials, composeHero, composeRows]);

  // ── Fetch series ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    setLoadingSeries(true);
    xtreamService
      .getSeries(credentials)
      .then((all) => {
        const grouped = groupByTitle(all, (s) => s.name, (s) => s.rating_5based ?? 0)
          .sort((a, b) => (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0));
        seriesGroupsRef.current = grouped;
        setSeries(grouped.slice(0, 18));
        composeHero();
        composeRows();
      })
      .catch(() => {})
      .finally(() => setLoadingSeries(false));
  }, [credentials, composeHero, composeRows]);

  // ── Fetch tendances TMDB (films + séries de la semaine) ──────────────────
  useEffect(() => {
    if (trendingDone.current || !tmdbService.isEnabled()) return;
    trendingDone.current = true;
    Promise.all([tmdbService.getTrending('movie'), tmdbService.getTrending('tv')])
      .then(([movies_, series_]) => {
        trendingRef.current = { movies: movies_, series: series_ };
        // Construire la map de ratings TMDB pour les cartes (score /10).
        const ratings: Record<string, number> = {};
        for (const t of movies_) if (t.rating) ratings[titleKey(t.title)] = t.rating;
        for (const t of series_) if (t.rating) ratings[titleKey(t.title)] = t.rating;
        setTmdbRatings(ratings);
        composeHero();
        composeRows();
      })
      .catch(() => { trendingDone.current = false; });
  }, [composeHero, composeRows]);

  // ── Reprendre : backdrop paysage TMDB (corrige les anciennes vignettes) ──
  const cwRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!tmdbService.isEnabled() || history.length === 0) return;
    let alive = true;
    history.forEach((item) => {
      if (item.type === 'live' || cwRequestedRef.current.has(item.id)) return;
      cwRequestedRef.current.add(item.id);
      // Épisode : le titre est "Série – Épisode X" → on requête la série.
      const base = item.type === 'series' ? item.title.split(' – ')[0] : item.title;
      const q = cleanTitle(base);
      if (!q) return;
      const p =
        item.type === 'series'
          ? tmdbService.enrichSeries(q)
          : tmdbService.enrichMovie(q);
      p.then((res) => {
        if (alive && res?.backdrop) {
          setCwBackdrops((prev) => ({ ...prev, [item.id]: res.backdrop! }));
        }
      });
    });
    return () => { alive = false; };
  }, [history]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  // Un clic sur un film ouvre sa fiche détail (design Vanta) ; la lecture est
  // lancée depuis cette page.
  const openMovie = (g: TitleGroup<VodStream>) => {
    navigate(`/movie/${g.primary.stream_id}`, { state: { movie: g.primary, variants: g.variants } });
  };

  const openSeries = (g: TitleGroup<SeriesItem>) => {
    navigate(`/series/${g.primary.series_id}`, { state: { series: g.primary, variants: g.variants } });
  };

  // Flèche haut depuis un rail haut (Reprendre / Live) → boutons du hero,
  // quelle que soit la carte (la géométrie n'y menait que depuis la gauche).
  const upToHero = (direction: string): boolean => {
    if (direction === 'up') {
      setFocus(HERO_FOCUS_KEY);
      return false;
    }
    return true;
  };

  const playLive = (s: LiveStream) => {
    if (!credentials) return;
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, s.stream_id),
      title: s.name,
      type: 'live',
      poster: s.stream_icon,
    };
    navigate('/player', { state });
  };

  const playHistory = (item: WatchHistoryItem) => {
    navigate('/player', { state: item.playerState });
  };

  const playHero = (slide: HeroSlide) => {
    if (slide.playerState.url) {
      navigate('/player', { state: slide.playerState });
    } else {
      // Série en vedette → fiche détail (choix épisode + sélecteur version).
      navigate(`/series/${slide.id.replace(/^s/, '')}`);
    }
  };

  // « Plus d'infos » : ouvre la fiche détail du contenu en vedette.
  const infoHero = (slide: HeroSlide) => {
    if (slide.playerState.type === 'episode') {
      navigate(`/series/${slide.id.replace(/^s/, '')}`);
    } else {
      navigate(`/movie/${slide.id}`);
    }
  };

  const initials = (name: string) =>
    name.replace(/[^A-Za-z0-9]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '••';

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ── Hero ── */}
      {heroLoading ? (
        <div className={styles.heroSkeleton} />
      ) : (
        <div className={styles.hero}>
          {heroSlides.map((slide, i) => (
            <div
              key={slide.id}
              className={`${styles.heroSlide} ${i === heroIdx ? styles.heroSlideActive : ''}`}
            >
              {/* Background */}
              <div className={styles.heroArt}>
                <span className={styles.heroArtTag}>// {slide.artTag}</span>
              </div>
              {safeImgUrl(slide.bgImage) && (
                <img
                  src={safeImgUrl(slide.bgImage)}
                  alt=""
                  className={styles.heroBg}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className={styles.heroOverlayBottom} />
              <div className={styles.heroOverlayLeft} />

              {/* Content */}
              <div className={styles.heroContent}>
                <div className={styles.heroEyebrow}>
                  <span className={styles.heroEyebrowDot} />
                  {slide.eyebrow}
                </div>
                <h1 className={styles.heroTitle}>{slide.title}</h1>
                <div className={styles.heroMeta}>
                  {slide.rating && slide.rating !== '—' && (
                    <>
                      <span className={styles.heroRating}>★ {slide.rating}</span>
                      <span className={styles.heroMetaDivider} />
                    </>
                  )}
                  <span className={styles.heroMetaItem}>{slide.genre}</span>
                  <span className={styles.heroMetaDivider} />
                  <span className={styles.heroTag}>HD</span>
                </div>
                {slide.description && (
                  <p className={styles.heroDesc}>{slide.description}</p>
                )}
                <div className={styles.heroActions}>
                  <Focusable
                    className={styles.heroPlayBtn}
                    focusedClassName="rc-focused"
                    focusKey={i === heroIdx ? HERO_FOCUS_KEY : undefined}
                    disabled={i !== heroIdx}
                    scrollHint="top"
                    onEnter={() => playHero(slide)}
                    onClick={() => playHero(slide)}
                  >
                    <PlayIcon /> Regarder
                  </Focusable>
                  <Focusable
                    className={styles.heroInfoBtn}
                    focusedClassName="rc-focused"
                    disabled={i !== heroIdx}
                    scrollHint="top"
                    onEnter={() => infoHero(slide)}
                    onClick={() => infoHero(slide)}
                  >
                    <InfoIcon /> Plus d'infos
                  </Focusable>
                </div>
              </div>
            </div>
          ))}

          {/* Flèches de navigation */}
          {heroSlides.length > 1 && (
            <>
              <button
                className={`${styles.heroNav} ${styles.heroNavPrev}`}
                onClick={() => stepSlide(-1)}
                aria-label="Slide précédent"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m15 18-6-6 6-6"/></svg>
              </button>
              <button
                className={`${styles.heroNav} ${styles.heroNavNext}`}
                onClick={() => stepSlide(1)}
                aria-label="Slide suivant"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </>
          )}

          {/* Rail indicator */}
          {heroSlides.length > 1 && (
            <div className={styles.heroDots}>
              {heroSlides.map((_, i) => (
                <button
                  key={i}
                  className={`${styles.heroDot} ${i === heroIdx ? styles.heroDotActive : ''}`}
                  onClick={() => goToSlide(i)}
                  aria-label={`Slide ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Rows ── */}
      <div className={styles.rows}>

        {/* Continue Watching */}
        {history.length > 0 && (
          <div className={styles.row}>
            <div className={styles.rowHeader}>
              <span className={styles.rowTitle}>Reprendre</span>
            </div>
            <div className={styles.rowRail}>
              {history.map((item) => {
                const thumb = safeImgUrl(cwBackdrops[item.id] ?? item.image);
                return (
                <Focusable
                  key={item.id}
                  className={`${styles.card} ${styles.cardWide}`}
                  focusedClassName={styles.cardFocused}
                  onClick={() => playHistory(item)}
                  onEnter={() => playHistory(item)}
                  onArrow={upToHero}
                >
                  <div className={styles.artWide}>
                    {thumb ? (
                      <img
                        src={thumb}
                        alt={item.title}
                        className={styles.artImg}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ArtPlaceholder tag="THUMBNAIL · 16:9" name={item.title} />
                    )}
                    <div className={styles.cwOverlay}>
                      <div className={styles.cwPlayBtn}>
                        <PlayIcon />
                      </div>
                    </div>
                    <div className={styles.cwProgress}>
                      <span className={styles.cwProgressBar} style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                  <div className={styles.cardLabel}>
                    <div className={styles.cardName}>{item.title}</div>
                    <div className={styles.cardMeta}>{item.subtitle}</div>
                  </div>
                </Focusable>
                );
              })}
            </div>
          </div>
        )}

        {/* Live Now */}
        <div className={styles.row}>
          <div className={styles.rowHeader}>
            <span className={styles.rowTitle}>Live maintenant</span>
            <button className={styles.rowSeeAll} onClick={() => navigate('/live')}>
              Voir tout <ChevronRight />
            </button>
          </div>
          {loadingLive ? (
            <RowSkeleton type="channel" />
          ) : (
            <div className={styles.rowRail}>
              {liveStreams.map((stream) => (
                <Focusable
                  key={stream.stream_id}
                  className={`${styles.card} ${styles.cardWide}`}
                  focusedClassName={styles.cardFocused}
                  onClick={() => playLive(stream)}
                  onEnter={() => playLive(stream)}
                  onArrow={upToHero}
                >
                  <div className={styles.artWide}>
                    {safeImgUrl(stream.stream_icon) ? (
                      <img
                        src={safeImgUrl(stream.stream_icon)}
                        alt={stream.name}
                        className={`${styles.artImg} ${styles.artImgContain}`}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ChannelPlaceholder code={initials(stream.name)} />
                    )}
                    <span className={styles.livePill}>
                      <span className={styles.livePillDot} />
                      LIVE
                    </span>
                  </div>
                  <div className={styles.cardLabel}>
                    <div className={styles.cardName}>{stream.name}</div>
                  </div>
                </Focusable>
              ))}
            </div>
          )}
        </div>

        {/* Top Films */}
        <div className={styles.row}>
          <div className={styles.rowHeader}>
            <span className={styles.rowTitle}>Films populaires</span>
            <button className={styles.rowSeeAll} onClick={() => navigate('/movies')}>
              Voir tout <ChevronRight />
            </button>
          </div>
          {loadingMovies ? (
            <RowSkeleton type="poster" />
          ) : (
            <div className={styles.rowRail}>
              {movies.map((g) => {
                const r = tmdbRatings[g.key] ?? (g.primary.rating_5based > 0 ? g.primary.rating_5based * 2 : 0);
                const yr = g.year ?? (g.primary.releaseDate ? g.primary.releaseDate.slice(0, 4) : 'Film');
                return (
                  <PreviewCard
                    key={g.primary.stream_id}
                    className={styles.posterCell}
                    title={g.title}
                    image={g.primary.stream_icon}
                    backdrop={g.primary.backdrop_path?.[0]}
                    synopsis={g.primary.plot}
                    meta={[yr, r > 0 ? `★ ${r.toFixed(1)}` : null].filter(Boolean).join(' · ')}
                    variant="movie"
                    trailerUrl={g.primary.youtube_trailer}
                    resolveTrailer={() => tmdbService.getTrailer('movie', g.title, g.year)}
                    onOpen={() => openMovie(g)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Séries tendances */}
        <div className={styles.row}>
          <div className={styles.rowHeader}>
            <span className={styles.rowTitle}>Séries tendances</span>
            <button className={styles.rowSeeAll} onClick={() => navigate('/series')}>
              Voir tout <ChevronRight />
            </button>
          </div>
          {loadingSeries ? (
            <RowSkeleton type="poster" />
          ) : (
            <div className={styles.rowRail}>
              {series.map((g) => {
                const r = tmdbRatings[g.key] ?? (g.primary.rating_5based > 0 ? g.primary.rating_5based * 2 : 0);
                const yr = g.year ?? (g.primary.releaseDate ? g.primary.releaseDate.slice(0, 4) : 'Série');
                return (
                  <PreviewCard
                    key={g.primary.series_id}
                    className={styles.posterCell}
                    title={g.title}
                    image={g.primary.cover}
                    backdrop={g.primary.backdrop_path?.[0]}
                    synopsis={g.primary.plot}
                    meta={[yr, r > 0 ? `★ ${r.toFixed(1)}` : null].filter(Boolean).join(' · ')}
                    variant="series"
                    trailerUrl={g.primary.youtube_trailer}
                    resolveTrailer={() => tmdbService.getTrailer('tv', g.title, g.year)}
                    onOpen={() => openSeries(g)}
                  />
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
