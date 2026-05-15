import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VideoPlayer } from '../components/VideoPlayer';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useLibrary } from '../contexts/LibraryContext';
import type { PlayerState } from '../types/xtream.types';
import styles from './Player.module.css';

export function Player() {
  const location = useLocation();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const { history, getResume, saveProgress } = useLibrary();
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

  if (!state?.url) {
    return (
      <div className={styles.noMedia}>
        <p>Aucun média sélectionné.</p>
        <button className={styles.backBtn} onClick={() => navigate(-1)}>← Retour</button>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => navigate(-1)}>← Retour</button>
      <div className={styles.playerWrapper}>
        <VideoPlayer
          url={activeUrl}
          title={state.title}
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
        />
      </div>
      {state.description && (
        <p className={styles.description}>{state.description}</p>
      )}
    </div>
  );
}
