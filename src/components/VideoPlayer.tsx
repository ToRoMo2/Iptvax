import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlayer, type WebPlayerController } from '../hooks/usePlayer';
import { useNativePlayer } from '../hooks/useNativePlayer';
import { useWebOSPlayer } from '../hooks/useWebOSPlayer';
import { useTizenPlayer } from '../hooks/useTizenPlayer';
import { isNative, isCapacitor, isWebOS, isTizen } from '../lib/platform';
import { isTvDevice } from '../native/tvDetect';
import { safeImgUrl } from '../utils/image';
import { AppLogo } from './AppLogo';
import { TvPlayerOverlay, type SubSize, type SubBg, type SubColor } from './TvPlayerOverlay';
import {
  IconPlay, IconPause, IconBack10, IconFwd10, IconPrev, IconNext,
  IconAudio, IconSubtitles, IconQuality, IconCheck, IconBack, IconClose,
  IconVolumeMute, IconVolumeLow, IconVolumeHigh,
  IconFullscreenEnter, IconFullscreenExit, IconSettings, IconAlert,
} from './PlayerIcons';
import { useI18n } from '../contexts/I18nContext';
import styles from './VideoPlayer.module.css';

interface Props {
  url: string | null;
  title?: string;
  poster?: string;
  isLiveType?: boolean;
  fallbackUrl?: string;
  /**
   * URL du fichier média direct (MKV/MP4) — utilisée pour le probe ffprobe et
   * l'extraction des sous-titres via /api/subtitle. Indépendante de l'URL de
   * lecture qui peut être un .m3u8 HLS. Recommandé : passer le fallbackUrl
   * (qui pointe sur le fichier direct).
   */
  mediaUrl?: string;
  onFallback?: () => void;
  onError?: () => void;
  // Mode live : navigation prev/next dans la liste de chaînes. Si undefined,
  // le bouton correspondant n'est pas affiché et la touche flèche est ignorée.
  onPrevChannel?: () => void;
  onNextChannel?: () => void;
  channelPosition?: string;
  // Reprise de lecture : position + pistes du dernier arrêt (non-live).
  resume?: { time: number; audio?: number; subtitle?: number };
  // Sauvegarde périodique de la progression (position + pistes).
  onPersist?: (p: { position: number; duration: number; audio: number; subtitle: number }) => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Types `SubSize` / `SubBg` / `SubColor` centralisés dans TvPlayerOverlay
// (partagés entre l'overlay TV et l'overlay souris/tactile).

// ── Persistance des préférences de sous-titres ───────────────────────────────
const SUB_PREFS_KEY = 'iptv-subtitle-prefs';

interface SubPrefs {
  size: SubSize;
  bg: SubBg;
  color: SubColor;
}

const DEFAULT_SUB_PREFS: SubPrefs = { size: 'md', bg: 'none', color: 'white' };

function loadSubPrefs(): SubPrefs {
  try {
    const raw = localStorage.getItem(SUB_PREFS_KEY);
    if (!raw) return DEFAULT_SUB_PREFS;
    return { ...DEFAULT_SUB_PREFS, ...(JSON.parse(raw) as Partial<SubPrefs>) };
  } catch { return DEFAULT_SUB_PREFS; }
}

function saveSubPrefs(prefs: SubPrefs) {
  try { localStorage.setItem(SUB_PREFS_KEY, JSON.stringify(prefs)); } catch { /* */ }
}

// Maps de style pour l'aperçu live + les chips « Aa » du panneau Personnaliser.
// Tailles alignées sur les .subSm/Md/Lg/Xl du CSS pour que l'aperçu reflète
// EXACTEMENT le rendu final. Mêmes couleurs/fonds que TvPlayerOverlay (DA).
const PREVIEW_PX: Record<SubSize, number> = { sm: 18, md: 26, lg: 36, xl: 48 };
const CHIP_PX: Record<SubSize, number> = { sm: 11, md: 15, lg: 20, xl: 26 };
const SUB_COLOR_HEX: Record<SubColor, string> = {
  white: '#ffffff', yellow: '#ffe066', cyan: 'var(--accent)', green: '#7eff7e',
};
const SUB_BG_CSS: Record<SubBg, string> = {
  none: 'transparent', semi: 'rgba(0,0,0,0.6)', solid: 'rgba(0,0,0,0.92)',
};
const SUB_OUTLINE = '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 0 6px rgba(0,0,0,0.55)';
const SUB_SOFT_SHADOW = '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.6)';

export function VideoPlayer({
  url,
  title,
  poster,
  isLiveType,
  fallbackUrl,
  mediaUrl,
  onFallback,
  onError,
  onPrevChannel,
  onNextChannel,
  channelPosition,
  resume,
  onPersist,
}: Props) {
  const { t } = useI18n();
  // Sur TV (Android TV / Tizen / webOS), l'overlay est piloté à la télécommande
  // par `TvPlayerOverlay` (machine à états D-pad) ; l'overlay souris/tactile et
  // ses raccourcis clavier ci-dessous sont alors désactivés. `isTvDevice()` est
  // résolu au boot → constant pour la vie du composant.
  const tvMode = isTvDevice();
  // Les flags `isCapacitor` / `isWebOS` / `isTizen` sont figés au build (cf.
  // src/lib/platform.ts) → la branche est stable pour toute la vie du composant :
  // appeler conditionnellement l'un ou l'autre hook est sûr ici (le lint
  // rules-of-hooks ne peut pas le savoir). Une seule des conditions est vraie
  // par build :
  // - Capacitor (Android) → libVLC derrière la WebView (surface transparente)
  // - webOS (LG TV)       → <video> HTML5 + hls.js / Media Pipeline luna://
  // - Tizen (Samsung TV)  → AVPlay derrière la WebView (surface transparente)
  // - web (et Electron, Option B) → ffmpeg via /api/* (path historique)
  /* eslint-disable react-hooks/rules-of-hooks */
  const player: WebPlayerController = isCapacitor
    ? useNativePlayer(url, mediaUrl)
    : isWebOS
      ? useWebOSPlayer(url, mediaUrl)
      : isTizen
        ? useTizenPlayer(url, mediaUrl)
        : usePlayer(url, mediaUrl);
  /* eslint-enable react-hooks/rules-of-hooks */
  const [controlsVisible, setControlsVisible] = useState(true);
  // Panneau inline qui REMPLACE la rangée de contrôles (pattern TvPlayerOverlay).
  // null = contrôles classiques affichés ; sinon le panneau prend la place et
  // le lecteur est mis en pause automatiquement (cf. pausedByPanelRef).
  const [panelKind, setPanelKind] = useState<'audio' | 'subtitles' | 'quality' | null>(null);
  // Vue active dans le panneau sous-titres : 'tracks' (pistes + bouton
  // Personnaliser) ou 'customize' (aperçu live + chips Taille/Couleur/Fond).
  const [subView, setSubView] = useState<'tracks' | 'customize'>('tracks');
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Trace si NOUS avons mis le lecteur en pause à l'ouverture du panneau (pour
  // éviter d'auto-reprendre une vidéo que l'utilisateur avait pausée lui-même).
  const pausedByPanelRef = useRef(false);

  // Ferme le panneau inline et reprend la lecture si on l'avait pausée.
  // Définie ici (avant les useEffect qui en dépendent) pour respecter l'ordre
  // de hoisting des `useCallback`.
  const closePanel = useCallback(() => {
    if (pausedByPanelRef.current) {
      player.toggle();
      pausedByPanelRef.current = false;
    }
    setPanelKind(null);
    setSubView('tracks');
  }, [player]);

  // Alias pour le onClick du wrapper (clic en dehors des contrôles) : ferme tout.
  const closeAllMenus = closePanel;

  // Ouvre un panneau (audio / sous-titres / qualité). Si le même panneau est
  // déjà ouvert dans sa vue de base, ferme. Sinon bascule + met en pause.
  const openPanel = useCallback((kind: 'audio' | 'subtitles' | 'quality') => {
    if (panelKind === kind && (kind !== 'subtitles' || subView === 'tracks')) {
      closePanel();
      return;
    }
    if (panelKind === null && player.status === 'playing') {
      player.toggle();
      pausedByPanelRef.current = true;
    }
    setPanelKind(kind);
    if (kind === 'subtitles') setSubView('tracks');
  }, [panelKind, subView, player, closePanel]);

  // Sous-titres : préférences visuelles persistées dans localStorage
  const initialPrefs = loadSubPrefs();
  const [subSize, setSubSize] = useState<SubSize>(initialPrefs.size);
  const [subBg, setSubBg] = useState<SubBg>(initialPrefs.bg);
  const [subColor, setSubColor] = useState<SubColor>(initialPrefs.color);
  const subtitleText = player.subtitleText;

  // Sauvegarde automatique des préférences à chaque changement
  useEffect(() => {
    saveSubPrefs({ size: subSize, bg: subBg, color: subColor });
  }, [subSize, subBg, subColor]);

  const isLive = player.isLive || isLiveType;
  const isLoading = player.status === 'loading' || player.status === 'buffering';
  const hasError = player.status === 'error';
  const isPlaying = player.status === 'playing';

  // Basculement automatique sur le fallback dès qu'une erreur fatale survient
  // (ex : serveur ne supporte pas HLS pour ce contenu → passe au fichier direct)
  const prevErrorRef = useRef(false);
  useEffect(() => {
    if (hasError && !prevErrorRef.current && fallbackUrl) {
      prevErrorRef.current = true;
      onError?.();
    }
    if (!hasError) prevErrorRef.current = false;
  }, [hasError, fallbackUrl, onError]);

  // ── Reprise de lecture : applique position + pistes une seule fois ────────
  const resumeSeekDone = useRef(false);
  const resumeAudioDone = useRef(false);
  const resumeSubDone = useRef(false);

  // Position : dès que la lecture démarre réellement (média prêt) on saute.
  useEffect(() => {
    if (isLive || !resume || resumeSeekDone.current) return;
    if (player.status === 'playing' || player.status === 'paused') {
      resumeSeekDone.current = true;
      if (resume.time > 1) player.seek(resume.time);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, resume, player.status, player.seek]);

  // Piste audio : quand la liste est connue et l'index valide/différent.
  useEffect(() => {
    if (isLive || !resume || resumeAudioDone.current) return;
    const idx = resume.audio;
    if (typeof idx !== 'number' || idx < 0) return;
    if (player.audioTracks.length === 0 || idx >= player.audioTracks.length) return;
    resumeAudioDone.current = true;
    if (idx !== player.currentAudio) player.setAudio(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, resume, player.audioTracks, player.currentAudio, player.setAudio]);

  // Sous-titres : index UI 0-based ; négatif = désactivé → rien à restaurer.
  useEffect(() => {
    if (isLive || !resume || resumeSubDone.current) return;
    const idx = resume.subtitle;
    if (typeof idx !== 'number' || idx < 0) return;
    if (!player.subtitleTracks.some((t) => t.index === idx)) return;
    resumeSubDone.current = true;
    if (idx !== player.currentSubtitle) player.setSubtitle(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, resume, player.subtitleTracks, player.currentSubtitle, player.setSubtitle]);

  // ── Sauvegarde périodique de la progression (5 s + au démontage) ─────────
  const persistRef = useRef<() => void>(() => {});
  persistRef.current = () => {
    if (isLive || !onPersist) return;
    const pos = player.currentTime;
    if (!isFinite(pos) || pos <= 0) return;
    onPersist({
      position: pos,
      duration: isFinite(player.duration) ? player.duration : 0,
      audio: player.currentAudio,
      subtitle: player.currentSubtitle,
    });
  };
  useEffect(() => {
    if (isLive || !onPersist) return;
    const id = setInterval(() => persistRef.current(), 5000);
    return () => {
      clearInterval(id);
      persistRef.current(); // sauvegarde finale en quittant le lecteur
    };
  }, [isLive, onPersist]);

  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (!isPlaying) setControlsVisible(true);
  }, [isPlaying]);

  // Raccourcis clavier (overlay souris/tactile uniquement — sur TV c'est
  // `TvPlayerOverlay` qui gère toutes les touches de la télécommande).
  useEffect(() => {
    if (tvMode) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      // Escape ferme le panneau inline en priorité (reprend la lecture si on
      // l'avait pausée).
      if (e.key === 'Escape' && panelKind !== null) {
        e.preventDefault();
        closePanel();
        return;
      }
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          player.toggle();
          break;
        case 'Enter':
          // Touche « OK » de la télécommande Android TV → lecture/pause.
          // Ignorée si un bouton a le focus : on laisse son clic natif jouer.
          if ((e.target as HTMLElement).tagName === 'BUTTON') break;
          e.preventDefault();
          player.toggle();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          player.toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          player.toggleMute();
          break;
        case 'ArrowRight':
          // En live, repurpose ArrowRight pour passer à la chaîne suivante
          // (le seek n'a pas de sens). En VOD/série : seek +10s.
          if (isLive) {
            if (onNextChannel) { e.preventDefault(); onNextChannel(); }
          } else {
            e.preventDefault();
            player.seek(player.currentTime + 10);
          }
          break;
        case 'ArrowLeft':
          if (isLive) {
            if (onPrevChannel) { e.preventDefault(); onPrevChannel(); }
          } else {
            e.preventDefault();
            player.seek(player.currentTime - 10);
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          player.setVolume(player.volume + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          player.setVolume(player.volume - 0.1);
          break;
        case 'g':
        case 'G':
          // g = sous-titres plus tôt (compense un retard), Shift+G = pas de 1s
          e.preventDefault();
          player.adjustSubtitleOffset(e.shiftKey ? 1 : 0.25);
          break;
        case 'h':
        case 'H':
          // h = sous-titres plus tard (compense une avance), Shift+H = pas de 1s
          e.preventDefault();
          player.adjustSubtitleOffset(e.shiftKey ? -1 : -0.25);
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [player, isLive, onPrevChannel, onNextChannel, tvMode, panelKind, closePanel]);

  const progressPercent = !isLive && player.duration > 0
    ? (player.currentTime / player.duration) * 100
    : 0;

  const bufferedPercent = player.duration > 0
    ? (player.bufferedEnd / player.duration) * 100
    : 0;

  const VolumeIcon = player.isMuted || player.volume === 0 ? IconVolumeMute
    : player.volume < 0.5 ? IconVolumeLow
    : IconVolumeHigh;

  const showControls = controlsVisible || !isPlaying || hasError;

  const subSizeClass = subSize === 'sm' ? styles.subSm
    : subSize === 'lg' ? styles.subLg
    : subSize === 'xl' ? styles.subXl
    : styles.subMd;
  const subBgClass = subBg === 'none' ? styles.subBgNone : subBg === 'solid' ? styles.subBgSolid : styles.subBgSemi;
  const subColorClass = subColor === 'yellow' ? styles.subColorYellow
    : subColor === 'cyan' ? styles.subColorCyan
    : subColor === 'green' ? styles.subColorGreen
    : styles.subColorWhite;

  // Surface native (vidéo rendue par un plan hardware DERRIÈRE la WebView) :
  //   - Capacitor → libVLC (`useNativePlayer` pose `usesNativeSurface` à true)
  //   - Tizen → AVPlay (`useTizenPlayer` pose `usesNativeSurface` à true) ; la
  //     surface est un <object type="application/avplayer"> qui réserve le plan
  //     vidéo (cf. webapis.avplay)
  //   - webOS Media Pipeline → `useWebOSPlayer` pose `usesNativeSurface` à true
  //     pour les fichiers directs (MKV/MP4), false en HLS (rendu par <video>)
  // Dans ces cas on n'affiche pas de <video> — juste un élément transparent
  // cliquable. La classe `native-video-surface` complète la chaîne CSS de
  // transparence (cf. `iptvax-native-playback` dans app.css).
  const useNativeSurface = player.usesNativeSurface === true;
  return (
    <div
      ref={player.wrapperRef}
      className={`${styles.wrapper} ${showControls ? styles.showControls : ''} ${useNativeSurface ? 'native-video-surface' : ''}`}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => { if (isPlaying) setControlsVisible(false); }}
      onClick={closeAllMenus}
    >
      {(() => {
        // Quand le panneau inline est ouvert, un clic sur la vidéo doit FERMER
        // le panneau (et reprendre la lecture si on l'avait pausée) plutôt
        // qu'appeler player.toggle directement — ce qui produirait un double-
        // toggle (panneau resume + video toggle = pause à nouveau).
        const onSurfaceClick = () => {
          if (panelKind !== null) closePanel();
          else player.toggle();
        };
        if (isTizen) {
          return (
            <object
              type="application/avplayer"
              className={`${styles.video} native-video-surface`}
              onClick={onSurfaceClick}
            />
          );
        }
        if (useNativeSurface) {
          return <div className={`${styles.video} native-video-surface`} onClick={onSurfaceClick} />;
        }
        return (
          <video
            ref={player.videoRef}
            className={styles.video}
            playsInline
            poster={safeImgUrl(poster)}
            onClick={onSurfaceClick}
          />
        );
      })()}

      {/* Sous-titres personnalisés */}
      {subtitleText && (
        <div className={`${styles.subtitleOverlay} ${subSizeClass} ${subBgClass} ${subColorClass}`}>
          {subtitleText.split('\n').map((line, i) => (
            <span key={i} className={styles.subtitleLine}
              dangerouslySetInnerHTML={{ __html: line }}
            />
          ))}
        </div>
      )}

      {/* Indicateur de chargement des sous-titres (extraction VTT en cours).
          Affiché tant qu'aucune cue n'est disponible — évite que l'utilisateur
          croie les sous-titres cassés sur un long épisode. */}
      {player.subtitleLoading && !subtitleText && (
        <div className={styles.subtitleLoading}>
          <span className={styles.subtitleLoadingDot} />
          {t('player.subtitlesLoading')}
        </div>
      )}

      {/* Chargement */}
      {isLoading && (
        <div className={styles.centerOverlay}>
          <AppLogo spin size={52} />
          <span className={styles.overlayLabel}>
            {player.status === 'buffering' ? t('player.buffering') : t('player.loading')}
          </span>
        </div>
      )}

      {/* Erreur */}
      {hasError && (
        <div className={styles.centerOverlay}>
          <span className={styles.errorIcon}><IconAlert size={34} /></span>
          <p className={styles.errorMsg}>{player.error ?? t('player.error')}</p>
          <div className={styles.errorActions}>
            <button className={styles.retryBtn} onClick={player.retry}>
              {t('common.retry')}
            </button>
            {fallbackUrl && onFallback && (
              <button className={`${styles.retryBtn} ${styles.retryBtnAlt}`} onClick={onFallback}>
                {t('player.tryOriginal')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bouton play central quand en pause (overlay souris/tactile) — masqué
          quand le panneau inline a la main (la pause est volontaire). */}
      {!tvMode && player.status === 'paused' && panelKind === null && (
        <div className={styles.pauseHint} onClick={player.toggle}>
          <div className={styles.bigPlayBtn}><IconPlay size={28} /></div>
        </div>
      )}

      {/* Overlay TV (télécommande) — rendu uniquement sur TV. */}
      {tvMode && (
        <TvPlayerOverlay
          player={player}
          title={title}
          isLive={!!isLive}
          channelPosition={channelPosition}
          onPrevChannel={onPrevChannel}
          onNextChannel={onNextChannel}
          subSize={subSize}
          subColor={subColor}
          subBg={subBg}
          onSubSize={setSubSize}
          onSubColor={setSubColor}
          onSubBg={setSubBg}
        />
      )}

      {/* Overlay contrôles souris/tactile — masqué sur TV. */}
      {!tvMode && (
      <div className={styles.controls} onClick={(e) => e.stopPropagation()}>

        {/* Barre du haut */}
        <div className={styles.topBar}>
          {title && (
            <span className={styles.crumb}>
              <span className={styles.crumbNow}>{title}</span>
            </span>
          )}
          {isLive && channelPosition && (
            <span className={styles.channelPos}>{channelPosition}</span>
          )}
          {isLive && (
            <span className={styles.liveBadge}>
              <span className={styles.livePulse} />
              {t('player.onAir')}
            </span>
          )}
        </div>

        {/* Section basse : barre de progression + contrôles */}
        <div className={styles.bottomSection}>
          {!isLive && player.duration > 0 && (
            <div className={styles.progressArea}>
              <span className={styles.timeLabel}>{formatTime(player.currentTime)}</span>
              <div className={styles.progressTrack}>
                <div className={styles.progressBuffered} style={{ width: `${bufferedPercent}%` }} />
                <div className={styles.progressFilled} style={{ width: `${progressPercent}%` }} />
                <div className={styles.progressKnob} style={{ left: `${progressPercent}%` }} />
                <input
                  type="range"
                  className={styles.scrubber}
                  min={0}
                  max={player.duration}
                  step={0.5}
                  value={player.currentTime}
                  onChange={(e) => player.seek(parseFloat(e.target.value))}
                />
              </div>
              <span className={styles.timeLabel}>{formatTime(player.duration)}</span>
            </div>
          )}

          {/* Aperçu live des sous-titres — rendu AU-DESSUS de la barre de
              progression quand le panneau Personnaliser est ouvert (pattern
              identique à TvPlayerOverlay). */}
          {panelKind === 'subtitles' && subView === 'customize' && (
            <div className={styles.subPreviewBar}>
              <span
                style={{
                  fontSize: PREVIEW_PX[subSize],
                  color: SUB_COLOR_HEX[subColor],
                  background: SUB_BG_CSS[subBg],
                  textShadow: subBg === 'none' ? SUB_OUTLINE : SUB_SOFT_SHADOW,
                  padding: subBg === 'none' ? '0 4px' : '4px 14px',
                  borderRadius: 'var(--r-ui)',
                  fontWeight: 700,
                  letterSpacing: '-0.005em',
                  lineHeight: 1.3,
                }}
              >
                {t('player.subtitlePreview')}
              </span>
            </div>
          )}

          {/* Barre du bas : rangée de contrôles OU panneau inline (qui REMPLACE
              les contrôles, façon TvPlayerOverlay). Le panneau ouvre toujours
              en pause auto, et reprend la lecture à sa fermeture. */}
          {panelKind === null ? (
            <div className={styles.bottomBar}>
              {isLive && (onPrevChannel || onNextChannel) && (
                <button
                  className={`${styles.controlBtn} ${styles.primaryGroup}`}
                  onClick={onPrevChannel}
                  disabled={!onPrevChannel}
                  title={t('player.prevChannel')}
                >
                  <IconPrev size={22} />
                </button>
              )}

              {!isLive && (
                <button className={`${styles.controlBtn} ${styles.primaryGroup}`} onClick={() => player.seek(player.currentTime - 10)} title={t('player.back10')}>
                  <IconBack10 size={22} />
                </button>
              )}

              <button className={`${styles.controlBtn} ${styles.playPauseBtn} ${styles.primaryGroup}`} onClick={player.toggle} title={t('player.playPause')}>
                {isPlaying ? <IconPause size={24} /> : <IconPlay size={24} />}
              </button>

              {isLive && (onPrevChannel || onNextChannel) && (
                <button
                  className={`${styles.controlBtn} ${styles.primaryGroup}`}
                  onClick={onNextChannel}
                  disabled={!onNextChannel}
                  title={t('player.nextChannel')}
                >
                  <IconNext size={22} />
                </button>
              )}

              {!isLive && (
                <button className={`${styles.controlBtn} ${styles.primaryGroup}`} onClick={() => player.seek(player.currentTime + 10)} title={t('player.fwd10')}>
                  <IconFwd10 size={22} />
                </button>
              )}

              <div className={styles.spacer} />

              {/* Volume */}
              <div className={styles.volumeGroup}>
                <button className={styles.controlBtn} onClick={player.toggleMute} title={t('player.mute')}>
                  <VolumeIcon size={22} />
                </button>
                <input
                  type="range"
                  className={styles.volumeSlider}
                  min={0}
                  max={1}
                  step={0.05}
                  value={player.isMuted ? 0 : player.volume}
                  onChange={(e) => player.setVolume(parseFloat(e.target.value))}
                />
              </div>

              {/* Audio — ouvre le panneau inline */}
              {player.audioTracks.length > 0 && (
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.secondaryGroup}`}
                  onClick={(e) => { e.stopPropagation(); openPanel('audio'); }}
                  title={t('player.audioTrack')}
                >
                  <IconAudio size={18} />
                  <span className={styles.controlBtnLabel}>
                    {player.audioTracks[player.currentAudio]?.language?.toUpperCase() || 'AUDIO'}
                  </span>
                </button>
              )}

              {/* Sous-titres — ouvre le panneau inline */}
              {player.subtitleTracks.length > 0 && (
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.secondaryGroup} ${player.currentSubtitle >= 0 ? styles.controlBtnOn : ''}`}
                  onClick={(e) => { e.stopPropagation(); openPanel('subtitles'); }}
                  title={t('player.subtitles')}
                >
                  <IconSubtitles size={18} />
                  {player.currentSubtitle >= 0 && (
                    <span className={styles.controlBtnLabel}>
                      {player.subtitleTracks[player.currentSubtitle]?.language?.toUpperCase() || 'CC'}
                    </span>
                  )}
                </button>
              )}

              {/* Qualité — ouvre le panneau inline */}
              {player.levels.length > 1 && (
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.secondaryGroup}`}
                  onClick={(e) => { e.stopPropagation(); openPanel('quality'); }}
                  title={t('player.quality')}
                >
                  <IconQuality size={18} />
                  <span className={styles.controlBtnLabel}>
                    {player.currentLevel === -1
                      ? 'AUTO'
                      : (player.levels[player.currentLevel]?.label ?? 'Q')}
                  </span>
                </button>
              )}

              {/* Plein écran — masqué en natif (l'app est déjà plein écran) */}
              {!isNative && (
                <button
                  className={`${styles.controlBtn} ${styles.secondaryGroup}`}
                  onClick={player.toggleFullscreen}
                  title={t('player.fullscreen')}
                >
                  {player.isFullscreen ? <IconFullscreenExit size={20} /> : <IconFullscreenEnter size={20} />}
                </button>
              )}
            </div>
          ) : (
            <div
              className={`${styles.inlinePanel} ${panelKind === 'subtitles' && subView === 'customize' ? styles.inlinePanelHoriz : ''}`}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header : back (customize) + titre + close */}
              <div className={styles.inlinePanelHeader}>
                {panelKind === 'subtitles' && subView === 'customize' ? (
                  <button
                    className={styles.inlinePanelBack}
                    onClick={() => setSubView('tracks')}
                    title={t('common.backWord')}
                  >
                    <IconBack size={14} />
                  </button>
                ) : (
                  <span className={styles.inlinePanelHeaderSpacer} />
                )}
                <span className={styles.inlinePanelTitle}>
                  {panelKind === 'audio' && t('player.audioTrack')}
                  {panelKind === 'subtitles' && subView === 'tracks' && t('player.subtitles')}
                  {panelKind === 'subtitles' && subView === 'customize' && t('player.customize')}
                  {panelKind === 'quality' && t('player.videoQuality')}
                </span>
                <button
                  className={styles.inlinePanelClose}
                  onClick={closePanel}
                  title={t('common.close')}
                >
                  <IconClose size={16} />
                </button>
              </div>

              {/* Audio */}
              {panelKind === 'audio' && (
                <div className={styles.panelSection}>
                  <div className={styles.panelItems}>
                    {player.audioTracks.map((tr) => (
                      <button
                        key={tr.index}
                        className={`${styles.panelItem} ${player.currentAudio === tr.index ? styles.panelItemActive : ''}`}
                        onClick={() => { player.setAudio(tr.index); closePanel(); }}
                      >
                        {player.currentAudio === tr.index && <IconCheck size={14} className={styles.panelItemCheck} />}
                        {tr.name}{tr.language ? ` (${tr.language})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Qualité */}
              {panelKind === 'quality' && (
                <div className={styles.panelSection}>
                  <div className={styles.panelItems}>
                    <button
                      className={`${styles.panelItem} ${player.currentLevel === -1 ? styles.panelItemActive : ''}`}
                      onClick={() => { player.setLevel(-1); closePanel(); }}
                    >
                      {player.currentLevel === -1 && <IconCheck size={14} className={styles.panelItemCheck} />}
                      {t('player.auto')}
                    </button>
                    {[...player.levels].reverse().map((lvl) => (
                      <button
                        key={lvl.index}
                        className={`${styles.panelItem} ${player.currentLevel === lvl.index ? styles.panelItemActive : ''}`}
                        onClick={() => { player.setLevel(lvl.index); closePanel(); }}
                      >
                        {player.currentLevel === lvl.index && <IconCheck size={14} className={styles.panelItemCheck} />}
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Sous-titres — vue tracks : pistes + bouton Personnaliser */}
              {panelKind === 'subtitles' && subView === 'tracks' && (
                <>
                  <div className={styles.panelSection}>
                    <div className={styles.panelItems}>
                      <button
                        className={`${styles.panelItem} ${player.currentSubtitle === -1 ? styles.panelItemActive : ''}`}
                        onClick={() => { player.setSubtitle(-1); closePanel(); }}
                      >
                        {player.currentSubtitle === -1 && <IconCheck size={14} className={styles.panelItemCheck} />}
                        {t('player.subtitlesOff')}
                      </button>
                      {player.subtitleTracks.map((tr) => (
                        <button
                          key={tr.index}
                          className={`${styles.panelItem} ${player.currentSubtitle === tr.index ? styles.panelItemActive : ''}`}
                          onClick={() => { player.setSubtitle(tr.index); closePanel(); }}
                        >
                          {player.currentSubtitle === tr.index && <IconCheck size={14} className={styles.panelItemCheck} />}
                          {tr.name}{tr.language ? ` (${tr.language})` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.panelSection}>
                    <div className={styles.panelSectionTitle}>{t('player.customize')}</div>
                    <div className={styles.panelItems}>
                      <button
                        className={`${styles.panelItem} ${styles.panelItemAccent}`}
                        onClick={() => setSubView('customize')}
                      >
                        <IconSettings size={14} />
                        {t('player.customize')}
                      </button>
                    </div>
                  </div>
                </>
              )}

              {/* Sous-titres — vue customize : 3 colonnes Taille / Couleur / Fond */}
              {panelKind === 'subtitles' && subView === 'customize' && (
                <>
                  <div className={styles.panelSection}>
                    <div className={styles.panelSectionTitle}>{t('player.size')}</div>
                    <div className={styles.panelItems}>
                      {(['sm', 'md', 'lg', 'xl'] as SubSize[]).map((sz) => (
                        <button
                          key={sz}
                          className={`${styles.panelItem} ${styles.panelItemChip} ${subSize === sz ? styles.panelItemActive : ''}`}
                          onClick={() => setSubSize(sz)}
                          title={sz.toUpperCase()}
                        >
                          <span className={styles.chipAa} style={{ fontSize: CHIP_PX[sz] }}>Aa</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.panelSection}>
                    <div className={styles.panelSectionTitle}>{t('player.color')}</div>
                    <div className={styles.panelItems}>
                      {(['white', 'yellow', 'cyan', 'green'] as SubColor[]).map((c) => (
                        <button
                          key={c}
                          className={`${styles.panelItem} ${styles.panelItemChip} ${subColor === c ? styles.panelItemActive : ''}`}
                          onClick={() => setSubColor(c)}
                        >
                          <span className={styles.chipAa} style={{ color: SUB_COLOR_HEX[c], textShadow: SUB_OUTLINE, fontSize: 17 }}>Aa</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className={styles.panelSection}>
                    <div className={styles.panelSectionTitle}>{t('player.background')}</div>
                    <div className={styles.panelItems}>
                      {(['none', 'semi', 'solid'] as SubBg[]).map((b) => (
                        <button
                          key={b}
                          className={`${styles.panelItem} ${styles.panelItemChip} ${subBg === b ? styles.panelItemActive : ''}`}
                          onClick={() => setSubBg(b)}
                        >
                          <span
                            className={styles.chipAa}
                            style={{
                              background: SUB_BG_CSS[b],
                              color: '#fff',
                              padding: '2px 8px',
                              borderRadius: 'var(--r-ui)',
                              fontSize: 15,
                              textShadow: b === 'none' ? SUB_OUTLINE : SUB_SOFT_SHADOW,
                            }}
                          >Aa</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
