import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlayer, type WebPlayerController } from '../hooks/usePlayer';
import { useNativePlayer } from '../hooks/useNativePlayer';
import { useWebOSPlayer } from '../hooks/useWebOSPlayer';
import { isNative, isWebOS } from '../lib/platform';
import { safeImgUrl } from '../utils/image';
import { AppLogo } from './AppLogo';
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

type SubSize = 'sm' | 'md' | 'lg' | 'xl';
type SubBg = 'none' | 'semi' | 'solid';
type SubColor = 'white' | 'yellow' | 'cyan' | 'green';

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
  // `isNative` / `isWebOS` sont figés au build (cf. src/lib/platform.ts) → la
  // branche est stable pour toute la vie du composant : appeler conditionnellement
  // l'un ou l'autre hook est sûr ici (le lint rules-of-hooks ne peut pas le
  // savoir).
  //   - webOS → <video> HTML5 + hls.js (URL Xtream directe, pas de proxy)
  //   - autre natif (Capacitor/Tizen)  → libVLC via le plugin maison
  //   - web → usePlayer (ffmpeg + /api/stream + sous-titres custom)
  /* eslint-disable react-hooks/rules-of-hooks */
  const player: WebPlayerController =
    isWebOS  ? useWebOSPlayer(url, mediaUrl)
    : isNative ? useNativePlayer(url, mediaUrl)
    :            usePlayer(url, mediaUrl);
  /* eslint-enable react-hooks/rules-of-hooks */
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showQuality, setShowQuality] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [showSubSettings, setShowSubSettings] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Raccourcis clavier
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
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
  }, [player, isLive, onPrevChannel, onNextChannel]);

  const progressPercent = !isLive && player.duration > 0
    ? (player.currentTime / player.duration) * 100
    : 0;

  const bufferedPercent = player.duration > 0
    ? (player.bufferedEnd / player.duration) * 100
    : 0;

  const volumeIcon = player.isMuted || player.volume === 0 ? '🔇'
    : player.volume < 0.5 ? '🔉'
    : '🔊';

  const showControls = controlsVisible || !isPlaying || hasError;

  const closeAllMenus = () => {
    setShowQuality(false);
    setShowAudio(false);
    setShowSubtitles(false);
    setShowSubSettings(false);
  };

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
  //   - webOS Media Pipeline → `useWebOSPlayer` pose `usesNativeSurface` à true
  //     pour les fichiers directs (MKV/MP4), false en HLS (rendu par <video>)
  // Dans ces cas on n'affiche pas de <video> — juste un <div> transparent
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
      {useNativeSurface ? (
        <div className={`${styles.video} native-video-surface`} onClick={player.toggle} />
      ) : (
        <video
          ref={player.videoRef}
          className={styles.video}
          playsInline
          poster={safeImgUrl(poster)}
          onClick={player.toggle}
        />
      )}

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
          <span className={styles.errorIcon}>⚠</span>
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

      {/* Bouton play central quand en pause */}
      {player.status === 'paused' && (
        <div className={styles.pauseHint} onClick={player.toggle}>
          <div className={styles.bigPlayBtn}>▶</div>
        </div>
      )}

      {/* Overlay contrôles */}
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

          {/* Barre du bas
              Classes additionnelles pour le mobile :
              - .primaryGroup → boutons de lecture (prev/play/next ou ±10s) centrés
              - .playPauseBtn → bouton play/pause distinctif (pastille blanche)
              - .secondaryGroup → menus + plein écran (alignés à droite)
              Sur desktop, .bottomBar reste un flex flat ; le visuel est inchangé.
              CSS gère le regroupement en 2 lignes uniquement sur mobile. */}
          <div className={styles.bottomBar}>
            {isLive && (onPrevChannel || onNextChannel) && (
              <button
                className={`${styles.controlBtn} ${styles.primaryGroup}`}
                onClick={onPrevChannel}
                disabled={!onPrevChannel}
                title={t('player.prevChannel')}
              >
                ⏮
              </button>
            )}

            {!isLive && (
              <button className={`${styles.controlBtn} ${styles.primaryGroup}`} onClick={() => player.seek(player.currentTime - 10)} title={t('player.back10')}>
                ↩ 10s
              </button>
            )}

            <button className={`${styles.controlBtn} ${styles.playPauseBtn} ${styles.primaryGroup}`} onClick={player.toggle} title={t('player.playPause')}>
              {isPlaying ? '⏸' : '▶'}
            </button>

            {isLive && (onPrevChannel || onNextChannel) && (
              <button
                className={`${styles.controlBtn} ${styles.primaryGroup}`}
                onClick={onNextChannel}
                disabled={!onNextChannel}
                title={t('player.nextChannel')}
              >
                ⏭
              </button>
            )}

            {!isLive && (
              <button className={`${styles.controlBtn} ${styles.primaryGroup}`} onClick={() => player.seek(player.currentTime + 10)} title={t('player.fwd10')}>
                10s ↪
              </button>
            )}

            <div className={styles.spacer} />

            {/* Volume */}
            <div className={styles.volumeGroup}>
              <button className={styles.controlBtn} onClick={player.toggleMute} title={t('player.mute')}>
                {volumeIcon}
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

            {/* Sélecteur de piste audio */}
            {player.audioTracks.length > 0 && (
              <div className={`${styles.menuContainer} ${styles.secondaryGroup}`}>
                <button
                  className={`${styles.controlBtn} ${showAudio ? styles.controlBtnActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowAudio((v) => !v); setShowQuality(false); setShowSubtitles(false); }}
                  title={t('player.audioTrack')}
                >
                  🎵 {player.audioTracks[player.currentAudio]?.language?.toUpperCase() || 'AUDIO'}
                </button>
                {showAudio && (
                  <div className={styles.popupMenu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuHeader}>{t('player.audioTrack')}</div>
                    {player.audioTracks.map((t) => (
                      <button
                        key={t.index}
                        className={`${styles.menuOption} ${player.currentAudio === t.index ? styles.menuOptionActive : ''}`}
                        onClick={() => { player.setAudio(t.index); setShowAudio(false); }}
                      >
                        <span className={styles.menuOptionIcon}>{player.currentAudio === t.index ? '✓' : ''}</span>
                        {t.name}{t.language ? ` (${t.language})` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sélecteur de sous-titres */}
            {player.subtitleTracks.length > 0 && (
              <div className={`${styles.menuContainer} ${styles.secondaryGroup}`}>
                <button
                  className={`${styles.controlBtn} ${showSubtitles ? styles.controlBtnActive : ''} ${player.currentSubtitle >= 0 ? styles.controlBtnOn : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowSubtitles((v) => !v); setShowQuality(false); setShowAudio(false); }}
                  title={t('player.subtitles')}
                >
                  CC{player.currentSubtitle >= 0 ? ` · ${player.subtitleTracks[player.currentSubtitle]?.language?.toUpperCase() || '●'}` : ''}
                </button>
                {showSubtitles && (
                  <div className={styles.popupMenu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuHeader}>
                      {t('player.subtitles')}
                      <button
                        className={styles.menuSettingsBtn}
                        onClick={() => setShowSubSettings((v) => !v)}
                        title={t('player.customize')}
                      >
                        ⚙
                      </button>
                    </div>

                    {showSubSettings && (
                      <div className={styles.subSettings}>
                        <div className={styles.subSettingsRow}>
                          <span className={styles.subSettingsLabel}>{t('player.size')}</span>
                          <div className={styles.subSettingsBtns}>
                            {(['sm', 'md', 'lg', 'xl'] as SubSize[]).map((s) => (
                              <button key={s} className={`${styles.subSettingsOpt} ${subSize === s ? styles.subSettingsOptActive : ''}`} onClick={() => setSubSize(s)}>
                                {s === 'sm' ? 'S' : s === 'md' ? 'M' : s === 'lg' ? 'L' : 'XL'}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className={styles.subSettingsRow}>
                          <span className={styles.subSettingsLabel}>{t('player.background')}</span>
                          <div className={styles.subSettingsBtns}>
                            {(['none', 'semi', 'solid'] as SubBg[]).map((b) => (
                              <button key={b} className={`${styles.subSettingsOpt} ${subBg === b ? styles.subSettingsOptActive : ''}`} onClick={() => setSubBg(b)}>
                                {b === 'none' ? t('player.bgNone') : b === 'semi' ? t('player.bgSemi') : t('player.bgSolid')}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className={styles.subSettingsRow}>
                          <span className={styles.subSettingsLabel}>{t('player.color')}</span>
                          <div className={styles.subSettingsBtns}>
                            {(['white', 'yellow', 'cyan', 'green'] as SubColor[]).map((c) => (
                              <button key={c} className={`${styles.subSettingsOpt} ${subColor === c ? styles.subSettingsOptActive : ''}`} onClick={() => setSubColor(c)}>
                                {c === 'white' ? t('player.colWhite') : c === 'yellow' ? t('player.colYellow') : c === 'cyan' ? t('player.colCyan') : t('player.colGreen')}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      className={`${styles.menuOption} ${player.currentSubtitle === -1 ? styles.menuOptionActive : ''}`}
                      onClick={() => { player.setSubtitle(-1); setShowSubtitles(false); }}
                    >
                      <span className={styles.menuOptionIcon}>{player.currentSubtitle === -1 ? '✓' : ''}</span>
                      {t('player.subtitlesOff')}
                    </button>
                    {player.subtitleTracks.map((t) => (
                      <button
                        key={t.index}
                        className={`${styles.menuOption} ${player.currentSubtitle === t.index ? styles.menuOptionActive : ''}`}
                        onClick={() => { player.setSubtitle(t.index); setShowSubtitles(false); }}
                      >
                        <span className={styles.menuOptionIcon}>{player.currentSubtitle === t.index ? '✓' : ''}</span>
                        {t.name}{t.language ? ` (${t.language})` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Sélecteur de qualité */}
            {player.levels.length > 1 && (
              <div className={`${styles.menuContainer} ${styles.secondaryGroup}`}>
                <button
                  className={`${styles.controlBtn} ${showQuality ? styles.controlBtnActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowQuality((v) => !v); setShowAudio(false); setShowSubtitles(false); }}
                  title={t('player.quality')}
                >
                  {player.currentLevel === -1
                    ? 'AUTO'
                    : (player.levels[player.currentLevel]?.label ?? 'Q')}
                </button>
                {showQuality && (
                  <div className={styles.popupMenu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuHeader}>{t('player.videoQuality')}</div>
                    <button
                      className={`${styles.menuOption} ${player.currentLevel === -1 ? styles.menuOptionActive : ''}`}
                      onClick={() => { player.setLevel(-1); setShowQuality(false); }}
                    >
                      <span className={styles.menuOptionIcon}>{player.currentLevel === -1 ? '✓' : ''}</span>
                      {t('player.auto')}
                    </button>
                    {[...player.levels].reverse().map((lvl) => (
                      <button
                        key={lvl.index}
                        className={`${styles.menuOption} ${player.currentLevel === lvl.index ? styles.menuOptionActive : ''}`}
                        onClick={() => { player.setLevel(lvl.index); setShowQuality(false); }}
                      >
                        <span className={styles.menuOptionIcon}>{player.currentLevel === lvl.index ? '✓' : ''}</span>
                        {lvl.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Plein écran — masqué en natif (l'app est déjà plein écran) */}
            {!isNative && (
              <button
                className={`${styles.controlBtn} ${styles.secondaryGroup}`}
                onClick={player.toggleFullscreen}
                title={t('player.fullscreen')}
              >
                {player.isFullscreen ? '⊡' : '⊞'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
