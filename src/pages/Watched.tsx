import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRatings } from '../contexts/RatingsContext';
import { WatchedCard } from '../components/WatchedCard/WatchedCard';
import { Focusable } from '../components/Focusable';
import {
  buildFacets,
  filterWatched,
  sortWatched,
  computeStats,
} from '../utils/ratings';
import type {
  WatchedFilter,
  WatchedSort,
  WatchedTypeFilter,
  RatingStatusFilter,
  FacetKind,
} from '../types/ratings.types';
import browse from './Browse.module.css';
import styles from './Watched.module.css';

const TYPE_TABS: { v: WatchedTypeFilter; label: string }[] = [
  { v: 'all', label: 'Tout' },
  { v: 'movie', label: 'Films' },
  { v: 'series', label: 'Séries' },
];

const STATUS_TABS: { v: RatingStatusFilter; label: string }[] = [
  { v: 'all', label: 'Tous' },
  { v: 'unrated', label: 'À noter' },
  { v: 'rated', label: 'Notés' },
];

const SORTS: { v: WatchedSort; label: string }[] = [
  { v: 'recent', label: 'Récents' },
  { v: 'rating-desc', label: 'Mieux notés' },
  { v: 'rating-asc', label: 'Moins bien notés' },
  { v: 'title', label: 'Titre' },
  { v: 'year', label: 'Année' },
];

const FACET_GROUPS: { kind: FacetKind; label: string; field: keyof WatchedFilter }[] = [
  { kind: 'genre', label: 'Genres', field: 'genre' },
  { kind: 'director', label: 'Réalisateurs', field: 'director' },
  { kind: 'cast', label: 'Acteurs', field: 'castName' },
];

const FACET_CAP = 16;
const fmtAvg = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

