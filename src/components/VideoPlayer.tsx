import { useState, useEffect, useCallback, useRef } from 'react';
import { usePlayer } from '../hooks/usePlayer';
import { useSubtitles } from '../hooks/useSubtitles';
import { safeImgUrl } from '../utils/image';
import { SubtitleOverlay, type SubSize, type SubBg, type SubColor } from './SubtitleOverlay';
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
   * lecture qui peut être un .m3u8 HLS.
   */
  mediaUrl?: string;
  onFallback?: () => void;
  onError?: () => void;
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatOffset(s: number): string {
  if (s === 0) return '0.0s';
  return `${s > 0 ? '+' : ''}${s.toFixed(2)}s`;
}

// ── Persistance des préférences visuelles ────────────────────────────────────
const SUB_PREFS_KEY = 'iptv-subtitle-prefs';

interface SubPrefs {
  size: SubSize;
  bg: SubBg;
  color: SubColor;
}

const DEFAULT_SUB_PREFS: SubPrefs = { size: 'md', bg: 'none', color: 'white' };

const ALL_SIZES: SubSize[] = ['sm', 'md', 'lg', 'xl', 'xxl'];
const ALL_BGS: SubBg[] = ['none', 'semi', 'solid'];
const ALL_COLORS: SubColor[] = ['white', 'yellow', 'cyan', 'green', 'red', 'pink'];

const SIZE_LABEL: Record<SubSize, string> = { sm: 'S', md: 'M', lg: 'L', xl: 'XL', xxl: 'XXL' };
const BG_LABEL: Record<SubBg, string> = { none: 'Aucun', semi: 'Semi', solid: 'Plein' };
const COLOR_LABEL: Record<SubColor, string> = {
  white: 'Blanc', yellow: 'Jaune', cyan: 'Cyan',
  green: 'Vert', red: 'Rouge', pink: 'Rose',
};
const COLOR_SWATCH: Record<SubColor, string> = {
  white: '#ffffff', yellow: '#ffd93d', cyan: '#61dafb',
  green: '#7fff7f', red: '#ff8a8a', pink: '#ffb3d9',
};

function loadSubPrefs(): SubPrefs {
  try {
    const raw = localStorage.getItem(SUB_PREFS_KEY);
    if (!raw) return DEFAULT_SUB_PREFS;
    const parsed = JSON.parse(raw) as Partial<SubPrefs>;
    return {
      size: ALL_SIZES.includes(parsed.size as SubSize) ? parsed.size as SubSize : DEFAULT_SUB_PREFS.size,
      bg: ALL_BGS.includes(parsed.bg as SubBg) ? parsed.bg as SubBg : DEFAULT_SUB_PREFS.bg,
      color: ALL_COLORS.includes(parsed.color as SubColor) ? parsed.color as SubColor : DEFAULT_SUB_PREFS.color,
    };
  } catch { return DEFAULT_SUB_PREFS; }
}

function saveSubPrefs(prefs: SubPrefs) {
  try { localStorage.setItem(SUB_PREFS_KEY, JSON.stringify(prefs)); } catch { /* */ }
}

