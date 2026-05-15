import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useLibrary } from '../contexts/LibraryContext';
import type { WatchHistoryItem } from '../types/library.types';
import type { LiveStream, VodStream, SeriesItem } from '../types/xtream.types';
import type { PlayerState } from '../types/xtream.types';
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
  const [movies, setMovies] = useState<VodStream[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);

  const [loadingLive, setLoadingLive] = useState(true);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingSeries, setLoadingSeries] = useState(true);

  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Auto-advance hero ────────────────────────────────────────────────────
  const startHeroTimer = useCallback(() => {
    if (heroTimer.current) clearInterval(heroTimer.current);
    heroTimer.current = setInterval(() => {
      setHeroIdx((i) => (i + 1) % 3);
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
        const sorted = [...all].sort((a, b) => (b.rating_5based ?? 0) - (a.rating_5based ?? 0));
        setMovies(sorted.slice(0, 18));

        // Build hero from top 3 movies
        const heroItems = sorted.slice(0, 3).map((m): HeroSlide => ({
          id: String(m.stream_id),
          title: m.name,
          genre: m.genre ?? 'Film',
          rating: m.rating || (m.rating_5based ? (m.rating_5based * 2).toFixed(1) : '—'),
          description: m.plot ?? '',
          eyebrow: 'Film · À la une',
          bgImage: safeImgUrl(m.stream_icon) ?? safeImgUrl(m.backdrop_path?.[0]),
          artTag: 'BACKDROP · 16:9',
          playerState: {
            url: xtreamService.getVodStreamUrl(credentials, m.stream_id, m.container_extension),
            fallbackUrl: xtreamService.getVodDirectUrl(credentials, m.stream_id, m.container_extension),
            title: m.name,
            type: 'movie',
            poster: m.stream_icon,
            description: m.plot,
          },
        }));
        setHeroSlides(heroItems);
        setHeroLoading(false);
      })
      .catch(() => {
        setHeroLoading(false);
      })
      .finally(() => setLoadingMovies(false));
  }, [credentials]);

  // ── Fetch series ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    setLoadingSeries(true);
    xtreamService
      .getSeries(credentials)
      .then((all) => {
        const sorted = [...all].sort((a, b) => (b.rating_5based ?? 0) - (a.rating_5based ?? 0));
        setSeries(sorted.slice(0, 18));

        // If hero still has no slides, build from series
        setHeroSlides((prev) => {
          if (prev.length > 0) return prev;
          return sorted.slice(0, 3).map((s): HeroSlide => ({
            id: `s${s.series_id}`,
            title: s.name,
            genre: s.genre ?? 'Série',
            rating: s.rating || '—',
            description: s.plot ?? '',
            eyebrow: 'Série · À la une',
            bgImage: safeImgUrl(s.cover),
            artTag: 'BACKDROP · 16:9',
            playerState: {
              url: '',
              title: s.name,
              type: 'episode',
              poster: s.cover,
              description: s.plot,
            },
          }));
        });
        setHeroLoading(false);
      })
      .catch(() => {})
      .finally(() => setLoadingSeries(false));
  }, [credentials]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  // Un clic sur un film ouvre sa fiche détail (design Vanta) ; la lecture est
  // lancée depuis cette page.
  const openMovie = (m: VodStream) => {
    navigate(`/movie/${m.stream_id}`, { state: { movie: m } });
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
      // Series — navigate to series page
      navigate('/series');
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
                  <button className={styles.heroPlayBtn} onClick={() => playHero(slide)}>
                    <PlayIcon /> Regarder
                  </button>
                  <button className={styles.heroInfoBtn} onClick={() => infoHero(slide)}>
                    <InfoIcon /> Plus d'infos
                  </button>
                </div>
              </div>
            </div>
          ))}

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
              {history.map((item) => (
                <div
                  key={item.id}
                  className={`${styles.card} ${styles.cardWide}`}
                  tabIndex={0}
                  onClick={() => playHistory(item)}
                  onKeyDown={(e) => { if (e.key === 'Enter') playHistory(item); }}
                >
                  <div className={styles.artWide}>
                    {safeImgUrl(item.image) ? (
                      <img
                        src={safeImgUrl(item.image)}
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
                </div>
              ))}
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
                <div
                  key={stream.stream_id}
                  className={`${styles.card} ${styles.cardWide}`}
                  tabIndex={0}
                  onClick={() => playLive(stream)}
                  onKeyDown={(e) => { if (e.key === 'Enter') playLive(stream); }}
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
                </div>
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
              {movies.map((m) => (
                <div
                  key={m.stream_id}
                  className={`${styles.card} ${styles.cardPoster}`}
                  tabIndex={0}
                  onClick={() => openMovie(m)}
                  onKeyDown={(e) => { if (e.key === 'Enter') openMovie(m); }}
                >
                  <div className={styles.artPoster}>
                    {safeImgUrl(m.stream_icon) ? (
                      <img
                        src={safeImgUrl(m.stream_icon)}
                        alt={m.name}
                        className={styles.artImg}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ArtPlaceholder tag="POSTER · 2:3" name={m.name} />
                    )}
                  </div>
                  <div className={styles.cardLabel}>
                    <div className={styles.cardName}>{m.name}</div>
                    <div className={styles.cardMeta}>
                      {m.releaseDate ? m.releaseDate.slice(0, 4) : 'Film'}
                      {m.rating_5based > 0 && ` · ★ ${(m.rating_5based * 2).toFixed(1)}`}
                    </div>
                  </div>
                </div>
              ))}
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
              {series.map((s) => (
                <div
                  key={s.series_id}
                  className={`${styles.card} ${styles.cardPoster}`}
                  tabIndex={0}
                  onClick={() => navigate(`/series/${s.series_id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/series/${s.series_id}`); }}
                >
                  <div className={styles.artPoster}>
                    {safeImgUrl(s.cover) ? (
                      <img
                        src={safeImgUrl(s.cover)}
                        alt={s.name}
                        className={styles.artImg}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <ArtPlaceholder tag="POSTER · 2:3" name={s.name} />
                    )}
                  </div>
                  <div className={styles.cardLabel}>
                    <div className={styles.cardName}>{s.name}</div>
                    <div className={styles.cardMeta}>
                      {s.releaseDate ? s.releaseDate.slice(0, 4) : 'Série'}
                      {s.rating_5based > 0 && ` · ★ ${(s.rating_5based * 2).toFixed(1)}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
