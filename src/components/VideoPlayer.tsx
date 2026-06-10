import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePlayer, type WebPlayerController } from '../hooks/usePlayer';
import { useNativePlayer } from '../hooks/useNativePlayer';
import { useWebOSPlayer } from '../hooks/useWebOSPlayer';
import { useTizenPlayer } from '../hooks/useTizenPlayer';
import { useElectronPlayer } from '../hooks/useElectronPlayer';
import { isElectronMpvReady } from '../native/electronMpv';
import { isNative, isCapacitor, isWebOS, isTizen, isElectron } from '../lib/platform';
import { volumeControl } from '../native/volumeControl';
import { isTvDevice } from '../native/tvDetect';
import { safeImgUrl } from '../utils/image';
import { AppLogo } from './AppLogo';
import { TvPlayerOverlay, type SubSize, type SubBg, type SubColor } from './TvPlayerOverlay';
import {
  IconPlay, IconPause, IconBack10, IconFwd10, IconPrev, IconNext,
  IconAudio, IconSubtitles, IconQuality, IconCheck, IconBack, IconClose,
  IconVolumeMute, IconVolumeLow, IconVolumeHigh,
  IconFullscreenEnter, IconFullscreenExit, IconSettings, IconAlert,
  IconEpisodes, IconSun,
} from './PlayerIcons';
import { useI18n } from '../contexts/I18nContext';
import type { Episode, LiveChannelRef } from '../types/xtream.types';
import type { TmdbEpisodeStills } from '../types/tmdb.types';
import type { EpgRow } from '../utils/epg';
import { qualityLabel } from '../utils/catalog';
import { channelCode } from '../utils/channel';
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
  // ── Zapping prev/next avec sélecteur de qualité (boutons de l'overlay) ─────
  // Refs de la chaîne précédente / suivante dans la liste courante (catégorie ou
  // favoris — celle du compteur « 1/82 »), enrichies de leurs variantes de
  // qualité. `onZapChannel(direction, variant?)` joue la chaîne adjacente ; si la
  // cible a ≥ 2 variantes, l'overlay ouvre le même bottom-sheet de qualité que le
  // zapper avant d'appeler `onZapChannel` avec la variante choisie. Boutons grisés
  // quand `prevChannel`/`nextChannel` sont absents (bord de liste).
  prevChannel?: LiveChannelRef;
  nextChannel?: LiveChannelRef;
  onZapChannel?: (direction: 1 | -1, variant?: { stream_id: number; name: string }) => void;
  // ── Zapper live (catalogue navigable par catégorie dans l'overlay) ────────
  // Catalogue complet (catégories + chaînes regroupées par titre avec variantes
  // de qualité), construit côté Player. Permet un rail de zapping + une rangée
  // de catégories cliquables. `liveCurrentCategoryId`/`liveCurrentStreamId`
  // localisent la chaîne en cours (surlignage). `onPlayChannel(catId, index)`
  // demande la lecture ; le variant optionnel vient du bottom-sheet de qualité.
  liveCatalog?: { id: string; name: string; channels: LiveChannelRef[] }[];
  liveCurrentCategoryId?: string;
  liveCurrentStreamId?: number;
  onPlayChannel?: (categoryId: string, index: number, variant?: { stream_id: number; name: string }) => void;
  // Programme EPG de la chaîne live courante (affiché en bande basse de
  // l'overlay). Vide / absent → aucune bande. Strictement additif.
  liveEpg?: EpgRow[];
  // Reprise de lecture : position + pistes du dernier arrêt (non-live).
  resume?: { time: number; audio?: number; subtitle?: number };
  // Sauvegarde périodique de la progression (position + pistes).
  onPersist?: (p: { position: number; duration: number; audio: number; subtitle: number }) => void;
  // ── Panneau « Épisodes » (séries uniquement, chantier 3) ─────────────────
  // Si `episodesBySeason` est fourni ET non vide, un bouton « Épisodes »
  // apparaît dans la rangée et ouvre un panneau inline avec sélecteur de
  // saison + grille horizontale d'épisodes (vignettes TMDB en Premium).
  episodesBySeason?: Record<string, Episode[]>;
  currentSeason?: number;
  currentEpisodeNum?: number;
  stillsBySeason?: Record<number, TmdbEpisodeStills>;
  onLoadSeasonStills?: (season: number) => void;
  onPlayEpisode?: (ep: Episode) => void;
  // Bouton retour (×) intégré dans l'overlay (visible uniquement quand les
  // contrôles sont affichés). Géré ici plutôt que dans Player.tsx pour avoir
  // accès direct à `controlsVisible`.
  onBack?: () => void;
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

// ── Mapping prefs → options libVLC (sous-titres rendus NATIVEMENT sur Android).
// libVLC ne rend pas l'overlay React ; on lui passe le style via media options
// (sub-text-scale en %, freetype-color en RGB entier, background-opacity 0-255).
const NATIVE_SUB_SCALE: Record<SubSize, number> = { sm: 70, md: 100, lg: 145, xl: 195 };
const NATIVE_SUB_COLOR: Record<SubColor, number> = {
  white: 0xffffff, yellow: 0xffe066, cyan: 0x00d4ff, green: 0x7eff7e,
};
const NATIVE_SUB_BG_OPACITY: Record<SubBg, number> = { none: 0, semi: 160, solid: 235 };

