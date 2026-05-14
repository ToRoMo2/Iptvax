import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { storageService, type WatchHistoryItem } from '../services/storage.service';
import type { LiveStream, VodStream, SeriesItem } from '../types/xtream.types';
import type { PlayerState } from '../types/xtream.types';
import { safeImgUrl } from '../utils/image';
import styles from './Home.module.css';

// ── Gradient palettes ────────────────────────────────────────────────────────
const HERO_GRADS = [
  'radial-gradient(ellipse at 25% 45%, rgba(108,63,255,0.85), transparent 55%), radial-gradient(ellipse at 75% 20%, rgba(168,85,247,0.65), transparent 50%), linear-gradient(160deg, #1a0d2e 0%, #0a0a0f 100%)',
  'radial-gradient(ellipse at 65% 35%, rgba(30,120,255,0.75), transparent 55%), radial-gradient(ellipse at 20% 70%, rgba(99,102,241,0.55), transparent 50%), linear-gradient(160deg, #0d1830 0%, #0a0a0f 100%)',
  'radial-gradient(ellipse at 40% 50%, rgba(220,60,120,0.6), transparent 55%), radial-gradient(ellipse at 80% 20%, rgba(168,85,247,0.55), transparent 50%), linear-gradient(160deg, #2a0d1a 0%, #0a0a0f 100%)',
];

const CARD_GRADS = [
  'linear-gradient(135deg, #1a0d2e 0%, #0d0d1a 100%)',
  'linear-gradient(135deg, #0d1a2e 0%, #0a0a0f 100%)',
  'linear-gradient(135deg, #1a1a0d 0%, #0a0a0f 100%)',
  'linear-gradient(135deg, #2e0d1a 0%, #0a0a0f 100%)',
];

