import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VideoPlayer } from '../components/VideoPlayer';
import { useXtream } from '../context/XtreamContext';
import { isNative } from '../lib/platform';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import type { Episode, LiveChannelRef, LiveStream, PlayerState, SeriesInfo } from '../types/xtream.types';
import type { TmdbEpisodeStills } from '../types/tmdb.types';
import { cleanTitle, extractYear, groupByTitle, qualityRank, episodeLabel } from '../utils/catalog';
import { buildEpgRows, type EpgRow } from '../utils/epg';
import styles from './Player.module.css';

// Id de la catégorie synthétique « Ma Liste » (favoris) injectée en tête du
// zapper quand `PlayerState.liveListLabel` est posé. Préfixe `__` → aucune
// collision possible avec un `category_id` Xtream.
const MYLIST_CAT_ID = '__mylist__';

export function Player() {
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const { history, getResume, saveProgress, addToHistory } = useLibrary();
  const { t } = useI18n();
  const state = (location.state as PlayerState) ?? null;

  // Permet de basculer sur l'URL de fallback si le m3u8 échoue
  const [useFallback, setUseFallback] = useState(false);
  const activeUrl = useFallback && state?.fallbackUrl ? state.fallbackUrl : (state?.url ?? null);
  // Évite de boucler indéfiniment sur le fallback automatique
  const autoFallbackDone = useRef(false);

  useEffect(() => {
    setUseFallback(false);
    autoFallbackDone.current = false;
  }, [state?.url]);

  // Bascule automatiquement sur le fichier direct si HLS retourne une erreur fatale
  const handleAutoFallback = () => {
    if (!autoFallbackDone.current && state?.fallbackUrl) {
      autoFallbackDone.current = true;
      setUseFallback(true);
    }
  };

  // ── Navigation prev/next dans la liste live ───────────────────────────────
  const isLive = state?.type === 'live';
  const channels = state?.liveChannels;
  const channelIndex = state?.liveIndex;
  const hasChannelNav =
    isLive &&
    !!credentials &&
    !!channels &&
    typeof channelIndex === 'number' &&
    channels.length > 1;
  const hasPrev = hasChannelNav && channelIndex! > 0;
  const hasNext = hasChannelNav && channelIndex! < channels!.length - 1;

  // Sélectionne une chaîne du zapper par index. Variante optionnelle : si le
  // zapper a ouvert le sélecteur de qualité, on joue le stream_id choisi ;
  // sinon (prev/next, chaîne mono-variante) on joue la meilleure qualité (primary).
  const selectChannel = useCallback(
    (index: number, variant?: { stream_id: number; name: string }) => {
      if (!credentials || !channels || index < 0 || index >= channels.length) return;
      const target = channels[index];
      const streamId = variant?.stream_id ?? target.stream_id;
      const nextState: PlayerState = {
        url: xtreamService.getLiveStreamUrl(credentials, streamId),
        fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, streamId),
        title: target.name,
        type: 'live',
        poster: target.stream_icon,
        liveChannels: channels,
        liveIndex: index,
        // Préserve l'identité de la liste (« Ma Liste ») au fil des prev/next.
        liveListLabel: state?.liveListLabel,
      };
      // replace:true → la touche retour ramène à /live, pas à la chaîne précédente
      navigate('/player', { state: nextState, replace: true });
    },
    [credentials, channels, navigate, state?.liveListLabel],
  );

  const switchChannel = useCallback(
    (direction: 1 | -1) => {
      if (typeof channelIndex !== 'number') return;
      selectChannel(channelIndex + direction);
    },
    [channelIndex, selectChannel],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate]);

  // ── EPG de la chaîne live courante (affiché dans l'overlay du lecteur) ─────
  // Strictement additif : un serveur sans EPG renvoie une liste vide → aucune
  // bande n'apparaît. Re-fetch au changement de chaîne (prev/next → liveIndex).
  const liveStreamId =
    isLive && channels && typeof channelIndex === 'number'
      ? channels[channelIndex]?.stream_id
      : undefined;
  const [liveEpg, setLiveEpg] = useState<EpgRow[]>([]);
  useEffect(() => {
    if (!credentials || !isLive || liveStreamId == null) {
      setLiveEpg([]);
      return;
    }
    let cancelled = false;
    xtreamService
      .getShortEpg(credentials, liveStreamId, 12)
      .then((r) => { if (!cancelled) setLiveEpg(buildEpgRows(r.epg_listings ?? [])); })
      .catch(() => { if (!cancelled) setLiveEpg([]); });
    return () => { cancelled = true; };
  }, [credentials, isLive, liveStreamId]);

  // ── Catalogue live (zapper avec catégories dans l'overlay) ────────────────
  // Construit côté lecteur (PAS dans PlayerState, §IV-26) : une requête
  // `getLiveStreams` (cache de session → hit après passage par /live) bucketée
  // par catégorie puis regroupée par titre (mêmes helpers que Live.tsx). Donne
  // au zapper les catégories navigables + les variantes de qualité par chaîne.
  const [liveCatalog, setLiveCatalog] = useState<
    { id: string; name: string; channels: LiveChannelRef[] }[]
  >([]);
  useEffect(() => {
    if (!credentials || !isLive) { setLiveCatalog([]); return; }
    let cancelled = false;
    Promise.all([
      xtreamService.getLiveCategories(credentials),
      xtreamService.getLiveStreams(credentials),
    ])
      .then(([cats, all]) => {
        if (cancelled) return;
        const byCat = new Map<string, LiveStream[]>();
        for (const s of all) {
          const arr = byCat.get(s.category_id);
          if (arr) arr.push(s);
          else byCat.set(s.category_id, [s]);
        }
        const catalog = cats
          .map((c) => {
            const bucket = byCat.get(c.category_id) ?? [];
            const groups = groupByTitle(bucket, (s) => s.name, (s) => qualityRank(s.name));
            const channels: LiveChannelRef[] = groups.map((gr) => ({
              stream_id: gr.primary.stream_id,
              name: gr.title || gr.primary.name,
              stream_icon: gr.primary.stream_icon,
              variants:
                gr.variants.length > 1
                  ? gr.variants.map((v) => ({ stream_id: v.stream_id, name: v.name }))
                  : undefined,
            }));
            return { id: c.category_id, name: c.category_name, channels };
          })
          .filter((r) => r.channels.length > 0);
        setLiveCatalog(catalog);
      })
      .catch(() => { if (!cancelled) setLiveCatalog([]); });
    return () => { cancelled = true; };
  }, [credentials, isLive]);

  // Stream_id de la chaîne en cours (= primary du ref courant) → surlignage dans
  // le rail. Catégorie courante = celle qui contient cette chaîne dans le catalogue.
  const currentChannelStreamId =
    isLive && channels && typeof channelIndex === 'number'
      ? channels[channelIndex]?.stream_id
      : undefined;

  // Catalogue affiché par le zapper. Quand la liste courante est nommée (favoris
  // « Ma Liste »), on préfixe une catégorie synthétique avec ces chaînes → le
  // zapper montre « Ma Liste » en tête (sélectionnée par défaut car elle contient
  // la chaîne en cours), tout en laissant glisser vers les catégories du serveur.
  const zapCatalog = useMemo(() => {
    if (!isLive) return [];
    if (state?.liveListLabel && channels && channels.length > 0) {
      return [{ id: MYLIST_CAT_ID, name: state.liveListLabel, channels }, ...liveCatalog];
    }
    return liveCatalog;
  }, [isLive, state?.liveListLabel, channels, liveCatalog]);

  const liveCurrentCategoryId = useMemo(() => {
    if (currentChannelStreamId == null) return undefined;
    return zapCatalog.find((c) => c.channels.some((ch) => ch.stream_id === currentChannelStreamId))?.id;
  }, [zapCatalog, currentChannelStreamId]);

  // Lecture d'une chaîne du zapper (catégorie + index). Variante optionnelle si
  // l'utilisateur a choisi une qualité. Bascule `liveChannels`/`liveIndex` sur la
  // catégorie ciblée → prev/next opèrent ensuite dans cette catégorie.
  const playChannel = useCallback(
    (categoryId: string, index: number, variant?: { stream_id: number; name: string }) => {
      if (!credentials) return;
      const cat = zapCatalog.find((c) => c.id === categoryId);
      const target = cat?.channels[index];
      if (!cat || !target) return;
      const streamId = variant?.stream_id ?? target.stream_id;
      const nextState: PlayerState = {
        url: xtreamService.getLiveStreamUrl(credentials, streamId),
        fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, streamId),
        title: target.name,
        type: 'live',
        poster: target.stream_icon,
        liveChannels: cat.channels,
        liveIndex: index,
        // Rester dans « Ma Liste » tant qu'on zappe dedans ; en sortir dès qu'on
        // choisit une chaîne d'une catégorie du serveur.
        liveListLabel: categoryId === MYLIST_CAT_ID ? state?.liveListLabel : undefined,
      };
      navigate('/player', { state: nextState, replace: true });
    },
    [credentials, zapCatalog, navigate, state?.liveListLabel],
  );

  // ── Zapping prev/next avec sélecteur de qualité ───────────────────────────
  // Les boutons prev/next du lecteur (overlay) doivent proposer le même choix de
  // qualité que le zapper. Les refs de `state.liveChannels` (issues de /live ou
  // des favoris) ne portent PAS les variantes → on les ré-enrichit en matchant
  // le stream_id primary dans le catalogue live. Favoris : pas de match → pas de
  // variantes → lecture directe de la chaîne (comportement attendu).
  const channelWithVariants = useCallback(
    (ref: LiveChannelRef | undefined): LiveChannelRef | undefined => {
      if (!ref) return undefined;
      if (ref.variants && ref.variants.length > 1) return ref;
      for (const cat of liveCatalog) {
        const found = cat.channels.find((ch) => ch.stream_id === ref.stream_id);
        if (found?.variants && found.variants.length > 1) return { ...ref, variants: found.variants };
      }
      return ref;
    },
    [liveCatalog],
  );
  // Note : on enrichit depuis `liveCatalog` (catégories serveur) et non
  // `zapCatalog` — les variantes de qualité ne vivent que dans les catégories du
  // serveur ; « Ma Liste » porte des chaînes mono-flux.
  const prevChannel =
    hasPrev && channels ? channelWithVariants(channels[channelIndex! - 1]) : undefined;
  const nextChannel =
    hasNext && channels ? channelWithVariants(channels[channelIndex! + 1]) : undefined;
  const zapChannel = useCallback(
    (direction: 1 | -1, variant?: { stream_id: number; name: string }) => {
      if (typeof channelIndex !== 'number') return;
      selectChannel(channelIndex + direction, variant);
    },
    [channelIndex, selectChannel],
  );

  // ── Reprise de lecture ────────────────────────────────────────────────────
  const historyId = state?.historyId;

  // Reprise : recalculée quand l'historique du profil est chargé (async Supabase).
  const resume = useMemo(() => {
    if (!historyId || state?.type === 'live') return undefined;
    return getResume(historyId);
    // history en dépendance → recalcul dès que la liste arrive de Supabase
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyId, state?.type, getResume, history]);

  const handlePersist = useCallback(
    (p: { position: number; duration: number; audio: number; subtitle: number }) => {
      if (!historyId || state?.type === 'live') return;
      saveProgress(historyId, {
        resumeTime: p.position,
        durationSec: p.duration,
        audioTrack: p.audio,
        subtitleTrack: p.subtitle,
      });
    },
    [historyId, state?.type, saveProgress],
  );

  // ── Panneau « Épisodes » du lecteur (chantier 3) ────────────────────────
  // Quand `state.seriesContext` est posé (par SeriesDetail OU une nav précédente
  // dans le panneau), on re-fetch la SeriesInfo + les stills TMDB de la saison
  // courante. Les autres saisons sont chargées à la demande via
  // `onLoadSeasonStills` (cache `stillsBySeason`).
  const seriesCtx = state?.seriesContext;
  const seriesIdCtx = seriesCtx?.seriesId;
  const [seriesInfo, setSeriesInfo] = useState<SeriesInfo | null>(null);
  const [stillsBySeason, setStillsBySeason] = useState<Record<number, TmdbEpisodeStills>>({});
  const tmdbIdRef = useRef<number | null>(null);
  // Garde anti-redondance : ne lance pas 2 fetch concurrents pour la même saison.
  const stillsInflightRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    setSeriesInfo(null);
    setStillsBySeason({});
    // Chemin rapide : tmdbId déjà résolu par SeriesDetail → on l'amorce ici
    // pour skip enrichSeries (qui peut rater sur un titre Xtream bruité).
    tmdbIdRef.current = seriesCtx?.tmdbId && seriesCtx.tmdbId > 0 ? seriesCtx.tmdbId : null;
    stillsInflightRef.current.clear();
    if (!credentials || !seriesIdCtx) return;
    let alive = true;
    xtreamService
      .getSeriesInfo(credentials, seriesIdCtx)
      .then((info) => { if (alive) setSeriesInfo(info); })
      .catch(() => {});
    return () => { alive = false; };
  }, [credentials, seriesIdCtx, seriesCtx?.tmdbId]);

  const loadSeasonStills = useCallback(
    async (season: number) => {
      if (!seriesInfo || !tmdbService.isEnabled()) return;
      if (stillsBySeason[season] || stillsInflightRef.current.has(season)) return;
      stillsInflightRef.current.add(season);
      try {
        if (tmdbIdRef.current == null) {
          // Même normalisation titre+année que SeriesDetail → hit cache TMDB
          // (sinon clé différente → 2e appel réseau).
          const cleanName = cleanTitle(seriesInfo.info.name);
          const year = extractYear(seriesInfo.info.name)
            ?? (seriesInfo.info.releaseDate ? seriesInfo.info.releaseDate.slice(0, 4) : undefined);
          const enriched = await tmdbService.enrichSeries(cleanName, year);
          tmdbIdRef.current = enriched?.tmdbId ?? -1; // -1 → enrich échoué, on n'essaie plus
        }
        if (tmdbIdRef.current > 0) {
          const map = await tmdbService.getEpisodeStills(tmdbIdRef.current, season);
          setStillsBySeason((prev) => ({ ...prev, [season]: map }));
        }
      } catch { /* silencieux : pas bloquant — voir §IV règle TMDB */ }
      finally { stillsInflightRef.current.delete(season); }
    },
    [seriesInfo, stillsBySeason],
  );

  // Stills initiaux pour la saison courante dès que SeriesInfo arrive.
  useEffect(() => {
    if (!seriesInfo || !seriesCtx) return;
    loadSeasonStills(seriesCtx.currentSeason);
  }, [seriesInfo, seriesCtx, loadSeasonStills]);

  const handlePlayEpisode = useCallback(
    (ep: Episode) => {
      if (!credentials || !seriesCtx) return;
      const seriesTitle = seriesCtx.title ?? seriesInfo?.info.name ?? state?.title.split(' – ')[0] ?? '';
      const epLabel = episodeLabel(ep.title, seriesTitle, t('detail.episodeN', { n: ep.episode_num }));
      const historyId = `episode-${ep.id}`;
      const landscape =
        ep.info.movie_image ||
        stillsBySeason[ep.season]?.[ep.episode_num] ||
        seriesInfo?.info.backdrop_path?.[0] ||
        seriesInfo?.info.cover;
      const nextState: PlayerState = {
        url: xtreamService.getSeriesStreamUrl(credentials, ep.id, ep.container_extension),
        fallbackUrl: xtreamService.getSeriesDirectUrl(credentials, ep.id, ep.container_extension),
        title: `${seriesTitle} – ${epLabel}`,
        type: 'episode',
        poster: landscape,
        description: ep.info.plot,
        historyId,
        seriesContext: {
          seriesId: seriesCtx.seriesId,
          title: seriesTitle,
          currentSeason: ep.season,
          currentEpisodeNum: ep.episode_num,
        },
      };
      // Sync historique (cohérent avec SeriesDetail.handlePlayEpisode).
      addToHistory({
        id: historyId,
        type: 'series',
        title: `${seriesTitle} – ${epLabel}`,
        image: landscape ?? '',
        progress: 0,
        subtitle: `S${ep.season} · É${ep.episode_num}`,
        playerState: nextState,
      });
      // replace:true → la touche retour ne ré-injecte pas l'épisode précédent.
      navigate('/player', { state: nextState, replace: true });
    },
    [credentials, seriesCtx, seriesInfo, stillsBySeason, state?.title, t, addToHistory, navigate],
  );

  if (!state?.url) {
    return (
      <div className={styles.noMedia}>
        <p>{t('player.noMedia')}</p>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>{t('common.back')}</button>
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${isNative ? 'native-video-surface' : ''}`}>
      <div className={styles.playerWrapper}>
        <VideoPlayer
          url={activeUrl}
          title={state.title}
          onBack={() => navigate(-1)}
          poster={state.poster}
          isLiveType={state.type === 'live'}
          fallbackUrl={!useFallback ? state.fallbackUrl : undefined}
          // Toujours pointer vers le fichier direct (MKV/MP4) pour le probe
          // et l'extraction des sous-titres, même si la lecture passe par HLS.
          // → Les sous-titres restent disponibles en mode HLS ou direct.
          mediaUrl={state.fallbackUrl ?? state.url}
          onFallback={() => setUseFallback(true)}
          onError={handleAutoFallback}
          onPrevChannel={hasPrev ? () => switchChannel(-1) : undefined}
          onNextChannel={hasNext ? () => switchChannel(1) : undefined}
          channelPosition={
            hasChannelNav ? `${channelIndex! + 1} / ${channels!.length}` : undefined
          }
          // Zapping prev/next avec sélecteur de qualité (boutons de l'overlay).
          prevChannel={prevChannel}
          nextChannel={nextChannel}
          onZapChannel={hasChannelNav ? zapChannel : undefined}
          // Zapper : catalogue navigable par catégorie + chaîne/cat courante.
          // `zapCatalog` = catégories serveur, précédées de « Ma Liste » si la
          // lecture vient des favoris (cohérence overlay ↔ prev/next).
          liveCatalog={isLive ? zapCatalog : undefined}
          liveCurrentCategoryId={liveCurrentCategoryId}
          liveCurrentStreamId={currentChannelStreamId}
          onPlayChannel={isLive ? playChannel : undefined}
          liveEpg={liveEpg}
          resume={resume}
          onPersist={handlePersist}
          // Panneau « Épisodes » : props transmises uniquement si seriesContext
          // est posé (déclenche l'affichage du bouton dans la rangée).
          episodesBySeason={seriesCtx ? seriesInfo?.episodes : undefined}
          currentSeason={seriesCtx?.currentSeason}
          currentEpisodeNum={seriesCtx?.currentEpisodeNum}
          stillsBySeason={stillsBySeason}
          onLoadSeasonStills={loadSeasonStills}
          onPlayEpisode={handlePlayEpisode}
        />
      </div>
      {state.description && (
        <p className={styles.description}>{state.description}</p>
      )}
    </div>
  );
}
