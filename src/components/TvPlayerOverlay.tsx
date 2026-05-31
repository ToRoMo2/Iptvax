import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { WebPlayerController } from '../hooks/usePlayer';
import {
  IconPlay, IconPause, IconBack10, IconFwd10, IconPrev, IconNext,
  IconAudio, IconSubtitles, IconQuality, IconCheck, IconEpisodes,
} from './PlayerIcons';
import { safeImgUrl } from '../utils/image';
import type { Episode } from '../types/xtream.types';
import type { TmdbEpisodeStills } from '../types/tmdb.types';
import s from './TvPlayerOverlay.module.css';

/**
 * Overlay du lecteur pour TV (Android TV / Tizen / webOS) — piloté à la
 * TÉLÉCOMMANDE (D-pad). Distinct de l'overlay souris/tactile de `VideoPlayer`
 * (rendu uniquement quand `isTvDevice()` est faux).
 *
 * Modèle d'interaction (façon Netflix) :
 *  - `idle`     : vidéo plein écran, overlay caché. Gauche/Droite → scrub ;
 *                 Bas/Haut/OK → barre de contrôles.
 *  - `controls` : rangée de pictogrammes centrée. Focus G/D, OK active.
 *                 Auto-masquage après 5 s d'inactivité.
 *  - `scrub`    : vidéo en PAUSE, barre sélectionnée. G/D déplace le point
 *                 (±10 s, accéléré si maintenu). OK confirme. Retour annule.
 *  - `panel`    : la partie basse devient un sélecteur de pistes. Pour l'audio
 *                 et la qualité : une seule rangée. Pour les sous-titres :
 *                 plusieurs rangées (pistes + taille + couleur + fond) navigables
 *                 Haut/Bas (section) et G/D (option). Vidéo en PAUSE.
 *
 * ⚠ Sous-titres sur TV : rendus NATIVEMENT par le lecteur (plan vidéo). Les
 * réglages d'apparence (taille/couleur/fond) pilotent les mêmes préférences que
 * l'overlay React de `VideoPlayer` — ils n'agissent donc que là où les
 * sous-titres sont rendus côté React (web/mobile), pas sur le rendu natif TV.
 */

export type SubSize = 'sm' | 'md' | 'lg' | 'xl';
export type SubBg = 'none' | 'semi' | 'solid';
export type SubColor = 'white' | 'yellow' | 'cyan' | 'green';

type TvMode = 'idle' | 'controls' | 'scrub' | 'panel';
type CtrlId = 'prev' | 'back10' | 'playpause' | 'fwd10' | 'next' | 'audio' | 'subtitles' | 'quality' | 'episodes';
type PanelKind = 'audio' | 'subtitles' | 'quality' | 'episodes';

interface PanelItem {
  key: string;
  label: ReactNode;
  active: boolean;
  run: () => void;
  /** `true` = applique sans fermer le panneau (réglages d'apparence). */
  stay: boolean;
}
interface PanelSection {
  title: string;
  items: PanelItem[];
}

interface Props {
  player: WebPlayerController;
  title?: string;
  isLive: boolean;
  channelPosition?: string;
  onPrevChannel?: () => void;
  onNextChannel?: () => void;
  subSize: SubSize;
  subColor: SubColor;
  subBg: SubBg;
  onSubSize: (s: SubSize) => void;
  onSubColor: (c: SubColor) => void;
  onSubBg: (b: SubBg) => void;
  // ── Panneau « Épisodes » (chantier 3) — voir VideoPlayer.tsx ──────────
  episodesBySeason?: Record<string, Episode[]>;
  currentSeason?: number;
  currentEpisodeNum?: number;
  stillsBySeason?: Record<number, TmdbEpisodeStills>;
  onLoadSeasonStills?: (season: number) => void;
  onPlayEpisode?: (ep: Episode) => void;
}

const SIZE_OPTS: { v: SubSize; label: string }[] = [
  { v: 'sm', label: 'S' }, { v: 'md', label: 'M' }, { v: 'lg', label: 'L' }, { v: 'xl', label: 'XL' },
];
const COLOR_OPTS: { v: SubColor; label: string }[] = [
  { v: 'white', label: 'Blanc' }, { v: 'yellow', label: 'Jaune' }, { v: 'cyan', label: 'Cyan' }, { v: 'green', label: 'Vert' },
];
const BG_OPTS: { v: SubBg; label: string }[] = [
  { v: 'none', label: 'Aucun' }, { v: 'semi', label: 'Semi' }, { v: 'solid', label: 'Plein' },
];

