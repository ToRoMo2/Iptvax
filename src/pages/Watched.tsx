import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useRatings } from '../contexts/RatingsContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslationKey } from '../i18n';
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

const TYPE_TABS: { v: WatchedTypeFilter; labelKey: TranslationKey }[] = [
  { v: 'all', labelKey: 'watched.typeAll' },
  { v: 'movie', labelKey: 'watched.typeMovie' },
  { v: 'series', labelKey: 'watched.typeSeries' },
];

const STATUS_TABS: { v: RatingStatusFilter; labelKey: TranslationKey }[] = [
  { v: 'all', labelKey: 'watched.statusAll' },
  { v: 'unrated', labelKey: 'watched.statusUnrated' },
  { v: 'rated', labelKey: 'watched.statusRated' },
];

const SORTS: { v: WatchedSort; labelKey: TranslationKey }[] = [
  { v: 'recent', labelKey: 'watched.sortRecent' },
  { v: 'rating-desc', labelKey: 'watched.sortRatingDesc' },
  { v: 'rating-asc', labelKey: 'watched.sortRatingAsc' },
  { v: 'title', labelKey: 'watched.sortTitle' },
  { v: 'year', labelKey: 'watched.sortYear' },
];

const FACET_GROUPS: { kind: FacetKind; labelKey: TranslationKey; field: keyof WatchedFilter }[] = [
  { kind: 'genre', labelKey: 'watched.genres', field: 'genre' },
  { kind: 'director', labelKey: 'watched.directors', field: 'director' },
  { kind: 'cast', labelKey: 'watched.actors', field: 'castName' },
];

const FACET_CAP = 16;
const fmtAvg = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

export function Watched() {
  const { watched, loading, removeWatched } = useRatings();
  const { t, tc } = useI18n();
  const navigate = useNavigate();

  const [filter, setFilter] = useState<WatchedFilter>({
    type: 'all',
    status: 'all',
  });
  const [sort, setSort] = useState<WatchedSort>('recent');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Sections de filtre pliables (mobile uniquement, voir Watched.module.css).
  // Sur desktop la CSS force toujours `.filterBody` à `display: flex` —
  // l'état est ignoré. Clés : 'type' | 'status' | 'genre' | 'director' | 'cast'.
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (k: string) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));

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
          <h1 className={browse.title}>{t('watched.title')}</h1>
          <p className={browse.pageSub}>
            {loading
              ? t('common.loading')
              : tc('watched.statsOne', 'watched.statsOther', stats.total, {
                  avg: fmtAvg(stats.avg),
                })}
          </p>
        </div>
        {!loading && stats.unrated > 0 && (
          <Focusable
            className={styles.unratedCta}
            onEnter={() => setFilter((f) => ({ ...f, status: 'unrated' }))}
            onClick={() => setFilter((f) => ({ ...f, status: 'unrated' }))}
          >
            {t('watched.toRate', { count: stats.unrated })}
          </Focusable>
        )}
        <Focusable
          className={styles.communityBtn}
          onEnter={() => navigate('/communaute')}
          onClick={() => navigate('/communaute')}
        >
          {t('watched.community')}
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
        <p className={browse.empty}>{t('watched.empty')}</p>
      )}

      {!loading && stats.total > 0 && (
        <div className={styles.layout}>
          {/* ── Filtres latéraux ── */}
          <aside className={styles.sidebar}>
            <div className={styles.filterGroup}>
              <button
                type="button"
                className={`${styles.filterHead} ${openSections.type ? styles.filterHeadOpen : ''}`}
                onClick={() => toggleSection('type')}
              >
                <span className={styles.filterLabel}>{t('watched.type')}</span>
                <svg className={styles.filterChev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div className={`${styles.filterBody} ${openSections.type ? styles.filterBodyOpen : ''}`}>
                <div className={styles.tabs}>
                  {TYPE_TABS.map((tab) => (
                    <Focusable
                      key={tab.v}
                      className={`${styles.tab} ${
                        filter.type === tab.v ? styles.tabActive : ''
                      }`}
                      onEnter={() => setFilter((f) => ({ ...f, type: tab.v }))}
                      onClick={() => setFilter((f) => ({ ...f, type: tab.v }))}
                    >
                      {t(tab.labelKey)}
                    </Focusable>
                  ))}
                </div>
              </div>
            </div>

            <div className={styles.filterGroup}>
              <button
                type="button"
                className={`${styles.filterHead} ${openSections.status ? styles.filterHeadOpen : ''}`}
                onClick={() => toggleSection('status')}
              >
                <span className={styles.filterLabel}>{t('watched.statusLabel')}</span>
                <svg className={styles.filterChev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="m6 9 6 6 6-6"/></svg>
              </button>
              <div className={`${styles.filterBody} ${openSections.status ? styles.filterBodyOpen : ''}`}>
                <div className={styles.tabs}>
                  {STATUS_TABS.map((tab) => (
                    <Focusable
                      key={tab.v}
                      className={`${styles.tab} ${
                        filter.status === tab.v ? styles.tabActive : ''
                      }`}
                      onEnter={() => setFilter((f) => ({ ...f, status: tab.v }))}
                      onClick={() => setFilter((f) => ({ ...f, status: tab.v }))}
                    >
                      {t(tab.labelKey)}
                    </Focusable>
                  ))}
                </div>
              </div>
            </div>

            {FACET_GROUPS.map(({ kind, labelKey, field }) => {
              const list = facets[kind];
              if (list.length === 0) return null;
              const isOpen = expanded[kind];
              const shown = isOpen ? list : list.slice(0, FACET_CAP);
              const sectionOpen = openSections[kind];
              return (
                <div key={kind} className={styles.filterGroup}>
                  <button
                    type="button"
                    className={`${styles.filterHead} ${sectionOpen ? styles.filterHeadOpen : ''}`}
                    onClick={() => toggleSection(kind)}
                  >
                    <span className={styles.filterLabel}>{t(labelKey)}</span>
                    <svg className={styles.filterChev} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="m6 9 6 6 6-6"/></svg>
                  </button>
                  <div className={`${styles.filterBody} ${sectionOpen ? styles.filterBodyOpen : ''}`}>
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
                          {isOpen ? t('watched.collapse') : `+${list.length - FACET_CAP}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>

          {/* ── Résultats ── */}
          <section className={styles.results}>
            <div className={styles.resultsBar}>
              <span className={styles.resultsCount}>
                {tc('common.resultOne', 'common.resultOther', visible.length)}
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
                    {t(s.labelKey)}
                  </Focusable>
                ))}
              </div>
            </div>

            {visible.length === 0 ? (
              <p className={browse.empty}>
                {t('watched.noMatch')}
                {hasActiveFilters && (
                  <>
                    {' '}
                    <button
                      className={styles.moreBtn}
                      onClick={() =>
                        setFilter({ type: 'all', status: 'all' })
                      }
                    >
                      {t('common.reset')}
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
