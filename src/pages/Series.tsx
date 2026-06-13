import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useI18n } from '../contexts/I18nContext';
import { PreviewCard } from '../components/PreviewCard';
import { RemoteSearch } from '../components/RemoteSearch';
import { ScrollRail } from '../components/ScrollRail';
import { PopularLocked } from '../components/PopularLocked';
import { Top10Spotlight, type Top10SpotlightItem } from '../components/Top10Spotlight';
import type { SeriesCategory, SeriesItem } from '../types/xtream.types';
import { groupByTitle, titleKey, star5Label, type TitleGroup } from '../utils/catalog';
import { useProgressiveList } from '../hooks/useProgressiveList';
import styles from './Browse.module.css';

const MIN_SEARCH_LEN = 3;
const RESULT_LIMIT = 80;
// Nombre de cartes affichées dans un rail avant la carte « Voir tout ».
const RAIL_PREVIEW = 12;
// Cartes du 1er écran d'une grille (recherche / catégorie) chargées en priorité
// haute (`eager` + fetchpriority) → les affiches visibles apparaissent plus vite.
const EAGER_COUNT = 18;
// Rendu progressif des rails de l'overview : on MONTE d'abord ces rails (le coût
// est le montage de centaines de PreviewCard focusables, pas leur paint), puis
// on étend par paquets pendant les temps morts → navigation entre onglets fluide.
const INITIAL_RAILS = 8;
const RAILS_CHUNK = 6;

interface SeriesRail { id: string; name: string; groups: TitleGroup<SeriesItem>[] }

// Caches des dérivés lourds par identité du catalogue. `allSeries` provient du
// cache service (même référence d'un montage à l'autre) → la navigation retour
// ne recalcule pas le regroupement (titleKey/cleanTitle sur potentiellement des
// dizaines de milliers d'items = plusieurs centaines de ms sinon).
const allGroupsCache = new WeakMap<SeriesItem[], TitleGroup<SeriesItem>[]>();
const railsCache = new WeakMap<SeriesItem[], { categories: SeriesCategory[]; rails: SeriesRail[] }>();

