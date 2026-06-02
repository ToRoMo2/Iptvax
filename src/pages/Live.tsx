import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import { MediaCard } from '../components/MediaCard';
import { RemoteSearch } from '../components/RemoteSearch';
import { ScrollRail } from '../components/ScrollRail';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { safeImgUrl } from '../utils/image';
import { channelCode } from '../utils/channel';
import { groupByTitle, qualityLabel, qualityRank, type TitleGroup } from '../utils/catalog';
import type { LiveCategory, LiveStream, PlayerState } from '../types/xtream.types';
import styles from './Browse.module.css';
import live from './Live.module.css';

const MIN_SEARCH_LEN = 3;
const RESULT_LIMIT = 80;
// Nombre de cartes affichées dans un rail avant la carte « Voir tout ».
const RAIL_PREVIEW = 12;

type LiveGroup = TitleGroup<LiveStream>;

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
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z" /></svg>
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

export function Live() {
  const { credentials } = useXtream();
  const { favorites, isFavorite, toggleFavorite } = useLibrary();
  const { t, tc } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Mode « catégorie complète » : /live?cat=<id> → grille de cette catégorie.
  const activeCat = searchParams.get('cat');

  const [categories, setCategories] = useState<LiveCategory[]>([]);
  // Catalogue COMPLET chargé une seule fois → bucketé par catégorie côté client
  // (chaque LiveStream porte son category_id). Une seule requête sert les rails,
  // la grille d'une catégorie ET la recherche globale (même schéma que Movies).
  const [allStreams, setAllStreams] = useState<LiveStream[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  // Bottom-sheet « choix de qualité » d'une chaîne regroupant ≥ 2 variantes.
  const [sheet, setSheet] = useState<{ group: LiveGroup; list: LiveGroup[] } | null>(null);

  // ── Chargement catégories + catalogue complet ──────────────────────────────
  useEffect(() => {
    if (!credentials) return;
    setLoading(true);
    Promise.all([
      xtreamService.getLiveCategories(credentials),
      xtreamService.getLiveStreams(credentials),
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

  // ── Catalogue dédupliqué (count + base recherche). Le rang qualité choisit la
  // meilleure variante comme `primary` et trie les variantes (meilleure d'abord). ──
  const allGroups = useMemo(
    () => groupByTitle(allStreams ?? [], (s) => s.name, (s) => qualityRank(s.name)),
    [allStreams],
  );

  // ── Rails par catégorie : bucket par category_id puis groupage par titre ────
  const rails = useMemo(() => {
    if (!allStreams) return [];
    const byCat = new Map<string, LiveStream[]>();
    for (const s of allStreams) {
      const arr = byCat.get(s.category_id);
      if (arr) arr.push(s);
      else byCat.set(s.category_id, [s]);
    }
    return categories
      .map((c) => {
        const bucket = byCat.get(c.category_id) ?? [];
        const groups = groupByTitle(bucket, (s) => s.name, (s) => qualityRank(s.name));
        return { id: c.category_id, name: c.category_name, groups };
      })
      .filter((r) => r.groups.length > 0);
  }, [allStreams, categories]);

  // ── Résultats de recherche (filtre sur le catalogue dédupliqué) ────────────
  const searchGroups = useMemo(() => {
    if (!isGlobalSearch) return [];
    const q = query.toLowerCase();
    const out: LiveGroup[] = [];
    for (const g of allGroups) {
      if (g.title.toLowerCase().includes(q) || g.primary.name.toLowerCase().includes(q)) {
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

  // ── Lecture ──────────────────────────────────────────────────────────────
  // `listGroups` = liste ordonnée de la zone tapée (rail ou grille) → snapshot
  // prev/next dans le lecteur (un item = une chaîne, sa meilleure qualité).
  const playVariant = (g: LiveGroup, variant: LiveStream, listGroups: LiveGroup[]) => {
    if (!credentials) return;
    const liveChannels = listGroups.map((gr) => ({
      stream_id: gr.primary.stream_id,
      name: gr.title || gr.primary.name,
      stream_icon: gr.primary.stream_icon,
    }));
    const idx = listGroups.findIndex((gr) => gr.key === g.key);
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, variant.stream_id),
      fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, variant.stream_id),
      title: g.title || variant.name,
      type: 'live',
      poster: g.primary.stream_icon,
      liveChannels,
      liveIndex: idx < 0 ? 0 : idx,
    };
    navigate('/player', { state });
  };

  // Chaîne à variante unique → plein écran direct. Chaîne regroupée → sheet.
  const handleGroupClick = (g: LiveGroup, listGroups: LiveGroup[]) => {
    if (g.variants.length > 1) setSheet({ group: g, list: listGroups });
    else playVariant(g, g.primary, listGroups);
  };

  // ── Rail « Ma Liste » (chaînes favorites) ──────────────────────────────────
  // Zapping restreint aux favoris (liste nommée → catégorie synthétique dans
  // l'overlay), exactement comme la page Favoris.
  const favChannels = useMemo(() => favorites.filter((f) => f.type === 'live'), [favorites]);
  const playFavoriteChannel = (index: number) => {
    if (!credentials) return;
    const liveChannels = favChannels.map((c) => ({
      stream_id: Number(c.id),
      name: c.name,
      stream_icon: c.image,
    }));
    const fav = favChannels[index];
    const streamId = Number(fav.id);
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, streamId),
      fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, streamId),
      title: fav.name,
      type: 'live',
      poster: fav.image,
      liveChannels,
      liveIndex: index < 0 ? 0 : index,
      liveListLabel: t('common.myList'),
    };
    navigate('/player', { state });
  };

  const groupBadge = (g: LiveGroup): string | undefined => {
    if (g.variants.length < 2) return undefined;
    const top = qualityLabel(g.primary.name, '');
    return top ? `${top} +${g.variants.length - 1}` : tc('live.qualityCountOne', 'live.qualityCountOther', g.variants.length);
  };

  const renderCard = (g: LiveGroup, listGroups: LiveGroup[], railCard: boolean) => {
    const card = (
      <MediaCard
        key={g.primary.stream_id}
        title={g.title || g.primary.name}
        image={g.primary.stream_icon}
        variant="channel"
        isLive
        isFavorite={isFavorite('live', String(g.primary.stream_id))}
        badge={groupBadge(g)}
        onClick={() => handleGroupClick(g, listGroups)}
        onFavorite={() =>
          toggleFavorite({
            type: 'live',
            id: String(g.primary.stream_id),
            name: g.title || g.primary.name,
            image: g.primary.stream_icon ?? '',
          })
        }
      />
    );
    return railCard ? (
      <div key={g.primary.stream_id} className={live.channelCell}>{card}</div>
    ) : (
      card
    );
  };

  // ── Mode CATÉGORIE COMPLÈTE (?cat=) ─────────────────────────────────────────
  if (activeCat) {
    return (
      <div className={styles.page}>
        <header className={styles.catHeader}>
          <button className={styles.backBtn} onClick={() => navigate('/live')} aria-label={t('common.backWord')}>
            <BackIcon />
          </button>
          <h1 className={styles.catTitle}>{catName || t('live.title')}</h1>
        </header>

        {error && <div className={styles.error}>⚠ {error}</div>}

        {loading ? (
          <div className={`${styles.grid} ${styles.gridChannel}`}>
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className={`${styles.skeleton} ${styles.skeletonChannel}`} />
            ))}
          </div>
        ) : (
          <div className={`${styles.grid} ${styles.gridChannel}`}>
            {visibleGrid.map((g) => renderCard(g, gridSource, false))}
          </div>
        )}

        {!loading && gridSource.length === 0 && !error && (
          <p className={styles.empty}>{t('live.none')}</p>
        )}

        {sheet && (
          <QualitySheet
            group={sheet.group}
            onClose={() => setSheet(null)}
            onPick={(variant) => { playVariant(sheet.group, variant, sheet.list); setSheet(null); }}
          />
        )}
      </div>
    );
  }

  // ── Mode OVERVIEW (rails) + recherche globale ───────────────────────────────
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('live.title')}</h1>
          <p className={styles.pageSub}>
            {isGlobalSearch
              ? tc('live.globalResultsOne', 'live.globalResultsOther', searchGroups.length)
              : tc('live.countOne', 'live.countOther', allGroups.length)}
          </p>
        </div>
        <RemoteSearch
          value={search}
          onChange={setSearch}
          placeholder={t('live.searchPlaceholder')}
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
            {tc('live.badgeOne', 'live.badgeOther', searchGroups.length, {
              count: `${searchGroups.length}${searchGroups.length >= RESULT_LIMIT ? '+' : ''}`,
            })}
          </span>
        )}
      </header>

      {error && <div className={styles.error}>⚠ {error}</div>}

      {isGlobalSearch ? (
        <div className={`${styles.grid} ${styles.gridChannel}`}>
          {visibleGrid.map((g) => renderCard(g, searchGroups, false))}
          {searchGroups.length === 0 && !loading && (
            <p className={styles.empty}>{t('live.none')}</p>
          )}
        </div>
      ) : loading ? (
        <div className={`${styles.grid} ${styles.gridChannel}`}>
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className={`${styles.skeleton} ${styles.skeletonChannel}`} />
          ))}
        </div>
      ) : (
        <div className={styles.shelves}>
          {favChannels.length > 0 && (
            <Shelf
              title={t('common.myList')}
              count={favChannels.length}
              seeAllLabel={t('common.seeAll')}
              onSeeAll={() => navigate('/favorites')}
            >
              {favChannels.map((c, i) => (
                <div key={c.id} className={live.channelCell}>
                  <MediaCard
                    title={c.name}
                    image={c.image}
                    variant="channel"
                    isLive
                    isFavorite={isFavorite('live', c.id)}
                    onClick={() => playFavoriteChannel(i)}
                    onFavorite={() => toggleFavorite(c)}
                  />
                </div>
              ))}
            </Shelf>
          )}
          {rails.map((r) => (
            <Shelf
              key={r.id}
              title={r.name}
              count={r.groups.length}
              seeAllLabel={t('common.seeAll')}
              onSeeAll={() => navigate(`/live?cat=${encodeURIComponent(r.id)}`)}
            >
              {r.groups.slice(0, RAIL_PREVIEW).map((g) => renderCard(g, r.groups, true))}
              {r.groups.length > RAIL_PREVIEW && (
                <div className={live.channelCell}>
                  <button
                    type="button"
                    className={live.seeAllChannel}
                    onClick={() => navigate(`/live?cat=${encodeURIComponent(r.id)}`)}
                  >
                    <span className={styles.seeAllIcon}><GridIcon /></span>
                    <span className={live.seeAllChannelLabel}>{t('common.seeAll')}</span>
                  </button>
                </div>
              )}
            </Shelf>
          ))}
          {rails.length === 0 && favChannels.length === 0 && (
            <p className={styles.empty}>{t('live.none')}</p>
          )}
        </div>
      )}

      {sheet && (
        <QualitySheet
          group={sheet.group}
          onClose={() => setSheet(null)}
          onPick={(variant) => { playVariant(sheet.group, variant, sheet.list); setSheet(null); }}
        />
      )}
    </div>
  );
}

