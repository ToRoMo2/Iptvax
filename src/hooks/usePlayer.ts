import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { apiUrl } from '../lib/api';
import type {
  PlayerStatus,
  QualityLevel,
  AudioTrack,
  SubtitleTrack,
  PlayerController,
} from '../types/player.types';

// ── ffprobe probe result ──────────────────────────────────────────────────────
interface ProbeTrack {
  index: number;
  streamIndex: number;
  codec: string;
  language: string;
  title: string;
}
interface ProbeData {
  audio: ProbeTrack[];
  subtitles: ProbeTrack[];
  duration?: number; // durée réelle du fichier en secondes (depuis les métadonnées du conteneur)
}

async function probeUrl(url: string): Promise<ProbeData> {
  try {
    const res = await fetch(apiUrl(`/api/probe?url=${encodeURIComponent(url)}`), {
      signal: AbortSignal.timeout(30_000),
    });
    return (await res.json()) as ProbeData;
  } catch {
    return { audio: [], subtitles: [] };
  }
}

// Build the /api/stream URL for a direct (non-HLS) source with a selected audio track.
// `transcode` force ffmpeg à ré-encoder la vidéo en H.264 (repli pour les codecs
// que le navigateur ne sait pas décoder en `-c:v copy` — HEVC/H.265, MPEG-2…).
function buildStreamUrl(sourceUrl: string, audioTrack: number, seekSec?: number, transcode?: boolean): string {
  // sourceUrl is already an /api/hlsproxy?url=... form
  // Extract the real upstream URL from it
  const inner = new URL(sourceUrl, window.location.origin);
  const upstream = inner.searchParams.get('url') ?? sourceUrl;
  const params = new URLSearchParams({ url: upstream, audio: String(audioTrack) });
  if (seekSec && seekSec > 0) params.set('seek', seekSec.toFixed(1));
  if (transcode) params.set('transcode', '1');
  return apiUrl(`/api/stream?${params}`);
}

/**
 * Retour de `usePlayer` : le contrat agnostique `PlayerController` plus les
 * refs DOM propres au lecteur web (élément <video> + conteneur plein écran).
 * Une implémentation native ne possède pas de HTMLVideoElement et se limitera
 * donc à `PlayerController`. Voir docs/native-port.md.
 */
export interface WebPlayerController extends PlayerController {
  videoRef: RefObject<HTMLVideoElement>;
  wrapperRef: RefObject<HTMLDivElement>;
}

function isHlsUrl(url: string) {
  return url.includes('.m3u8');
}

// ── Sous-titres FENÊTRÉS (desktop) ─────────────────────────────────────────
// On n'extrait plus toute la piste d'un coup (ffmpeg devait lire le fichier
// distant entier → dizaines de secondes + monopolisation de l'unique connexion
// autorisée par le fournisseur IPTV). À la place : des fenêtres de quelques
// minutes autour de la position courante, via fast-seek `-ss` côté serveur, puis
// fusionnées côté client. Résultat : cues affichées en ~1-2 s comme sur mobile.
const SUB_WIN = 300;       // longueur d'une fenêtre (s) — grille fixe pour le cache
const SUB_OVERLAP = 5;     // chevauchement (s) pour ne pas couper une cue en bord de fenêtre
const SUB_LOOKAHEAD = 1;   // nombre de fenêtres préchargées en avance de la lecture

// Index de la fenêtre contenant l'instant absolu `t` (grille de pas SUB_WIN).
function subWindowIndex(t: number): number {
  return Math.max(0, Math.floor((t || 0) / SUB_WIN));
}

// ── Parser WebVTT robuste ─────────────────────────────────────────────────
// On fetch et parse les sous-titres nous-mêmes plutôt que d'utiliser <track> :
// les éléments <track> ont des bugs de timing dans Chrome (mode='hidden' ne
// déclenche pas toujours le fetch, track.cues reste vide…).
// Le parser doit gérer toutes les variantes que ffmpeg peut produire :
// WebVTT, SRT (virgules), tags ASS, voice tags, entités HTML, BOM, CRLF.
interface VttCue { start: number; end: number; text: string; }

// Correction des cues « tenues ouvertes » par ffmpeg ──────────────────────
// Depuis l'extraction FENÊTRÉE (fast-seek `-ss`), l'encodeur WebVTT de certains
// builds ffmpeg (BtbN 7.x en prod, cf. CLAUDE.md §IV-25) ne connaît plus la fin
// réelle d'une cue après un seek d'entrée → il l'étire jusqu'au DÉBUT de la cue
// suivante. Symptôme : après une phrase suivie d'un long blanc, le sous-titre
// reste affiché jusqu'à la phrase suivante au lieu de disparaître à sa fin.
// On ne peut pas récupérer la vraie fin, mais une cue manifestement étirée a une
// durée déclarée bien plus longue que le temps nécessaire pour LIRE son texte.
// On ramène alors sa fin à une durée de lecture plausible (~15 caractères/s,
// bornée). Les cues correctement minutées (durée ≈ temps de lecture, à la marge
// `SUB_HOLD_SLACK` près) ne sont JAMAIS touchées → zéro régression sur les flux
// dont ffmpeg produit déjà des fins exactes.
const SUB_READ_CPS = 15;       // vitesse de lecture supposée (caractères / s)
const SUB_READ_MIN = 1.2;      // durée d'affichage minimale (s)
const SUB_READ_MAX = 7;        // durée d'affichage maximale (s) — standard Netflix/BBC
const SUB_HOLD_SLACK = 2.5;    // marge avant de considérer une cue « tenue ouverte »
const SUB_HOLD_FLOOR = 6;      // aucune cue plus courte que ça n'est jamais corrigée

// Fin corrigée d'une cue si elle est étirée bien au-delà de sa durée de lecture.
// Double garde-fou : on ne touche QUE les cues dont la durée déclarée dépasse à la
// fois (a) le temps de lecture du texte + une marge ET (b) un plancher absolu
// (`SUB_HOLD_FLOOR`) → les sous-titres normaux (≤ 6 s, l'immense majorité) ne sont
// jamais altérés ; seuls les longs maintiens (blanc → fin étirée) sont ramenés.
function clampCueEnd(start: number, end: number, text: string): number {
  const dur = end - start;
  if (dur <= SUB_HOLD_FLOOR) return end;
  const readEst = Math.min(SUB_READ_MAX, Math.max(SUB_READ_MIN, text.length / SUB_READ_CPS));
  return dur > readEst + SUB_HOLD_SLACK ? start + readEst : end;
}

function parseTimestamp(ts: string): number {
  // Formats supportés : HH:MM:SS.mmm | MM:SS.mmm | SS.mmm | HH:MM:SS,mmm (SRT)
  const cleaned = ts.trim().replace(',', '.');
  const parts = cleaned.split(':');
  let h = 0, m = 0, s = 0;
  if (parts.length === 3) {
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
    s = parseFloat(parts[2]);
  } else if (parts.length === 2) {
    m = parseInt(parts[0], 10);
    s = parseFloat(parts[1]);
  } else {
    s = parseFloat(parts[0]);
  }
  if (!isFinite(h) || !isFinite(m) || !isFinite(s)) return NaN;
  return h * 3600 + m * 60 + s;
}

function cleanCueText(raw: string): string {
  return raw
    // Overrides ASS/SSA : {\an8}, {\pos(100,200)}, {\fad(...)}, etc.
    .replace(/\{\\[^}]*\}/g, '')
    // Voice tags WebVTT : <v Speaker>texte</v>
    .replace(/<v[\s.][^>]*>/gi, '').replace(/<\/v>/gi, '')
    // Class tags WebVTT : <c.classname>texte</c>
    .replace(/<c[\s.][^>]*>/gi, '').replace(/<\/c>/gi, '')
    // Timestamps inline (karaoke) : <00:00:00.000>
    .replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, '')
    // Toute autre balise (i, b, u, ruby, lang, font, etc.)
    .replace(/<[^>]+>/g, '')
    // Entités HTML courantes
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Nettoyer chaque ligne
    .split('\n').map((l) => l.trimEnd()).join('\n').trim();
}

function parseVtt(text: string): VttCue[] {
  const cues: VttCue[] = [];
  // Normalisation : BOM, fins de ligne
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const arrow = line.indexOf('-->');
    if (arrow === -1) continue;

    const startStr = line.substring(0, arrow).trim();
    const afterArrow = line.substring(arrow + 3).trim();
    // Le timestamp de fin peut être suivi de "settings" WebVTT (line:N, position:N…)
    const endStr = afterArrow.split(/\s+/)[0];
    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr);
    if (!isFinite(start) || !isFinite(end) || end <= start) continue;

    // Texte = lignes suivantes jusqu'à une ligne vide
    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }
    const cleaned = cleanCueText(textLines.join('\n'));
    // Corrige les cues « tenues ouvertes » par ffmpeg (fin étirée jusqu'à la cue
    // suivante après un fast-seek) → fin ramenée à une durée de lecture plausible.
    if (cleaned) cues.push({ start, end: clampCueEnd(start, end, cleaned), text: cleaned });
  }

  // Tri par temps de début → permet la recherche binaire dans la boucle RAF
  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// Lit les AudioTracks natives de l'élément video (MP4 multi-audio)
