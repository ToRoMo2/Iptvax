import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

interface UseHlsOptions {
  autoPlay?: boolean;
}

function isHlsUrl(url: string): boolean {
  return url.includes('.m3u8') || url.includes('m3u8');
}

export function useHls(url: string | null, options: UseHlsOptions = {}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const { autoPlay = true } = options;

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) {
      setStatus('idle');
      return;
    }

    setStatus('loading');
    setError(null);

    if (isHlsUrl(url) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true });
      hlsRef.current = hls;

      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
        setStatus('playing');
      });

      hls.on(Hls.Events.ERROR, (_evt, data) => {
        if (data.fatal) {
          setStatus('error');
          setError(data.details);
        }
      });

      return () => {
        hls.destroy();
        hlsRef.current = null;
      };
    }

    if (isHlsUrl(url) && video.canPlayType('application/vnd.apple.mpegurl')) {
      // Safari native HLS
      video.src = url;
      if (autoPlay) video.play().catch(() => {});
      setStatus('playing');
      return;
    }

    // Lecture directe (mp4, mkv, etc.)
    video.src = url;
    video.oncanplay = () => {
      setStatus('playing');
      if (autoPlay) video.play().catch(() => {});
    };
    video.onerror = () => {
      setStatus('error');
      setError('Impossible de charger la source vidéo');
    };

    return () => {
      video.oncanplay = null;
      video.onerror = null;
      video.src = '';
    };
  }, [url, autoPlay]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setStatus('playing');
    } else {
      video.pause();
      setStatus('paused');
    }
  };

  return { videoRef, status, error, toggle };
}
