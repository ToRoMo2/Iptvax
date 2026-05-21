import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import { MediaCard } from '../components/MediaCard';
import { RemoteSearch } from '../components/RemoteSearch';
import { CategoryBar } from '../components/CategoryBar';
import { ChannelPreview } from '../components/ChannelPreview';
import { useProgressiveList } from '../hooks/useProgressiveList';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { safeImgUrl } from '../utils/image';
import { channelCode } from '../utils/channel';
import type { LiveCategory, LiveStream, EpgListing } from '../types/xtream.types';
import type { PlayerState } from '../types/xtream.types';
import styles from './Browse.module.css';
import live from './Live.module.css';

const MIN_SEARCH_LEN = 3;
const RESULT_LIMIT = 80;

// `title`/`description` EPG sont encodés en base64 (UTF-8) côté serveur Xtream.
function decodeB64(s: string): string {
  if (!s) return '';
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes).trim();
  } catch {
    return s;
  }
}

// "2026-05-16 19:00:00" → "19:00" (heure de programmation telle quelle).
function epgTime(raw: string): string {
  const m = /(\d{1,2}):(\d{2})/.exec(raw ?? '');
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

export function Live() {
  const { credentials } = useXtream();
  const { isFavorite, toggleFavorite } = useLibrary();
  const { t, tc } = useI18n();
  const navigate = useNavigate();
  // Mobile : le panneau latéral est masqué, l'aperçu monte INLINE dans la carte
  // sélectionnée (gain de place + UX native). Synchronisé avec le breakpoint CSS.
  const isMobile = useMediaQuery('(max-width: 640px)');

  const [categories, setCategories] = useState<LiveCategory[]>([]);
  const [streams, setStreams] = useState<LiveStream[]>([]);
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loadingCats, setLoadingCats] = useState(true);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Chaîne sélectionnée (panneau latéral + aperçu). Cliquer une 2ᵉ fois la même
  // chaîne ouvre le lecteur plein écran.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [epg, setEpg] = useState<EpgListing[]>([]);
  const [epgLoading, setEpgLoading] = useState(false);

  // Global search — préchargé au montage pour une recherche instantanée
  const [allStreams, setAllStreams] = useState<LiveStream[] | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const allLoadedRef = useRef(false);

  useEffect(() => {
    if (!credentials) return;
    setLoadingCats(true);
    xtreamService
      .getLiveCategories(credentials)
      .then((cats) => {
        setCategories(cats);
        if (cats.length > 0) setSelectedCat(cats[0].category_id);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingCats(false));
  }, [credentials]);

  useEffect(() => {
    if (!credentials || !selectedCat) return;
    setLoadingStreams(true);
    setStreams([]);
    xtreamService
      .getLiveStreams(credentials, selectedCat)
      .then(setStreams)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoadingStreams(false));
  }, [credentials, selectedCat]);

  useEffect(() => {
    if (!credentials || allLoadedRef.current) return;
    allLoadedRef.current = true;
    setLoadingAll(true);
    xtreamService
      .getLiveStreams(credentials)
      .then((all) => { setAllStreams(all); })
      .catch(() => { allLoadedRef.current = false; })
      .finally(() => setLoadingAll(false));
  }, [credentials]);

  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(id);
  }, [search]);

  // Changer de catégorie ou de recherche → la chaîne sélectionnée n'est plus
  // pertinente : on referme le panneau.
  useEffect(() => {
    setSelectedId(null);
  }, [selectedCat, query]);

  const isGlobalSearch = query.length >= MIN_SEARCH_LEN;

  const filtered = useMemo(() => {
    if (!isGlobalSearch) return streams;
    if (!allStreams) return [];
    const q = query.toLowerCase();
    const out: LiveStream[] = [];
    for (const s of allStreams) {
      if (s.name.toLowerCase().includes(q)) {
        out.push(s);
        if (out.length >= RESULT_LIMIT) break;
      }
    }
    return out;
  }, [streams, allStreams, query, isGlobalSearch]);

  const selectedStream = useMemo(
    () => filtered.find((s) => s.stream_id === selectedId) ?? null,
    [filtered, selectedId],
  );

  // Rendu progressif de la grille uniquement (cf. useProgressiveList).
  // `filtered` reste la source pour le panneau, l'index prev/next, le compteur.
  const visibleStreams = useProgressiveList(filtered);

  // EPG court de la chaîne sélectionnée. Strictement additif : un serveur sans
  // EPG renvoie une liste vide → l'UI retombe sur le nom de chaîne.
  useEffect(() => {
    if (!credentials || selectedId == null) {
      setEpg([]);
      return;
    }
    let cancelled = false;
    setEpgLoading(true);
    xtreamService
      .getShortEpg(credentials, selectedId, 12)
      .then((r) => { if (!cancelled) setEpg(r.epg_listings ?? []); })
      .catch(() => { if (!cancelled) setEpg([]); })
      .finally(() => { if (!cancelled) setEpgLoading(false); });
    return () => { cancelled = true; };
  }, [credentials, selectedId]);

  const goFullscreen = (stream: LiveStream) => {
    if (!credentials) return;
    // Snapshot de la liste actuellement visible (catégorie ou recherche)
    // pour permettre le switch prev/next depuis le lecteur.
    const liveChannels = filtered.map((s) => ({
      stream_id: s.stream_id,
      name: s.name,
      stream_icon: s.stream_icon,
    }));
    const liveIndex = filtered.findIndex((s) => s.stream_id === stream.stream_id);
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, stream.stream_id),
      // Fallback : MPEG-TS continu si le serveur ne sert pas le live en HLS
      fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, stream.stream_id),
      title: stream.name,
      type: 'live',
      poster: stream.stream_icon,
      liveChannels,
      liveIndex,
    };
    navigate('/player', { state });
  };

  // 1ᵉʳ clic sur une chaîne → sélection (panneau + aperçu).
  // Clic sur la chaîne déjà sélectionnée → lecteur plein écran.
  const handleCardClick = (stream: LiveStream) => {
    if (selectedId === stream.stream_id) goFullscreen(stream);
    else setSelectedId(stream.stream_id);
  };

  const catName = isGlobalSearch
    ? t('live.globalSearch')
    : categories.find((c) => c.category_id === selectedCat)?.category_name ??
      t('live.allCategories');

  // Certains panels Xtream renvoient chaque programme en double (même créneau,
  // l'un marqué `now_playing`). On dédoublonne par horaire de début, on décode
  // les champs base64 et on calcule l'état « en cours » UNE fois par fetch
  // (sinon ~3 décodages base64 par ligne à chaque rendu du parent).
  const epgRows = useMemo(() => {
    const nowSec = Date.now() / 1000;
    const byStart = new Map<string, EpgListing>();
    for (const p of epg) {
      const key = p.start_timestamp || p.start || p.id;
      const existing = byStart.get(key);
      if (!existing || (p.now_playing === 1 && existing.now_playing !== 1)) {
        byStart.set(key, p);
      }
    }
    return Array.from(byStart.values())
      .sort((a, b) => Number(a.start_timestamp) - Number(b.start_timestamp))
      .map((p) => {
        const s = Number(p.start_timestamp);
        const e = Number(p.stop_timestamp);
        const playing =
          p.now_playing === 1 ||
          (Number.isFinite(s) && Number.isFinite(e) && nowSec >= s && nowSec < e);
        const progress =
          Number.isFinite(s) && Number.isFinite(e) && e > s
            ? Math.min(100, Math.max(0, ((nowSec - s) / (e - s)) * 100))
            : 0;
        return {
          key: p.id || `${p.start_timestamp}-${p.start}`,
          time: epgTime(p.start),
          title: decodeB64(p.title),
          desc: decodeB64(p.description),
          playing,
          progress,
        };
      });
  }, [epg]);

  const showStreamSkeleton =
    (loadingStreams && !isGlobalSearch) || (isGlobalSearch && !allStreams);

  const selectedIcon = selectedStream ? safeImgUrl(selectedStream.stream_icon) : undefined;
  const nowProgram = selectedStream
    ? epgRows.find((r) => r.playing) ?? epgRows[0] ?? null
    : null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{t('live.title')}</h1>
          <p className={styles.pageSub}>
            {isGlobalSearch
              ? tc('live.globalResultsOne', 'live.globalResultsOther', filtered.length)
              : tc('live.channelsOne', 'live.channelsOther', filtered.length, { cat: catName })}
          </p>
        </div>
        <RemoteSearch
          value={search}
          onChange={setSearch}
          placeholder={t('live.searchPlaceholder')}
          wrapperClassName={styles.searchWrapper}
          iconClassName={styles.searchIcon}
          inputClassName={styles.search}
        />
        {search.trim().length > 0 && search.trim().length < MIN_SEARCH_LEN && (
          <span className={styles.searchBadge}>{t('common.minChars', { n: MIN_SEARCH_LEN })}</span>
        )}
        {isGlobalSearch && (
          <span className={styles.searchBadge}>
            {loadingAll
              ? t('common.loadingShort')
              : tc('live.badgeOne', 'live.badgeOther', filtered.length, {
                  count: `${filtered.length}${filtered.length >= RESULT_LIMIT ? '+' : ''}`,
                })}
          </span>
        )}
      </header>

      {error && <div className={styles.error}>⚠ {error}</div>}

      {!isGlobalSearch && (
        loadingCats ? (
          <div className={styles.catSkeleton} />
        ) : (
          <CategoryBar
            categories={categories.map((c) => ({ id: c.category_id, name: c.category_name }))}
            selected={selectedCat}
            onSelect={(id) => setSelectedCat(id)}
          />
        )
      )}

      <div className={live.layout}>
        <div className={live.main}>
          {showStreamSkeleton ? (
            <div className={styles.gridLoading}>
              {Array.from({ length: 18 }).map((_, i) => (
                <div key={i} className={`${styles.skeleton} ${styles.skeletonChannel}`} />
              ))}
            </div>
          ) : (
            <div className={`${styles.grid} ${styles.gridChannel}`}>
              {visibleStreams.map((stream) => {
                const isSelected = selectedId === stream.stream_id;
                // Mobile : la carte sélectionnée monte le lecteur inline (et le
                // panneau latéral disparaît) → pas de double-affichage.
                const inlinePreview = isMobile && isSelected && credentials ? (
                  <ChannelPreview
                    key={stream.stream_id}
                    url={xtreamService.getLiveStreamUrl(credentials, stream.stream_id)}
                    fallbackUrl={xtreamService.getLiveStreamTsUrl(credentials, stream.stream_id)}
                    poster={stream.stream_icon}
                    title={stream.name}
                    onExpand={() => goFullscreen(stream)}
                  />
                ) : null;
                return (
                  <MediaCard
                    key={stream.stream_id}
                    title={stream.name}
                    image={stream.stream_icon}
                    variant="channel"
                    isLive
                    selected={isSelected}
                    isFavorite={isFavorite('live', String(stream.stream_id))}
                    onClick={() => handleCardClick(stream)}
                    onFavorite={() =>
                      toggleFavorite({
                        type: 'live',
                        id: String(stream.stream_id),
                        name: stream.name,
                        image: stream.stream_icon ?? '',
                      })
                    }
                    inlinePreview={inlinePreview}
                  />
                );
              })}
            </div>
          )}

          {!loadingStreams && !loadingAll && filtered.length === 0 && !error && (
            <p className={styles.empty}>{t('live.none')}</p>
          )}
        </div>

        {selectedStream && credentials && (
          <aside className={live.panel}>
            <div className={live.panelHead}>
              <div className={live.panelLogo}>
                {selectedIcon ? (
                  <img src={selectedIcon} alt={selectedStream.name} />
                ) : (
                  <span className={live.panelCode}>
                    <span className={live.panelStripe} />
                    {channelCode(selectedStream.name)}
                  </span>
                )}
              </div>
              <div className={live.panelTitleBox}>
                <span className={live.panelChannel} title={selectedStream.name}>
                  {selectedStream.name}
                </span>
                <span className={live.panelLiveTag}>
                  <span className={live.panelLiveDot} />
                  {t('live.onAir')}
                </span>
              </div>
            </div>

            <ChannelPreview
              key={selectedStream.stream_id}
              url={xtreamService.getLiveStreamUrl(credentials, selectedStream.stream_id)}
              fallbackUrl={xtreamService.getLiveStreamTsUrl(credentials, selectedStream.stream_id)}
              poster={selectedStream.stream_icon}
              title={selectedStream.name}
              onExpand={() => goFullscreen(selectedStream)}
            />

            {nowProgram && (
              <div className={live.nowBlock}>
                <span className={live.nowLabel}>{t('live.now')}</span>
                <span className={live.nowTitle}>{nowProgram.title || selectedStream.name}</span>
                {nowProgram.desc && <p className={live.nowDesc}>{nowProgram.desc}</p>}
              </div>
            )}

            <div className={live.epgHead}>{t('live.schedule')}</div>
            {epgLoading ? (
              <div className={live.epgSkeleton}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className={live.epgSkelRow} />
                ))}
              </div>
            ) : epgRows.length === 0 ? (
              <p className={live.epgEmpty}>{t('live.noProgram')}</p>
            ) : (
              <ul className={live.epgList}>
                {epgRows.map((r) => (
                  <li
                    key={r.key}
                    className={`${live.epgItem} ${r.playing ? live.epgItemNow : ''}`}
                  >
                    <span className={live.epgTime}>{r.time}</span>
                    <div className={live.epgBody}>
                      <span className={live.epgTitle}>
                        {r.playing && <span className={live.epgNowDot} />}
                        {r.title}
                      </span>
                      {r.desc && <span className={live.epgDesc}>{r.desc}</span>}
                      {r.playing && (
                        <div className={live.epgProgress}>
                          <div
                            className={live.epgProgressFill}
                            style={{ width: `${r.progress}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