// Maps de style partagées entre l'aperçu live et les chips « Aa ».
const SIZE_PX: Record<SubSize, number> = { sm: 20, md: 28, lg: 38, xl: 50 };
const SIZE_AA_PX: Record<SubSize, number> = { sm: 14, md: 20, lg: 28, xl: 38 };
const COLOR_HEX: Record<SubColor, string> = {
  white: '#ffffff', yellow: '#ffe066', cyan: 'var(--accent)', green: '#7eff7e',
};
const BG_CSS: Record<SubBg, string> = {
  none: 'transparent', semi: 'rgba(0,0,0,0.6)', solid: 'rgba(0,0,0,0.92)',
};
const SHADOW_OUTLINE = '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 0 6px rgba(0,0,0,0.55)';
const SHADOW_SOFT = '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.6)';

function isChipKey(key: string): boolean {
  return key.startsWith('sz-') || key.startsWith('co-') || key.startsWith('bg-');
}

// Carte épisode du panneau « Épisodes » (vignette + label).
function isEpCardKey(key: string): boolean {
  return key.startsWith('ep-') && !key.startsWith('ep-s-');
}

// Chip de sélection de saison.
function isEpSeasonKey(key: string): boolean {
  return key.startsWith('ep-s-');
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function TvPlayerOverlay({
  player, title, isLive, channelPosition, onPrevChannel, onNextChannel,
  subSize, subColor, subBg, onSubSize, onSubColor, onSubBg,
  episodesBySeason, currentSeason, currentEpisodeNum,
  stillsBySeason, onLoadSeasonStills, onPlayEpisode,
}: Props) {
  const [mode, setMode] = useState<TvMode>('idle');
  const [panelKind, setPanelKind] = useState<PanelKind>('audio');
  // Sous-vue du panneau sous-titres : `tracks` (liste pistes + bouton
  // Personnaliser) ou `customize` (aperçu live + taille/couleur/fond).
  const [subView, setSubView] = useState<'tracks' | 'customize'>('tracks');
  // Saison affichée dans le panneau Épisodes (init = currentSeason à
  // l'ouverture). Sert AUSSI au rendu visuel des cartes épisodes.
  const [tvSelectedSeason, setTvSelectedSeason] = useState<number | null>(null);
  const [focusSection, setFocusSection] = useState(0);
  const [focusIndex, setFocusIndex] = useState(0);
  const [scrubPos, setScrubPos] = useState(0);
  const [activityTick, setActivityTick] = useState(0);

  const panelRef = useRef<HTMLDivElement>(null);

  // Saisons disponibles dans `episodesBySeason` (clés numériques triées).
  const epSeasons: number[] = useMemo(() => {
    if (!episodesBySeason) return [];
    return Object.keys(episodesBySeason)
      .map(Number)
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
  }, [episodesBySeason]);
  // Le bouton est visible dès que Player.tsx nous donne `onPlayEpisode` (i.e.
  // dès qu'on est sur un épisode avec `seriesContext` posé), même si la liste
  // n'est pas encore arrivée — sinon il pop tardivement sur TV (fetch lent) et
  // l'utilisateur ne le voit jamais s'il ouvre l'overlay avant la fin.
  const epHasButton = !!onPlayEpisode && !isLive;

  const controls = useMemo<CtrlId[]>(() => {
    const list: CtrlId[] = [];
    if (isLive) {
      if (onPrevChannel) list.push('prev');
      list.push('playpause');
      if (onNextChannel) list.push('next');
    } else {
      list.push('back10', 'playpause', 'fwd10');
    }
    if (player.audioTracks.length > 0) list.push('audio');
    if (player.subtitleTracks.length > 0) list.push('subtitles');
    if (player.levels.length > 1) list.push('quality');
    if (epHasButton) list.push('episodes');
    return list;
  }, [isLive, onPrevChannel, onNextChannel, player.audioTracks.length, player.subtitleTracks.length, player.levels.length, epHasButton]);

  // ── Refs synchronisées (lues dans le handler clavier installé une fois) ────
  const playerRef = useRef(player); playerRef.current = player;
  const isLiveRef = useRef(isLive); isLiveRef.current = isLive;
  const prevRef = useRef(onPrevChannel); prevRef.current = onPrevChannel;
  const nextRef = useRef(onNextChannel); nextRef.current = onNextChannel;
  const controlsRef = useRef(controls); controlsRef.current = controls;
  const modeRef = useRef(mode); modeRef.current = mode;
  const panelKindRef = useRef(panelKind); panelKindRef.current = panelKind;
  const subViewRef = useRef(subView); subViewRef.current = subView;
  const focusSecRef = useRef(focusSection); focusSecRef.current = focusSection;
  const focusIdxRef = useRef(focusIndex); focusIdxRef.current = focusIndex;
  const scrubPosRef = useRef(scrubPos); scrubPosRef.current = scrubPos;
  const accelRef = useRef(0);
  const pausedByUsRef = useRef(false);
  // Prefs sous-titres : refs pour que buildSections reflète l'état courant.
  const subSizeRef = useRef(subSize); subSizeRef.current = subSize;
  const subColorRef = useRef(subColor); subColorRef.current = subColor;
  const subBgRef = useRef(subBg); subBgRef.current = subBg;
  const onSubSizeRef = useRef(onSubSize); onSubSizeRef.current = onSubSize;
  const onSubColorRef = useRef(onSubColor); onSubColorRef.current = onSubColor;
  const onSubBgRef = useRef(onSubBg); onSubBgRef.current = onSubBg;
  // Épisodes — refs lues par le handler clavier installé une fois.
  const episodesBySeasonRef = useRef(episodesBySeason); episodesBySeasonRef.current = episodesBySeason;
  const epSeasonsRef = useRef(epSeasons); epSeasonsRef.current = epSeasons;
  const currentSeasonRef = useRef(currentSeason); currentSeasonRef.current = currentSeason;
  const currentEpisodeNumRef = useRef(currentEpisodeNum); currentEpisodeNumRef.current = currentEpisodeNum;
  const stillsBySeasonRef = useRef(stillsBySeason); stillsBySeasonRef.current = stillsBySeason;
  const onLoadSeasonStillsRef = useRef(onLoadSeasonStills); onLoadSeasonStillsRef.current = onLoadSeasonStills;
  const onPlayEpisodeRef = useRef(onPlayEpisode); onPlayEpisodeRef.current = onPlayEpisode;
  const tvSelectedSeasonRef = useRef(tvSelectedSeason); tvSelectedSeasonRef.current = tvSelectedSeason;
  // Setter combiné state + ref (analogue à setFocus/setView).
  const setSelSeason = useCallback((sea: number | null) => {
    tvSelectedSeasonRef.current = sea; setTvSelectedSeason(sea);
  }, []);

  // Helpers de mutation (ref + state synchrones) utilisés par buildSections
  // (bouton Personnaliser) et le Back handler.
  const setFocus = useCallback((sec: number, idx: number) => {
    focusSecRef.current = sec; setFocusSection(sec);
    focusIdxRef.current = idx; setFocusIndex(idx);
  }, []);
  const setView = useCallback((v: 'tracks' | 'customize') => {
    subViewRef.current = v; setSubView(v);
  }, []);

  // Construit les sections d'un panneau depuis l'état courant.
  const buildSections = useCallback((kind: PanelKind): PanelSection[] => {
    const p = playerRef.current;
    if (kind === 'audio') {
      return [{
        title: 'Piste audio',
        items: p.audioTracks.map((t) => ({
          key: `a-${t.index}`,
          label: t.language ? `${t.name} (${t.language})` : t.name,
          active: p.currentAudio === t.index,
          run: () => playerRef.current.setAudio(t.index),
          stay: false,
        })),
      }];
    }
    if (kind === 'quality') {
      const auto: PanelItem = {
        key: 'q-auto', label: 'Auto', active: p.currentLevel === -1,
        run: () => playerRef.current.setLevel(-1), stay: false,
      };
      return [{
        title: 'Qualité',
        items: [auto, ...[...p.levels].reverse().map((l) => ({
          key: `q-${l.index}`, label: l.label, active: p.currentLevel === l.index,
          run: () => playerRef.current.setLevel(l.index), stay: false,
        }))],
      }];
    }
    if (kind === 'episodes') {
      const map = episodesBySeasonRef.current;
      const seasons = epSeasonsRef.current;
      // Fetch encore en cours côté Player → on retourne une section "vide"
      // qui sert de marqueur (le rendu affichera un état chargement). Le
      // handler clavier détecte items.length === 0 → seul Back ferme le panel.
      if (!map || seasons.length === 0) {
        return [{ title: 'Épisodes', items: [] }];
      }
      const sel = tvSelectedSeasonRef.current ?? currentSeasonRef.current ?? seasons[0];
      const epList: Episode[] = map[String(sel)] ?? [];
      const stillsForSeason = (sel != null ? stillsBySeasonRef.current?.[sel] : undefined) ?? {};
      const seasonSection: PanelSection = {
        title: 'Saison',
        items: seasons.map((sn) => ({
          key: `ep-s-${sn}`,
          label: `S${sn}`,
          active: sel === sn,
          run: () => {
            setSelSeason(sn);
            onLoadSeasonStillsRef.current?.(sn);
            // Repositionne le focus sur le 1er épisode de la nouvelle saison.
            const targetSec = seasons.length > 1 ? 1 : 0;
            setFocus(targetSec, 0);
          },
          stay: true,
        })),
      };
      const episodeSection: PanelSection = {
        title: 'Épisodes',
        items: epList.map((ep) => {
          const thumb = safeImgUrl(ep.info.movie_image) || safeImgUrl(stillsForSeason[ep.episode_num]);
          const isCurrent =
            currentSeasonRef.current === ep.season && currentEpisodeNumRef.current === ep.episode_num;
          return {
            key: `ep-${ep.id}`,
            label: (
              <span className={s.epCardInner}>
                <span className={s.epCardThumb}>
                  {thumb ? (
                    <img
                      src={thumb}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <span className={s.epCardNum}>{ep.episode_num}</span>
                  )}
                  {isCurrent && <span className={s.epCardBadge}>EN COURS</span>}
                </span>
                <span className={s.epCardMeta}>
                  <span className={s.epCardEpNum}>É{ep.episode_num}</span>
                  <span className={s.epCardTitle}>{ep.title || `Épisode ${ep.episode_num}`}</span>
                </span>
              </span>
            ),
            active: isCurrent,
            run: () => onPlayEpisodeRef.current?.(ep),
            stay: false,
          };
        }),
      };
      return seasons.length > 1 ? [seasonSection, episodeSection] : [episodeSection];
    }
    // Sous-titres : 2 sous-vues.
    if (subViewRef.current === 'tracks') {
      const off: PanelItem = {
        key: 's-off', label: 'Désactivés', active: p.currentSubtitle === -1,
        run: () => playerRef.current.setSubtitle(-1), stay: false,
      };
      const tracks: PanelItem[] = p.subtitleTracks.map((t) => ({
        key: `s-${t.index}`,
        label: t.language ? `${t.name} (${t.language})` : t.name,
        active: p.currentSubtitle === t.index,
        run: () => playerRef.current.setSubtitle(t.index),
        stay: false,
      }));
      const customizeBtn: PanelItem = {
        key: 'customize',
        label: (
          <span className={s.customizeLbl}>
            <IconQuality size={16} />Personnaliser
          </span>
        ),
        active: false,
        run: () => {
          setView('customize');
          // Focus le premier réglage actif (taille courante).
          const idx = SIZE_OPTS.findIndex((o) => o.v === subSizeRef.current);
          setFocus(0, idx >= 0 ? idx : 0);
        },
        stay: true,
      };
      return [
        { title: 'Sous-titres', items: [off, ...tracks] },
        { title: 'Apparence', items: [customizeBtn] },
      ];
    }
    // Vue customize : aperçu live au-dessus (rendu hors sections) + 3 rangées
    // de chips « Aa » qui reflètent visuellement chaque option.
    return [
      {
        title: 'Taille', items: SIZE_OPTS.map((o) => ({
          key: `sz-${o.v}`,
          label: <span className={s.aa} style={{ fontSize: SIZE_AA_PX[o.v] }}>Aa</span>,
          active: subSizeRef.current === o.v,
          run: () => onSubSizeRef.current(o.v), stay: true,
        })),
      },
      {
        title: 'Couleur', items: COLOR_OPTS.map((o) => ({
          key: `co-${o.v}`,
          label: (
            <span
              className={s.aa}
              style={{ color: COLOR_HEX[o.v], textShadow: SHADOW_OUTLINE }}
            >Aa</span>
          ),
          active: subColorRef.current === o.v,
          run: () => onSubColorRef.current(o.v), stay: true,
        })),
      },
      {
        title: 'Fond', items: BG_OPTS.map((o) => ({
          key: `bg-${o.v}`,
          label: (
            <span
              className={s.aa}
              style={{
                background: BG_CSS[o.v], color: '#fff',
                padding: '3px 9px', borderRadius: 'var(--r-ui)',
                textShadow: o.v === 'none' ? SHADOW_OUTLINE : SHADOW_SOFT,
              }}
            >Aa</span>
          ),
          active: subBgRef.current === o.v,
          run: () => onSubBgRef.current(o.v), stay: true,
        })),
      },
    ];
  }, [setFocus, setView, setSelSeason]);

  const sections = mode === 'panel' ? buildSections(panelKind) : [];

  // ── Handler télécommande : installé une fois, lit les refs ─────────────────
  useEffect(() => {
    const goMode = (m: TvMode) => { modeRef.current = m; setMode(m); };
    const goSection = (sec: number) => { focusSecRef.current = sec; setFocusSection(sec); };
    const goIndex = (i: number) => { focusIdxRef.current = i; setFocusIndex(i); };
    const goScrub = (p: number) => { scrubPosRef.current = p; setScrubPos(p); };
    const bumpActivity = () => setActivityTick((t) => t + 1);

    const defaultControlFocus = () => {
      const i = controlsRef.current.indexOf('playpause');
      return i >= 0 ? i : 0;
    };
    const pauseForInteraction = () => {
      if (playerRef.current.status === 'playing') {
        playerRef.current.toggle();
        pausedByUsRef.current = true;
      }
    };
    const resumeIfWePaused = () => {
      if (pausedByUsRef.current) {
        playerRef.current.toggle();
        pausedByUsRef.current = false;
      }
    };
    const stepScrub = (dir: number, repeat: boolean) => {
      accelRef.current = repeat ? Math.min(accelRef.current + 1, 40) : 0;
      const step = 10 * Math.min(1 + Math.floor(accelRef.current / 4), 6); // 10..60 s
      const dur = playerRef.current.duration || 0;
      let next = scrubPosRef.current + dir * step;
      next = Math.max(0, dur > 0 ? Math.min(next, dur) : next);
      goScrub(next);
      bumpActivity();
    };
    const enterScrub = (dir: number, repeat: boolean) => {
      pauseForInteraction();
      goMode('scrub');
      goScrub(playerRef.current.currentTime || 0);
      if (dir !== 0) stepScrub(dir, repeat);
    };
    const confirmScrub = () => {
      playerRef.current.seek(scrubPosRef.current);
      resumeIfWePaused();
      accelRef.current = 0;
      goMode('idle');
    };
    const cancelScrub = () => {
      resumeIfWePaused();
      accelRef.current = 0;
      goMode('idle');
    };
    const enterControls = () => {
      goMode('controls');
      goSection(0);
      goIndex(defaultControlFocus());
      bumpActivity();
    };
    const openPanel = (kind: PanelKind) => {
      pauseForInteraction();
      panelKindRef.current = kind;
      setPanelKind(kind);
      // Toujours rouvrir le panneau sous-titres sur la vue pistes (le bouton
      // Personnaliser permet d'aller dans les réglages d'apparence).
      if (kind === 'subtitles') {
        subViewRef.current = 'tracks';
        setSubView('tracks');
      }
      // Init de la saison sélectionnée + charge ses stills (la saison courante
      // peut déjà avoir été chargée par Player, le 2e appel est idempotent).
      if (kind === 'episodes') {
        const init = currentSeasonRef.current ?? epSeasonsRef.current[0] ?? null;
        tvSelectedSeasonRef.current = init;
        setTvSelectedSeason(init);
        if (init != null) onLoadSeasonStillsRef.current?.(init);
      }
      goMode('panel');
      const secs = buildSections(kind);
      // Pour les épisodes : focus directement sur l'épisode courant (la
      // section des saisons existe au-dessus, accessible via Haut).
      if (kind === 'episodes') {
        const hasSeasonRow = epSeasonsRef.current.length > 1;
        const epSec = hasSeasonRow ? 1 : 0;
        const epItems = secs[epSec]?.items ?? [];
        const idx = epItems.findIndex((it) => it.active);
        goSection(epSec);
        goIndex(idx >= 0 ? idx : 0);
      } else {
        const activeIdx = secs[0]?.items.findIndex((it) => it.active) ?? 0;
        goSection(0);
        goIndex(activeIdx >= 0 ? activeIdx : 0);
      }
    };
    const resumeFromPanel = () => {
      resumeIfWePaused();
      enterControls();
    };
    const activateControl = (id: CtrlId) => {
      const p = playerRef.current;
      switch (id) {
        case 'playpause': p.toggle(); break;
        case 'back10': p.seek(Math.max(0, p.currentTime - 10)); break;
        case 'fwd10': p.seek(p.currentTime + 10); break;
        case 'prev': prevRef.current?.(); break;
        case 'next': nextRef.current?.(); break;
        case 'audio': openPanel('audio'); break;
        case 'subtitles': openPanel('subtitles'); break;
        case 'quality': openPanel('quality'); break;
        case 'episodes': openPanel('episodes'); break;
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key;
      const code = e.keyCode;
      const isLeft = k === 'ArrowLeft' || code === 37;
      const isRight = k === 'ArrowRight' || code === 39;
      const isUp = k === 'ArrowUp' || code === 38;
      const isDown = k === 'ArrowDown' || code === 40;
      const isOk = k === 'Enter' || code === 13;
      const isBack = k === 'Escape' || k === 'GoBack' || k === 'BrowserBack'
        || code === 10009 || code === 461 || code === 8;
      const isPlayPause = k === 'MediaPlayPause' || code === 415 || code === 19 || code === 10252;

      const mode = modeRef.current;

      if (isBack) {
        if (mode === 'idle') return;
        e.preventDefault();
        if (mode === 'panel') {
          // Dans la vue customize des sous-titres, Back revient à la vue pistes
          // (au lieu de fermer le panneau).
          if (panelKindRef.current === 'subtitles' && subViewRef.current === 'customize') {
            setView('tracks');
            setFocus(1, 0); // Personnaliser (section 1, item 0)
          } else {
            resumeFromPanel();
          }
        }
        else if (mode === 'scrub') cancelScrub();
        else goMode('idle');
        return;
      }

      if (isPlayPause) {
        e.preventDefault();
        playerRef.current.toggle();
        if (mode === 'idle') enterControls();
        else bumpActivity();
        return;
      }

      switch (mode) {
        case 'idle':
          if (isLeft || isRight) {
            if (isLiveRef.current) {
              if (isRight && nextRef.current) { e.preventDefault(); nextRef.current(); }
              else if (isLeft && prevRef.current) { e.preventDefault(); prevRef.current(); }
            } else {
              e.preventDefault();
              enterScrub(isRight ? 1 : -1, e.repeat);
            }
          } else if (isUp || isDown || isOk) {
            e.preventDefault();
            enterControls();
          }
          break;

        case 'controls': {
          const list = controlsRef.current;
          if (isLeft) { e.preventDefault(); goIndex(clamp(focusIdxRef.current - 1, 0, list.length - 1)); bumpActivity(); }
          else if (isRight) { e.preventDefault(); goIndex(clamp(focusIdxRef.current + 1, 0, list.length - 1)); bumpActivity(); }
          else if (isUp) {
            e.preventDefault();
            if (!isLiveRef.current) enterScrub(0, false);
            else bumpActivity();
          } else if (isDown) {
            e.preventDefault();
            goMode('idle');
          } else if (isOk) {
            e.preventDefault();
            activateControl(list[focusIdxRef.current]);
          }
          break;
        }

        case 'scrub':
          if (isLeft) { e.preventDefault(); stepScrub(-1, e.repeat); }
          else if (isRight) { e.preventDefault(); stepScrub(1, e.repeat); }
          else if (isOk) { e.preventDefault(); confirmScrub(); }
          else if (isDown) { e.preventDefault(); enterControls(); }
          else if (isUp) { e.preventDefault(); }
          break;

        case 'panel': {
          e.preventDefault();
          const secs = buildSections(panelKindRef.current);
          const sec = secs[focusSecRef.current];
          if (!sec) { resumeFromPanel(); break; }
          const isCustomizeView = panelKindRef.current === 'subtitles' && subViewRef.current === 'customize';

          if (isCustomizeView) {
            // 3 colonnes côte à côte → G/D traverse linéairement Taille → Couleur
            // → Fond ; Haut revient à la vue pistes ; Bas ferme le panneau.
            if (isLeft) {
              if (focusIdxRef.current > 0) {
                goIndex(focusIdxRef.current - 1);
              } else if (focusSecRef.current > 0) {
                const ns = focusSecRef.current - 1;
                goSection(ns);
                goIndex(secs[ns].items.length - 1);
              }
            } else if (isRight) {
              if (focusIdxRef.current < sec.items.length - 1) {
                goIndex(focusIdxRef.current + 1);
              } else if (focusSecRef.current < secs.length - 1) {
                const ns = focusSecRef.current + 1;
                goSection(ns);
                goIndex(0);
              }
            } else if (isUp) {
              setView('tracks');
              setFocus(1, 0); // Personnaliser
            } else if (isDown) {
              resumeFromPanel();
            } else if (isOk) {
              const it = sec.items[focusIdxRef.current];
              if (it) {
                it.run();
                if (it.stay) bumpActivity();
                else resumeFromPanel();
              }
            }
          } else {
            // Vues pistes (audio / qualité / sous-titres) : G/D dans la rangée,
            // H/B entre sections.
            if (isLeft) { goIndex(clamp(focusIdxRef.current - 1, 0, sec.items.length - 1)); }
            else if (isRight) { goIndex(clamp(focusIdxRef.current + 1, 0, sec.items.length - 1)); }
            else if (isUp) {
              if (focusSecRef.current > 0) {
                const ns = focusSecRef.current - 1;
                goSection(ns);
                goIndex(clamp(focusIdxRef.current, 0, secs[ns].items.length - 1));
              } else resumeFromPanel();
            } else if (isDown) {
              if (focusSecRef.current < secs.length - 1) {
                const ns = focusSecRef.current + 1;
                goSection(ns);
                goIndex(clamp(focusIdxRef.current, 0, secs[ns].items.length - 1));
              } else resumeFromPanel();
            } else if (isOk) {
              const it = sec.items[focusIdxRef.current];
              if (it) {
                it.run();
                if (it.stay) bumpActivity();
                else resumeFromPanel();
              }
            }
          }
          break;
        }
      }
    };

    const onKeyUp = () => { accelRef.current = 0; };
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('keyup', onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-masquage en mode `controls` (5 s après la dernière activité).
  useEffect(() => {
    if (mode !== 'controls') return;
    const id = setTimeout(() => { modeRef.current = 'idle'; setMode('idle'); }, 5000);
    return () => clearTimeout(id);
  }, [mode, activityTick]);

  // Garde l'item focalisé visible.
  useEffect(() => {
    if (mode !== 'panel') return;
    const el = panelRef.current?.querySelector(
      `[data-sec="${focusSection}"][data-idx="${focusIndex}"]`,
    ) as HTMLElement | undefined;
    el?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [mode, focusSection, focusIndex]);

  const visible = mode !== 'idle';
  const isPlaying = player.status === 'playing';
  const subActive = player.currentSubtitle >= 0;
  const dur = player.duration;
  const headPos = mode === 'scrub' ? scrubPos : player.currentTime;
  const posPct = dur > 0 ? clamp((headPos / dur) * 100, 0, 100) : 0;
  const bufferedPct = dur > 0 ? clamp((player.bufferedEnd / dur) * 100, 0, 100) : 0;

  // Style de l'aperçu de sous-titres, recalculé à chaque changement de prefs.
  const previewStyle: CSSProperties = {
    fontSize: SIZE_PX[subSize],
    color: COLOR_HEX[subColor],
    background: BG_CSS[subBg],
    textShadow: subBg === 'none' ? SHADOW_OUTLINE : SHADOW_SOFT,
    padding: subBg === 'none' ? '0 2px' : '4px 14px',
    borderRadius: 'var(--r-ui)',
    fontWeight: 700,
    letterSpacing: '-0.005em',
    lineHeight: 1.3,
  };

  const renderIcon = (id: CtrlId) => {
    switch (id) {
      case 'prev': return <IconPrev size={26} />;
      case 'next': return <IconNext size={26} />;
      case 'back10': return <IconBack10 size={26} />;
      case 'fwd10': return <IconFwd10 size={26} />;
      case 'playpause': return isPlaying ? <IconPause size={30} /> : <IconPlay size={30} />;
      case 'audio': return <IconAudio size={24} />;
      case 'subtitles': return <IconSubtitles size={24} />;
      case 'quality': return <IconQuality size={24} />;
      case 'episodes': return <IconEpisodes size={24} />;
    }
  };

  return (
    <div className={`${s.overlay} ${visible ? s.visible : ''}`}>
      {/* Bandeau haut : titre + live */}
      <div className={s.top}>
        {title && <span className={s.title}>{title}</span>}
        {isLive && channelPosition && <span className={s.chPos}>{channelPosition}</span>}
        {isLive && (
          <span className={s.live}><span className={s.livePulse} />EN DIRECT</span>
        )}
      </div>

      {/* Bandeau bas : progression + (contrôles | panneau pistes) */}
      <div className={s.bottom}>
        {/* Aperçu des sous-titres : remonté AU-DESSUS de la barre de progression
            (sur le film) pour ne pas alourdir le panneau. Mis à jour en direct. */}
        {mode === 'panel' && panelKind === 'subtitles' && subView === 'customize' && (
          <div className={s.subPreview}>
            <span style={previewStyle}>Vos sous-titres ressembleront à ceci</span>
          </div>
        )}
        {!isLive && dur > 0 && (
          <div className={`${s.progressRow} ${mode === 'scrub' ? s.scrubbing : ''}`}>
            <span className={s.time}>{formatTime(headPos)}</span>
            <div className={s.track}>
              <div className={s.buffered} style={{ width: `${bufferedPct}%` }} />
              <div className={s.filled} style={{ width: `${posPct}%` }} />
              <div className={s.knob} style={{ left: `${posPct}%` }}>
                {mode === 'scrub' && (
                  <span className={s.scrubBubble}>{formatTime(scrubPos)}</span>
                )}
              </div>
            </div>
            <span className={s.time}>{formatTime(dur)}</span>
          </div>
        )}

        {mode === 'panel' && panelKind === 'episodes' && (sections[0]?.items.length ?? 0) === 0 ? (
          <div className={s.epPanelLoading}>
            <span className={s.epLoadingDot} />
            Chargement des épisodes…
          </div>
        ) : mode === 'panel' ? (
          <div
            ref={panelRef}
            className={`${s.panel} ${panelKind === 'subtitles' && subView === 'customize' ? s.panelHoriz : ''}`}
          >
            {sections.map((sec, si) => (
              <div className={`${s.panelSection} ${panelKind === 'episodes' && isEpCardKey(sec.items[0]?.key ?? '') ? s.epPanelSection : ''}`} key={sec.title}>
                <div className={s.panelTitle}>{sec.title}</div>
                <div className={`${s.panelItems} ${panelKind === 'episodes' && isEpCardKey(sec.items[0]?.key ?? '') ? s.epRow : ''}`}>
                  {sec.items.map((it, ii) => {
                    const epCard = isEpCardKey(it.key);
                    const epSeason = isEpSeasonKey(it.key);
                    return (
                      <div
                        key={it.key}
                        data-sec={si}
                        data-idx={ii}
                        className={`${s.panelItem} ${isChipKey(it.key) ? s.panelItemChip : ''} ${epSeason ? s.panelItemEpSeason : ''} ${epCard ? s.panelItemEpCard : ''} ${si === focusSection && ii === focusIndex ? s.itemFocused : ''} ${it.active ? s.itemActive : ''}`}
                      >
                        {it.active && !epCard && <IconCheck size={15} className={s.itemCheck} />}
                        {it.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={s.row}>
            {controls.map((id, i) => (
              <div
                key={id}
                className={`${s.ctrl} ${id === 'playpause' ? s.ctrlPrimary : ''} ${mode === 'controls' && i === focusIndex ? s.ctrlFocused : ''}`}
              >
                {renderIcon(id)}
                {id === 'subtitles' && subActive && <span className={s.activeDot} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