// Retourne les pistes et s'assure qu'au moins une est activée.
function readNativeAudioTracks(video: HTMLVideoElement): AudioTrack[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (video as any).audioTracks as ({ label?: string; language?: string; enabled: boolean }[] & { length: number }) | undefined;
  if (!list || list.length === 0) return [];

  const tracks: AudioTrack[] = [];
  let hasEnabled = false;

  for (let i = 0; i < list.length; i++) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = list[i] as any;
    tracks.push({
      index: i,
      name: t.label || t.language || `Audio ${i + 1}`,
      language: t.language || '',
    });
    if (t.enabled) hasEnabled = true;
  }

  // Si aucune piste n'est active, on force la première → règle le silence
  if (!hasEnabled && list.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (list[0] as any).enabled = true;
  }

  return tracks;
}

// Lit les TextTracks natives (sous-titres embarqués en MP4 / WebVTT).
// Note : on ne les utilise PLUS pour le rendu (qui passe par /api/subtitle).
// On les liste uniquement comme fallback de découverte si le probe échoue.
function readNativeSubtitleTracks(video: HTMLVideoElement): SubtitleTrack[] {
  const list = video.textTracks;
  if (!list || list.length === 0) return [];

  const tracks: SubtitleTrack[] = [];
  let idx = 0;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.kind === 'subtitles' || t.kind === 'captions') {
      tracks.push({
        index: idx++,
        streamIndex: i, // pas d'index absolu disponible côté natif → on garde i
        name: t.label || t.language || `Sous-titres ${idx}`,
        language: t.language || '',
      });
    }
  }
  return tracks;
}

// Filet de sécurité (le cas principal — source illisible/0 octet — est déjà
// détecté en ~1-2 s côté proxy qui répond 422). Ne couvre plus que le cas rare
// d'un flux qui émet quelques octets puis se fige sans event 'error'. Délai
// court car la détection rapide vit ailleurs ; assez long pour ne pas piéger un
// gros seek sur réseau lent.
const STUCK_DETECT_MS = 12_000;

