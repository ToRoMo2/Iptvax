import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useSocial } from '../contexts/SocialContext';
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

const TYPE_TABS: { v: WatchedTypeFilter; label: string }[] = [
  { v: 'all', label: 'Tout' },
  { v: 'movie', label: 'Films' },
  { v: 'series', label: 'Séries' },
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

const FACET_CAP = 14;
const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

export function MemberCine() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { activeProfile } = useIptvProfile();
  const { isFollowing, toggleFollow, memberRating, rateMember, clearMemberRating } =
    useSocial();

  const [stats, setStats] = useState<PublicProfileStats | null>(null);
  const [watched, setWatched] = useState<WatchedTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<WatchedFilter>({
    type: 'all',
    status: 'all',
  });
  const [sort, setSort] = useState<WatchedSort>('recent');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
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
          ariaLabel="Retour à la communauté"
        >
          ← Communauté
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
                {stats.watchedCount} vu{stats.watchedCount !== 1 ? 's' : ''} ·{' '}
                {stats.ratedCount} noté{stats.ratedCount !== 1 ? 's' : ''} · ★{' '}
                {fmt(stats.avgRating)} · {stats.followers} abonné
                {stats.followers !== 1 ? 's' : ''}
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
                  {isFollowing(stats.id) ? '✓ Suivi' : '+ Suivre'}
                </Focusable>
                <div className={styles.rateMember}>
                  <span className={styles.rateLabel}>Votre avis sur ce membre</span>
                  <div className={styles.rateRow}>
                    <RatingStars
                      value={memberRating(stats.id) ?? null}
                      step={1}
                      min={1}
                      size={22}
                      onChange={(v) => rateMember(stats.id, v)}
                      focusKey="rc-member-rate"
                      ariaLabel="Noter ce membre sur 5"
                    />
                    {memberRating(stats.id) != null && (
                      <button
                        className={styles.clearLink}
                        onClick={() => clearMemberRating(stats.id)}
                      >
                        Effacer
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
        <p className={browse.empty}>
          Ce membre n'existe pas ou a rendu son ciné privé.
        </p>
      )}

      {!loading && stats && watched.length === 0 && (
        <p className={browse.empty}>Ce membre n'a encore rien partagé.</p>
      )}

      {!loading && stats && watched.length > 0 && (
        <div className={styles.layout}>
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

            {FACET_GROUPS.map(({ kind, label, field }) => {
              const fl = facets[kind];
              if (fl.length === 0) return null;
              const open = expanded[kind];
              const shown = open ? fl : fl.slice(0, FACET_CAP);
              return (
                <div key={kind} className={styles.filterGroup}>
                  <span className={styles.filterLabel}>{label}</span>
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
                        {open ? 'Réduire' : `+${fl.length - FACET_CAP}`}
                      </button>
                    )}
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
                  {s.label}
                </Focusable>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className={browse.empty}>Aucun titre pour ces filtres.</p>
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
                <span className={styles.panelUnrated}>Vu · non noté</span>
              )}
              {viewing.review ? (
                <p className={styles.panelReview}>{viewing.review}</p>
              ) : (
                <p className={styles.panelNoReview}>Pas de critique.</p>
              )}
              <button
                className={styles.panelClose}
                onClick={() => setViewing(null)}
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
