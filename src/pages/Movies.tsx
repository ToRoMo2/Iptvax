import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import { PreviewCard } from '../components/PreviewCard';
import { RemoteSearch } from '../components/RemoteSearch';
import { ScrollRail } from '../components/ScrollRail';
import { PopularRail } from '../components/PopularRail';
import type { VodCategory, VodStream } from '../types/xtream.types';
import { groupByTitle, titleKey, type TitleGroup } from '../utils/catalog';
import { useProgressiveList } from '../hooks/useProgressiveList';
import styles from './Browse.module.css';

const MIN_SEARCH_LEN = 3;
const RESULT_LIMIT = 80;
// Nombre de cartes affichées dans un rail avant la carte « Voir tout ».
const RAIL_PREVIEW = 12;

// ── Icônes inline ───────────────────────────────────────────────────────────
function ChevronRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="13" height="13"><path d="m9 18 6-6-6-6" /></svg>
  );
}
function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="26" height="26"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  );
}
function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20"><path d="m15 18-6-6 6-6" /></svg>
  );
}

// ── Rangée « rail » (en-tête + scroll horizontal) ───────────────────────────
function Shelf({
  title,
  count,
  seeAllLabel,
  onSeeAll,
  children,
}: {
  title: string;
  count?: number;
  seeAllLabel?: string;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section className={styles.shelf}>
      <div className={styles.shelfHeader}>
        <div className={styles.shelfTitleGroup}>
          <h2 className={styles.shelfTitle}>{title}</h2>
          {count != null && count > 0 && (
            <>
              <span className={styles.shelfDivider} aria-hidden="true" />
              <span className={styles.shelfCount}>{count}</span>
            </>
          )}
        </div>
        {onSeeAll && seeAllLabel && (
          <button className={styles.shelfSeeAll} onClick={onSeeAll}>
            {seeAllLabel} <ChevronRight />
          </button>
        )}
      </div>
      <ScrollRail railClassName={styles.shelfRail}>{children}</ScrollRail>
    </section>
  );
}

// ── Carte « Voir tout » placée en fin de rail ────────────────────────────────
function SeeAllCard({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={`${styles.posterCell} ${styles.seeAllCard}`} onClick={onClick}>
      <span className={styles.seeAllIcon}><GridIcon /></span>
      <span className={styles.seeAllLabel}>{label}</span>
    </button>
  );
}