export function usePlayer(url: string | null, mediaUrl?: string | null): WebPlayerController {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  // URL proxy de la source courante (gardée pour pouvoir basculer vers /api/stream)
  const sourceUrlRef = useRef<string | null>(null);
  // Si non-null → on est en mode ffmpeg (/api/stream) ; null → lecture native via hlsproxy
  const directSourceRef = useRef<string | null>(null);
  // Escalade transcodage : passe à true quand la lecture `-c:v copy` a échoué
  // (codec vidéo non décodable par le navigateur) et qu'on a basculé sur un
  // flux ffmpeg transcodé en H.264. Toutes les requêtes /api/stream suivantes
  // (seek, switch audio) doivent alors aussi demander le transcodage.
  const transcodeRef = useRef(false);
  // URL upstream du fichier média (MKV/MP4) — TOUJOURS utilisée pour le probe ffprobe
  // et l'extraction des sous-titres, peu importe que la lecture passe par HLS ou ffmpeg.
  // C'est la seule source de vérité pour les sous-titres → comportement déterministe.
  const mediaUrlRef = useRef<string | null>(null);
  // Durée réelle du fichier (depuis ffprobe) — video.duration est Infinity pour les streams ffmpeg
  const probeDurationRef = useRef(0);
  // Offset de seek : Chrome rebase à 0 la timeline d'un MP4 fragmenté servi
  // via video.src → video.currentTime repart de 0 à chaque restart ffmpeg.
  // Position réelle = video.currentTime + seekOffsetRef. Valeur posée de façon
  // optimiste = position demandée, puis corrigée sur la VRAIE keyframe K de
  // démarrage via /api/streambase (sinon barre/sous-titres en avance de ~1 GOP).
  const seekOffsetRef = useRef(0);
  // Refs pour accéder aux valeurs courantes dans les callbacks sans dépendances stales
  const currentAudioRef = useRef(0);
  const currentTimeRef = useRef(0);
  // Compteur de seeks pour invalider les listeners obsolètes (seeks rapides successifs)
  const seekGenRef = useRef(0);
  // Sous-titres : cues FUSIONNÉES de la piste active (toutes les fenêtres chargées,
  // triées). C'est ce que lit la boucle d'affichage RAF.
  const subCuesRef = useRef<VttCue[]>([]);
  // Cache par fenêtre : clé `${streamIndex}#${windowIndex}` → cues de la fenêtre.
  // Survit aux changements de piste (re-sélectionner une piste déjà vue = instantané).
  const subWinCacheRef = useRef<Map<string, VttCue[]>>(new Map());
  // Fenêtres en cours de fetch (mêmes clés) → évite les requêtes en double.
  const subWinFetchingRef = useRef<Set<string>>(new Set());
  // streamIndex absolu de la piste de sous-titres ACTIVE (-1 = aucune).
  const subActiveStreamRef = useRef(-1);
  // Fenêtres déjà fusionnées dans subCuesRef pour la piste active.
  const subLoadedWindowsRef = useRef<Set<number>>(new Set());
  // Index UI (0-based) de la piste courante — sert à valider les fetch asynchrones
  const currentSubRef = useRef(-1);
  // Décalage utilisateur en secondes (positif = sous-titres plus tôt)
  const subOffsetRef = useRef(0);
  // Liste courante des pistes de sous-titres — ref pour lookup streamIndex sans re-render
  const subtitleTracksRef = useRef<SubtitleTrack[]>([]);
  // Timer pour retarder l'indicateur de chargement des sous-titres.
  // Si le cache est chaud, la réponse arrive en <150 ms → le spinner n'apparaît jamais.
  const subLoadingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Préchauffage des sous-titres : ANNULABLE et SÉRIALISÉ. Chaque /api/subtitle
  // spawn un ffmpeg qui lit tout le fichier distant → lancer toutes les pistes
  // en parallèle (ancien comportement) saturait CPU/bande passante et ralentissait
  // le démarrage de la vidéo elle-même. On précharge désormais une piste à la
  // fois, par ordre de priorité (sélectionnée/FR d'abord), et après un délai.
  const subPrefetchAbortRef = useRef<AbortController | null>(null);
  const subPrefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Dernière video.currentTime observée — sert à détecter si la vidéo avance vraiment
  // pour débloquer un statut "buffering" qui resterait coincé après-coup.
  const lastTimeRef = useRef(0);
  // Watchdog "flux illisible" (VOD uniquement) : un flux défectueux que ffmpeg
  // ne sait pas démuxer peut décoder une seule frame puis se figer en 'paused'
  // SANS jamais émettre d'event 'error' → l'utilisateur reste sur une image gelée
  // avec un bouton play inerte, aucun overlay d'erreur. everPlayedRef passe à true
  // dès qu'une vraie progression est observée ; si le délai expire avant ça, on
  // bascule en erreur explicite (cf. STUCK_DETECT_MS).
  const everPlayedRef = useRef(false);
  const stuckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Verrou d'erreur TERMINALE : une fois posé, plus aucun event tardif du <video>
  // (pause/waiting/canplay/play d'un flux moribond, ou un play().catch en attente)
  // ne doit ré-écrire le statut — sinon l'overlay d'erreur clignote puis repasse
  // sur un bouton pause inerte. Remis à false à chaque nouveau loadSource (Retry).
  const erroredRef = useRef(false);
  // Miroir du `status` lisible dans les callbacks/effets sans dépendances stale.
  // Sert à NE PAS ouvrir de connexion sous-titres tant que la vidéo s'établit
  // (status loading/buffering) : les fournisseurs IPTV limitent souvent les
  // connexions simultanées → une extraction sous-titres lancée au démarrage volait
  // le slot au flux vidéo et le laissait coincé en pause (cf. fetchSubWindow).
  const statusRef = useRef<PlayerStatus>('idle');
  // Sérialise les extractions de sous-titres : au plus UNE connexion upstream à la
  // fois (la fenêtre courante puis la suivante en file), jamais une rafale.
  const subFetchChainRef = useRef<Promise<unknown>>(Promise.resolve());

  const [status, setStatus] = useState<PlayerStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [currentLevel, setCurrentLevelState] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [currentAudio, setCurrentAudio] = useState(-1);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [currentSubtitle, setCurrentSubtitle] = useState(-1);
  // Texte du sous-titre courant — calculé manuellement à partir du temps réel
  // (video.currentTime + seekOffsetRef) car on rend les sous-titres via un
  // overlay <div>, jamais via <track> natif.
  const [subtitleText, setSubtitleText] = useState('');
  // Extraction VTT en cours (ffmpeg lit tout le fichier pour récupérer toutes
  // les cues) — surfacé à l'UI pour un retour visuel sur les longs épisodes.
  const [subtitleLoading, setSubtitleLoading] = useState(false);
  // Décalage des sous-titres ajustable par l'utilisateur (en secondes, +/- 10s)
  // Positif = apparaissent plus tôt (corrige les sous-titres en retard)
  const [subtitleOffset, setSubtitleOffsetState] = useState(0);

  // Listeners persistants sur le <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      // video.currentTime repart de 0 après chaque restart ffmpeg (Chrome
      // rebase le MP4 fragmenté) → on ajoute seekOffsetRef (= keyframe K
      // réelle de démarrage, corrigée via /api/streambase) pour la vraie pos.
      const ct = video.currentTime + seekOffsetRef.current;
      setCurrentTime(ct);
      currentTimeRef.current = ct;
      // Filet de sécurité : si on est coincé en "loading" ou "buffering" mais
      // que la vidéo avance réellement, débloquer en passant à "playing".
      // (Évite que l'overlay "Mise en mémoire tampon" reste affiché alors que
      // la vidéo joue normalement derrière.)
      const advanced = video.currentTime - lastTimeRef.current;
      lastTimeRef.current = video.currentTime;
      if (!video.paused && advanced > 0.05 && advanced < 1) {
        setStatus((s) => (s === 'loading' || s === 'buffering' ? 'playing' : s));
      }
      // Désarme le watchdog "flux illisible" dès la 1re vraie progression de lecture.
      if (!video.paused && video.currentTime > 0.1 && !everPlayedRef.current) {
        everPlayedRef.current = true;
        if (stuckTimerRef.current) { clearTimeout(stuckTimerRef.current); stuckTimerRef.current = null; }
      }
    };
    const onDurationChange = () => {
      // Priorité absolue à la durée du probe (vraie durée depuis les métadonnées
      // du conteneur). video.duration peut être Infinity (stream ffmpeg) ou pire,
      // une valeur croissante (chunked Transfer-Encoding) → barre cassée.
      if (probeDurationRef.current > 0) {
        setDuration(probeDurationRef.current);
        setIsLive(false);
        return;
      }
      const d = video.duration;
      if (isFinite(d) && d > 0) {
        setDuration(d);
        setIsLive(false);
      } else {
        setDuration(0);
        setIsLive(true);
      }
    };
    const onProgress = () => {
      if (video.buffered.length > 0)
        setBufferedEnd(video.buffered.end(video.buffered.length - 1) + seekOffsetRef.current);
    };
    // ⚠ Tous gardés par erroredRef : après une erreur terminale, un event tardif
    // du <video> (pause/waiting/play d'un flux qui avorte) ne doit PAS sortir de
    // l'état 'error' (sinon overlay → bouton pause inerte).
    const onPlay    = () => { if (!erroredRef.current) setStatus('playing'); };
    const onPause   = () => { if (!erroredRef.current) setStatus('paused'); };
    const onWaiting = () => { if (!erroredRef.current) setStatus('buffering'); };
    const onPlaying = () => { if (!erroredRef.current) setStatus('playing'); };
    const onVolumeChange = () => {
      setVolumeState(video.volume);
      setIsMuted(video.muted);
    };
    const onError = () => {
      if (mpegtsRef.current) return;

      // Escalade transcodage : la lecture ffmpeg directe a échoué. Cause la
      // plus fréquente — un codec vidéo que le navigateur ne sait pas décoder
      // (HEVC/H.265, MPEG-2, VC-1, MPEG-4 ASP…) que `-c:v copy` laisse passer
      // tel quel dans le MP4. On retente UNE fois en demandant à ffmpeg de
      // transcoder la vidéo en H.264 (universellement décodable). Ne s'applique
      // pas aux erreurs réseau (code 2) — là le transcodage n'y changerait rien.
      const errCode = video.error?.code;
      const isDecodeError = errCode == null || errCode === 3 || errCode === 4;
      if (directSourceRef.current && !transcodeRef.current && isDecodeError) {
        transcodeRef.current = true;
        const pos = currentTimeRef.current || 0;
        const audio = Math.max(0, currentAudioRef.current);
        const doSeek = pos > 2;
        seekOffsetRef.current = doSeek ? pos : 0;
        currentTimeRef.current = pos;
        lastTimeRef.current = 0;
        console.warn(`[player] erreur lecture (code ${errCode ?? '?'}) — bascule transcodage H.264`);
        setStatus('loading');
        setSubtitleText('');
        video.src = buildStreamUrl(directSourceRef.current, audio, doSeek ? pos : undefined, true);
        video.load();
        // Le flux transcodé met plus de temps à produire sa première frame
        // (ffmpeg ré-encode la vidéo) → un seul play() peut partir avant que
        // le média soit prêt et laisser le lecteur coincé en pause. On retente
        // donc sur canplay/loadeddata, comme le chemin de chargement direct.
        const onTranscodeReady = () => {
          video.removeEventListener('canplay', onTranscodeReady);
          video.removeEventListener('loadeddata', onTranscodeReady);
          video.play().catch(() => { if (!erroredRef.current) setStatus('paused'); });
        };
        video.addEventListener('canplay', onTranscodeReady);
        video.addEventListener('loadeddata', onTranscodeReady);
        video.play().catch(() => {/* trop tôt — on retentera sur canplay */});
        return;
      }

      // Fallback silencieux : si la lecture native échoue (codec/conteneur non supporté),
      // basculer vers ffmpeg en préservant la position courante.
      const src = sourceUrlRef.current;
      if (src && !directSourceRef.current) {
        const pos = video.currentTime || 0;
        directSourceRef.current = src;
        // Base optimiste = position courante (barre correcte). Chemin de
        // repli rare (codec natif non supporté) → on ne raffine pas via
        // /api/streambase ici, l'écart résiduel ≈ 1 GOP reste réglable g/h.
        seekOffsetRef.current = pos;
        currentTimeRef.current = pos;
        const audio = Math.max(0, currentAudioRef.current);
        const url = buildStreamUrl(src, audio, pos > 2 ? pos : undefined);
        setStatus('loading');
        // Effacer le sous-titre courant : la frame affichée va être remplacée
        // par le nouveau flux ffmpeg → éviter qu'un cue obsolète persiste.
        setSubtitleText('');
        // ffmpeg met ~1-2 s à produire sa 1re frame → retenter play() sur
        // canplay/loadeddata, sinon le lecteur reste figé en pause après bascule.
        const onFfmpegReady = () => {
          video.removeEventListener('canplay', onFfmpegReady);
          video.removeEventListener('loadeddata', onFfmpegReady);
          video.play().catch(() => { if (video.paused && !erroredRef.current) setStatus('paused'); });
        };
        video.addEventListener('canplay', onFfmpegReady);
        video.addEventListener('loadeddata', onFfmpegReady);
        video.src = url;
        video.load();
        video.play().catch(() => {/* trop tôt — retry sur canplay/loadeddata */});
        return;
      }
      // Erreur TERMINALE : verrou + coupe du flux moribond. Sans ça, un event
      // tardif (canplay/play/pause du <video> en train d'avorter, ou un
      // play().catch en attente) ré-écrirait le statut → l'overlay clignote puis
      // repasse en pause. On pose erroredRef (les handlers d'events l'honorent),
      // on annule le watchdog et on détache la source.
      erroredRef.current = true;
      if (stuckTimerRef.current) { clearTimeout(stuckTimerRef.current); stuckTimerRef.current = null; }
      const finalCode = video.error?.code;
      try { video.pause(); } catch { /* */ }
      video.removeAttribute('src');
      video.load();
      setStatus('error');
      setError(`Erreur de lecture${finalCode ? ` (code ${finalCode})` : ''}`);
      // Diagnostic : la source est-elle joignable DEPUIS le serveur ? Un backend
      // hébergé sur un VPS dont l'IP (datacenter) est blacklistée par le
      // fournisseur IPTV ne peut pas récupérer le flux, alors qu'un appareil
      // sur IP résidentielle le peut. On affine le message en conséquence.
      const proxySrc = directSourceRef.current || sourceUrlRef.current;
      if (proxySrc) {
        let upstream = proxySrc;
        try {
          upstream = new URL(proxySrc, window.location.origin).searchParams.get('url') ?? proxySrc;
        } catch { /* garder tel quel */ }
        fetch(apiUrl(`/api/debug-reach?url=${encodeURIComponent(upstream)}`), {
          signal: AbortSignal.timeout(15_000),
        })
          .then((r) => r.json())
          .then((d: { ok?: boolean; status?: number }) => {
            if (d?.ok === false) {
              setError(
                "Le serveur n'arrive pas à joindre cette source — l'IP du serveur " +
                'est probablement bloquée par le fournisseur IPTV.',
              );
            } else if (d?.ok && typeof d.status === 'number' && d.status >= 400) {
              setError(`La source refuse l'accès au serveur (HTTP ${d.status}).`);
            } else if (d?.ok) {
              // Source joignable + HTTP OK, mais la lecture a quand même échoué :
              // le flux est illisible (conteneur/codec non démuxable, ou fichier
              // défectueux côté fournisseur). ffmpeg étant le démuxeur le plus
              // capable, on ne peut rien y faire — on le dit clairement plutôt
              // que de laisser un « code 4 » opaque.
              setError(
                'Cette vidéo est illisible : le flux est dans un format non ' +
                'supporté ou défectueux côté fournisseur. Essayez une autre version.',
              );
            }
          })
          .catch(() => {/* réseau/timeout — garder le message générique */});
      }
    };
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);

    // Détection des pistes natives (MP4 multi-audio / sous-titres embarqués).
    // HLS.js gère ses propres pistes via ses events — on ne lit le natif que
    // si HLS n'est pas actif, pour éviter les doublons.
    const onLoadedMetadata = () => {
      if (hlsRef.current) return; // HLS.js s'en charge via AUDIO_TRACKS_UPDATED

      const aTracks = readNativeAudioTracks(video);
      if (aTracks.length > 1) {
        setAudioTracks(aTracks);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enabledIdx = aTracks.findIndex((_, i) => (video as any).audioTracks[i]?.enabled);
        setCurrentAudio(enabledIdx >= 0 ? enabledIdx : 0);
      }

      // Désactiver TOUS les textTracks natifs : on n'utilise jamais les cues du
      // navigateur — toutes les pistes passent par /api/subtitle (extraction ffmpeg
      // depuis le fichier source). Cela évite que le navigateur affiche des
      // sous-titres natifs par-dessus notre overlay.
      for (let i = 0; i < video.textTracks.length; i++) {
        video.textTracks[i].mode = 'disabled';
      }

      // Fallback : si le probe n'a pas encore listé de sous-titres et qu'il y a
      // des textTracks natifs, les utiliser comme fallback de découverte.
      if (subtitleTracksRef.current.length === 0) {
        const sTracks = readNativeSubtitleTracks(video);
        if (sTracks.length > 0) setSubtitleTracks(sTracks);
      }
    };

    // Les pistes audio natives peuvent être ajoutées dynamiquement
    // (certains navigateurs les exposent via addtrack).
    const onAudioTrackAdd = () => {
      if (hlsRef.current) return;
      const aTracks = readNativeAudioTracks(video);
      if (aTracks.length > 1) {
        setAudioTracks(aTracks);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const enabledIdx = aTracks.findIndex((_, i) => (video as any).audioTracks[i]?.enabled);
        setCurrentAudio(enabledIdx >= 0 ? enabledIdx : 0);
      }
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('progress', onProgress);
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('error', onError);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    document.addEventListener('fullscreenchange', onFullscreenChange);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeAudioTracks = (video as any).audioTracks as ({ addEventListener: (e: string, cb: () => void) => void; removeEventListener: (e: string, cb: () => void) => void }) | undefined;
    if (nativeAudioTracks) {
      nativeAudioTracks.addEventListener('addtrack', onAudioTrackAdd);
    }

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('progress', onProgress);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('error', onError);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      if (nativeAudioTracks) {
        nativeAudioTracks.removeEventListener('addtrack', onAudioTrackAdd);
      }
      if (stuckTimerRef.current) { clearTimeout(stuckTimerRef.current); stuckTimerRef.current = null; }
    };
  }, []);

  // Synchronise subtitleTracksRef avec l'état → permet le lookup streamIndex
  // depuis setSubtitle sans dépendances stales sur le state.
  useEffect(() => {
    subtitleTracksRef.current = subtitleTracks;
  }, [subtitleTracks]);

  // Miroir du status pour les callbacks/effets (cf. statusRef).
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  // Extrait l'URL upstream réelle depuis une URL de proxy /api/hlsproxy?url=...
  // Retourne l'URL telle quelle si ce n'est pas un proxy.
  const extractUpstreamUrl = useCallback((proxyUrl: string): string => {
    try {
      const parsed = new URL(proxyUrl, window.location.origin);
      return parsed.searchParams.get('url') ?? proxyUrl;
    } catch {
      return proxyUrl;
    }
  }, []);

  // ── Sous-titres fenêtrés : fusion + fetch ──────────────────────────────────
  // Reconstruit subCuesRef à partir de toutes les fenêtres chargées de la piste
  // active (tri + dédup des cues identiques issues des zones de chevauchement).
  const rebuildActiveCues = useCallback(() => {
    const streamIdx = subActiveStreamRef.current;
    if (streamIdx < 0) { subCuesRef.current = []; return; }
    const all: VttCue[] = [];
    for (const w of subLoadedWindowsRef.current) {
      const cues = subWinCacheRef.current.get(`${streamIdx}#${w}`);
      if (cues && cues.length) all.push(...cues);
    }
    all.sort((a, b) => a.start - b.start || a.end - b.end);
    const dedup: VttCue[] = [];
    for (const c of all) {
      const p = dedup[dedup.length - 1];
      if (p && p.start === c.start && p.end === c.end && p.text === c.text) continue;
      dedup.push(c);
    }
    subCuesRef.current = dedup;
  }, []);

  // Garantit qu'une fenêtre [w] de la piste `streamIdx` est chargée. Cache hit →
  // fusion immédiate (zéro latence). Sinon fetch d'une seule tranche via /api/subtitle
  // (start/len) → ffmpeg fast-seek = cues en ~1-2 s. La fenêtre n'est fusionnée que
  // si la piste est (toujours) active à la résolution. `signal` permet d'annuler un
  // préchauffage devenu obsolète (changement de source).
  const fetchSubWindow = useCallback(
    (streamIdx: number, w: number, signal?: AbortSignal): Promise<void> => {
      const key = `${streamIdx}#${w}`;
      // Déjà connue : juste s'assurer qu'elle est fusionnée si la piste est active.
      // (chemin synchrone, AUCUNE connexion → autorisé même pendant le chargement)
      if (subWinCacheRef.current.has(key)) {
        if (subActiveStreamRef.current === streamIdx && !subLoadedWindowsRef.current.has(w)) {
          subLoadedWindowsRef.current.add(w);
          rebuildActiveCues();
        }
        return Promise.resolve();
      }
      if (subWinFetchingRef.current.has(key)) return Promise.resolve();
      // GARDE-FOU connexion : ne lancer une extraction (= ouvrir une connexion
      // upstream) QUE si la vidéo est posée (playing/paused). Pendant 'loading'
      // ou 'buffering', le flux vidéo a besoin de l'unique slot autorisé par le
      // fournisseur → on diffère. Le préchargement glissant relance dès que le
      // status repasse à 'playing' (cf. l'effet, qui dépend de `status`).
      if (statusRef.current !== 'playing' && statusRef.current !== 'paused') {
        return Promise.resolve();
      }
      const mediaUrl = mediaUrlRef.current;
      if (!mediaUrl) return Promise.resolve();

      subWinFetchingRef.current.add(key);
      const run = (): Promise<void> => {
        // Annulée entre-temps (changement de source vide le set) → ne rien faire.
        if (!subWinFetchingRef.current.has(key)) return Promise.resolve();
        // Re-vérifie le garde-fou au moment réel de l'exécution (la file a pu
        // attendre, le status a pu retomber en 'loading' suite à un seek).
        if (statusRef.current !== 'playing' && statusRef.current !== 'paused') {
          subWinFetchingRef.current.delete(key);
          return Promise.resolve();
        }
        const start = Math.max(0, w * SUB_WIN - SUB_OVERLAP);
        const len = SUB_WIN + SUB_OVERLAP * 2;
        const qs = `url=${encodeURIComponent(mediaUrl)}&track=${streamIdx}` +
          `&start=${start.toFixed(1)}&len=${len.toFixed(1)}`;
        return fetch(apiUrl(`/api/subtitle?${qs}`), signal ? { signal } : undefined)
          .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
          .then((text) => {
            // On met en cache même une fenêtre vide (scène sans dialogue) → pas de
            // refetch inutile. Un échec réseau/HTTP part dans .catch et N'est PAS
            // mis en cache → réessayable au prochain passage.
            const cues = parseVtt(text);
            subWinCacheRef.current.set(key, cues);
            if (subActiveStreamRef.current === streamIdx) {
              subLoadedWindowsRef.current.add(w);
              rebuildActiveCues();
            }
          })
          .catch(() => {/* abort/réseau : ne pas marquer chargée → retry possible */})
          .finally(() => { subWinFetchingRef.current.delete(key); });
      };
      // Sérialisation : enchaîne après l'extraction précédente → au plus une
      // connexion sous-titres simultanée (jamais une rafale fenêtre + lookahead).
      const p = subFetchChainRef.current.then(run, run);
      subFetchChainRef.current = p.catch(() => {});
      return p;
    },
    [rebuildActiveCues],
  );

  // Lance ffprobe sur le fichier média + met à jour les pistes audio / sous-titres / durée.
  // Toujours appelé après loadSource, peu importe le mode de lecture (HLS ou direct).
  const runProbe = useCallback((probeSource: string) => {
    if (!probeSource) return;
    probeUrl(probeSource).then((probe) => {
      // Durée : priorité au probe (vraie durée du fichier)
      if (probe.duration && probe.duration > 0) {
        probeDurationRef.current = probe.duration;
        setDuration(probe.duration);
        setIsLive(false);
      }

      // Pistes audio : uniquement en mode ffmpeg direct (HLS.js gère les siennes)
      if (!hlsRef.current && probe.audio.length > 0) {
        const tracks: AudioTrack[] = probe.audio.map((t) => ({
          index: t.index,
          name: t.title || t.language || `Audio ${t.index + 1}`,
          language: t.language,
        }));
        setAudioTracks(tracks);
        // Le probe résout de façon asynchrone (ffprobe lit le fichier) : il peut
        // arriver APRÈS un changement de piste (reprise ou choix utilisateur).
        // Ne pas réinitialiser à 0 si une sélection valide est déjà active,
        // sinon l'UI repasse sur la piste par défaut alors que le flux ffmpeg
        // joue déjà la bonne piste.
        const sel = currentAudioRef.current;
        const keep = sel >= 0 && sel < tracks.length;
        setCurrentAudio(keep ? sel : 0);
        currentAudioRef.current = keep ? sel : 0;

        // Filet anti-silence (lecture NATIVE directe uniquement) : un audio non
        // décodable par le navigateur (AC3/EAC3/DTS…) produit une vidéo SANS
        // erreur mais MUETTE. Le probe révèle le codec → si la piste active n'est
        // pas AAC/MP3/Opus/FLAC, on bascule sur ffmpeg (transcode AAC) à la
        // position courante. En mode ffmpeg (directSourceRef déjà posé) → no-op.
        const activeIdx = keep ? sel : 0;
        const codec = (probe.audio[activeIdx]?.codec ?? '').toLowerCase();
        const browserAudioOk = ['aac', 'mp3', 'opus', 'flac'].includes(codec);
        const probeVideo = videoRef.current;
        if (!directSourceRef.current && sourceUrlRef.current && probeVideo && !browserAudioOk) {
          const fSrc = sourceUrlRef.current;
          const pos = currentTimeRef.current || probeVideo.currentTime || 0;
          directSourceRef.current = fSrc;
          seekOffsetRef.current = pos;
          currentTimeRef.current = pos;
          setStatus('loading');
          setSubtitleText('');
          const onAacReady = () => {
            probeVideo.removeEventListener('canplay', onAacReady);
            probeVideo.removeEventListener('loadeddata', onAacReady);
            probeVideo.play().catch(() => { if (probeVideo.paused) setStatus('paused'); });
          };
          probeVideo.addEventListener('canplay', onAacReady);
          probeVideo.addEventListener('loadeddata', onAacReady);
          probeVideo.src = buildStreamUrl(fSrc, activeIdx, pos > 2 ? pos : undefined);
          probeVideo.load();
          probeVideo.play().catch(() => {/* retry sur canplay/loadeddata */});
        }
      }

      // Pistes de sous-titres : TOUJOURS depuis le probe (source de vérité unique)
      // → comportement identique en mode HLS ou direct.
      if (probe.subtitles.length > 0) {
        const subTracks: SubtitleTrack[] = probe.subtitles.map((t) => ({
          index: t.index,
          streamIndex: t.streamIndex, // index absolu pour ffmpeg
          name: t.title || t.language || `Sous-titres ${t.index + 1}`,
          language: t.language,
        }));
        // Mise à jour SYNCHRONE du ref avant le setState : garantit que setSubtitle()
        // appelé depuis l'effet de reprise trouve toujours le ref à jour, même si le
        // useEffect de sync (subtitleTracksRef.current = subtitleTracks) court après
        // l'effet de reprise dans le même cycle de rendu (timing serré avec probe cachée).
        subtitleTracksRef.current = subTracks;
        setSubtitleTracks(subTracks);

        // Préchauffage : on ne charge plus des pistes ENTIÈRES (chaque
        // /api/subtitle lisait alors tout le fichier distant → goulot + connexion
        // monopolisée). On préchauffe UNE fenêtre — celle autour de la position
        // courante — de la seule piste prioritaire (déjà sélectionnée > française
        // > première). Ainsi le 1er clic « sous-titres » trouve un cache hit et
        // s'affiche instantanément, sans concurrencer le flux /api/stream.
        subPrefetchAbortRef.current?.abort();
        if (subPrefetchTimerRef.current !== null) {
          clearTimeout(subPrefetchTimerRef.current);
        }
        const ac = new AbortController();
        subPrefetchAbortRef.current = ac;

        const isFrench = (t: SubtitleTrack) =>
          /\b(fr|fre|fra|french|fran[cç]ais|vff?|vostfr|truefrench)\b/i.test(
            `${t.language} ${t.name}`,
          );
        const ordered = [...subTracks].sort((a, b) => {
          const rank = (t: SubtitleTrack) =>
            t.index === currentSubRef.current ? 0 : isFrench(t) ? 1 : 2;
          return rank(a) - rank(b);
        });
        const warmTrack = ordered[0];

        // Délai court (1.2 s) : laisser le flux vidéo s'établir avant d'ouvrir la
        // connexion sous-titres. Si l'utilisateur clique une piste avant, setSubtitle
        // fetch la fenêtre à la demande (la déduplication in-flight serveur évite
        // tout double travail).
        subPrefetchTimerRef.current = setTimeout(() => {
          subPrefetchTimerRef.current = null;
          if (ac.signal.aborted || !warmTrack) return;
          const w = subWindowIndex(currentTimeRef.current);
          void fetchSubWindow(warmTrack.streamIndex, w, ac.signal);
        }, 1200);
      }
    }).catch(() => {/* probe échoue silencieusement — fallback sur les pistes natives */});
  }, [fetchSubWindow]);

  const loadSource = useCallback((src: string) => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (mpegtsRef.current) { mpegtsRef.current.destroy(); mpegtsRef.current = null; }
    sourceUrlRef.current = null;
    directSourceRef.current = null;
    transcodeRef.current = false;
    mediaUrlRef.current = null;
    probeDurationRef.current = 0;
    seekOffsetRef.current = 0;
    currentAudioRef.current = 0;
    currentTimeRef.current = 0;
    lastTimeRef.current = 0;
    // Vider les sous-titres parsés et tous les caches de fenêtres
    subCuesRef.current = [];
    subWinCacheRef.current.clear();
    subWinFetchingRef.current.clear();
    subActiveStreamRef.current = -1;
    subLoadedWindowsRef.current.clear();
    currentSubRef.current = -1;
    subtitleTracksRef.current = [];
    // Couper tout préchauffage de sous-titres de la source précédente
    // (sinon des ffmpeg continuent de tourner pour une vidéo abandonnée).
    subPrefetchAbortRef.current?.abort();
    subPrefetchAbortRef.current = null;
    if (subPrefetchTimerRef.current !== null) {
      clearTimeout(subPrefetchTimerRef.current);
      subPrefetchTimerRef.current = null;
    }
    Array.from(video.querySelectorAll('track')).forEach((t) => t.remove());
    setSubtitleText('');
    setSubtitleLoading(false);

    setStatus('loading');
    setError(null);
    setCurrentTime(0);
    setDuration(0);
    setBufferedEnd(0);
    setLevels([]);
    setCurrentLevelState(-1);
    setIsLive(false);
    setAudioTracks([]);
    setCurrentAudio(-1);
    setSubtitleTracks([]);
    setCurrentSubtitle(-1);

    // Détermine l'URL upstream pour le probe et l'extraction de sous-titres.
    // Priorité : mediaUrl fourni explicitement (typiquement le fichier direct MKV/MP4)
    // > extraction depuis l'URL de proxy de la lecture courante.
    // → Garantit que les sous-titres sont disponibles en mode HLS comme direct.
    const probeSource = mediaUrl
      ? extractUpstreamUrl(mediaUrl)
      : extractUpstreamUrl(src);
    mediaUrlRef.current = probeSource;

    // Détection live : pilote la tuning HLS (retries, buffer) et l'évitement
    // du probe (inutile pour live — pas de durée, pas de sous-titres, économie
    // de bande passante + démarrage plus rapide).
    const isLiveStream =
      src.startsWith(apiUrl('/api/liveproxy')) ||
      /\/live\//.test(extractUpstreamUrl(src)) ||
      /\/live\//.test(probeSource);

    // (Ré)arme le watchdog "flux illisible" pour ce VOD. Jamais en live (un flux
    // live n'a pas de durée et "stalle" légitimement au démarrage). Disarmé dès
    // la 1re progression réelle (onTimeUpdate) ou par l'event 'error' (onError).
    everPlayedRef.current = false;
    erroredRef.current = false;
    if (stuckTimerRef.current) { clearTimeout(stuckTimerRef.current); stuckTimerRef.current = null; }
    if (!isLiveStream) {
      stuckTimerRef.current = setTimeout(() => {
        stuckTimerRef.current = null;
        const v = videoRef.current;
        // Déjà en lecture, ou assez de données bufferisées pour jouer (= flux sain
        // simplement en pause utilisateur) → ne rien faire. Un flux illisible reste
        // à readyState bas (0-2 : au plus une frame décodée) et n'a jamais progressé.
        if (!v || everPlayedRef.current || erroredRef.current || v.readyState >= 3) return;
        // Erreur TERMINALE collante (cf. onError) : verrou + coupe de la source
        // pour stopper les tentatives en cours et empêcher tout retour en pause.
        erroredRef.current = true;
        try { v.pause(); } catch { /* */ }
        v.removeAttribute('src');
        v.load();
        setStatus('error');
        setError(
          'Cette vidéo est illisible : le flux est dans un format non ' +
          'supporté ou défectueux côté fournisseur. Essayez une autre version.',
        );
      }, STUCK_DETECT_MS);
    }

    const tryPlay = () => {
      video.play().catch(() => {
        if (!erroredRef.current) setStatus('paused');
      });
    };

    // Stream MPEG-TS live continu via /api/liveproxy
    if (src.startsWith(apiUrl('/api/liveproxy')) && mpegts.isSupported()) {
      setIsLive(true);
      const absoluteSrc = src.startsWith('http') ? src : `${window.location.origin}${src}`;
      const player = mpegts.createPlayer(
        { type: 'mpegts', url: absoluteSrc, isLive: true, hasAudio: true, hasVideo: true },
        {
          enableWorker: true,
          enableStashBuffer: true,
          // Démarrage plus rapide : 128 KB suffisent pour un flux IPTV typique
          // (~1-2 s de buffer initial vs 3-5 s à 384 KB). Le live latency chasing
          // ci-dessous compense la marge de jitter restante.
          stashInitialSize: 128 * 1024,
          autoCleanupSourceBuffer: true,
          autoCleanupMinBackwardDuration: 15,
          autoCleanupMaxBackwardDuration: 30,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 12.0,
          liveBufferLatencyMinRemain: 6.0,
          fixAudioTimestampGap: true,
        },
      );
      mpegtsRef.current = player;
      player.attachMediaElement(video);

      player.on(mpegts.Events.ERROR, (_type: string, data: object) => {
        setStatus('error');
        setError(`Erreur stream : ${JSON.stringify(data)}`);
      });

      player.on(mpegts.Events.MEDIA_INFO, () => {
        if (mpegtsRef.current === player && video.paused) tryPlay();
      });

      player.load();
      tryPlay();
      return;
    }

    if (isHlsUrl(src) && Hls.isSupported()) {
      // Config HLS distincte pour live vs VOD :
      // - VOD : peu de retries (échec rapide → bascule sur fichier direct), gros buffer
      // - Live : retries généreux (3 s de tolérance réseau), buffer court (faible
      //   latence), traitement infini, pas de prefetch (chaque seek=nouveau live)
      const hls = new Hls(isLiveStream ? {
        enableWorker: true,
        liveDurationInfinity: true,
        maxBufferLength: 10,
        maxMaxBufferLength: 30,
        backBufferLength: 30,
        // Note : `liveMaxLatencyDurationCount` peut paraître séduisant (saut
        // auto au live edge si on dérive trop) mais hls.js 1.6 a une validation
        // stricte vs `liveSyncDurationCount` qui plante au boot. Le watchdog JS
        // ci-dessous couvre le même cas de manière plus robuste.
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 500,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 500,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 500,
        // Cap total : ne pas s'acharner plus de 8 s sur un même segment
        maxLoadingDelay: 8,
      } : {
        enableWorker: true,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        startFragPrefetch: true,
        manifestLoadingMaxRetry: 0,
        levelLoadingMaxRetry: 0,
        fragLoadingMaxRetry: 2,
      });
      hlsRef.current = hls;
      if (isLiveStream) setIsLive(true);

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        const qualityLevels: QualityLevel[] = data.levels.map((l, i) => ({
          index: i,
          label: l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)} kbps`,
          bitrate: l.bitrate,
        }));
        setLevels(qualityLevels);
        tryPlay();
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
        setCurrentLevelState(data.level);
      });

      // Pistes audio HLS (EXT-X-MEDIA TYPE=AUDIO)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data: any) => {
        const list = (data.audioTracks ?? []) as { name?: string; lang?: string }[];
        const tracks: AudioTrack[] = list.map((t, i) => ({
          index: i,
          name: t.name || t.lang || `Audio ${i + 1}`,
          language: t.lang || '',
        }));
        setAudioTracks(tracks);
        if (tracks.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const hlsAny = hls as any;
          // Force track 0 si HLS.js n'en a pas sélectionné
          if (hlsAny.audioTrack === -1) hlsAny.audioTrack = 0;
          setCurrentAudio(Math.max(0, hlsAny.audioTrack ?? 0));
        }
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_, data: any) => {
        setCurrentAudio(data.id ?? 0);
      });

      // Note : pas de handlers SUBTITLE_TRACKS_UPDATED / SUBTITLE_TRACK_SWITCH ici.
      // Les sous-titres sont TOUJOURS extraits du fichier source via /api/subtitle
      // (cf. runProbe + setSubtitle) → comportement déterministe et indépendant
      // du fait que la lecture passe par HLS ou par ffmpeg direct.
      // On désactive aussi tous les textTracks éventuellement créés par HLS.js
      // pour éviter qu'ils s'affichent par-dessus notre overlay.
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        for (let i = 0; i < video.textTracks.length; i++) {
          video.textTracks[i].mode = 'disabled';
        }
      });

      // Compteur de récupération auto sur erreur fatale (live uniquement).
      // Au-delà, on bascule sur l'UI d'erreur (qui déclenchera le fallback .ts).
      let liveRecoveryAttempts = 0;
      const MAX_LIVE_RECOVERY = 2;

      hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal) return;

        // MANIFEST_PARSING_ERROR : flux indisponible côté serveur (cf. hlsproxy).
        // Le proxy renvoie un manifest vide volontairement quand l'upstream
        // refuse — pas de recovery possible, on bascule directement.
        const isServerRejection = data.details === Hls.ErrorDetails.MANIFEST_PARSING_ERROR;

        // Pour live : tenter une récupération auto avant de basculer sur le
        // fallback .ts. HLS.js sait recoverer la plupart des erreurs réseau
        // (segment perdu, glitch de manifest) et média (decoder hiccup).
        if (isLiveStream && !isServerRejection && liveRecoveryAttempts < MAX_LIVE_RECOVERY) {
          liveRecoveryAttempts++;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError();
            return;
          }
        }

        setStatus('error');
        setError(
          isServerRejection
            ? 'Flux indisponible (trop de connexions simultanées ou source inaccessible)'
            : `Erreur HLS : ${data.details}`,
        );
      });

      // Probe : SAUTÉ pour live (pas de durée à afficher, pas de sous-titres
      // attendus, pas de switch audio fréquent → économie ffprobe + bande
      // passante + démarrage plus rapide).
      if (!isLiveStream) runProbe(probeSource);
      return;
    }

    // Safari – HLS natif
    if (isHlsUrl(src) && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      tryPlay();
      return;
    }

    // ── Fichier direct (mkv, mp4…) ─────────────────────────────────────────
    // Stratégie : passer systématiquement par ffmpeg (/api/stream → MP4 fragmenté
    // avec audio AAC). Déterministe : durée correcte (depuis le probe), seek qui
    // fonctionne (redémarrage avec -ss), audio universel, sélection de pistes.
    sourceUrlRef.current = src;

    const loadDirect = (streamSrc: string) => {
      video.src = streamSrc;
      video.load();
      const onCanPlay = () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('loadeddata', onLoadedData);
        tryPlay();
      };
      const onLoadedData = () => {
        video.removeEventListener('loadeddata', onLoadedData);
        video.removeEventListener('canplay', onCanPlay);
        tryPlay();
      };
      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('loadeddata', onLoadedData);
    };

    // ── Démarrage : lecture DIRECTE si le conteneur est décodable nativement ──
    // mp4/m4v/mov ≈ H.264/AAC → Chromium les lit directement. On sert le fichier
    // via /api/hlsproxy (passthrough Range → seek natif + démarrage quasi
    // instantané, comme l'app native) au lieu de tout remuxer par ffmpeg.
    // Replis AUTOMATIQUES (état de secours = chemin ffmpeg actuel) :
    //   • vidéo non décodable (HEVC/MKV déguisé) → `onError` bascule sur ffmpeg ;
    //   • audio non décodable (AC3/DTS, sans erreur émise) → `runProbe` le détecte
    //     via le codec et bascule (filet anti-silence).
    // Les autres conteneurs (mkv/ts/avi…) passent direct par ffmpeg (déterministe,
    // pas de tentative vaine).
    const fileUrl = extractUpstreamUrl(src);
    if (/\.(mp4|m4v|mov)(\?|$)/i.test(fileUrl)) {
      directSourceRef.current = null; // mode NATIF — pas (encore) ffmpeg
      loadDirect(apiUrl(`/api/hlsproxy?url=${encodeURIComponent(fileUrl)}`));
    } else {
      directSourceRef.current = src;  // ffmpeg direct (remux → MP4 fragmenté AAC)
      loadDirect(buildStreamUrl(src, 0));
    }

    // Probe en parallèle : durée réelle + pistes audio/sous-titres depuis ffprobe
    runProbe(probeSource);
  }, [mediaUrl, extractUpstreamUrl, runProbe]);

  useEffect(() => {
    if (!url) {
      setStatus('idle');
      return;
    }

    loadSource(url);

    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (mpegtsRef.current) { mpegtsRef.current.destroy(); mpegtsRef.current = null; }
      subPrefetchAbortRef.current?.abort();
      if (subPrefetchTimerRef.current !== null) {
        clearTimeout(subPrefetchTimerRef.current);
        subPrefetchTimerRef.current = null;
      }
      const video = videoRef.current;
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
    };
  }, [url, loadSource]);

  // ── Boucle d'affichage des sous-titres ────────────────────────────────────
  // requestAnimationFrame (~60Hz) pour des transitions de cue à la frame près
  // (timeupdate ne fire qu'à ~4Hz → impression de retard).
  //
  // Source unique : subCuesRef → cues extraites du fichier source via /api/subtitle.
  // Identique en mode HLS ou ffmpeg direct → comportement déterministe.
  //
  // Temps réel = video.currentTime
  //            + seekOffsetRef (keyframe K réelle de démarrage du flux ffmpeg,
  //              corrigée via /api/streambase → aligné sur l'image ; 0 en
  //              HLS / natif où la timeline est déjà absolue)
  //            + subOffsetRef (réglage utilisateur g/h pour corriger une désync)
  //
  // Recherche : binaire (O(log n)) → optimal même sur fichiers à milliers de cues.
  // Hint d'index : la dernière cue trouvée est souvent voisine → on commence par là.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let rafId = 0;
    let lastShown = '';
    let lastIdx = 0; // hint : dernière cue active (cas linéaire courant)

    const tick = () => {
      let next = '';
      const cues = subCuesRef.current;

      if (currentSubRef.current >= 0 && cues.length > 0) {
        const realTime = video.currentTime + seekOffsetRef.current + subOffsetRef.current;

        // 1. Vérifier d'abord la dernière cue active et ses voisines (cas courant)
        let found = -1;
        for (let i = Math.max(0, lastIdx - 1); i < Math.min(cues.length, lastIdx + 3); i++) {
          const c = cues[i];
          if (realTime >= c.start && realTime <= c.end) { found = i; break; }
        }

        // 2. Sinon recherche binaire (seek important ou démarrage)
        if (found === -1) {
          let lo = 0, hi = cues.length - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const c = cues[mid];
            if (realTime < c.start) hi = mid - 1;
            else if (realTime > c.end) lo = mid + 1;
            else { found = mid; break; }
          }
        }

        if (found !== -1) {
          next = cues[found].text;
          lastIdx = found;
        }
      }

      if (next !== lastShown) {
        lastShown = next;
        setSubtitleText(next);
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(rafId);
  }, []);

  // ── Préchargement glissant des fenêtres de sous-titres ─────────────────────
  // À mesure que la lecture avance (currentTime, mis à jour ~4 Hz), on garde la
  // fenêtre courante + SUB_LOOKAHEAD fenêtres suivantes chargées pour la piste
  // active → les sous-titres ne « s'arrêtent » jamais en bord de fenêtre, et un
  // seek hors zone charge la nouvelle fenêtre dès le tick suivant (~250 ms).
  // fetchSubWindow court-circuite si la fenêtre est déjà connue/en cours → ce
  // passage 4×/s est quasi gratuit.
  useEffect(() => {
    if (currentSubtitle < 0) return;
    // Tant que la vidéo s'établit, on ne lance rien (le garde-fou de fetchSubWindow
    // diffère de toute façon) — mais on dépend de `status` pour RE-déclencher cet
    // effet dès que la lecture démarre (passage à 'playing'), sinon les fenêtres
    // différées au démarrage ne seraient jamais relancées avant le prochain tick.
    if (status !== 'playing' && status !== 'paused') return;
    const streamIdx = subActiveStreamRef.current;
    if (streamIdx < 0) return;
    const w = subWindowIndex(currentTime + subOffsetRef.current);
    void fetchSubWindow(streamIdx, w);
    for (let k = 1; k <= SUB_LOOKAHEAD; k++) void fetchSubWindow(streamIdx, w + k);
  }, [currentTime, currentSubtitle, status, fetchSubWindow]);

  // --- Contrôles ---

  // Après un restart ffmpeg avec seek, seekOffsetRef est posé de façon
  // optimiste = position demandée (barre ≈ correcte immédiatement). Mais
  // ffmpeg démarre en réalité à la keyframe K <= position (copie vidéo). On
  // demande K au serveur (/api/streambase) et on corrige seekOffsetRef → image,
  // barre et sous-titres parfaitement alignés. Garde-fou seekGen : si
  // l'utilisateur a re-seeké entre-temps, la réponse obsolète est ignorée.
  const correctSeekBase = useCallback((proxySrc: string, requestedPos: number, gen: number) => {
    const upstream = extractUpstreamUrl(proxySrc);
    const seekStr = requestedPos.toFixed(1); // même arrondi que buildStreamUrl
    fetch(apiUrl(`/api/streambase?url=${encodeURIComponent(upstream)}&seek=${seekStr}`), {
      signal: AbortSignal.timeout(20_000),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { base?: number }) => {
        if (seekGenRef.current !== gen) return; // seek obsolète
        const base = typeof data.base === 'number' && isFinite(data.base) ? data.base : 0;
        if (base <= 0) return; // probe échoué → garder la base optimiste
        seekOffsetRef.current = base;
        const video = videoRef.current;
        if (video) {
          const ct = video.currentTime + base;
          currentTimeRef.current = ct;
          setCurrentTime(ct);
        }
      })
      .catch(() => {/* garder la base optimiste (≈ position demandée) */});
  }, [extractUpstreamUrl]);

  // Saut au live edge — utilisé après un stall ou un long onglet inactif
  // pour ne pas reprendre 30 s en retard. `minBehind` configure le seuil
  // au-dessus duquel on saute, sinon on respecte la position courante.
  const seekToLiveEdge = useCallback((minBehind = 3) => {
    const video = videoRef.current;
    if (!video || video.seekable.length === 0) return;
    const edge = video.seekable.end(video.seekable.length - 1);
    if (edge - video.currentTime > minBehind) {
      video.currentTime = Math.max(0, edge - 2);
    }
  }, []);

  // Distingue pause utilisateur (intentionnelle) vs pause système (buffer vide).
  // Chrome peut firer 'pause' sur un buffer underrun → sans ce flag, le watchdog
  // ne pourrait pas distinguer et soit relancerait l'utilisateur (mauvais), soit
  // ne récupérerait jamais le stall (mauvais aussi).
  const userPausedRef = useRef(false);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      userPausedRef.current = false;
      // Live : rejoindre le live edge si on a accumulé du retard
      // (cas typique : reprise après un stall ou un onglet inactif).
      if (isLive) {
        seekToLiveEdge(3);
        try { hlsRef.current?.startLoad(); } catch { /* */ }
      }
      video.play().catch(() => {});
    } else {
      userPausedRef.current = true;
      video.pause();
    }
  }, [isLive, seekToLiveEdge]);

  // Watchdog stall pour le live : si la vidéo reste bloquée (waiting/stalled)
  // pendant 4 s, sauter au live edge et redemander à HLS de charger.
  // Évite le scénario : coupure réseau brève → buffer vide → vidéo gelée
  // alors que le live a continué d'avancer côté serveur.
  useEffect(() => {
    if (!isLive) return;
    const video = videoRef.current;
    if (!video) return;

    let stallTimer: ReturnType<typeof setTimeout> | null = null;

    const recover = () => {
      // Ne pas écraser une pause intentionnelle de l'utilisateur.
      if (userPausedRef.current) return;
      seekToLiveEdge(3);
      try { hlsRef.current?.startLoad(); } catch { /* */ }
      video.play().catch(() => {/* tab inactive — ignore */});
    };

    const armStall = () => {
      if (userPausedRef.current) return; // l'utilisateur contrôle
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(recover, 4000);
    };
    const cancelStall = () => {
      if (stallTimer) { clearTimeout(stallTimer); stallTimer = null; }
    };

    // 'waiting' = buffer vide, 'stalled' = chargement bloqué.
    // On NE cancel PAS sur 'pause' : Chrome peut firer 'pause' en cas
    // d'underrun ; on cancel uniquement quand la lecture redémarre vraiment.
    video.addEventListener('waiting', armStall);
    video.addEventListener('stalled', armStall);
    video.addEventListener('playing', cancelStall);

    return () => {
      cancelStall();
      video.removeEventListener('waiting', armStall);
      video.removeEventListener('stalled', armStall);
      video.removeEventListener('playing', cancelStall);
    };
  }, [isLive, seekToLiveEdge]);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (directSourceRef.current) {
      const src = directSourceRef.current;
      const audio = Math.max(0, currentAudioRef.current);
      const maxTime = probeDurationRef.current;
      const clampedTime = Math.max(0, maxTime > 0 ? Math.min(time, maxTime) : time);

      // Position dans le flux courant = position absolue - base du flux.
      // video.buffered est 0-based sur la keyframe de départ → on compare
      // dans ce repère. Si déjà bufferisé → seek natif instantané, pas de
      // rechargement ffmpeg (couvre ±10s, petits ajustements, retours arrière).
      const targetVideoTime = clampedTime - seekOffsetRef.current;
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (targetVideoTime >= start - 0.5 && targetVideoTime <= end) {
          video.currentTime = Math.max(0, targetVideoTime);
          return;
        }
      }

      // Sinon : redémarrer ffmpeg à la nouvelle position.
      const myGen = ++seekGenRef.current;
      // Base optimiste = position demandée (barre ≈ correcte tout de suite),
      // puis corrigée sur la vraie keyframe K via /api/streambase.
      seekOffsetRef.current = clampedTime;
      currentTimeRef.current = clampedTime;
      lastTimeRef.current = 0;
      setCurrentTime(clampedTime);
      setStatus('loading');
      // Effacer le sous-titre courant : la frame à l'écran est encore l'ancienne
      // position → éviter qu'un cue obsolète reste pendant le rechargement.
      setSubtitleText('');

      const doSeek = clampedTime > 0.5;
      const url = buildStreamUrl(src, audio, doSeek ? clampedTime : undefined, transcodeRef.current);
      if (doSeek) correctSeekBase(src, clampedTime, myGen);
      else seekOffsetRef.current = 0; // pas de -ss côté serveur → flux à 0
      video.src = url;
      video.load();
      // Tenter play() immédiatement : les navigateurs modernes queuent l'appel
      // jusqu'à ce que le média soit prêt. C'est plus simple et plus fiable que
      // d'attendre loadedmetadata (qui peut ne pas firer fiablement pour les MP4
      // fragmentés avec empty_moov).
      // Le check seekGen évite que les play() en attente d'un seek obsolète
      // rejettent et bloquent l'UI quand on enchaîne plusieurs seeks rapidement.
      video.play().catch(() => {
        if (seekGenRef.current === myGen && video.paused) setStatus('paused');
      });
      return;
    }

    video.currentTime = Math.max(0, Math.min(time, video.duration || 0));
  }, [correctSeekBase]);

  const setVolume = useCallback((v: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = Math.max(0, Math.min(1, v));
    video.muted = false;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }, []);

  const setLevel = useCallback((level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentLevelState(level);
    }
  }, []);

  // Lance la lecture dès que le flux ffmpeg rechargé est prêt (canplay /
  // loadeddata), en ignorant un rechargement obsolète (myGen). Sans ça, un
  // play() lancé juste après video.load() — avant que ffmpeg ait produit sa
  // 1re frame — échoue et laisse le lecteur figé en pause : c'est la « pause
  // non voulue » après un changement de piste audio. Même pattern que la
  // bascule transcodage H.264 (cf. onError).
  const playWhenReady = useCallback((video: HTMLVideoElement, myGen: number) => {
    const handler = () => {
      video.removeEventListener('canplay', handler);
      video.removeEventListener('loadeddata', handler);
      if (seekGenRef.current !== myGen) return; // un autre rechargement a pris le relais
      video.play().catch(() => {
        if (seekGenRef.current === myGen && video.paused) setStatus('paused');
      });
    };
    video.addEventListener('canplay', handler);
    video.addEventListener('loadeddata', handler);
    // Tentative immédiate (cas où le flux est déjà prêt) ; sinon on retentera.
    video.play().catch(() => {/* trop tôt — retry sur canplay/loadeddata */});
  }, []);

  const setAudio = useCallback((index: number) => {
    // HLS.js
    if (hlsRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (hlsRef.current as any).audioTrack = index;
      setCurrentAudio(index);
      return;
    }

    // Mode ffmpeg actif → recharger /api/stream avec la nouvelle piste audio
    const ffmpegSrc = directSourceRef.current;
    if (ffmpegSrc) {
      const video = videoRef.current;
      if (!video) return;
      const myGen = ++seekGenRef.current;
      const currentPos = currentTimeRef.current;
      setCurrentAudio(index);
      currentAudioRef.current = index;
      // Base optimiste = position courante, corrigée sur K via /api/streambase.
      seekOffsetRef.current = currentPos;
      setStatus('loading');
      // Effacer le sous-titre courant : ffmpeg redémarre à la keyframe la plus
      // proche → la frame affichée va changer, ne pas laisser un cue obsolète.
      setSubtitleText('');
      const doSeek = currentPos > 2;
      const streamUrl = buildStreamUrl(ffmpegSrc, index, doSeek ? currentPos : undefined, transcodeRef.current);
      if (doSeek) correctSeekBase(ffmpegSrc, currentPos, myGen);
      else seekOffsetRef.current = 0;
      video.src = streamUrl;
      video.load();
      playWhenReady(video, myGen);
      return;
    }

    // Mode natif sur fichier direct : Chrome n'expose pas le switch multi-audio.
    // Basculer vers ffmpeg avec la piste choisie, en préservant la position.
    const nativeSrc = sourceUrlRef.current;
    if (nativeSrc) {
      const video = videoRef.current;
      if (!video) return;
      const myGen = ++seekGenRef.current;
      const currentPos = video.currentTime || 0;
      directSourceRef.current = nativeSrc;
      currentAudioRef.current = index;
      currentTimeRef.current = currentPos;
      seekOffsetRef.current = currentPos;
      setCurrentAudio(index);
      setStatus('loading');
      // Effacer le sous-titre courant pendant la bascule natif → ffmpeg.
      setSubtitleText('');
      const doSeek = currentPos > 2;
      const streamUrl = buildStreamUrl(nativeSrc, index, doSeek ? currentPos : undefined, transcodeRef.current);
      if (doSeek) correctSeekBase(nativeSrc, currentPos, myGen);
      else seekOffsetRef.current = 0;
      video.src = streamUrl;
      video.load();
      playWhenReady(video, myGen);
      return;
    }

    // Pistes audio natives (MP4 — Chrome ne supporte pas mais Firefox/Safari oui)
    const video = videoRef.current;
    if (video) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (video as any).audioTracks as ({ length: number; [i: number]: { enabled: boolean } }) | undefined;
      if (list) {
        for (let i = 0; i < list.length; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (list[i] as any).enabled = i === index;
        }
      }
    }
    setCurrentAudio(index);
  }, [correctSeekBase, playWhenReady]);

  // Désactivation / sélection d'une piste de sous-titres.
  // index = -1 → désactivé. Sinon = index UI 0-based dans subtitleTracks.
  // Le streamIndex absolu (envoyé à ffmpeg) est récupéré depuis subtitleTracksRef.
  const setSubtitle = useCallback((index: number) => {
    setCurrentSubtitle(index);
    currentSubRef.current = index;

    const clearLoadingTimer = () => {
      if (subLoadingTimerRef.current !== null) {
        clearTimeout(subLoadingTimerRef.current);
        subLoadingTimerRef.current = null;
      }
    };

    // Désactivation
    if (index < 0) {
      subActiveStreamRef.current = -1;
      subLoadedWindowsRef.current.clear();
      subCuesRef.current = [];
      setSubtitleText('');
      setSubtitleLoading(false);
      clearLoadingTimer();
      return;
    }

    // Lookup de la piste pour récupérer le streamIndex absolu
    const track = subtitleTracksRef.current.find((t) => t.index === index);
    if (!track) {
      console.warn('[subtitle] piste introuvable pour index', index);
      setSubtitleLoading(false);
      return;
    }
    const streamIdx = track.streamIndex;

    if (!mediaUrlRef.current) {
      console.warn('[subtitle] mediaUrl non défini — extraction impossible');
      setSubtitleLoading(false);
      return;
    }

    // Bascule sur la nouvelle piste active : on repart d'un jeu de fenêtres vide
    // (les fenêtres restent en cache par streamIndex → ré-affichées instantanément
    // si déjà vues). rebuildActiveCues remplira subCuesRef au fil des fusions.
    subActiveStreamRef.current = streamIdx;
    subLoadedWindowsRef.current = new Set();
    subCuesRef.current = [];
    setSubtitleText('');

    // Fenêtre autour de la position de lecture courante (absolue).
    const w = subWindowIndex(currentTimeRef.current);
    const curKey = `${streamIdx}#${w}`;
    const haveCurrent = subWinCacheRef.current.has(curKey);

    clearLoadingTimer();
    // Spinner seulement si la fenêtre courante n'est pas déjà en cache. Délai de
    // 150 ms : un cache chaud (préchauffage / fenêtre déjà vue) résout avant →
    // l'utilisateur ne voit jamais l'indicateur.
    if (!haveCurrent) {
      subLoadingTimerRef.current = setTimeout(() => {
        subLoadingTimerRef.current = null;
        if (currentSubRef.current === index) setSubtitleLoading(true);
      }, 150);
    }

    // Charge la fenêtre courante (instantané si en cache) → affichage immédiat,
    // puis les fenêtres en avance pour la suite de la lecture.
    void fetchSubWindow(streamIdx, w).then(() => {
      if (currentSubRef.current === index) {
        clearLoadingTimer();
        setSubtitleLoading(false);
      }
    });
    for (let k = 1; k <= SUB_LOOKAHEAD; k++) void fetchSubWindow(streamIdx, w + k);
  }, [fetchSubWindow]);

  const toggleFullscreen = useCallback(async () => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await wrapper.requestFullscreen();
  }, []);

  const retry = useCallback(() => {
    if (url) loadSource(url);
  }, [url, loadSource]);

  // Ajuste le décalage des sous-titres (en secondes). Positif = avance les sous-titres.
  const adjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffsetState((prev) => {
      const v = Math.max(-10, Math.min(10, prev + delta));
      subOffsetRef.current = v;
      return v;
    });
  }, []);

  const setSubtitleOffset = useCallback((value: number) => {
    const v = Math.max(-10, Math.min(10, value));
    subOffsetRef.current = v;
    setSubtitleOffsetState(v);
  }, []);

  return {
    videoRef,
    wrapperRef,
    status,
    error,
    isLive,
    currentTime,
    duration,
    bufferedEnd,
    volume,
    isMuted,
    isFullscreen,
    levels,
    currentLevel,
    audioTracks,
    currentAudio,
    subtitleTracks,
    currentSubtitle,
    subtitleText,
    subtitleLoading,
    subtitleOffset,
    adjustSubtitleOffset,
    setSubtitleOffset,
    toggle,
    seek,
    setVolume,
    toggleMute,
    setLevel,
    setAudio,
    setSubtitle,
    toggleFullscreen,
    retry,
  };
}