// ── Bottom-sheet : choix de la qualité d'une chaîne regroupée ────────────────
function QualitySheet({
  group,
  onClose,
  onPick,
}: {
  group: LiveGroup;
  onClose: () => void;
  onPick: (variant: LiveStream) => void;
}) {
  const { t } = useI18n();
  const logo = safeImgUrl(group.primary.stream_icon);
  return (
    <div className={live.sheetBackdrop} onClick={onClose} role="presentation">
      <div className={live.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={live.sheetHead}>
          <div className={live.sheetLogo}>
            {logo ? <img src={logo} alt={group.title} /> : <span className={live.sheetCode}>{channelCode(group.title || group.primary.name)}</span>}
          </div>
          <div className={live.sheetTitleBox}>
            <span className={live.sheetTitle}>{group.title || group.primary.name}</span>
            <span className={live.sheetSub}>{t('live.qualityTitle')}</span>
          </div>
        </div>
        <div className={live.sheetList}>
          {group.variants.map((v, i) => (
            <button
              key={v.stream_id}
              type="button"
              className={live.qualityRow}
              onClick={() => onPick(v)}
            >
              <span className={live.qualityName}>
                {qualityLabel(v.name, t('detail.source', { n: i + 1 }))}
              </span>
              <span className={live.qualityPlay}><PlayIcon /></span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