// ── Mapping prefs → options mpv (Electron — sous-titres rendus par mpv).
// Avantage mpv vs libVLC : ces propriétés s'appliquent À CHAUD (pas de
// reconstruction du moteur). sub-scale en facteur, couleur/fond en hex.
const MPV_SUB_SCALE: Record<SubSize, number> = { sm: 0.7, md: 1.0, lg: 1.45, xl: 1.95 };
const MPV_SUB_COLOR: Record<SubColor, string> = {
  white: '#ffffff', yellow: '#ffe066', cyan: '#00d4ff', green: '#7eff7e',
};
// sub-back-color = boîte derrière le texte (#aarrggbb). none → transparent.
const MPV_SUB_BACK: Record<SubBg, string> = {
  none: '#00000000', semi: '#99000000', solid: '#ec000000',
};

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
  prevChannel,
  nextChannel,
  onZapChannel,
  liveCatalog,
  liveCurrentCategoryId,
  liveCurrentStreamId,
  onPlayChannel,
  liveEpg,
  resume,
  onPersist,
  episodesBySeason,
  currentSeason,
  currentEpisodeNum,
  stillsBySeason,
  onLoadSeasonStills,
  onPlayEpisode,
  onBack,
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
  // Sous-titres : préférences visuelles persistées dans localStorage. Déclarées
  // AVANT le hook player pour pouvoir passer le style aux sous-titres natifs
  // (libVLC les rend lui-même sur Android → media options au chargement).
  const initialPrefs = loadSubPrefs();
  const [subSize, setSubSize] = useState<SubSize>(initialPrefs.size);
  const [subBg, setSubBg] = useState<SubBg>(initialPrefs.bg);
  const [subColor, setSubColor] = useState<SubColor>(initialPrefs.color);
  const nativeSubStyle = {
    scale: NATIVE_SUB_SCALE[subSize],
    color: NATIVE_SUB_COLOR[subColor],
    bgOpacity: NATIVE_SUB_BG_OPACITY[subBg],
  };
  const mpvSubStyle = {
    scale: MPV_SUB_SCALE[subSize],
    color: MPV_SUB_COLOR[subColor],
    back: MPV_SUB_BACK[subBg],
  };

  // Electron (Windows) : lecteur natif mpv si le binaire est présent (résolu au
  // boot, cf. initElectronMpv) ; sinon repli sur le proxy ffmpeg (`usePlayer`).
  // `isElectron` est figé au module et `isElectronMpvReady()` au boot → la
  // branche est stable pour la vie du composant (hooks conditionnels sûrs).
  const useElectronNative = isElectron && isElectronMpvReady();

  /* eslint-disable react-hooks/rules-of-hooks */
  const player: WebPlayerController = isCapacitor
    ? useNativePlayer(url, mediaUrl, nativeSubStyle, !!isLiveType)
    : isWebOS
      ? useWebOSPlayer(url, mediaUrl)
      : isTizen
        ? useTizenPlayer(url, mediaUrl)
        : useElectronNative
          ? useElectronPlayer(url, mediaUrl, { isLive: !!isLiveType, subStyle: mpvSubStyle })
          : usePlayer(url, mediaUrl);
  /* eslint-enable react-hooks/rules-of-hooks */
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsVisibleRef = useRef(controlsVisible);
  controlsVisibleRef.current = controlsVisible;
  // Double-tap seek flash (mobile/touch) — 'left' | 'right' | null
  const [tapFlash, setTapFlash] = useState<'left' | 'right' | null>(null);
  // Luminosité simulée par overlay sombre (0.1 = très sombre, 1.0 = plein)
  const [brightness, setBrightness] = useState(1.0);
  // Volume affiché dans le slider : volume système Android (Capacitor) ou
  // player.volume (web/Electron). null = pas encore lu.
  const [sysVolume, setSysVolume] = useState<number | null>(null);
  // Refs sur les pistes des sliders verticaux (luminosité + volume)
  const brightnessTrackRef = useRef<HTMLDivElement>(null);
  const volumeTrackRef = useRef<HTMLDivElement>(null);
  // Panneau inline qui REMPLACE la rangée de contrôles (pattern TvPlayerOverlay).
  // null = contrôles classiques affichés ; sinon le panneau prend la place et
  // le lecteur est mis en pause automatiquement (cf. pausedByPanelRef).
  const [panelKind, setPanelKind] = useState<'audio' | 'subtitles' | 'quality' | 'episodes' | null>(null);
  // Zapper live : vue de la bande basse ('channels' = liste des chaînes, défaut ;
  // 'epg' = programme de la chaîne courante). Catégorie sélectionnée dans le
  // zapper (null = suit la catégorie en cours de lecture). Chaîne dont le
  // bottom-sheet de qualité est ouvert (null = fermé).
  const [liveBottomView, setLiveBottomView] = useState<'channels' | 'epg'>('channels');
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  // Bottom-sheet de choix de qualité, partagé par le zapper (tap sur une chaîne
  // du rail) ET par les boutons prev/next de l'overlay. Descripteur générique :
  // nom affiché, variantes à proposer, et callback de lecture de la variante.
  const [qSheet, setQSheet] = useState<{
    name: string;
    variants: { stream_id: number; name: string }[];
    onPick: (v: { stream_id: number; name: string }) => void;
  } | null>(null);
  const channelRailRef = useRef<HTMLDivElement>(null);
  const catTabsRef = useRef<HTMLDivElement>(null);
  // Vue active dans le panneau sous-titres : 'tracks' (pistes + bouton
  // Personnaliser) ou 'customize' (aperçu live + chips Taille/Couleur/Fond).
  const [subView, setSubView] = useState<'tracks' | 'customize'>('tracks');
  // Saison affichée dans le panneau Épisodes (init = saison courante).
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const epGridRef = useRef<HTMLDivElement>(null);
  // Navigation clavier interne au panel Épisodes (flèches + Enter). Distincte
  // du focus DOM brut pour pouvoir initialiser sur l'épisode courant à
  // l'ouverture et basculer saison↔épisode au clavier.
  const [epFocus, setEpFocus] = useState<{ section: 'season' | 'episode'; index: number } | null>(null);
  const epFocusRef = useRef(epFocus); epFocusRef.current = epFocus;
  const epSeasonChipsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const epCardsRef = useRef<Array<HTMLButtonElement | null>>([]);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Double-tap seek : dernière frappe mémorisée (timestamp + côté + état overlay).
  const lastTapRef = useRef<{ time: number; side: 'left' | 'right'; wasVisible: boolean } | null>(null);
  const tapFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Timer 320ms du single-tap (annulé si un second tap arrive = double-tap).
  const singleTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bloque le click natif qui suit un touchend (évite le double-trigger play/pause).
  const touchHappenedRef = useRef(false);
  const touchHappenedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Ouvre un panneau (audio / sous-titres / qualité / épisodes). Si le même
  // panneau est déjà ouvert dans sa vue de base, ferme. Sinon bascule + met
  // en pause auto (cf. pausedByPanelRef).
  const openPanel = useCallback((kind: 'audio' | 'subtitles' | 'quality' | 'episodes') => {
    if (panelKind === kind && (kind !== 'subtitles' || subView === 'tracks')) {
      closePanel();
      return;
    }
    // Audio + sous-titres : la lecture CONTINUE (changement de piste instantané
    // sur mpv/natif, style des sous-titres appliqué à chaud) → ne pas mettre en
    // pause, c'est plus gênant qu'utile. Seuls qualité/épisodes (changement de
    // source) gardent la pause auto.
    const pausesPlayback = kind === 'quality' || kind === 'episodes';
    if (pausesPlayback && panelKind === null && player.status === 'playing') {
      player.toggle();
      pausedByPanelRef.current = true;
    }
    setPanelKind(kind);
    if (kind === 'subtitles') setSubView('tracks');
    if (kind === 'episodes') {
      const init = currentSeason ?? null;
      setSelectedSeason(init);
      if (init != null) onLoadSeasonStills?.(init);
    }
  }, [panelKind, subView, player, closePanel, currentSeason, onLoadSeasonStills]);

  // Sélecteur de saison dans le panneau Épisodes : charge les stills + reset
  // le scroll-into-view (l'effet ci-dessous le déclenche au changement).
  const handleSelectSeason = useCallback((season: number) => {
    setSelectedSeason(season);
    onLoadSeasonStills?.(season);
  }, [onLoadSeasonStills]);

  // Scroll-into-view sur l'épisode courant à l'ouverture / changement de saison.
  // L'autre saison n'a pas d'épisode courant → fallback scrollLeft=0.
  useEffect(() => {
    if (panelKind !== 'episodes' || selectedSeason == null) return;
    const grid = epGridRef.current;
    if (!grid) return;
    const cur = grid.querySelector('[data-current="true"]') as HTMLElement | null;
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
    else grid.scrollLeft = 0;
  }, [panelKind, selectedSeason, episodesBySeason, stillsBySeason]);

  const subtitleText = player.subtitleText;

  // Sauvegarde automatique des préférences à chaque changement
  useEffect(() => {
    saveSubPrefs({ size: subSize, bg: subBg, color: subColor });
  }, [subSize, subBg, subColor]);

  const isLive = player.isLive || isLiveType;
  const isLoading = player.status === 'loading' || player.status === 'buffering';
  const hasError = player.status === 'error';
  const isPlaying = player.status === 'playing';

  // Bascule one-shot pour le backdrop de chargement de la surface native (mpv).
  // Une fois que mpv a rendu sa première frame (isPlaying → true), le backdrop
  // disparaît définitivement jusqu'au prochain changement de source — il ne
  // revient PAS à la pause, au seek ou au changement de piste audio.
  const [backdropDone, setBackdropDone] = useState(false);
  useEffect(() => { setBackdropDone(false); }, [url]);
  useEffect(() => { if (isPlaying) setBackdropDone(true); }, [isPlaying]);

  // ── Zapper live : bande basse à deux vues (chaînes / programme) ───────────
  // Le zapper s'affiche dès qu'on a un catalogue navigable + un sélecteur. Le
  // toggle n'apparaît que si les DEUX vues ont du contenu ; sinon on montre
  // directement la seule disponible (strictement additif).
  const hasZapper = !!(isLive && onPlayChannel && liveCatalog && liveCatalog.length > 0);
  const hasLiveEpg = !!(isLive && liveEpg && liveEpg.length > 0);
  const liveStripView: 'channels' | 'epg' = hasZapper
    ? (hasLiveEpg ? liveBottomView : 'channels')
    : 'epg';
  // Catégorie active du zapper : choix explicite de l'utilisateur, sinon suit la
  // catégorie en cours de lecture, sinon la première du catalogue.
  const activeCatId = selectedCatId ?? liveCurrentCategoryId ?? liveCatalog?.[0]?.id;
  const activeCat = liveCatalog?.find((c) => c.id === activeCatId);
  const railChannels = useMemo(() => activeCat?.channels ?? [], [activeCat]);

  // Tap sur une chaîne du zapper : sélecteur de qualité si ≥ 2 variantes,
  // sinon lecture directe de la meilleure qualité (primary).
  const handleChannelTap = useCallback(
    (index: number) => {
      if (!activeCatId || !onPlayChannel) return;
      const ch = railChannels[index];
      if (!ch) return;
      if (ch.variants && ch.variants.length > 1) {
        setQSheet({
          name: ch.name,
          variants: ch.variants,
          onPick: (v) => onPlayChannel(activeCatId, index, v),
        });
      } else onPlayChannel(activeCatId, index);
    },
    [activeCatId, railChannels, onPlayChannel],
  );

  // Zapping prev/next via les boutons de l'overlay : si la chaîne adjacente a
  // ≥ 2 variantes → même bottom-sheet de qualité que le zapper, sinon lecture
  // directe. Boutons grisés en bord de liste (prevChannel/nextChannel absents).
  const handleZap = useCallback(
    (direction: 1 | -1) => {
      const target = direction === 1 ? nextChannel : prevChannel;
      if (!target || !onZapChannel) return;
      if (target.variants && target.variants.length > 1) {
        setQSheet({
          name: target.name,
          variants: target.variants,
          onPick: (v) => onZapChannel(direction, v),
        });
      } else onZapChannel(direction);
    },
    [prevChannel, nextChannel, onZapChannel],
  );

  // Centre la chaîne courante (ou le début) dans le rail à l'ouverture / au
  // changement de catégorie ou de chaîne.
  useEffect(() => {
    if (!hasZapper || liveStripView !== 'channels' || !controlsVisible) return;
    const rail = channelRailRef.current;
    if (!rail) return;
    const cur = rail.querySelector('[data-current="true"]') as HTMLElement | null;
    if (cur) cur.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
    else rail.scrollLeft = 0;
  }, [hasZapper, liveStripView, activeCatId, liveCurrentStreamId, controlsVisible]);

  // Centre la catégorie active dans la rangée d'onglets à l'ouverture.
  useEffect(() => {
    if (!hasZapper || liveStripView !== 'channels' || !controlsVisible) return;
    const cur = catTabsRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
    cur?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
  }, [hasZapper, liveStripView, activeCatId, controlsVisible]);

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

  // Force l'affichage des contrôles sur une VRAIE pause (pas pendant un
  // chargement/buffering : on n'y montre que l'overlay « Chargement », jamais le
  // bouton lecture central qui laisserait croire à une pause manuelle).
  useEffect(() => {
    if (player.status === 'paused') setControlsVisible(true);
  }, [player.status]);

  // Double-tap seek (mobile/touch) — gère touchend sur la surface vidéo.
  //
  // Pattern :
  //   1er tap → on ATTEND 320ms avant d'agir (cas single-tap).
  //   2e tap < 320ms, même côté → double-tap : annule l'attente, seek ±10s.
  //     · Si l'overlay était caché avant le 1er tap : seek silencieux (pas d'overlay).
  //     · Si l'overlay était visible : seek + reset du timer (overlay reste).
  //
  // Le `onTouchStart` du wrapper est supprimé pour éviter de montrer l'overlay
  // dès le 1er tap d'un double-tap ; le reset du timer est délégué au div
  // `.controls` et `.mobileCenterControls` qui ont `onTouchStart={resetHideTimer}`.
  const handleSurfaceTouchEnd = useCallback((e: React.TouchEvent) => {
    touchHappenedRef.current = true;
    if (touchHappenedTimerRef.current) clearTimeout(touchHappenedTimerRef.current);
    touchHappenedTimerRef.current = setTimeout(() => { touchHappenedRef.current = false; }, 600);

    if (panelKind !== null) { closePanel(); return; }

    const touch = e.changedTouches[0];
    if (!touch) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const side: 'left' | 'right' = touch.clientX - rect.left < rect.width / 2 ? 'left' : 'right';
    const now = Date.now();
    const last = lastTapRef.current;
    // Capture l'état AVANT tout setState en attente (le rendu n'a pas eu lieu).
    const wasVisible = controlsVisibleRef.current;

    if (last && now - last.time < 320 && last.side === side) {
      // ── Double-tap détecté ───────────────────────────────────────────────
      // Annule l'action pending du 1er tap (toggle overlay).
      if (singleTapTimerRef.current) {
        clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = null;

      if (!isLive) {
        const delta = side === 'left' ? -10 : 10;
        player.seek(Math.max(0, player.currentTime + delta));
        setTapFlash(side);
        if (tapFlashTimerRef.current) clearTimeout(tapFlashTimerRef.current);
        tapFlashTimerRef.current = setTimeout(() => setTapFlash(null), 700);
      }

      // Si l'overlay était déjà visible → le garder visible (reset timer).
      // Si l'overlay était caché → seek silencieux, pas d'overlay.
      if (last.wasVisible) {
        resetHideTimer();
      }
      // else : on ne touche pas à controlsVisible → l'overlay reste caché.

    } else {
      // ── 1er tap (potential double-tap) ──────────────────────────────────
      // Enregistre l'état courant et attend 320ms.
      lastTapRef.current = { time: now, side, wasVisible };
      if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
      singleTapTimerRef.current = setTimeout(() => {
        singleTapTimerRef.current = null;
        // Confirmation : c'était bien un single-tap → bascule l'overlay.
        if (controlsVisibleRef.current) {
          setControlsVisible(false);
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
        } else {
          resetHideTimer();
        }
      }, 320);
    }
  }, [panelKind, closePanel, isLive, player, resetHideTimer]);

  // Tap sur une zone VIDE de l'overlay (fond du dégradé, bande basse, EPG…) →
  // masque l'overlay, comme un tap sur la surface vidéo. Indispensable quand la
  // bande basse (zapper + catégories) est haute : elle recouvre la zone que
  // l'utilisateur touche pour fermer, et seul `resetHideTimer` se déclenchait.
  // Les contrôles interactifs (boutons / inputs / sheet) stoppent déjà la
  // propagation ou sont filtrés par `closest(...)` → seuls les fonds remontent.
  const handleOverlayBackgroundClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const el = e.target as HTMLElement;
    if (el.closest('button, input, [role="dialog"]')) return;
    if (controlsVisibleRef.current) {
      setControlsVisible(false);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    }
  }, []);

  // Marque qu'un toucher vient d'avoir lieu (n'importe où dans le lecteur —
  // les events touch bubblent jusqu'au wrapper). Sert à NEUTRALISER les events
  // souris synthétiques (mouseleave/mousemove) que les WebView mobiles émettent
  // après un tap : sans ça, `onMouseLeave` masquait l'overlay aussitôt affiché.
  const markTouch = useCallback(() => {
    touchHappenedRef.current = true;
    if (touchHappenedTimerRef.current) clearTimeout(touchHappenedTimerRef.current);
    touchHappenedTimerRef.current = setTimeout(() => { touchHappenedRef.current = false; }, 700);
  }, []);

  // Nettoyage des timers double-tap / single-tap à l'unmount.
  useEffect(() => () => {
    if (tapFlashTimerRef.current) clearTimeout(tapFlashTimerRef.current);
    if (touchHappenedTimerRef.current) clearTimeout(touchHappenedTimerRef.current);
    if (singleTapTimerRef.current) clearTimeout(singleTapTimerRef.current);
  }, []);

  // Wake lock écran (web + Electron uniquement — sur Capacitor c'est le plugin
  // libVLC qui pose FLAG_KEEP_SCREEN_ON). Empêche la mise en veille en lecture.
  useEffect(() => {
    if (isNative) return;
    if (!isPlaying) return;
    let lock: { release: () => Promise<void> } | null = null;
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    if (!wl) return;
    wl.request('screen').then((l) => { lock = l; }).catch(() => {});
    return () => { lock?.release().catch(() => {}); };
  }, [isPlaying]);

  // Helpers sliders verticaux (luminosité / volume) : calcule la valeur 0-1
  // à partir de la position Y du pointeur sur la piste du slider.
  // Défini en dehors de useCallback car il n'utilise que son argument.
  function getSliderPct(e: React.PointerEvent, trackRef: React.RefObject<HTMLDivElement>): number | null {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return null;
    return Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height));
  }

  const handleBrightnessPointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    if (e.type === 'pointermove' && e.buttons === 0) return;
    e.stopPropagation();
    const v = getSliderPct(e, brightnessTrackRef);
    if (v !== null) setBrightness(Math.max(0.08, v));
  }, []);

  const handleVolumePointer = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.type === 'pointerdown') e.currentTarget.setPointerCapture(e.pointerId);
    if (e.type === 'pointermove' && e.buttons === 0) return;
    e.stopPropagation();
    const v = getSliderPct(e, volumeTrackRef);
    if (v === null) return;
    if (isCapacitor) {
      // Sur Android : pilote le volume média système (STREAM_MUSIC).
      setSysVolume(v);
      volumeControl.setMediaVolume(v).catch(() => {});
    } else {
      player.setVolume(v);
    }
  }, [player]);

  // Sync volume système Android (Capacitor uniquement).
  // Lit le volume initial + s'abonne aux changements via boutons physiques.
  // Sur web/Electron/TV : no-op (volumeControl rend des valeurs neutres).
  useEffect(() => {
    volumeControl.getMediaVolume().then(setSysVolume).catch(() => {});
    const unsub = volumeControl.onVolumeChange(setSysVolume);
    return unsub;
  }, []);

  // Raccourcis clavier (overlay souris/tactile uniquement — sur TV c'est
  // `TvPlayerOverlay` qui gère toutes les touches de la télécommande).
  useEffect(() => {
    if (tvMode) return;
    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      // Escape ferme le panneau inline en priorité (reprend la lecture si on
      // l'avait pausée). Le plein écran et le retour catalogue sont gérés par le
      // handler global de Player.tsx (source unique pour la navigation).
      if (e.key === 'Escape' && panelKind !== null) {
        e.preventDefault();
        closePanel();
        return;
      }
      // Quand un panneau est ouvert, les raccourcis du player (seek/volume/
      // play-pause/etc) sont gelés pour ne pas piloter la vidéo. Le panel
      // « Épisodes » dispose en plus de sa propre navigation D-pad/clavier
      // (focus DOM réel sur les `<button>` saison/épisode).
      if (panelKind !== null) {
        if (panelKind === 'episodes') {
          const isLeft = e.key === 'ArrowLeft';
          const isRight = e.key === 'ArrowRight';
          const isUp = e.key === 'ArrowUp';
          const isDown = e.key === 'ArrowDown';
          const isEnter = e.key === 'Enter';
          if (!(isLeft || isRight || isUp || isDown || isEnter)) return;
          e.preventDefault();
          const seasons = epSeasonsRef.current;
          const eps = epEpisodesRef.current;
          if (isLeft || isRight) {
            setEpFocus((cur) => {
              if (!cur) return cur;
              const max = cur.section === 'season' ? seasons.length - 1 : eps.length - 1;
              if (max < 0) return cur;
              const next = Math.max(0, Math.min(max, cur.index + (isRight ? 1 : -1)));
              return { ...cur, index: next };
            });
          } else if (isUp) {
            // Saisons au-dessus → y aller si dispo, sinon ferme le panel.
            const cur = epFocusRef.current;
            if (cur?.section === 'episode' && seasons.length > 1) {
              const idx = seasons.indexOf(epDisplaySeasonRef.current ?? -1);
              setEpFocus({ section: 'season', index: idx >= 0 ? idx : 0 });
            } else {
              closePanel();
            }
          } else if (isDown) {
            // Depuis saisons : descendre aux épisodes (focus = épisode courant).
            // Depuis épisodes : ferme.
            const cur = epFocusRef.current;
            if (cur?.section === 'season') {
              const idx = eps.findIndex(
                (ep) => ep.season === currentSeasonRef.current && ep.episode_num === currentEpisodeNumRef.current,
              );
              setEpFocus({ section: 'episode', index: idx >= 0 ? idx : 0 });
            } else {
              closePanel();
            }
          } else if (isEnter) {
            const cur = epFocusRef.current;
            if (!cur) return;
            if (cur.section === 'season') {
              const s = seasons[cur.index];
              if (s != null) handleSelectSeasonRef.current(s);
            } else {
              const ep = eps[cur.index];
              if (ep) { onPlayEpisodeRef.current?.(ep); closePanel(); }
            }
          }
          return;
        }
        // Autres panels (audio/CC/qualité) : flèches / play / fullscreen / mute
        // sont absorbées en silence. Tab + Click natifs continuent de fonctionner.
        const trap = [
          'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
          ' ', 'k', 'K', 'f', 'F', 'm', 'M', 'g', 'G', 'h', 'H',
        ];
        if (trap.includes(e.key)) { e.preventDefault(); return; }
        // Enter : sur un BUTTON, on laisse le clic natif jouer ; sinon ignore.
        if (e.key === 'Enter') {
          if ((e.target as HTMLElement).tagName !== 'BUTTON') e.preventDefault();
          return;
        }
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

  // Volume affiché dans le slider : volume système (Capacitor) ou player.volume
  const displayVolume = isCapacitor && sysVolume !== null
    ? sysVolume
    : (player.isMuted ? 0 : player.volume);

  const VolumeIcon = displayVolume === 0 ? IconVolumeMute
    : displayVolume < 0.5 ? IconVolumeLow
    : IconVolumeHigh;

  // `showControls` = la chrome (top bar / dégradé / sous-titres remontés) est
  // affichée. On NE force PLUS l'affichage pendant un chargement (sinon le
  // bouton lecture central apparaît et laisse croire à une pause).
  const showControls = controlsVisible || player.status === 'paused' || hasError;
  // `controlsActive` = les contrôles INTERACTIFS (lecture/pause, ±10s, barre du
  // bas, zapper…) sont rendus. Masqués pendant un chargement : seul l'overlay
  // « Chargement » s'affiche → plus de confusion lecture/pause.
  const controlsActive = showControls && !isLoading;

  // Sous-titres rendus par une surface NATIVE (mpv/Electron) : les remonter
  // au-dessus de l'overlay des contrôles quand il apparaît, en tandem (le CSS
  // `.wrapper.showControls .subtitleOverlay` ne pilote que le rendu web React).
  // No-op pour les autres lecteurs (`setSubtitleRaised` absent).
  const raiseSubtitle = player.setSubtitleRaised;
  useEffect(() => {
    raiseSubtitle?.(showControls);
  }, [showControls, raiseSubtitle]);

  // Saisons disponibles + épisodes de la saison sélectionnée (panneau Épisodes).
  // `episodesBySeason` est un Record<string, Episode[]> (clés numériques str).
  const epSeasons: number[] = episodesBySeason
    ? Object.keys(episodesBySeason).map(Number).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b)
    : [];
  const epDisplaySeason = selectedSeason ?? currentSeason ?? epSeasons[0];
  const epEpisodes: Episode[] = (epSeasons.length > 0 && episodesBySeason && epDisplaySeason != null)
    ? (episodesBySeason[String(epDisplaySeason)] ?? [])
    : [];
  // Le bouton est visible dès que Player.tsx nous donne `onPlayEpisode` (i.e.
  // dès qu'on est sur un épisode avec `seriesContext` posé), même si la liste
  // n'est pas encore arrivée — sinon il pop tardivement et l'utilisateur ne le
  // voit jamais s'il ouvre l'overlay avant la fin du fetch.
  const epHasButton = !!onPlayEpisode && !isLive;
  const epLoading = epHasButton && epSeasons.length === 0;
  // Y a-t-il au moins un contrôle secondaire visible dans la barre du bas
  // (audio / sous-titres / qualité / épisodes / plein écran) ? Pilote le fond
  // « verre dépoli » flottant sur mobile : pas de pastille vide quand un flux
  // n'expose aucune piste (le primaryGroup est déjà remonté au centre sur mobile).
  const hasBottomControls =
    player.audioTracks.length > 0 ||
    player.subtitleTracks.length > 0 ||
    player.levels.length > 1 ||
    epHasButton ||
    !isNative;
  // Refs synchrones : permettent au keyboard handler global de lire la liste
  // courante sans se réinstaller à chaque render.
  const epSeasonsRef = useRef(epSeasons); epSeasonsRef.current = epSeasons;
  const epEpisodesRef = useRef(epEpisodes); epEpisodesRef.current = epEpisodes;
  const epDisplaySeasonRef = useRef(epDisplaySeason); epDisplaySeasonRef.current = epDisplaySeason;
  const currentSeasonRef = useRef(currentSeason); currentSeasonRef.current = currentSeason;
  const currentEpisodeNumRef = useRef(currentEpisodeNum); currentEpisodeNumRef.current = currentEpisodeNum;
  const onPlayEpisodeRef = useRef(onPlayEpisode); onPlayEpisodeRef.current = onPlayEpisode;
  const handleSelectSeasonRef = useRef(handleSelectSeason); handleSelectSeasonRef.current = handleSelectSeason;

  // Init epFocus sur l'épisode courant à l'ouverture du panel ; reset au close.
  useEffect(() => {
    if (panelKind !== 'episodes') {
      setEpFocus(null);
      return;
    }
    const list = epEpisodesRef.current;
    const idx = list.findIndex(
      (ep) => ep.season === currentSeasonRef.current && ep.episode_num === currentEpisodeNumRef.current,
    );
    setEpFocus({ section: 'episode', index: idx >= 0 ? idx : 0 });
  }, [panelKind, epDisplaySeason]);

  // Sync focus DOM réel + scroll-into-view à chaque déplacement.
  useEffect(() => {
    if (!epFocus || panelKind !== 'episodes') return;
    const arr = epFocus.section === 'season' ? epSeasonChipsRef.current : epCardsRef.current;
    const el = arr[epFocus.index];
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' });
  }, [epFocus, panelKind]);

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
      onTouchStart={markTouch}
      onMouseMove={() => { if (!touchHappenedRef.current) resetHideTimer(); }}
      onMouseLeave={() => { if (!touchHappenedRef.current && isPlaying) setControlsVisible(false); }}
      onClick={closeAllMenus}
    >
      {(() => {
        // Sur desktop (souris) : clic sur la vidéo = play/pause ou ferme le panel.
        // Sur mobile (touch) : touchend est intercepté par handleSurfaceTouchEnd
        // qui pose touchHappenedRef = true → le click natif post-touch est ignoré.
        const onSurfaceClick = () => {
          if (touchHappenedRef.current) return;
          if (panelKind !== null) closePanel();
          else player.toggle();
        };
        if (isTizen) {
          return (
            <object
              type="application/avplayer"
              className={`${styles.video} native-video-surface`}
              onClick={onSurfaceClick}
              onTouchEnd={handleSurfaceTouchEnd}
            />
          );
        }
        if (useNativeSurface) {
          // Backdrop TMDB paysage pendant le chargement — évite que le fond
          // transparent de la fenêtre Electron laisse voir le bureau.
          // Pour la TV live : icône canal carrée → on préfère du noir uni.
          // Pour VOD/série : `poster` = tmdb.backdrop HD 16:9 (MovieDetail /
          // buildEpisodeEntry posent déjà l'image paysage TMDB dans l'état).
          const backdropSrc = !isLiveType ? safeImgUrl(poster) : undefined;
          return (
            <>
              <div
                className={`${styles.video} native-video-surface`}
                onClick={onSurfaceClick}
                onTouchEnd={handleSurfaceTouchEnd}
              />
              <div
                className={`${styles.nativeBackdrop}${backdropDone ? ` ${styles.nativeBackdropDone}` : ''}`}
                style={backdropSrc ? { backgroundImage: `url(${backdropSrc})` } : undefined}
              />
            </>
          );
        }
        return (
          <video
            ref={player.videoRef}
            className={styles.video}
            playsInline
            poster={safeImgUrl(poster)}
            onClick={onSurfaceClick}
            onTouchEnd={handleSurfaceTouchEnd}
          />
        );
      })()}

      {/* Overlay luminosité simulée (filtre sombre sur la vidéo) — toujours
          présent pour éviter un mount/unmount ; opacity pilotée par `brightness`.
          z-index 1 : au-dessus de la surface vidéo, sous les sous-titres. */}
      <div
        className={styles.brightnessOverlay}
        style={{ opacity: brightness < 1 ? 1 - brightness : 0 }}
      />

      {/* Sous-titres personnalisés — inline styles identiques à la preview
          pour garantir que le rendu réel = l'aperçu Personnaliser à 100%.
          On évite les classes CSS (qui seraient écrasées par media queries). */}
      {subtitleText && (
        <div className={styles.subtitleOverlay}>
          {subtitleText.split('\n').map((line, i) => (
            <span
              key={i}
              className={styles.subtitleLine}
              style={{
                fontSize: PREVIEW_PX[subSize],
                color: SUB_COLOR_HEX[subColor],
                background: SUB_BG_CSS[subBg],
                textShadow: subBg === 'none' ? SUB_OUTLINE : SUB_SOFT_SHADOW,
                padding: subBg === 'none' ? '0 6px' : '4px 14px',
                fontWeight: 700,
                letterSpacing: '-0.005em',
                lineHeight: 1.3,
              }}
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

      {/* Chargement — carte « verre dépoli » centrée. Aucun bouton lecture n'est
          rendu pendant ce temps (cf. controlsActive) → plus de confusion avec
          une pause manuelle. */}
      {isLoading && (
        <div className={styles.centerOverlay}>
          <div className={styles.loadingCard}>
            <AppLogo spin size={46} />
            <span className={styles.overlayLabel}>
              {player.status === 'buffering' ? t('player.buffering') : t('player.loading')}
            </span>
          </div>
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
          quand le panneau inline a la main ou sur mobile (centre controls gère). */}
      {!tvMode && player.status === 'paused' && panelKind === null && (
        <div className={styles.pauseHint} onClick={player.toggle}>
          <div className={styles.bigPlayBtn}><IconPlay size={28} /></div>
        </div>
      )}

      {/* ── Mobile / paysage : contrôles centrés + sliders latéraux ─────────
          Visibles uniquement quand showControls (overlay visible).
          CSS : display:none sur desktop, display:flex sur ≤640px ou landscape.
          ─────────────────────────────────────────────────────────────────── */}
      {!tvMode && controlsActive && panelKind === null && (
        <div className={`${styles.mobileCenterControls} ${isLive ? styles.mobileCenterControlsLive : ''}`} onClick={(e) => e.stopPropagation()} onTouchStart={resetHideTimer}>

          {/* Slider luminosité — gauche */}
          <div
            className={styles.mobileSideBar}
            onPointerDown={handleBrightnessPointer}
            onPointerMove={handleBrightnessPointer}
          >
            <span className={styles.mobileSideBarIcon}><IconSun size={18} /></span>
            <div ref={brightnessTrackRef} className={styles.mobileSideBarTrack}>
              <div className={styles.mobileSideBarFill} style={{ height: `${brightness * 100}%` }} />
            </div>
          </div>

          {/* Colonne centrale : pistes audio/CC (live) au-dessus du pause +
              groupe lecture (±10s en VOD, chaîne prec/suiv en live). */}
          <div className={styles.mobileCenterStack}>
            {/* Live : pistes audio + sous-titres remontées au-dessus du pause
                (cachées dans le bottom bar quand l'overlay est chargé). */}
            {isLive && (player.audioTracks.length > 0 || player.subtitleTracks.length > 0) && (
              <div className={styles.mobileCenterTrackRow}>
                {player.audioTracks.length > 0 && (
                  <button
                    className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.mobileCenterChip}`}
                    onClick={(e) => { e.stopPropagation(); openPanel('audio'); }}
                    title={t('player.audioTrack')}
                  >
                    <IconAudio size={18} />
                    <span className={styles.controlBtnLabel}>
                      {player.audioTracks[player.currentAudio]?.language?.toUpperCase() || 'AUDIO'}
                    </span>
                  </button>
                )}
                {player.subtitleTracks.length > 0 && (
                  <button
                    className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.mobileCenterChip} ${player.currentSubtitle >= 0 ? styles.controlBtnOn : ''}`}
                    onClick={(e) => { e.stopPropagation(); openPanel('subtitles'); }}
                    title={t('player.subtitles')}
                  >
                    <IconSubtitles size={18} />
                    <span className={styles.controlBtnLabel}>
                      {player.currentSubtitle >= 0
                        ? (player.subtitleTracks[player.currentSubtitle]?.language?.toUpperCase() || 'CC')
                        : 'CC'}
                    </span>
                  </button>
                )}
              </div>
            )}

            {/* Groupe lecture central */}
            <div className={styles.mobileCenterPlayGroup}>
              {isLive ? (
                <button
                  className={`${styles.controlBtn} ${styles.mobileSeekBtn}`}
                  onClick={() => handleZap(-1)}
                  disabled={!prevChannel}
                  title={t('player.prevChannel')}
                >
                  <IconPrev size={28} />
                </button>
              ) : (
                <button
                  className={`${styles.controlBtn} ${styles.mobileSeekBtn}`}
                  onClick={() => player.seek(player.currentTime - 10)}
                  title={t('player.back10')}
                >
                  <IconBack10 size={30} />
                </button>
              )}
              <button
                className={`${styles.controlBtn} ${styles.mobileCenterPlayBtn}`}
                onClick={player.toggle}
                title={t('player.playPause')}
              >
                {isPlaying ? <IconPause size={30} /> : <IconPlay size={30} />}
              </button>
              {isLive ? (
                <button
                  className={`${styles.controlBtn} ${styles.mobileSeekBtn}`}
                  onClick={() => handleZap(1)}
                  disabled={!nextChannel}
                  title={t('player.nextChannel')}
                >
                  <IconNext size={28} />
                </button>
              ) : (
                <button
                  className={`${styles.controlBtn} ${styles.mobileSeekBtn}`}
                  onClick={() => player.seek(player.currentTime + 10)}
                  title={t('player.fwd10')}
                >
                  <IconFwd10 size={30} />
                </button>
              )}
            </div>
          </div>

          {/* Slider volume — droite */}
          <div
            className={styles.mobileSideBar}
            onPointerDown={handleVolumePointer}
            onPointerMove={handleVolumePointer}
          >
            <span className={styles.mobileSideBarIcon}><VolumeIcon size={18} /></span>
            <div ref={volumeTrackRef} className={styles.mobileSideBarTrack}>
              <div className={styles.mobileSideBarFill} style={{ height: `${displayVolume * 100}%` }} />
            </div>
          </div>
        </div>
      )}

      {/* Bouton × retour — mobile uniquement, visible quand overlay affiché */}
      {!tvMode && onBack && showControls && (
        <button
          className={styles.mobileBackBtn}
          onClick={onBack}
          aria-label={t('common.back')}
        >
          <IconClose size={18} />
        </button>
      )}

      {/* Flash double-tap seek (mobile/touch, VOD uniquement) */}
      {!tvMode && tapFlash !== null && !isLive && (
        <div className={`${styles.tapFlashZone} ${tapFlash === 'left' ? styles.tapFlashLeft : styles.tapFlashRight}`}>
          <div className={styles.tapFlashCircle}>
            {tapFlash === 'left' ? <IconBack10 size={28} /> : <IconFwd10 size={28} />}
            <span className={styles.tapFlashLabel}>{tapFlash === 'left' ? '−10s' : '+10s'}</span>
          </div>
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
          episodesBySeason={episodesBySeason}
          currentSeason={currentSeason}
          currentEpisodeNum={currentEpisodeNum}
          stillsBySeason={stillsBySeason}
          onLoadSeasonStills={onLoadSeasonStills}
          onPlayEpisode={onPlayEpisode}
        />
      )}

      {/* Overlay contrôles souris/tactile — masqué sur TV. */}
      {!tvMode && (
      <div className={styles.controls} onClick={handleOverlayBackgroundClick} onTouchStart={resetHideTimer}>

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
              en pause auto, et reprend la lecture à sa fermeture. Masquée pendant
              un chargement (seul l'overlay « Chargement » s'affiche). */}
          {!isLoading && (panelKind === null ? (
            <div className={`${styles.bottomBar} ${hasBottomControls ? styles.bottomBarFilled : ''}`}>
              {isLive && onZapChannel && (
                <button
                  className={`${styles.controlBtn} ${styles.primaryGroup}`}
                  onClick={() => handleZap(-1)}
                  disabled={!prevChannel}
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

              {isLive && onZapChannel && (
                <button
                  className={`${styles.controlBtn} ${styles.primaryGroup}`}
                  onClick={() => handleZap(1)}
                  disabled={!nextChannel}
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

              {/* Audio — ouvre le panneau inline. En live, masqué sur mobile
                  (remonté au-dessus du pause dans les contrôles centraux). */}
              {player.audioTracks.length > 0 && (
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.secondaryGroup} ${isLive ? styles.liveCenterOnly : ''}`}
                  onClick={(e) => { e.stopPropagation(); openPanel('audio'); }}
                  title={t('player.audioTrack')}
                >
                  <IconAudio size={18} />
                  <span className={styles.controlBtnLabel}>
                    {player.audioTracks[player.currentAudio]?.language?.toUpperCase() || 'AUDIO'}
                  </span>
                </button>
              )}

              {/* Sous-titres — ouvre le panneau inline. En live, masqué sur mobile
                  (remonté au-dessus du pause dans les contrôles centraux). */}
              {player.subtitleTracks.length > 0 && (
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.secondaryGroup} ${isLive ? styles.liveCenterOnly : ''} ${player.currentSubtitle >= 0 ? styles.controlBtnOn : ''}`}
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

              {/* Épisodes (séries uniquement — props posées par Player.tsx
                  quand state.seriesContext existe). */}
              {epHasButton && (
                <button
                  className={`${styles.controlBtn} ${styles.controlBtnLabeled} ${styles.secondaryGroup}`}
                  onClick={(e) => { e.stopPropagation(); openPanel('episodes'); }}
                  title={t('player.episodes')}
                >
                  <IconEpisodes size={18} />
                  <span className={styles.controlBtnLabel}>
                    {currentSeason != null && currentEpisodeNum != null
                      ? `S${currentSeason}·É${currentEpisodeNum}`
                      : 'EP'}
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

              {/* Épisodes : sélecteur de saison (si >1) + grille horizontale
                  d'épisodes (vignettes 16:9 Premium, num+titre+durée).
                  L'épisode courant a [data-current=true] → auto-scroll center.
                  Refs `epSeasonChipsRef`/`epCardsRef` : focus DOM réel piloté
                  par le handler clavier (cf. effets epFocus ci-dessus). */}
              {panelKind === 'episodes' && epLoading && (
                <div className={styles.epPanelLoading}>
                  <AppLogo spin size={28} />
                  <span>{t('player.episodesLoading')}</span>
                </div>
              )}
              {panelKind === 'episodes' && !epLoading && (
                <div className={styles.epPanel}>
                  {epSeasons.length > 1 && (
                    <div className={styles.epSeasonBar}>
                      {epSeasons.map((s, i) => (
                        <button
                          key={s}
                          ref={(el) => { epSeasonChipsRef.current[i] = el; }}
                          className={`${styles.epSeasonChip} ${epDisplaySeason === s ? styles.epSeasonChipActive : ''}`}
                          onClick={() => handleSelectSeason(s)}
                        >
                          {t('detail.seasonN', { n: s })}
                        </button>
                      ))}
                    </div>
                  )}
                  <div ref={epGridRef} className={styles.epGrid}>
                    {epEpisodes.map((ep, i) => {
                      const isCurrent =
                        currentSeason === ep.season && currentEpisodeNum === ep.episode_num;
                      const thumb =
                        safeImgUrl(ep.info.movie_image) ||
                        safeImgUrl(stillsBySeason?.[ep.season]?.[ep.episode_num]);
                      return (
                        <button
                          key={ep.id}
                          ref={(el) => { epCardsRef.current[i] = el; }}
                          data-current={isCurrent ? 'true' : undefined}
                          className={`${styles.epCard} ${isCurrent ? styles.epCardActive : ''}`}
                          onClick={() => { onPlayEpisode?.(ep); closePanel(); }}
                          title={ep.title || t('detail.episodeN', { n: ep.episode_num })}
                        >
                          <div className={styles.epThumb}>
                            {thumb ? (
                              <img
                                src={thumb}
                                alt=""
                                loading="lazy"
                                decoding="async"
                                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                              />
                            ) : (
                              <span className={styles.epThumbNum}>{ep.episode_num}</span>
                            )}
                            {isCurrent && (
                              <span className={styles.epCurrentBadge}>{t('player.nowPlaying')}</span>
                            )}
                          </div>
                          <div className={styles.epLabel}>
                            <span className={styles.epNum}>
                              {t('detail.episodeN', { n: ep.episode_num })}
                            </span>
                            <span className={styles.epTitle}>
                              {ep.title || t('detail.episodeN', { n: ep.episode_num })}
                            </span>
                            {ep.info.duration && (
                              <span className={styles.epDuration}>{ep.info.duration}</span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Bande basse live — zapper (chaînes) OU programme (EPG) de la chaîne
              courante. Toggle visible uniquement si les deux vues ont du contenu.
              Strictement additif : sans liste navigable ni EPG → rien. */}
          {isLive && !isLoading && panelKind === null && (hasZapper || hasLiveEpg) && (
            <div className={styles.liveStrip}>
              {hasZapper && hasLiveEpg && (
                <div className={styles.liveStripTabs}>
                  <button
                    className={`${styles.liveTab} ${liveStripView === 'channels' ? styles.liveTabOn : ''}`}
                    onClick={(e) => { e.stopPropagation(); setLiveBottomView('channels'); }}
                  >
                    {t('player.channelsTab')}
                  </button>
                  <button
                    className={`${styles.liveTab} ${liveStripView === 'epg' ? styles.liveTabOn : ''}`}
                    onClick={(e) => { e.stopPropagation(); setLiveBottomView('epg'); }}
                  >
                    {t('player.programTab')}
                  </button>
                </div>
              )}

              {/* Zapper — rangée de catégories cliquables + rail de chaînes. */}
              {liveStripView === 'channels' && hasZapper && (
                <>
                  {liveCatalog!.length > 1 && (
                    <div className={styles.catTabs} ref={catTabsRef}>
                      {liveCatalog!.map((c) => {
                        const active = c.id === activeCatId;
                        return (
                          <button
                            key={c.id}
                            data-active={active || undefined}
                            className={`${styles.catTab} ${active ? styles.catTabOn : ''}`}
                            onClick={(e) => { e.stopPropagation(); setSelectedCatId(c.id); }}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className={styles.channelRail} ref={channelRailRef}>
                    {railChannels.map((ch, i) => {
                      const logo = safeImgUrl(ch.stream_icon);
                      const current = ch.stream_id === liveCurrentStreamId;
                      return (
                        <button
                          key={`${ch.stream_id}-${i}`}
                          data-current={current || undefined}
                          className={`${styles.channelCell} ${current ? styles.channelCellNow : ''}`}
                          onClick={(e) => { e.stopPropagation(); handleChannelTap(i); }}
                          title={ch.name}
                        >
                          <span className={styles.channelLogo}>
                            {logo
                              ? <img src={logo} alt="" loading="lazy" />
                              : <span className={styles.channelCode}>{channelCode(ch.name)}</span>}
                          </span>
                          <span className={styles.channelName}>{ch.name}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Programme EPG de la chaîne courante, par créneau horaire. */}
              {liveStripView === 'epg' && hasLiveEpg && (
                <div className={styles.epgStrip}>
                  {liveEpg!.map((p) => (
                    <div
                      key={p.key}
                      className={`${styles.epgCell} ${p.playing ? styles.epgCellNow : ''}`}
                    >
                      <span className={styles.epgCellTime}>
                        {p.playing && <span className={styles.epgCellDot} />}
                        {p.time}
                      </span>
                      <span className={styles.epgCellTitle}>{p.title}</span>
                      {p.playing && (
                        <div className={styles.epgCellBar}>
                          <div className={styles.epgCellBarFill} style={{ width: `${p.progress}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Bottom-sheet « choix de qualité » (≥ 2 variantes) — partagé par le zapper
          (tap sur le rail) ET les boutons prev/next de l'overlay. Rendu au niveau
          racine (hors `.controls`) pour survivre à l'auto-masquage des contrôles.
          Picker → qSheet.onPick(variant) → navigation. */}
      {!tvMode && qSheet && (
        <div
          className={styles.qSheetBackdrop}
          onClick={(e) => { e.stopPropagation(); setQSheet(null); }}
          role="presentation"
        >
          <div
            className={styles.qSheet}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <div className={styles.qSheetHead}>
              <span className={styles.qSheetTitle}>{qSheet.name}</span>
              <span className={styles.qSheetSub}>{t('player.chooseChannelQuality')}</span>
            </div>
            <div className={styles.qSheetList}>
              {qSheet.variants.map((v, i) => (
                <button
                  key={v.stream_id}
                  className={styles.qSheetRow}
                  onClick={(e) => {
                    e.stopPropagation();
                    qSheet.onPick(v);
                    setQSheet(null);
                  }}
                >
                  <span className={styles.qSheetRowLabel}>
                    {qualityLabel(v.name, t('detail.source', { n: i + 1 }))}
                  </span>
                  <IconPlay size={15} />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
