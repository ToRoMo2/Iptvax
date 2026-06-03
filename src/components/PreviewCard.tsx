import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { safeImgUrl } from '../utils/image';
import { youtubeId } from '../utils/youtube';
import type { TmdbTrailer } from '../types/tmdb.types';
import { useLazyPoster } from '../hooks/useLazyPoster';
import { useI18n } from '../contexts/I18nContext';
import { isTvDevice } from '../native/tvDetect';
import styles from './PreviewCard.module.css';

/* ── API YouTube IFrame (chargée une seule fois, globalement) ──────────────
   On passe par l'API JS (et pas un <iframe> brut) pour : démarrer en autoplay
   muté programmatiquement ; révéler seulement quand des images défilent
   vraiment ; puis tenter unMute() pour le son (best-effort : la politique
   autoplay du navigateur peut le re-muter, dégradation gracieuse). */
interface YTPlayer {
  destroy(): void;
  playVideo(): void;
  mute(): void;
  unMute(): void;
  setVolume(v: number): void;
  getCurrentTime(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
}
interface YTPlayerEvent {
  target: YTPlayer;
  data?: number;
}
interface YTPlayerOptions {
  videoId: string;
  host?: string;
  playerVars: Record<string, number | string>;
  events: {
    onReady?: (e: YTPlayerEvent) => void;
    onStateChange?: (e: YTPlayerEvent) => void;
  };
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
  PlayerState: { PLAYING: number; ENDED: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise<YTNamespace>((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT) resolve(window.YT);
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return ytApiPromise;
}

interface Props {
  title: string;
  image?: string;
  /** Image paysage 16:9 pour le fond de l'aperçu (sinon le poster est letterboxé). */
  backdrop?: string;
  synopsis?: string;
  meta?: string;
  variant: 'movie' | 'series';
  /** Classe additionnelle sur la cellule (ex. largeur fixe dans un rail Home). */
  className?: string;
  isFavorite?: boolean;
  /** Trailer YouTube déjà connu (champ Xtream `youtube_trailer`). */
  trailerUrl?: string;
  /** Résolveur paresseux TMDB, fourni par la page (couplage services↔pages). */
  resolveTrailer?: (signal: AbortSignal) => Promise<TmdbTrailer | null>;
  /** Résolveur d'affiche TMDB (paresseux, visible-only) — remplace l'affiche IPTV. */
  resolvePoster?: () => Promise<string | null>;
  onOpen: () => void;
  onFavorite?: () => void;
}

// Délai d'intention de survol avant l'agrandissement (évite de déclencher en
// traversant la grille à la souris). ~1 s = volontaire sans être intrusif.
const HOVER_INTENT_MS = 1000;
// Coupe l'aperçu vidéo après 30 s puis revient au visuel fixe.
const PREVIEW_CAP_MS = 30_000;
// Volume discret de l'aperçu (0–100). Pas de contrôle UI volontairement —
// l'aperçu reste un fond d'ambiance, on baisse juste le défaut.
const PREVIEW_VOLUME = 22;
// Doit rester aligné sur la transition CSS de fermeture (.module.css).
const COLLAPSE_MS = 200;
const EDGE_MARGIN = 14;

interface Box {
  left: number;
  top: number;
  width: number;
  originX: number;
  originY: number;
}

// NB : volontairement NON mémoïsé. Un `React.memo` qui ignore les props
// fonctions (onOpen/onFavorite/resolveTrailer) gelait `resolveTrailer` et
// cassait la résolution du trailer dans l'aperçu agrandi. Le coût de montage
// des grilles est déjà borné par `useProgressiveList` + `content-visibility`,
// donc on garde ce composant simple et correct.
export function PreviewCard({
  title,
  image,
  backdrop,
  synopsis,
  meta,
  variant,
  className,
  isFavorite,
  trailerUrl,
  resolveTrailer,
  resolvePoster,
  onOpen,
  onFavorite,
}: Props) {
  const { t } = useI18n();
  const ytMountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const [ytId, setYtId] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [tmdbOverview, setTmdbOverview] = useState<string | undefined>();

  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const posterRaw = safeImgUrl(image);
  const text = synopsis?.trim() || tmdbOverview?.trim() || '';

  const clearTimers = useCallback(() => {
    if (openTimer.current) clearTimeout(openTimer.current);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (capTimer.current) clearTimeout(capTimer.current);
    if (revealTimer.current) clearInterval(revealTimer.current);
    openTimer.current = closeTimer.current = capTimer.current = revealTimer.current = null;
  }, []);

  const stopTrailer = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (revealTimer.current) {
      clearInterval(revealTimer.current);
      revealTimer.current = null;
    }
    setYtId(null);
    setPlaying(false);
  }, []);

