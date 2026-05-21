import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useSocial } from '../contexts/SocialContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslationKey } from '../i18n';
import { socialService } from '../services/social.service';
import { WatchedCard } from '../components/WatchedCard/WatchedCard';
import { RatingStars } from '../components/RatingStars/RatingStars';
import { Focusable } from '../components/Focusable';
import { safeImgUrl } from '../utils/image';
import {
  buildFacets,
  filterWatched,
  sortWatched,
} from '../utils/ratings';
import type { WatchedTitle } from '../types/ratings.types';
import type {
  WatchedFilter,
  WatchedSort,
  WatchedTypeFilter,
  FacetKind,
} from '../types/ratings.types';
import type { PublicProfileStats } from '../types/social.types';
import browse from './Browse.module.css';
import styles from './MemberCine.module.css';

const TYPE_TABS: { v: WatchedTypeFilter; labelKey: TranslationKey }[] = [
  { v: 'all', labelKey: 'watched.typeAll' },
  { v: 'movie', labelKey: 'watched.typeMovie' },
  { v: 'series', labelKey: 'watched.typeSeries' },
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

const FACET_CAP = 14;
const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

export function MemberCine() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeProfile } = useIptvProfile();
  const { isFollowing, toggleFollow, memberRating, rateMember, clearMemberRating } =
    useSocial();
  const { t, tc } = useI18n();

  const [stats, setStats] = useState<PublicProfileStats | null>(null);
  const [watched, setWatched] = useState<WatchedTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WatchedFilter>({
    type: 'all',
    status: 'all',
  });
  const [sort, setSort] = useState<WatchedSort>('recent');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Sections de filtre pliables sur mobile (cf. MemberCine.module.css). Voir
  // §IV-22 CLAUDE.md — pattern partagé avec Watched (Mon Ciné perso).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (k: string) =>
    setOpenSections((s) => ({ ...s, [k]: !s[k] }));
  const [viewing, setViewing] = useState<WatchedTitle | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      socialService.getProfileStats(id),
      socialService.getMemberWatched(id),
    ]).then(([s, w]) => {
      if (cancelled) return;
      setStats(s);
      setWatched(w);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const facets = useMemo(
    () => ({
      genre: buildFacets(
        filterWatched(watched, { type: filter.type, status: 'all' }),
        'genre',
      ),
      director: buildFacets(
        filterWatched(watched, { type: filter.type, status: 'all' }),
        'director',
      ),
      cast: buildFacets(
        filterWatched(watched, { type: filter.type, status: 'all' }),
        'cast',
      ),
    }),
    [watched, filter.type],
  );

  const visible = useMemo(
    () => sortWatched(filterWatched(watched, filter), sort),
    [watched, filter, sort],
  );

  const isMe = id === activeProfile?.id;

  const activeFacet = (field: keyof WatchedFilter) =>
    filter[field] as string | undefined;
  const toggleFacet = (field: keyof WatchedFilter, value: string) =>
    setFilter((f) => ({ ...f, [field]: f[field] === value ? undefined : value }));

  return (
    <div className={browse.page}>
      <header className={styles.memberHead}>
        <Focusable
          className={styles.back}
          onEnter={() => navigate('/communaute')}
          onClick={() => navigate('/communaute')}
          ariaLabel={t('member.backAria')}
        >
          {t('member.backCommunity')}
        </Focusable>

        {stats && (
          <div className={styles.identRow}>
            <span
              className={styles.avatar}
              style={{ background: `var(--${stats.color})` }}
            >
              {stats.avatar}
            </span>
            <div className={styles.identText}>
              <h1 className={styles.handle}>
                {stats.name}
                {stats.discriminator && (
                  <span className={styles.disc}>#{stats.discriminator}</span>
                )}
              </h1>
              <p className={styles.statLine}>
                {tc('member.watchedOne', 'member.watchedOther', stats.watchedCount)} ·{' '}
                {tc('member.ratedOne', 'member.ratedOther', stats.ratedCount)} · ★{' '}
                {fmt(stats.avgRating)} ·{' '}
                {tc('member.followersOne', 'member.followersOther', stats.followers)}
              </p>
            </div>

            {!isMe && activeProfile && (
              <div className={styles.actions}>
                <Focusable
                  className={`${styles.followBtn} ${
                    isFollowing(stats.id) ? styles.following : ''
                  }`}
                  onEnter={() => toggleFollow(stats.id)}
                  onClick={() => toggleFollow(stats.id)}
                >
                  {isFollowing(stats.id) ? t('member.following') : t('member.follow')}
                </Focusable>
                <div className={styles.rateMember}>
                  <span className={styles.rateLabel}>{t('member.yourOpinion')}</span>
                  <div className={styles.rateRow}>
                    <RatingStars
                      value={memberRating(stats.id) ?? null}
                      step={1}
                      min={1}
                      size={22}
                      onChange={(v) => rateMember(stats.id, v)}
                      focusKey="rc-member-rate"
                      ariaLabel={t('member.rateAria')}
                    />
                    {memberRating(stats.id) != null && (
                      <button
                        className={styles.clearLink}
                        onClick={() => clearMemberRating(stats.id)}
                      >
                        {t('member.clear')}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
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

      {!loading && !stats && (
        <p className={browse.empty}>{t('member.notFound')}</p>
      )}

      {!loading && stats && watched.length === 0 && (
        <p className={browse.empty}>{t('member.nothingShared')}</p>
      )}

      {!loading && stats && watched.length > 0 && (
        <div className={styles.layout}>
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

            {FACET_GROUPS.map(({ kind, labelKey, field }) => {
              const fl = facets[kind];
              if (fl.length === 0) return null;
              const open = expanded[kind];
              const shown = open ? fl : fl.slice(0, FACET_CAP);
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
                            activeFacet(field) === fc.label ? styles.chipActive : ''
                          }`}
                          onEnter={() => toggleFacet(field, fc.label)}
                          onClick={() => toggleFacet(field, fc.label)}
                          title={`${fc.label} · ${fc.count}`}
                        >
                          <span className={styles.chipLabel}>{fc.label}</span>
                          <span className={styles.chipCount}>{fc.count}</span>
                        </Focusable>
                      ))}
                      {fl.length > FACET_CAP && (
                        <button
                          className={styles.moreBtn}
                          onClick={() =>
                            setExpanded((e) => ({ ...e, [kind]: !e[kind] }))
                          }
                        >
                          {open ? t('watched.collapse') : `+${fl.length - FACET_CAP}`}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </aside>

          <section className={styles.results}>
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

            {visible.length === 0 ? (
              <p className={browse.empty}>{t('member.noTitles')}</p>
            ) : (
              <div className={`${browse.grid} ${browse.gridPoster}`}>
                {visible.map((it) => (
                  <WatchedCard
                    key={`${it.contentType}:${it.titleKey}`}
                    item={it}
                    readOnly
                    onOpen={() => setViewing(it)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {viewing && (
        <div
          className={styles.overlay}
          onClick={() => setViewing(null)}
          role="presentation"
        >
          <div
            className={styles.panel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label={viewing.title}
          >
            {safeImgUrl(viewing.poster) && (
              <img
                src={safeImgUrl(viewing.poster)}
                alt={viewing.title}
                className={styles.panelPoster}
              />
            )}
            <div className={styles.panelBody}>
              <h2 className={styles.panelTitle}>
                {viewing.title}
                {viewing.year && (
                  <span className={styles.panelYear}> · {viewing.year}</span>
                )}
              </h2>
              {viewing.rating != null ? (
                <RatingStars value={viewing.rating} readOnly size={22} />
              ) : (
                <span className={styles.panelUnrated}>{t('member.watchedUnrated')}</span>
              )}
              {viewing.review ? (
                <p className={styles.panelReview}>{viewing.review}</p>
              ) : (
                <p className={styles.panelNoReview}>{t('member.noReview')}</p>
              )}
              <button
                className={styles.panelClose}
                onClick={() => setViewing(null)}
              >
                {t('member.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
