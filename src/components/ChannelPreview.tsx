import { useEffect, useRef, useState } from 'react';
import { usePlayer } from '../hooks/usePlayer';
import { safeImgUrl } from '../utils/image';
import styles from './ChannelPreview.module.css';

interface Props {
  // Flux HLS primaire (/api/hlsproxy)
  url: string;
  // Flux MPEG-TS de repli (/api/liveproxy) si le HLS échoue
  fallbackUrl?: string;
  poster?: string;
  title: string;
  // Clic ou Entrée → ouvre le lecteur plein écran (/player)
  onExpand: () => void;
}

// Remonté via une `key` par chaîne côté parent → l'état (src, fallback) repart
// toujours propre, pas besoin de resynchroniser sur le changement de prop `url`.
export function ChannelPreview({ url, fallbackUrl, poster, title, onExpand }: Props) {
  // Bascule HLS → MPEG-TS si le live HLS échoue (même logique que VideoPlayer).
  const [src, setSrc] = useState(url);
  const triedFallbackRef = useRef(false);

  const player = usePlayer(src);

  // Aperçu TOUJOURS muet : l'autoplay sans geste utilisateur n'est autorisé que
  // muté, et on ne veut pas de son parasite dans la grille (le son arrive en
  // plein écran). L'attribut JSX `muted` n'étant pas fiable, on force la
  // propriété quand la source (re)charge.
  useEffect(() => {
    const v = player.videoRef.current;
    if (v) v.muted = true;
  }, [src, player.videoRef]);

  const hasError = player.status === 'error';
  useEffect(() => {
    if (hasError && !triedFallbackRef.current && fallbackUrl) {
      triedFallbackRef.current = true;
      setSrc(fallbackUrl);
    }
  }, [hasError, fallbackUrl]);

  const isLoading = player.status === 'loading' || player.status === 'buffering';
  const failed = hasError && triedFallbackRef.current;

  return (
    <div
      className={styles.preview}
      onClick={onExpand}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onExpand()}
      title={`${title} — plein écran`}
    >
      <video
        ref={player.videoRef}
        className={styles.video}
        muted
        playsInline
        poster={safeImgUrl(poster)}
      />

      {isLoading && (
        <div className={styles.center}>
          <div className={styles.spinner} />
        </div>
      )}

      {failed && (
        <div className={styles.center}>
          <span className={styles.errorIcon}>⚠</span>
          <span className={styles.errorMsg}>Aperçu indisponible</span>
        </div>
      )}

      <span className={styles.livePill}>
        <span className={styles.liveDot} />
        EN DIRECT
      </span>

      <div className={styles.expandHint}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15">
          <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
        </svg>
        Plein écran
      </div>
    </div>
  );
}