// Entrée « Populaires » : groupe catalogue + visuel/synopsis TMDB. Le backdrop
// paysage HD vient de TMDB (les fonds Xtream sont souvent absents → poster
// portrait zoomé dans le 16:9, illisible) — cf. PopularSpotlight.
interface PopularEntry {
  group: TitleGroup<SeriesItem>;
  /** Backdrop paysage HD TMDB (tendances). */
  backdrop?: string;
  /** Synopsis FR TMDB. */
  overview?: string;
}

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
  const { favorites, isFavorite, toggleFavorite } = useLibrary();
  const { isPremium } = useSubscription();
  const { t, tc } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Mode « catégorie complète » : /series?cat=<id> → grille de cette catégorie.
  const activeCat = searchParams.get('cat');
  // Restaure la query depuis l'URL au remontage (retour depuis la fiche détail).
  const urlQ = searchParams.get('q') ?? '';

  // Seed depuis le snapshot synchrone du cache catalogue : au retour sur l'onglet
  // (cache chaud), l'état initial porte déjà les données → aucun squelette.
  const [categories, setCategories] = useState<SeriesCategory[]>(
    () => (credentials ? xtreamService.peekSeriesCategories(credentials) : null) ?? [],
  );
  // Catalogue COMPLET chargé une fois → bucketé par catégorie côté client.
  const [allSeries, setAllSeries] = useState<SeriesItem[] | null>(
    () => (credentials ? xtreamService.peekSeries(credentials) : null),
  );
  // ⚠ loading=false UNIQUEMENT si catalogue ET catégories sont en cache : les
  // rails dépendent des catégories, donc seeder sur le seul catalogue laissait
  // afficher « aucune série » (grille vide) le temps que les catégories arrivent.
  const [loading, setLoading] = useState(
    () =>
      !(
        credentials &&
        xtreamService.peekSeries(credentials) &&
        xtreamService.peekSeriesCategories(credentials)
      ),
  );
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState(urlQ);
  const [query, setQuery] = useState(urlQ.length >= MIN_SEARCH_LEN ? urlQ : '');
  const [showSearch, setShowSearch] = useState(urlQ.length > 0);

  // Rail « Populaires » (tendances TMDB) — Premium only (cf. Movies / §X). Vide
  // pour le tier gratuit → le CTA <PopularLocked> est affiché à la place.
  const [popular, setPopular] = useState<PopularEntry[]>([]);
  const trendingDone = useRef(false);

  // ── Chargement catégories + catalogue complet ──────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    let cancelled = false;
    // Pas de setLoading(true) ici : si l'état a été seedé depuis le cache, on ne
    // veut PAS revenir au squelette. Le fetch (Promise en cache → résolution
    // immédiate) ne fait que rafraîchir les données déjà affichées.
    Promise.all([
      xtreamService.getSeriesCategories(credentials),
      xtreamService.getSeries(credentials),
    ])
      .then(([cats, all]) => {
        if (cancelled) return;
        setCategories(cats);
        setAllSeries(all);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [credentials]);

  // ── Debounce recherche ─────────────────────────────────────────────────────
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 200);
    if (search.trim().length > 0) setShowSearch(true);
    return () => clearTimeout(id);
  }, [search]);

  // Persiste la query dans l'URL (replace:true = pas de nouvelle entrée d'historique
  // à chaque frappe). À la navigation retour depuis la fiche, le composant se remonte
  // avec urlQ renseignée → les résultats sont restaurés.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        const q = search.trim();
        if (q.length >= MIN_SEARCH_LEN) next.set('q', q);
        else next.delete('q');
        return next;
      },
      { replace: true },
    );
  }, [search, setSearchParams]);

  const isGlobalSearch = query.length >= MIN_SEARCH_LEN;

  const allGroups = useMemo(() => {
    if (!allSeries) return [];
    let hit = allGroupsCache.get(allSeries);
    if (!hit) {
      hit = groupByTitle(allSeries, (s) => s.name, (s) => s.rating_5based ?? 0);
      allGroupsCache.set(allSeries, hit);
    }
    return hit;
  }, [allSeries]);

  // ── Rails par catégorie ────────────────────────────────────────────────────
  const rails = useMemo<SeriesRail[]>(() => {
    if (!allSeries) return [];
    const cached = railsCache.get(allSeries);
    if (cached && cached.categories === categories) return cached.rails;
    const byCat = new Map<string, SeriesItem[]>();
    for (const s of allSeries) {
      const arr = byCat.get(s.category_id);
      if (arr) arr.push(s);
      else byCat.set(s.category_id, [s]);
    }
    const built = categories
      .map((c) => {
        const bucket = byCat.get(c.category_id) ?? [];
        const groups = groupByTitle(bucket, (s) => s.name, (s) => s.rating_5based ?? 0).sort(
          (a, b) => (b.primary.rating_5based ?? 0) - (a.primary.rating_5based ?? 0),
        );
        return { id: c.category_id, name: c.category_name, groups };
      })
      .filter((r) => r.groups.length > 0);
    railsCache.set(allSeries, { categories, rails: built });
    return built;
  }, [allSeries, categories]);

  // Mont progressif des rails (overview) → premier paint rapide au retour d'onglet.
  const visibleRails = useProgressiveList(rails, INITIAL_RAILS, RAILS_CHUNK);

  // ── Tendances TMDB → rail « Populaires » ───────────────────────────────────
  // Gate sur `isPremium` (source de vérité réactive) : si l'abonnement se résout
  // après le catalogue, l'effet re-tourne. On retient le backdrop paysage TMDB
  // par entrée (le hero a besoin d'une image 16:9 HD, absente côté Xtream).
  useEffect(() => {
    if (trendingDone.current || !allSeries || allGroups.length === 0) return;
    if (!isPremium) return;
    trendingDone.current = true;
    tmdbService
      .getTrending('tv')
      .then((trend) => {
        const map = new Map(allGroups.map((g) => [g.key, g] as const));
        const matched: PopularEntry[] = [];
        for (const tr of trend) {
          const g = map.get(titleKey(tr.title));
          if (g) matched.push({ group: g, backdrop: tr.backdrop, overview: tr.overview });
          if (matched.length >= 18) break;
        }
        if (matched.length >= 4) setPopular(matched);
        // Rien (TMDB pas encore activé / aucun match) → autorise une relance.
        else trendingDone.current = false;
      })
      .catch(() => {
        trendingDone.current = false;
      });
  }, [allSeries, allGroups, isPremium]);

  // ── Rail « Ma Liste » (séries favorites matchées au catalogue) ─────────────
  const favGroups = useMemo(() => {
    const favs = favorites.filter((f) => f.type === 'series');
    if (favs.length === 0) return [];
    const byId = new Map(allGroups.map((g) => [String(g.primary.series_id), g] as const));
    const out: TitleGroup<SeriesItem>[] = [];
    for (const f of favs) {
      const g = byId.get(f.id);
      if (g) out.push(g);
    }
    return out;
  }, [favorites, allGroups]);

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

  const renderCard = (g: TitleGroup<SeriesItem>, railCard: boolean, priority = false) => (
    <PreviewCard
      key={g.primary.series_id}
      className={railCard ? styles.posterCell : undefined}
      priority={priority}
      title={g.title}
      image={g.primary.cover}
      backdrop={g.primary.backdrop_path?.[0]}
      synopsis={g.primary.plot}
      meta={[
        g.year,
        star5Label(g.primary.rating_5based),
        g.primary.genre?.split('/')[0].trim(),
      ]
        .filter(Boolean)
        .join(' · ')}
      variant="series"
      isFavorite={isFavorite('series', String(g.primary.series_id))}
      trailerUrl={g.primary.youtube_trailer}
      resolveTrailer={() => tmdbService.getTrailer('tv', g.title, g.year)}
      resolvePoster={() => tmdbService.lookupPoster('tv', g.title, g.year)}
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

  // ── Top 10 « Populaires » : items du spotlight coverflow (carte hero + numéro
  //    de rang doré). Visuel HD + synopsis depuis TMDB (repli Xtream). ─────────
  const top10Items: Top10SpotlightItem[] = popular.slice(0, 10).map(({ group: g, backdrop, overview }, i) => ({
    id: g.primary.series_id,
    rank: i + 1,
    title: g.title,
    backdrop: backdrop ?? g.primary.backdrop_path?.[0] ?? g.primary.cover,
    ratingBadge: g.primary.rating_5based > 0 ? (g.primary.rating_5based * 2).toFixed(1) : undefined,
    meta: [g.year, g.primary.genre?.split('/')[0].trim()].filter(Boolean) as string[],
    synopsis: overview ?? g.primary.plot,
    isFavorite: isFavorite('series', String(g.primary.series_id)),
    onOpen: () => openSeries(g),
    onPlay: () =>
      navigate(`/series/${g.primary.series_id}`, {
        state: { series: g.primary, variants: g.variants, autoplay: true },
      }),
    onFavorite: () =>
      toggleFavorite({
        type: 'series',
        id: String(g.primary.series_id),
        name: g.title,
        image: g.primary.cover ?? '',
      }),
  }));

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
            {visibleGrid.map((g, i) => renderCard(g, false, i < EAGER_COUNT))}
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
        <div className={`${styles.titleBlock} ${styles.titleBlockRow}`}>
          <div>
            <h1 className={styles.title}>{t('series.title')}</h1>
            <p className={styles.pageSub}>
              {isGlobalSearch
                ? t('live.globalSearch')
                : tc('series.countOne', 'series.countOther', allGroups.length)}
            </p>
          </div>
          <button
            className={`${styles.searchToggleBtn} ${showSearch ? styles.searchToggleActive : ''}`}
            aria-label={t('series.searchPlaceholder')}
            aria-expanded={showSearch}
            onClick={() => {
              setShowSearch((s) => !s);
              if (showSearch) setSearch('');
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </button>
        </div>
        <div className={`${styles.searchOuter} ${showSearch ? styles.searchOpen : ''}`}>
          <RemoteSearch
            value={search}
            onChange={setSearch}
            placeholder={t('series.searchPlaceholder')}
            wrapperClassName={styles.searchWrapper}
            iconClassName={styles.searchIcon}
            inputClassName={styles.search}
            clearClassName={styles.searchClear}
          />
        </div>
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
          {visibleGrid.map((g, i) => renderCard(g, false, i < EAGER_COUNT))}
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
          {!isPremium ? (
            <section className={styles.shelf}>
              <PopularLocked />
            </section>
          ) : popular.length > 0 ? (
            <section className={styles.shelf}>
              <Top10Spotlight items={top10Items} />
            </section>
          ) : null}
          {favGroups.length > 0 && (
            <Shelf
              title={t('common.myList')}
              count={favGroups.length}
              seeAllLabel={t('common.seeAll')}
              onSeeAll={() => navigate('/favorites')}
            >
              {favGroups.slice(0, RAIL_PREVIEW).map((g) => renderCard(g, true))}
              {favGroups.length > RAIL_PREVIEW && (
                <SeeAllCard label={t('common.seeAll')} onClick={() => navigate('/favorites')} />
              )}
            </Shelf>
          )}
          {visibleRails.map((r) => (
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
          {rails.length === 0 && favGroups.length === 0 && (
            <p className={styles.empty}>{t('series.none')}</p>
          )}
        </div>
      )}
    </div>
  );
}