export function Watched() {
  const { watched, loading, removeWatched } = useRatings();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<WatchedFilter>({
    type: 'all',
    status: 'all',
  });
  const [sort, setSort] = useState<WatchedSort>('recent');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const stats = useMemo(() => computeStats(watched), [watched]);

  // Facettes calculées sur le sous-ensemble type courant (genres/acteurs/réal
  // pertinents pour Films vs Séries), indépendamment du filtre de facette actif.
  const facetBase = useMemo(
    () =>
      filterWatched(watched, {
        type: filter.type,
        status: 'all',
      }),
    [watched, filter.type],
  );

  const facets = useMemo(
    () => ({
      genre: buildFacets(facetBase, 'genre'),
      director: buildFacets(facetBase, 'director'),
      cast: buildFacets(facetBase, 'cast'),
    }),
    [facetBase],
  );

  const visible = useMemo(
    () => sortWatched(filterWatched(watched, filter), sort),
    [watched, filter, sort],
  );

  const openItem = (contentType: string, contentId: string) => {
    const num = contentId.replace(/^(movie|series)-/, '');
    navigate(contentType === 'series' ? `/series/${num}` : `/movie/${num}`);
  };

  const activeFacet = (field: keyof WatchedFilter): string | undefined =>
    filter[field] as string | undefined;

  const toggleFacet = (field: keyof WatchedFilter, value: string) =>
    setFilter((f) => ({
      ...f,
      [field]: f[field] === value ? undefined : value,
    }));

  const hasActiveFilters =
    filter.type !== 'all' ||
    filter.status !== 'all' ||
    filter.genre ||
    filter.castName ||
    filter.director;

  return (
    <div className={browse.page}>
      <header className={browse.header}>
        <div className={browse.titleBlock}>
          <h1 className={browse.title}>Mon ciné</h1>
          <p className={browse.pageSub}>
            {loading
              ? 'Chargement…'
              : `${stats.total} titre${stats.total !== 1 ? 's' : ''} vu${
                  stats.total !== 1 ? 's' : ''
                } · note moyenne ★ ${fmtAvg(stats.avg)}`}
          </p>
        </div>
        {!loading && stats.unrated > 0 && (
          <Focusable
            className={styles.unratedCta}
            onEnter={() => setFilter((f) => ({ ...f, status: 'unrated' }))}
            onClick={() => setFilter((f) => ({ ...f, status: 'unrated' }))}
          >
            {stats.unrated} à noter →
          </Focusable>
        )}
        <Focusable
          className={styles.communityBtn}
          onEnter={() => navigate('/communaute')}
          onClick={() => navigate('/communaute')}
        >
          Communauté →
        </Focusable>
      </header>

      {loading && (
        <div className={browse.gridLoading}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div
              key={i}
              className={`${browse.skeleton} ${browse.skeletonPoster}`}
            />
          ))}
        </div>
      )}

      {!loading && stats.total === 0 && (
        <p className={browse.empty}>
          Aucun visionnage pour l'instant. Terminez un film (&gt;90 %) ou notez
          un film / une série depuis sa fiche : il apparaîtra ici.
        </p>
      )}

      {!loading && stats.total > 0 && (
        <div className={styles.layout}>
          {/* ── Filtres latéraux ── */}
          <aside className={styles.sidebar}>
            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Type</span>
              <div className={styles.tabs}>
                {TYPE_TABS.map((t) => (
                  <Focusable
                    key={t.v}
                    className={`${styles.tab} ${
                      filter.type === t.v ? styles.tabActive : ''
                    }`}
                    onEnter={() => setFilter((f) => ({ ...f, type: t.v }))}
                    onClick={() => setFilter((f) => ({ ...f, type: t.v }))}
                  >
                    {t.label}
                  </Focusable>
                ))}
              </div>
            </div>

            <div className={styles.filterGroup}>
              <span className={styles.filterLabel}>Statut de note</span>
              <div className={styles.tabs}>
                {STATUS_TABS.map((t) => (
                  <Focusable
                    key={t.v}
                    className={`${styles.tab} ${
                      filter.status === t.v ? styles.tabActive : ''
                    }`}
                    onEnter={() => setFilter((f) => ({ ...f, status: t.v }))}
                    onClick={() => setFilter((f) => ({ ...f, status: t.v }))}
                  >
                    {t.label}
                  </Focusable>
                ))}
              </div>
            </div>

            {FACET_GROUPS.map(({ kind, label, field }) => {
              const list = facets[kind];
              if (list.length === 0) return null;
              const isOpen = expanded[kind];
              const shown = isOpen ? list : list.slice(0, FACET_CAP);
              return (
                <div key={kind} className={styles.filterGroup}>
                  <span className={styles.filterLabel}>{label}</span>
                  <div className={styles.chips}>
                    {shown.map((fc) => (
                      <Focusable
                        key={fc.key}
                        className={`${styles.chip} ${
                          activeFacet(field) === fc.label
                            ? styles.chipActive
                            : ''
                        }`}
                        onEnter={() => toggleFacet(field, fc.label)}
                        onClick={() => toggleFacet(field, fc.label)}
                        title={
                          fc.avg != null
                            ? `${fc.label} · ${fc.count} · moy. ★ ${fmtAvg(
                                fc.avg,
                              )}`
                            : `${fc.label} · ${fc.count}`
                        }
                      >
                        <span className={styles.chipLabel}>{fc.label}</span>
                        <span className={styles.chipCount}>{fc.count}</span>
                      </Focusable>
                    ))}
                    {list.length > FACET_CAP && (
                      <button
                        className={styles.moreBtn}
                        onClick={() =>
                          setExpanded((e) => ({ ...e, [kind]: !e[kind] }))
                        }
                      >
                        {isOpen ? 'Réduire' : `+${list.length - FACET_CAP}`}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </aside>

          {/* ── Résultats ── */}
          <section className={styles.results}>
            <div className={styles.resultsBar}>
              <span className={styles.resultsCount}>
                {visible.length} résultat{visible.length !== 1 ? 's' : ''}
              </span>
              <div className={styles.sortRow}>
                {SORTS.map((s) => (
                  <Focusable
                    key={s.v}
                    className={`${styles.sortPill} ${
                      sort === s.v ? styles.sortActive : ''
                    }`}
                    onEnter={() => setSort(s.v)}
                    onClick={() => setSort(s.v)}
                  >
                    {s.label}
                  </Focusable>
                ))}
              </div>
            </div>

            {visible.length === 0 ? (
              <p className={browse.empty}>
                Aucun titre ne correspond à ces filtres.
                {hasActiveFilters && (
                  <>
                    {' '}
                    <button
                      className={styles.moreBtn}
                      onClick={() =>
                        setFilter({ type: 'all', status: 'all' })
                      }
                    >
                      Réinitialiser
                    </button>
                  </>
                )}
              </p>
            ) : (
              <div className={`${browse.grid} ${browse.gridPoster}`}>
                {visible.map((it) => (
                  <WatchedCard
                    key={`${it.contentType}:${it.titleKey}`}
                    item={it}
                    onOpen={() => openItem(it.contentType, it.contentId)}
                    onRemove={() =>
                      removeWatched(it.contentType, it.titleKey)
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
