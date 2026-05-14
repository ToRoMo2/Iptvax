import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { VideoPlayer } from '../components/VideoPlayer';
import type { PlayerState } from '../types/xtream.types';
import styles from './Player.module.css';

export function Player() {
  const location = useLocation();
  const navigate = useNavigate();
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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') navigate(-1);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [navigate]);

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
        />
      </div>
      {state.description && (
        <p className={styles.description}>{state.description}</p>
      )}
    </div>
  );
}
