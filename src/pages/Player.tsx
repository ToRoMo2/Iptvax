import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VideoPlayer } from '../components/VideoPlayer';
import { useXtream } from '../context/XtreamContext';
import { isNative } from '../lib/platform';
import { xtreamService } from '../services/xtream.service';
import { tmdbService } from '../services/tmdb.service';
import { useLibrary } from '../contexts/LibraryContext';
import { useI18n } from '../contexts/I18nContext';
import type { Episode, PlayerState, SeriesInfo } from '../types/xtream.types';
import type { TmdbEpisodeStills } from '../types/tmdb.types';
import { cleanTitle, extractYear } from '../utils/catalog';
import styles from './Player.module.css';

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

  const switchChannel = useCallback(
    (direction: 1 | -1) => {
      if (!credentials || !channels || typeof channelIndex !== 'number') return;
      const next = channelIndex + direction;
      if (next < 0 || next >= channels.length) return;
      const target = channels[next];
      const nextState: PlayerState = {
        url: xtreamService.getLiveStreamUrl(credentials, target.stream_id),
        fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, target.stream_id),
        title: target.name,
        type: 'live',
        poster: target.stream_icon,
        liveChannels: channels,
        liveIndex: next,
      };
      // replace:true → la touche retour ramène à /live, pas à la chaîne précédente
      navigate('/player', { state: nextState, replace: true });
    },
    [credentials, channels, channelIndex, navigate],
  );

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate]);

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
      const epLabel = ep.title || t('detail.episodeN', { n: ep.episode_num });
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