export function Movies() {
  const { credentials } = useXtream();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { t, tc } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Mode « catégorie complète » : /movies?cat=<id> → grille de cette catégorie.
  const activeCat = searchParams.get('cat');

  const [categories, setCategories] = useState<VodCategory[]>([]);
  // Catalogue COMPLET chargé une seule fois → bucketé par catégorie côté client
  // (chaque VodStream porte son category_id). Une seule requête sert les rails,
  // la grille d'une catégorie ET la recherche globale.
  const [allStreams, setAllStreams] = useState<VodStream[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  // Rail « Populaires » (tendances TMDB matchées au catalogue) — Premium only :
  // tmdbService.isEnabled() est piloté par l'abonnement (cf. §X). Reste vide
  // pour le tier gratuit → aucune rangée populaire.
  const [popular, setPopular] = useState<TitleGroup<VodStream>[]>([]);
  const trendingDone = useRef(false);

  // ── Chargement catégories + catalogue complet ──────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    setLoading(true);
    Promise.all([
      xtreamService.getVodCategories(credentials),
      xtreamService.getVodStreams(credentials),
    ])
      .then(([cats, all]) => {
        setCategories(cats);
        setAllStreams(all);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [credentials]);

  // ── Debounce recherche ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  const isGlobalSearch = query.length >= MIN_SEARCH_LEN;

  // ── Catalogue dédupliqué complet (count d'en-tête + base recherche + match TMDB) ──
  const allGroups = useMemo(
    () => groupByTitle(allStreams ?? [], (v) => v.name, (v) => v.rating_5based ?? 0),
    [allStreams],
  );

  // ── Rails par catégorie : bucket par category_id puis groupage par titre ────
  const rails = useMemo(() => {
    if (!allStreams) return [];
    const byCat = new Map<string, VodStream[]>();
    for (const s of allStreams) {
      const arr = byCat.get(s.category_id);
      if (arr) arr.push(s);
      else byCat.set(s.category_id, [s]);
    }
    return categories
      .map((c) => {
        const bucket = byCat.get(c.category_id) ?? [];
        const groups = groupByTitle(bucket, (v) => v.name, (v) => v.rating_5based ?? 0).sort(
          (a, b) => (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0),
        );
        return { id: c.category_id, name: c.category_name, groups };
      })
      .filter((r) => r.groups.length > 0);
  }, [allStreams, categories]);

  // ── Tendances TMDB → rail « Populaires » (matché au catalogue) ─────────────
  useEffect(() => {
    if (trendingDone.current || !allStreams || allGroups.length === 0) return;
    if (!tmdbService.isEnabled()) return;
    trendingDone.current = true;
    tmdbService
      .getTrending('movie')
      .then((trend) => {
        const map = new Map(allGroups.map((g) => [g.key, g] as const));
        const matched: TitleGroup<VodStream>[] = [];
        for (const tr of trend) {
          const g = map.get(titleKey(tr.title));
          if (g) matched.push(g);
          if (matched.length >= 18) break;
        }
        if (matched.length >= 4) setPopular(matched);
      })
      .catch(() => {
        trendingDone.current = false;
      });
  }, [allStreams, allGroups]);

  // ── Résultats de recherche (filtre sur le catalogue dédupliqué) ────────────
  const searchGroups = useMemo(() => {
    if (!isGlobalSearch) return [];
    const q = query.toLowerCase();
    const out: TitleGroup<VodStream>[] = [];
    for (const g of allGroups) {
      if (g.title.toLowerCase().includes(q)) {
        out.push(g);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return out;
  }, [allGroups, query, isGlobalSearch]);

  // ── Items d'une catégorie (mode ?cat=) ─────────────────────────────────────
  const catRail = useMemo(
    () => (activeCat ? rails.find((r) => r.id === activeCat) : undefined),
    [rails, activeCat],
  );
  const catName = useMemo(
    () => categories.find((c) => c.category_id === activeCat)?.category_name ?? '',
    [categories, activeCat],
  );

  // Rendu progressif des grilles (catégorie complète / recherche).
  const gridSource = activeCat ? (catRail?.groups ?? []) : searchGroups;
  const visibleGrid = useProgressiveList(gridSource);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const openMovie = (g: TitleGroup<VodStream>) => {
    navigate(`/movie/${g.primary.stream_id}`, { state: { movie: g.primary, variants: g.variants } });
  };

  const renderCard = (g: TitleGroup<VodStream>, railCard: boolean) => (
    <PreviewCard
      key={g.primary.stream_id}
      className={railCard ? styles.posterCell : undefined}
      title={g.title}
      image={g.primary.stream_icon}
      backdrop={g.primary.backdrop_path?.[0]}
      synopsis={g.primary.plot}
      meta={[
        g.year,
        g.primary.rating_5based > 0 ? `★ ${g.primary.rating_5based.toFixed(1)}` : null,
        g.primary.genre?.split('/')[0].trim(),
      ]
        .filter(Boolean)
        .join(' · ')}
      variant="movie"
      isFavorite={isFavorite('movie', String(g.primary.stream_id))}
      trailerUrl={g.primary.youtube_trailer}
      resolveTrailer={() => tmdbService.getTrailer('movie', g.title, g.year)}
      onOpen={() => openMovie(g)}
      onFavorite={() =>
        toggleFavorite({
          type: 'movie',
          id: String(g.primary.stream_id),
          name: g.title,
          image: g.primary.stream_icon ?? '',
        })
      }
    />
  );

  // ── Mode CATÉGORIE COMPLÈTE (?cat=) ─────────────────────────────────────────
  if (activeCat) {
    return (
      <div className={styles.page}>
        <header className={styles.catHeader}>
          <button className={styles.backBtn} onClick={() => navigate('/movies')} aria-label={t('common.backWord')}>
            <BackIcon />
          </button>
          <h1 className={styles.catTitle}>{catName || t('movies.title')}</h1>
        </header>

        {error && <div className={styles.error}>⚠ {error}</div>}

        {loading ? (
          <div className={styles.gridLoading}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={`${styles.skeleton} ${styles.skeletonPoster}`} />
            ))}
          </div>
        ) : (
          <div className={`${styles.grid} ${styles.gridPoster}`}>
            {visibleGrid.map((g) => renderCard(g, false))}
          </div>
        )}

        {!loading && gridSource.length === 0 && !error && (
          <p className={styles.empty}>{t('movies.none')}</p>
        )}
      </div>
    );
  }

  // ── Mode OVERVIEW (rails) + recherche globale ───────────────────────────────
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('movies.title')}</h1>
          <p className={styles.pageSub}>
            {isGlobalSearch
              ? t('live.globalSearch')
              : tc('movies.countOne', 'movies.countOther', allGroups.length)}
          </p>
        </div>
        <RemoteSearch
          value={search}
          onChange={setSearch}
          placeholder={t('movies.searchPlaceholder')}
          wrapperClassName={styles.searchWrapper}
          iconClassName={styles.searchIcon}
          inputClassName={styles.search}
          clearClassName={styles.searchClear}
        />
        {search.trim().length > 0 && search.trim().length < MIN_SEARCH_LEN && (
          <span className={styles.searchBadge}>{t('common.minChars', { n: MIN_SEARCH_LEN })}</span>
        )}
        {isGlobalSearch && (
          <span className={styles.searchBadge}>
            {tc('common.resultOne', 'common.resultOther', searchGroups.length, {
              count: `${searchGroups.length}${searchGroups.length >= RESULT_LIMIT ? '+' : ''}`,
            })}
          </span>
        )}
      </header>

      {error && <div className={styles.error}>⚠ {error}</div>}

      {isGlobalSearch ? (
        <div className={`${styles.grid} ${styles.gridPoster}`}>
          {visibleGrid.map((g) => renderCard(g, false))}
          {searchGroups.length === 0 && !loading && (
            <p className={styles.empty}>{t('movies.none')}</p>
          )}
        </div>
      ) : loading ? (
        <div className={styles.gridLoading}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`${styles.skeleton} ${styles.skeletonPoster}`} />
          ))}
        </div>
      ) : (
        <div className={styles.shelves}>
          {popular.length > 0 && (
            <section className={styles.shelf}>
              <div className={styles.shelfHeader}>
                <div className={styles.shelfTitleGroup}>
                  <h2 className={styles.shelfTitle}>{t('common.popular')}</h2>
                  <span className={styles.shelfDivider} aria-hidden="true" />
                  <span className={styles.shelfCount}>{popular.length}</span>
                </div>
              </div>
              <PopularRail>{popular.map((g) => renderCard(g, false))}</PopularRail>
            </section>
          )}
          {rails.map((r) => (
            <Shelf
              key={r.id}
              title={r.name}
              count={r.groups.length}
              seeAllLabel={t('common.seeAll')}
              onSeeAll={() => navigate(`/movies?cat=${encodeURIComponent(r.id)}`)}
            >
              {r.groups.slice(0, RAIL_PREVIEW).map((g) => renderCard(g, true))}
              {r.groups.length > RAIL_PREVIEW && (
                <SeeAllCard
                  label={t('common.seeAll')}
                  onClick={() => navigate(`/movies?cat=${encodeURIComponent(r.id)}`)}
                />
              )}
            </Shelf>
          ))}
          {rails.length === 0 && <p className={styles.empty}>{t('movies.none')}</p>}
        </div>
      )}
    </div>
  );
}