export function VideoPlayer({ url, title, poster, isLiveType, fallbackUrl, mediaUrl, onFallback, onError }: Props) {
  const player = usePlayer(url, mediaUrl);

  // Sous-titres : nouveau hook frame-accurate, totalement découplé du player.
  // Il utilise requestVideoFrameCallback pour synchroniser exactement à la
  // frame affichée, en compensant le décalage de timestamp via getStreamBase().
  const subtitles = useSubtitles({
    videoRef: player.videoRef,
    getMediaUrl: player.getMediaUrl,
    tracks: player.subtitleTracks,
    getStreamBase: player.getStreamBase,
    streamEpoch: player.streamEpoch,
  });

  const [controlsVisible, setControlsVisible] = useState(true);
  const [showQuality, setShowQuality] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [showSubtitles, setShowSubtitles] = useState(false);
  const [showSubSettings, setShowSubSettings] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialPrefs = loadSubPrefs();
  const [subSize, setSubSize] = useState<SubSize>(initialPrefs.size);
  const [subBg, setSubBg] = useState<SubBg>(initialPrefs.bg);
  const [subColor, setSubColor] = useState<SubColor>(initialPrefs.color);

  useEffect(() => {
    saveSubPrefs({ size: subSize, bg: subBg, color: subColor });
  }, [subSize, subBg, subColor]);

  const isLive = player.isLive || isLiveType;
  const isLoading = player.status === 'loading' || player.status === 'buffering';
  const hasError = player.status === 'error';
  const isPlaying = player.status === 'playing';

  const prevErrorRef = useRef(false);
  useEffect(() => {
    if (hasError && !prevErrorRef.current && fallbackUrl) {
      prevErrorRef.current = true;
      onError?.();
    }
    if (!hasError) prevErrorRef.current = false;
  }, [hasError, fallbackUrl, onError]);

  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
  }, []);

  useEffect(() => {
    if (!isPlaying) setControlsVisible(true);
  }, [isPlaying]);

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
          if (!isLive) { e.preventDefault(); player.seek(player.currentTime + 10); }
          break;
        case 'ArrowLeft':
          if (!isLive) { e.preventDefault(); player.seek(player.currentTime - 10); }
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
          // g = sous-titres plus tôt, Shift+G = pas de 1s
          e.preventDefault();
          subtitles.adjustSubtitleOffset(e.shiftKey ? 1 : 0.25);
          break;
        case 'h':
        case 'H':
          // h = sous-titres plus tard, Shift+H = pas de 1s
          e.preventDefault();
          subtitles.adjustSubtitleOffset(e.shiftKey ? -1 : -0.25);
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [player, subtitles, isLive]);

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

  return (
    <div
      ref={player.wrapperRef}
      className={`${styles.wrapper} ${showControls ? styles.showControls : ''}`}
      onMouseMove={resetHideTimer}
      onMouseLeave={() => { if (isPlaying) setControlsVisible(false); }}
      onClick={closeAllMenus}
    >
      <video
        ref={player.videoRef}
        className={styles.video}
        playsInline
        poster={safeImgUrl(poster)}
        onClick={player.toggle}
      />

      {/* Sous-titres frame-accurate (requestVideoFrameCallback) + contour noir */}
      <SubtitleOverlay
        text={subtitles.subtitleText}
        size={subSize}
        bg={subBg}
        color={subColor}
      />

      {isLoading && (
        <div className={styles.centerOverlay}>
          <div className={styles.spinner} />
          <span className={styles.overlayLabel}>
            {player.status === 'buffering' ? 'Mise en mémoire tampon…' : 'Chargement…'}
          </span>
        </div>
      )}

      {hasError && (
        <div className={styles.centerOverlay}>
          <span className={styles.errorIcon}>⚠</span>
          <p className={styles.errorMsg}>{player.error ?? 'Erreur de lecture'}</p>
          <div className={styles.errorActions}>
            <button className={styles.retryBtn} onClick={player.retry}>
              ↺ Réessayer
            </button>
            {fallbackUrl && onFallback && (
              <button className={`${styles.retryBtn} ${styles.retryBtnAlt}`} onClick={onFallback}>
                Essayer le format original
              </button>
            )}
          </div>
        </div>
      )}

      {player.status === 'paused' && (
        <div className={styles.pauseHint} onClick={player.toggle}>
          <div className={styles.bigPlayBtn}>▶</div>
        </div>
      )}

      <div className={styles.controls} onClick={(e) => e.stopPropagation()}>

        <div className={styles.topBar}>
          {title && <span className={styles.title}>{title}</span>}
          {isLive && <span className={styles.liveBadge}>● EN DIRECT</span>}
        </div>

        <div className={styles.bottomSection}>
          {!isLive && player.duration > 0 && (
            <div className={styles.progressArea}>
              <span className={styles.timeLabel}>{formatTime(player.currentTime)}</span>
              <div className={styles.progressTrack}>
                <div className={styles.progressBuffered} style={{ width: `${bufferedPercent}%` }} />
                <div className={styles.progressFilled} style={{ width: `${progressPercent}%` }} />
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

          <div className={styles.bottomBar}>
            <button className={styles.controlBtn} onClick={player.toggle} title="Lecture/Pause (Espace)">
              {isPlaying ? '⏸' : '▶'}
            </button>

            {!isLive && (
              <>
                <button className={styles.controlBtn} onClick={() => player.seek(player.currentTime - 10)} title="- 10s (←)">
                  ↩ 10s
                </button>
                <button className={styles.controlBtn} onClick={() => player.seek(player.currentTime + 10)} title="+ 10s (→)">
                  10s ↪
                </button>
              </>
            )}

            <div className={styles.spacer} />

            <div className={styles.volumeGroup}>
              <button className={styles.controlBtn} onClick={player.toggleMute} title="Muet (M)">
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

            {player.audioTracks.length > 0 && (
              <div className={styles.menuContainer}>
                <button
                  className={`${styles.controlBtn} ${showAudio ? styles.controlBtnActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowAudio((v) => !v); setShowQuality(false); setShowSubtitles(false); }}
                  title="Piste audio"
                >
                  🎵 {player.audioTracks[player.currentAudio]?.language?.toUpperCase() || 'AUDIO'}
                </button>
                {showAudio && (
                  <div className={styles.popupMenu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuHeader}>Piste audio</div>
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

            {player.subtitleTracks.length > 0 && (
              <div className={styles.menuContainer}>
                <button
                  className={`${styles.controlBtn} ${showSubtitles ? styles.controlBtnActive : ''} ${subtitles.currentSubtitle >= 0 ? styles.controlBtnOn : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowSubtitles((v) => !v); setShowQuality(false); setShowAudio(false); }}
                  title="Sous-titres"
                >
                  CC{subtitles.currentSubtitle >= 0 ? ` · ${player.subtitleTracks[subtitles.currentSubtitle]?.language?.toUpperCase() || '●'}` : ''}
                </button>
                {showSubtitles && (
                  <div className={styles.popupMenu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuHeader}>
                      Sous-titres
                      <button
                        className={`${styles.menuSettingsBtn} ${showSubSettings ? styles.menuSettingsBtnActive : ''}`}
                        onClick={() => setShowSubSettings((v) => !v)}
                        title="Personnaliser l'apparence"
                      >
                        ⚙
                      </button>
                    </div>

                    {showSubSettings && (
                      <div className={styles.subSettings}>
                        <div className={styles.subSettingsRow}>
                          <span className={styles.subSettingsLabel}>Taille</span>
                          <div className={styles.subSettingsBtns}>
                            {ALL_SIZES.map((s) => (
                              <button
                                key={s}
                                className={`${styles.subSettingsOpt} ${subSize === s ? styles.subSettingsOptActive : ''}`}
                                onClick={() => setSubSize(s)}
                              >
                                {SIZE_LABEL[s]}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className={styles.subSettingsRow}>
                          <span className={styles.subSettingsLabel}>Fond</span>
                          <div className={styles.subSettingsBtns}>
                            {ALL_BGS.map((b) => (
                              <button
                                key={b}
                                className={`${styles.subSettingsOpt} ${subBg === b ? styles.subSettingsOptActive : ''}`}
                                onClick={() => setSubBg(b)}
                              >
                                {BG_LABEL[b]}
                              </button>
                            ))}
                          </div>
                        </div>
                        <div className={styles.subSettingsRow}>
                          <span className={styles.subSettingsLabel}>Couleur</span>
                          <div className={styles.subSettingsBtnsColors}>
                            {ALL_COLORS.map((c) => (
                              <button
                                key={c}
                                className={`${styles.colorSwatch} ${subColor === c ? styles.colorSwatchActive : ''}`}
                                onClick={() => setSubColor(c)}
                                title={COLOR_LABEL[c]}
                                style={{ background: COLOR_SWATCH[c] }}
                              />
                            ))}
                          </div>
                        </div>
                        <div className={styles.subSettingsRow}>
                          <span className={styles.subSettingsLabel}>
                            Décalage<br/>
                            <span className={styles.subSettingsHint}>{formatOffset(subtitles.subtitleOffset)}</span>
                          </span>
                          <div className={styles.subSettingsBtns}>
                            <button
                              className={styles.subSettingsOpt}
                              onClick={() => subtitles.adjustSubtitleOffset(-0.25)}
                              title="Sous-titres plus tard (-0.25s)"
                            >−</button>
                            <button
                              className={styles.subSettingsOpt}
                              onClick={() => subtitles.setSubtitleOffset(0)}
                              title="Remettre à zéro"
                            >0</button>
                            <button
                              className={styles.subSettingsOpt}
                              onClick={() => subtitles.adjustSubtitleOffset(0.25)}
                              title="Sous-titres plus tôt (+0.25s)"
                            >+</button>
                          </div>
                        </div>
                      </div>
                    )}

                    <button
                      className={`${styles.menuOption} ${subtitles.currentSubtitle === -1 ? styles.menuOptionActive : ''}`}
                      onClick={() => { subtitles.setSubtitle(-1); setShowSubtitles(false); }}
                    >
                      <span className={styles.menuOptionIcon}>{subtitles.currentSubtitle === -1 ? '✓' : ''}</span>
                      Désactivés
                    </button>
                    {player.subtitleTracks.map((t) => (
                      <button
                        key={t.index}
                        className={`${styles.menuOption} ${subtitles.currentSubtitle === t.index ? styles.menuOptionActive : ''}`}
                        onClick={() => { subtitles.setSubtitle(t.index); setShowSubtitles(false); }}
                      >
                        <span className={styles.menuOptionIcon}>{subtitles.currentSubtitle === t.index ? '✓' : ''}</span>
                        {t.name}{t.language ? ` (${t.language})` : ''}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {player.levels.length > 1 && (
              <div className={styles.menuContainer}>
                <button
                  className={`${styles.controlBtn} ${showQuality ? styles.controlBtnActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); setShowQuality((v) => !v); setShowAudio(false); setShowSubtitles(false); }}
                  title="Qualité"
                >
                  {player.currentLevel === -1
                    ? 'AUTO'
                    : (player.levels[player.currentLevel]?.label ?? 'Q')}
                </button>
                {showQuality && (
                  <div className={styles.popupMenu} onClick={(e) => e.stopPropagation()}>
                    <div className={styles.menuHeader}>Qualité vidéo</div>
                    <button
                      className={`${styles.menuOption} ${player.currentLevel === -1 ? styles.menuOptionActive : ''}`}
                      onClick={() => { player.setLevel(-1); setShowQuality(false); }}
                    >
                      <span className={styles.menuOptionIcon}>{player.currentLevel === -1 ? '✓' : ''}</span>
                      Auto
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

            <button
              className={styles.controlBtn}
              onClick={player.toggleFullscreen}
              title="Plein écran (F)"
            >
              {player.isFullscreen ? '⊡' : '⊞'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