function hashGrad(title: string) {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) & 0xffffff;
  return CARD_GRADS[Math.abs(h) % CARD_GRADS.length];
}

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
function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="#ffd34d" width="12" height="12"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
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
  bgGrad: string;
  playerState: PlayerState;
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
  const navigate = useNavigate();

  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>([]);
  const [heroIdx, setHeroIdx] = useState(0);
  const [heroLoading, setHeroLoading] = useState(true);

  const [history, setHistory] = useState<WatchHistoryItem[]>([]);
  const [liveStreams, setLiveStreams] = useState<LiveStream[]>([]);
  const [movies, setMovies] = useState<VodStream[]>([]);
  const [series, setSeries] = useState<SeriesItem[]>([]);

  const [loadingLive, setLoadingLive] = useState(true);
  const [loadingMovies, setLoadingMovies] = useState(true);
  const [loadingSeries, setLoadingSeries] = useState(true);

  const heroTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load watch history ───────────────────────────────────────────────────
  useEffect(() => {
    setHistory(storageService.getWatchHistory());
  }, []);

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
        const heroItems = sorted.slice(0, 3).map((m, idx): HeroSlide => ({
          id: String(m.stream_id),
          title: m.name,
          genre: m.genre ?? 'Film',
          rating: m.rating || (m.rating_5based ? (m.rating_5based * 2).toFixed(1) : '—'),
          description: m.plot ?? '',
          eyebrow: 'Film · À la une',
          bgImage: safeImgUrl(m.stream_icon) ?? safeImgUrl(m.backdrop_path?.[0]),
          bgGrad: HERO_GRADS[idx % HERO_GRADS.length],
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
          return sorted.slice(0, 3).map((s, idx): HeroSlide => ({
            id: `s${s.series_id}`,
            title: s.name,
            genre: s.genre ?? 'Série',
            rating: s.rating || '—',
            description: s.plot ?? '',
            eyebrow: 'Série · À la une',
            bgImage: safeImgUrl(s.cover),
            bgGrad: HERO_GRADS[idx % HERO_GRADS.length],
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

  // ── Play handler ─────────────────────────────────────────────────────────
  const playMovie = (m: VodStream) => {
    if (!credentials) return;
    const state: PlayerState = {
      url: xtreamService.getVodStreamUrl(credentials, m.stream_id, m.container_extension),
      fallbackUrl: xtreamService.getVodDirectUrl(credentials, m.stream_id, m.container_extension),
      title: m.name,
      type: 'movie',
      poster: m.stream_icon,
      description: m.plot,
    };
    storageService.addToWatchHistory({
      id: `movie-${m.stream_id}`,
      type: 'movie',
      title: m.name,
      image: m.stream_icon || '',
      progress: 0,
      subtitle: m.releaseDate ? `${m.releaseDate.slice(0, 4)}` : 'Film',
      playerState: state,
    });
    navigate('/player', { state });
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
              <div style={{ position: 'absolute', inset: 0, background: slide.bgGrad }} />
              {safeImgUrl(slide.bgImage) && (
                <img
                  src={safeImgUrl(slide.bgImage)}
                  alt=""
                  className={styles.heroBg}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              )}
              <div className={styles.heroVignette} />

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
                      <span className={styles.heroRating}>
                        <StarIcon />
                        {slide.rating}
                      </span>
                      <span className={styles.heroMetaDivider} />
                    </>
                  )}
                  <span className={styles.heroMetaItem}>{slide.genre}</span>
                </div>
                {slide.description && (
                  <p className={styles.heroDesc}>{slide.description}</p>
                )}
                <div className={styles.heroActions}>
                  <button className={styles.heroPlayBtn} onClick={() => playHero(slide)}>
                    <PlayIcon /> Regarder
                  </button>
                  <button className={styles.heroInfoBtn} onClick={() => navigate('/movies')}>
                    <InfoIcon /> Plus d'infos
                  </button>
                </div>
              </div>
            </div>
          ))}

          {/* Pagination dots */}
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
                <div key={item.id} className={styles.cwCard} onClick={() => playHistory(item)}>
                  <div
                    className={styles.cwThumb}
                    style={{ background: hashGrad(item.title) }}
                  >
                    {safeImgUrl(item.image) && (
                      <img
                        src={safeImgUrl(item.image)}
                        alt={item.title}
                        className={styles.cwThumbImg}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className={styles.cwOverlay}>
                      <div className={styles.cwPlayBtn}>
                        <PlayIcon />
                      </div>
                    </div>
                    <div className={styles.cwProgress}>
                      <div className={styles.cwProgressBar} style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                  <div className={styles.cwInfo}>
                    <div className={styles.cwTitle}>{item.title}</div>
                    <div className={styles.cwSub}>{item.subtitle}</div>
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
                <div key={stream.stream_id} className={styles.channelCard} onClick={() => playLive(stream)}>
                  <div
                    className={styles.channelThumb}
                    style={{ background: hashGrad(stream.name) }}
                  >
                    {safeImgUrl(stream.stream_icon) && (
                      <img
                        src={safeImgUrl(stream.stream_icon)}
                        alt={stream.name}
                        className={styles.channelThumbImg}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className={styles.channelLive}>
                      <span className={styles.channelLiveDot} />
                      LIVE
                    </div>
                  </div>
                  <div className={styles.channelInfo}>
                    <div className={styles.channelName}>{stream.name}</div>
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
                <div key={m.stream_id} className={styles.posterCard} onClick={() => playMovie(m)}>
                  <div
                    className={styles.posterThumb}
                    style={{ background: hashGrad(m.name) }}
                  >
                    {safeImgUrl(m.stream_icon) && (
                      <img
                        src={safeImgUrl(m.stream_icon)}
                        alt={m.name}
                        className={styles.posterThumbImg}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className={styles.posterOverlay}>
                      <div className={styles.posterPlayBtn}>
                        <PlayIcon />
                      </div>
                      {m.rating_5based > 0 && (
                        <div className={styles.posterRating}>
                          <StarIcon />
                          {(m.rating_5based * 2).toFixed(1)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.posterInfo}>
                    <div className={styles.posterTitle}>{m.name}</div>
                    {m.releaseDate && (
                      <div className={styles.posterYear}>{m.releaseDate.slice(0, 4)}</div>
                    )}
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
                  className={styles.posterCard}
                  onClick={() => navigate(`/series/${s.series_id}`)}
                >
                  <div
                    className={styles.posterThumb}
                    style={{ background: hashGrad(s.name) }}
                  >
                    {safeImgUrl(s.cover) && (
                      <img
                        src={safeImgUrl(s.cover)}
                        alt={s.name}
                        className={styles.posterThumbImg}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    )}
                    <div className={styles.posterOverlay}>
                      <div className={styles.posterPlayBtn}>
                        <PlayIcon />
                      </div>
                      {s.rating_5based > 0 && (
                        <div className={styles.posterRating}>
                          <StarIcon />
                          {(s.rating_5based * 2).toFixed(1)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={styles.posterInfo}>
                    <div className={styles.posterTitle}>{s.name}</div>
                    {s.releaseDate && (
                      <div className={styles.posterYear}>{s.releaseDate.slice(0, 4)}</div>
                    )}
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