  const collapse = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    // Coupe la vidéo immédiatement (audio/réseau) même pendant l'anim de repli.
    stopTrailer();
    setEntered(false);
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), COLLAPSE_MS);
  }, [stopTrailer]);

  const expand = useCallback(() => {
    const el = cellRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Carte d'aperçu nettement plus large que la vignette (déborde sur les
    // voisines, c'est volontaire — l'overlay flotte au-dessus).
    const width = Math.max(340, Math.min(480, r.width * 2));
    // Hauteur approx : média 16:9 + bloc info (~150 px) pour le clamp vertical.
    const approxH = width * (9 / 16) + 150;
    const cx = r.left + r.width / 2;
    let left = cx - width / 2;
    left = Math.max(EDGE_MARGIN, Math.min(left, vw - width - EDGE_MARGIN));
    let top = r.top - 36;
    top = Math.max(EDGE_MARGIN, Math.min(top, vh - approxH - EDGE_MARGIN));
    setBox({
      left,
      top,
      width,
      // Origine de l'anim = centre de la carte d'origine → « sort » de la carte.
      originX: cx - left,
      originY: r.top + r.height / 2 - top,
    });
    setTmdbOverview(undefined);
    setOpen(true);

    const fromXtream = youtubeId(trailerUrl);
    if (fromXtream) {
      setYtId(fromXtream);
    } else if (resolveTrailer) {
      const ac = new AbortController();
      abortRef.current = ac;
      resolveTrailer(ac.signal)
        .then((res) => {
          if (ac.signal.aborted || !res) return;
          if (res.overview) setTmdbOverview(res.overview);
          if (res.youtubeKey) setYtId(res.youtubeKey);
        })
        .catch(() => {});
    }
    // cellRef vient de useFocusable (déclaré plus bas, ref stable) → exclu des
    // deps pour éviter l'usage-avant-déclaration ; identité constante de toute façon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailerUrl, resolveTrailer]);

  // Transition d'entrée : monte démonté puis bascule `entered` à la frame
  // suivante pour déclencher le transform CSS (grossit depuis la carte).
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Crée le lecteur YouTube via l'API JS quand un trailer est résolu et que
  // l'overlay est en place. YT remplace un <div> enfant créé impérativement
  // (jamais rendu par React) → aucun conflit de réconciliation.
  useEffect(() => {
    if (!ytId || !entered) return;
    const mount = ytMountRef.current;
    if (!mount) return;
    let cancelled = false;
    let player: YTPlayer | undefined;

    loadYouTubeApi().then((YT) => {
      if (cancelled || !ytMountRef.current) return;
      const inner = document.createElement('div');
      ytMountRef.current.appendChild(inner);
      player = new YT.Player(inner, {
        videoId: ytId,
        host: 'https://www.youtube-nocookie.com',
        // Pas de `loop`/`playlist` : ce mode fait traiter la vidéo comme une
        // playlist → YouTube ajoute des boutons précédent/suivant. On boucle
        // nous-mêmes sur l'évènement ENDED (seekTo 0 + play).
        playerVars: {
          autoplay: 1,
          mute: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          fs: 0,
          disablekb: 1,
          iv_load_policy: 3,
        },
        events: {
          onReady: (e) => {
            e.target.mute();
            e.target.playVideo();
          },
          onStateChange: (e) => {
            // Boucle manuelle (pas de paramètre playlist → pas de chrome skip).
            if (e.data === YT.PlayerState.ENDED) {
              e.target.seekTo(0, true);
              e.target.playVideo();
              return;
            }
            if (e.data === YT.PlayerState.PLAYING) {
              // Best-effort : le navigateur peut re-muter selon sa politique
              // autoplay → on reste muet sans casser l'aperçu.
              e.target.unMute();
              e.target.setVolume(PREVIEW_VOLUME);
              // `controls:0` ne masque PAS le gros bouton tant que des images
              // ne défilent pas vraiment. On ne révèle l'iframe que lorsque
              // `currentTime` CROÎT entre deux relevés (lecture réellement en
              // mouvement), avec un filet de sécurité ~5 s.
              if (revealTimer.current) clearInterval(revealTimer.current);
              let ticks = 0;
              let prev = -1;
              revealTimer.current = setInterval(() => {
                ticks += 1;
                const t = e.target.getCurrentTime();
                const advancing = t > 0.4 && t > prev;
                prev = t;
                if (advancing || ticks > 33) {
                  if (revealTimer.current) clearInterval(revealTimer.current);
                  revealTimer.current = null;
                  setPlaying(true);
                }
              }, 150);
            }
          },
        },
      });
      playerRef.current = player;
    });

    return () => {
      cancelled = true;
      if (revealTimer.current) {
        clearInterval(revealTimer.current);
        revealTimer.current = null;
      }
      try {
        player?.destroy();
      } catch {
        /* lecteur déjà détruit */
      }
      playerRef.current = null;
      if (mount) mount.innerHTML = '';
    };
  }, [ytId, entered]);

  // Cap 30 s : la vidéo coupe et on revient au visuel fixe.
  useEffect(() => {
    if (!ytId) return;
    capTimer.current = setTimeout(() => {
      setYtId(null);
      setPlaying(false);
    }, PREVIEW_CAP_MS);
    return () => {
      if (capTimer.current) clearTimeout(capTimer.current);
    };
  }, [ytId]);

  // L'aperçu se referme au scroll/resize (comportement Netflix : un overlay
  // ancré en `fixed` ne doit pas « flotter » désaligné quand la page bouge).
  useEffect(() => {
    if (!open) return;
    const onMove = () => collapse();
    const main = document.querySelector('.main-content');
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    main?.addEventListener('scroll', onMove, { passive: true });
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
      main?.removeEventListener('scroll', onMove);
    };
  }, [open, collapse]);

  useEffect(() => () => {
    clearTimers();
    abortRef.current?.abort();
    try {
      playerRef.current?.destroy();
    } catch {
      /* lecteur déjà détruit */
    }
  }, [clearTimers]);

  const onCellEnter = () => {
    // Touch screens (phones/tablets) don't have reliable hover — skip preview.
    // TV remotes bypass this guard via isTvDevice() even when hover:none.
    if (!window.matchMedia?.('(hover: hover)').matches && !isTvDevice()) return;
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (open) return;
    openTimer.current = setTimeout(expand, HOVER_INTENT_MS);
  };

  const onCellLeave = () => {
    if (openTimer.current) {
      clearTimeout(openTimer.current);
      openTimer.current = null;
    }
  };

  // ── Navigation télécommande ────────────────────────────────────────────────
  // Le focus déclenche le même aperçu que le survol souris ; quitter la carte
  // (blur) referme l'aperçu (pas d'overlay survolable à la télécommande).
  // Le ref norigin sert AUSSI à mesurer la carte (ancrage de l'overlay) — on
  // ne fait que LE LIRE, donc le RefObject en lecture seule convient.
  const { ref: cellRef, focused } = useFocusable({
    onEnterPress: () => onOpen(),
    onFocus: () => onCellEnter(),
    onBlur: () => {
      if (open) collapse();
      else onCellLeave();
    },
  });

  useEffect(() => {
    if (focused) {
      cellRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, [focused, cellRef]);

  // Affiche TMDB chargée paresseusement (visible-only), substituée à l'IPTV.
  const tmdbPoster = useLazyPoster(resolvePoster, cellRef);
  const poster = (tmdbPoster ? safeImgUrl(tmdbPoster) : undefined) ?? posterRaw;
  const heroImg = safeImgUrl(backdrop) || poster;

  return (
    <div
      ref={cellRef}
      className={`${styles.cell} ${styles[variant]} ${focused ? styles.cellFocused : ''} ${className ?? ''}`}
      onMouseEnter={onCellEnter}
      onMouseLeave={onCellLeave}
    >
      <div
        className={styles.card}
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        title={title}
      >
        <div className={styles.art}>
          {poster ? (
            <img src={poster} alt={title} loading="lazy" decoding="async" className={styles.img} />
          ) : (
            <div className={styles.ph}>
              <span className={styles.phName}>{title}</span>
            </div>
          )}
        </div>
        <div className={styles.info}>
          <div className={styles.cardTitle}>{title}</div>
          {meta && <div className={styles.cardMeta}>{meta}</div>}
        </div>
        {onFavorite && (
          <button
            className={`${styles.fav} ${isFavorite ? styles.favOn : ''}`}
            onClick={(e) => { e.stopPropagation(); onFavorite(); }}
            title={isFavorite ? t('common.removeFavorite') : t('common.addFavorite')}
          >
            {isFavorite ? '★' : '☆'}
          </button>
        )}
      </div>

      {open && box && createPortal(
        <div
          className={`${styles.overlay} ${entered ? styles.overlayIn : ''}`}
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            transformOrigin: `${box.originX}px ${box.originY}px`,
          }}
          onMouseLeave={collapse}
          onClick={onOpen}
          role="button"
          tabIndex={-1}
        >
          <div className={styles.media}>
            {/* L'iframe YouTube est rendue D'ABORD et TOUJOURS visible
                (opacity 1) : YouTube refuse l'autoplay d'un lecteur qu'il juge
                masqué (opacity 0) → deadlock avec l'ancien design « révéler
                après lecture ». On la couvre simplement avec le poster, qu'on
                fait disparaître quand la lecture démarre vraiment. */}
            <div ref={ytMountRef} className={styles.frameHost} />
            {heroImg ? (
              <img
                src={heroImg}
                alt={title}
                loading="lazy"
                decoding="async"
                className={`${styles.mediaCover} ${playing ? styles.mediaCoverHidden : ''}`}
              />
            ) : (
              <div className={`${styles.mediaCover} ${styles.mediaCoverBlank} ${playing ? styles.mediaCoverHidden : ''}`} />
            )}
            <div className={styles.mediaShade} />
          </div>
          <div className={styles.body}>
            <div className={styles.bodyTitle}>{title}</div>
            {meta && <div className={styles.bodyMeta}>{meta}</div>}
            {text && <p className={styles.synopsis}>{text}</p>}
            <div className={styles.actions}>
              <button
                className={styles.play}
                onClick={(e) => { e.stopPropagation(); onOpen(); }}
              >
                {t('common.play')}
              </button>
              {onFavorite && (
                <button
                  className={`${styles.ovFav} ${isFavorite ? styles.ovFavOn : ''}`}
                  onClick={(e) => { e.stopPropagation(); onFavorite(); }}
                  title={isFavorite ? t('common.removeFavorite') : t('common.addFavorite')}
                >
                  {isFavorite ? '★' : '☆'}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
