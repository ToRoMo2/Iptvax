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
import type { SeriesCategory, SeriesItem } from '../types/xtream.types';
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

export function Series() {
  const { credentials } = useXtream();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { t, tc } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Mode « catégorie complète » : /series?cat=<id> → grille de cette catégorie.
  const activeCat = searchParams.get('cat');

  const [categories, setCategories] = useState<SeriesCategory[]>([]);
  // Catalogue COMPLET chargé une fois → bucketé par catégorie côté client.
  const [allSeries, setAllSeries] = useState<SeriesItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  // Rail « Populaires » (tendances TMDB) — Premium only (cf. Movies / §X).
  const [popular, setPopular] = useState<TitleGroup<SeriesItem>[]>([]);
  const trendingDone = useRef(false);

  // ── Chargement catégories + catalogue complet ──────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    setLoading(true);
    Promise.all([
      xtreamService.getSeriesCategories(credentials),
      xtreamService.getSeries(credentials),
    ])
      .then(([cats, all]) => {
        setCategories(cats);
        setAllSeries(all);
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

  const allGroups = useMemo(
    () => groupByTitle(allSeries ?? [], (s) => s.name, (s) => s.rating_5based ?? 0),
    [allSeries],
  );

  // ── Rails par catégorie ────────────────────────────────────────────────────
  const rails = useMemo(() => {
    if (!allSeries) return [];
    const byCat = new Map<string, SeriesItem[]>();
    for (const s of allSeries) {
      const arr = byCat.get(s.category_id);
      if (arr) arr.push(s);
      else byCat.set(s.category_id, [s]);
    }
    return categories
      .map((c) => {
        const bucket = byCat.get(c.category_id) ?? [];
        const groups = groupByTitle(bucket, (s) => s.name, (s) => s.rating_5based ?? 0).sort(
          (a, b) => (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0),
        );
        return { id: c.category_id, name: c.category_name, groups };
      })
      .filter((r) => r.groups.length > 0);
  }, [allSeries, categories]);

  // ── Tendances TMDB → rail « Populaires » ───────────────────────────────────
  useEffect(() => {
    if (trendingDone.current || !allSeries || allGroups.length === 0) return;
    if (!tmdbService.isEnabled()) return;
    trendingDone.current = true;
    tmdbService
      .getTrending('tv')
      .then((trend) => {
        const map = new Map(allGroups.map((g) => [g.key, g] as const));
        const matched: TitleGroup<SeriesItem>[] = [];
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
  }, [allSeries, allGroups]);

  // ── Résultats de recherche ─────────────────────────────────────────────────
  const searchGroups = useMemo(() => {
    if (!isGlobalSearch) return [];
    const q = query.toLowerCase();
    const out: TitleGroup<SeriesItem>[] = [];
    for (const g of allGroups) {
      if (g.title.toLowerCase().includes(q)) {
        out.push(g);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return out;
  }, [allGroups, query, isGlobalSearch]);

  const catRail = useMemo(
    () => (activeCat ? rails.find((r) => r.id === activeCat) : undefined),
    [rails, activeCat],
  );
  const catName = useMemo(
    () => categories.find((c) => c.category_id === activeCat)?.category_name ?? '',
    [categories, activeCat],
  );

  const gridSource = activeCat ? (catRail?.groups ?? []) : searchGroups;
  const visibleGrid = useProgressiveList(gridSource);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const openSeries = (g: TitleGroup<SeriesItem>) => {
    navigate(`/series/${g.primary.series_id}`, { state: { series: g.primary, variants: g.variants } });
  };

  const renderCard = (g: TitleGroup<SeriesItem>, railCard: boolean) => (
    <PreviewCard
      key={g.primary.series_id}
      className={railCard ? styles.posterCell : undefined}
      title={g.title}
      image={g.primary.cover}
      backdrop={g.primary.backdrop_path?.[0]}
      synopsis={g.primary.plot}
      meta={[
        g.year,
        g.primary.rating_5based > 0 ? `★ ${g.primary.rating_5based.toFixed(1)}` : null,
        g.primary.genre?.split('/')[0].trim(),
      ]
        .filter(Boolean)
        .join(' · ')}
      variant="series"
      isFavorite={isFavorite('series', String(g.primary.series_id))}
      trailerUrl={g.primary.youtube_trailer}
      resolveTrailer={() => tmdbService.getTrailer('tv', g.title, g.year)}
      onOpen={() => openSeries(g)}
      onFavorite={() =>
        toggleFavorite({
          type: 'series',
          id: String(g.primary.series_id),
          name: g.title,
          image: g.primary.cover ?? '',
        })
      }
    />
  );

  // ── Mode CATÉGORIE COMPLÈTE (?cat=) ─────────────────────────────────────────
  if (activeCat) {
    return (
      <div className={styles.page}>
        <header className={styles.catHeader}>
          <button className={styles.backBtn} onClick={() => navigate('/series')} aria-label={t('common.backWord')}>
            <BackIcon />
          </button>
          <h1 className={styles.catTitle}>{catName || t('series.title')}</h1>
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
          <p className={styles.empty}>{t('series.none')}</p>
        )}
      </div>
    );
  }

  // ── Mode OVERVIEW (rails) + recherche globale ───────────────────────────────
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('series.title')}</h1>
          <p className={styles.pageSub}>
            {isGlobalSearch
              ? t('live.globalSearch')
              : tc('series.countOne', 'series.countOther', allGroups.length)}
          </p>
        </div>
        <RemoteSearch
          value={search}
          onChange={setSearch}
          placeholder={t('series.searchPlaceholder')}
          wrapperClassName={styles.searchWrapper}
          iconClassName={styles.searchIcon}
          inputClassName={styles.search}
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
            <p className={styles.empty}>{t('series.none')}</p>
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
            <Shelf title={t('common.popular')} count={popular.length}>
              {popular.map((g) => renderCard(g, true))}
            </Shelf>
          )}
          {rails.map((r) => (
            <Shelf
              key={r.id}
              title={r.name}
              count={r.groups.length}
              seeAllLabel={t('common.seeAll')}
              onSeeAll={() => navigate(`/series?cat=${encodeURIComponent(r.id)}`)}
            >
              {r.groups.slice(0, RAIL_PREVIEW).map((g) => renderCard(g, true))}
              {r.groups.length > RAIL_PREVIEW && (
                <SeeAllCard
                  label={t('common.seeAll')}
                  onClick={() => navigate(`/series?cat=${encodeURIComponent(r.id)}`)}
                />
              )}
            </Shelf>
          ))}
          {rails.length === 0 && <p className={styles.empty}>{t('series.none')}</p>}
        </div>
      )}
    </div>
  );
}
