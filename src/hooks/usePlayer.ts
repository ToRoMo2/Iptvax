import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';

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
    const res = await fetch(`/api/probe?url=${encodeURIComponent(url)}`, {
      signal: AbortSignal.timeout(30_000),
    });
    return (await res.json()) as ProbeData;
  } catch {
    return { audio: [], subtitles: [] };
  }
}

// Build the /api/stream URL for a direct (non-HLS) source with a selected audio track
function buildStreamUrl(sourceUrl: string, audioTrack: number, seekSec?: number): string {
  // sourceUrl is already an /api/hlsproxy?url=... form
  // Extract the real upstream URL from it
  const inner = new URL(sourceUrl, window.location.origin);
  const upstream = inner.searchParams.get('url') ?? sourceUrl;
  const params = new URLSearchParams({ url: upstream, audio: String(audioTrack) });
  if (seekSec && seekSec > 0) params.set('seek', seekSec.toFixed(1));
  return `/api/stream?${params}`;
}

export type PlayerStatus = 'idle' | 'loading' | 'playing' | 'paused' | 'error' | 'buffering';

export interface QualityLevel {
  index: number;
  label: string;
  bitrate: number;
}

export interface AudioTrack {
  index: number;
  name: string;
  language: string;
}

export interface SubtitleTrack {
  index: number;        // index 0-based dans notre liste UI (après filtrage)
  streamIndex: number;  // index absolu du stream dans le fichier (envoyé à ffmpeg)
  name: string;
  language: string;
}

function isHlsUrl(url: string) {
  return url.includes('.m3u8');
}

// ── Parser WebVTT robuste ─────────────────────────────────────────────────
// On fetch et parse les sous-titres nous-mêmes plutôt que d'utiliser <track> :
// les éléments <track> ont des bugs de timing dans Chrome (mode='hidden' ne
// déclenche pas toujours le fetch, track.cues reste vide…).
// Le parser doit gérer toutes les variantes que ffmpeg peut produire :
// WebVTT, SRT (virgules), tags ASS, voice tags, entités HTML, BOM, CRLF.
interface VttCue { start: number; end: number; text: string; }

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
  const normalized = text.replace(/^﻿/, '').replace(/\r\n|\r/g, '\n');
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
    if (cleaned) cues.push({ start, end, text: cleaned });
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

export function usePlayer(url: string | null, mediaUrl?: string | null) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<mpegts.Player | null>(null);
  // URL proxy de la source courante (gardée pour pouvoir basculer vers /api/stream)
  const sourceUrlRef = useRef<string | null>(null);
  // Si non-null → on est en mode ffmpeg (/api/stream) ; null → lecture native via hlsproxy
  const directSourceRef = useRef<string | null>(null);
  // URL upstream du fichier média (MKV/MP4) — TOUJOURS utilisée pour le probe ffprobe
  // et l'extraction des sous-titres, peu importe que la lecture passe par HLS ou ffmpeg.
  // C'est la seule source de vérité pour les sous-titres → comportement déterministe.
  const mediaUrlRef = useRef<string | null>(null);
  // Durée réelle du fichier (depuis ffprobe) — video.duration est Infinity pour les streams ffmpeg
  const probeDurationRef = useRef(0);
  // Offset de seek : quand on redémarre ffmpeg à la position X, video.currentTime repart de 0
  // mais on affiche currentTime + seekOffset pour montrer la vraie position dans le fichier
  const seekOffsetRef = useRef(0);
  // Refs pour accéder aux valeurs courantes dans les callbacks sans dépendances stales
  const currentAudioRef = useRef(0);
  const currentTimeRef = useRef(0);
  // Compteur de seeks pour invalider les listeners obsolètes (seeks rapides successifs)
  const seekGenRef = useRef(0);
  // Sous-titres : cues parsées de la piste active (mises à jour quand l'utilisateur change)
  const subCuesRef = useRef<VttCue[]>([]);
  // Cache par streamIndex absolu pour éviter de re-télécharger en switchant entre pistes
  const subCuesCacheRef = useRef<Map<number, VttCue[]>>(new Map());
  // Index UI (0-based) de la piste courante — sert à valider les fetch asynchrones
  const currentSubRef = useRef(-1);
  // Décalage utilisateur en secondes (positif = sous-titres plus tôt)
  const subOffsetRef = useRef(0);
  // Liste courante des pistes de sous-titres — ref pour lookup streamIndex sans re-render
  const subtitleTracksRef = useRef<SubtitleTrack[]>([]);
  // Dernière video.currentTime observée — sert à détecter si la vidéo avance vraiment
  // pour débloquer un statut "buffering" qui resterait coincé après-coup.
  const lastTimeRef = useRef(0);

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
  // Texte du sous-titre courant — calculé manuellement à partir du timecode réel
  // (video.currentTime + seekOffset) car les cues WebVTT ont les timestamps d'origine
  // alors que video.currentTime repart à 0 après chaque seek ffmpeg.
  const [subtitleText, setSubtitleText] = useState('');
  // Décalage des sous-titres ajustable par l'utilisateur (en secondes, +/- 10s)
  // Positif = apparaissent plus tôt (corrige les sous-titres en retard)
  const [subtitleOffset, setSubtitleOffsetState] = useState(0);

  // Listeners persistants sur le <video>
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      // Ajouter l'offset de seek : quand ffmpeg repart de 0, on affiche la vraie position
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
    const onPlay    = () => setStatus('playing');
    const onPause   = () => setStatus('paused');
    const onWaiting = () => setStatus('buffering');
    const onPlaying = () => setStatus('playing');
    const onVolumeChange = () => {
      setVolumeState(video.volume);
      setIsMuted(video.muted);
    };
    const onError = () => {
      if (mpegtsRef.current) return;
      // Fallback silencieux : si la lecture native échoue (codec/conteneur non supporté),
      // basculer vers ffmpeg en préservant la position courante.
      const src = sourceUrlRef.current;
      if (src && !directSourceRef.current) {
        const pos = video.currentTime || 0;
        directSourceRef.current = src;
        seekOffsetRef.current = pos;
        currentTimeRef.current = pos;
        const audio = Math.max(0, currentAudioRef.current);
        const url = buildStreamUrl(src, audio, pos > 2 ? pos : undefined);
        setStatus('loading');
        video.src = url;
        video.load();
        video.play().catch(() => setStatus('paused'));
        return;
      }
      setStatus('error');
      setError('Erreur de lecture (source incompatible ou CORS)');
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
    };
  }, []);

  // Synchronise subtitleTracksRef avec l'état → permet le lookup streamIndex
  // depuis setSubtitle sans dépendances stales sur le state.
  useEffect(() => {
    subtitleTracksRef.current = subtitleTracks;
  }, [subtitleTracks]);

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
        setCurrentAudio(0);
        currentAudioRef.current = 0;
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
        setSubtitleTracks(subTracks);
      }
    }).catch(() => {/* probe échoue silencieusement — fallback sur les pistes natives */});
  }, []);

  const loadSource = useCallback((src: string) => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (mpegtsRef.current) { mpegtsRef.current.destroy(); mpegtsRef.current = null; }
    sourceUrlRef.current = null;
    directSourceRef.current = null;
    mediaUrlRef.current = null;
    probeDurationRef.current = 0;
    seekOffsetRef.current = 0;
    currentAudioRef.current = 0;
    currentTimeRef.current = 0;
    lastTimeRef.current = 0;
    // Vider les sous-titres parsés et le cache
    subCuesRef.current = [];
    subCuesCacheRef.current.clear();
    currentSubRef.current = -1;
    subtitleTracksRef.current = [];
    Array.from(video.querySelectorAll('track')).forEach((t) => t.remove());
    setSubtitleText('');

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
      src.startsWith('/api/liveproxy') ||
      /\/live\//.test(extractUpstreamUrl(src)) ||
      /\/live\//.test(probeSource);

    const tryPlay = () => {
      video.play().catch(() => {
        setStatus('paused');
      });
    };

    // Stream MPEG-TS live continu via /api/liveproxy
    if (src.startsWith('/api/liveproxy') && mpegts.isSupported()) {
      setIsLive(true);
      const absoluteSrc = `${window.location.origin}${src}`;
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
    directSourceRef.current = src;

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

    // Démarrage : ffmpeg → MP4 fragmenté avec audio AAC (toujours)
    loadDirect(buildStreamUrl(src, 0));

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
  //            + seekOffsetRef (compense les seeks ffmpeg qui repartent à 0)
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

  // --- Contrôles ---

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

      // Position dans le stream courant (= position absolue - seekOffset du dernier restart)
      const targetVideoTime = clampedTime - seekOffsetRef.current;

      // Si la cible est déjà dans le buffer → seek natif instantané, pas de rechargement.
      // Couvre les ±10s, les petits ajustements, et même les retours en arrière récents.
      for (let i = 0; i < video.buffered.length; i++) {
        const start = video.buffered.start(i);
        const end = video.buffered.end(i);
        if (targetVideoTime >= start - 0.5 && targetVideoTime <= end) {
          video.currentTime = Math.max(0, targetVideoTime);
          return;
        }
      }

      // Sinon : redémarrer ffmpeg à la nouvelle position
      const myGen = ++seekGenRef.current;
      seekOffsetRef.current = clampedTime;
      currentTimeRef.current = clampedTime;
      lastTimeRef.current = 0;
      setCurrentTime(clampedTime);
      setStatus('loading');

      const url = buildStreamUrl(src, audio, clampedTime > 0.5 ? clampedTime : undefined);
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
  }, []);

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
      seekOffsetRef.current = currentPos;
      setStatus('loading');
      const streamUrl = buildStreamUrl(ffmpegSrc, index, currentPos > 2 ? currentPos : undefined);
      video.src = streamUrl;
      video.load();
      video.play().catch(() => {
        if (seekGenRef.current === myGen && video.paused) setStatus('paused');
      });
      return;
    }

    // Mode natif sur fichier direct : Chrome n'expose pas le switch multi-audio.
    // Basculer vers ffmpeg avec la piste choisie, en préservant la position.
    const nativeSrc = sourceUrlRef.current;
    if (nativeSrc) {
      const video = videoRef.current;
      if (!video) return;
      const currentPos = video.currentTime || 0;
      directSourceRef.current = nativeSrc;
      currentAudioRef.current = index;
      currentTimeRef.current = currentPos;
      seekOffsetRef.current = currentPos;
      setCurrentAudio(index);
      setStatus('loading');
      const streamUrl = buildStreamUrl(nativeSrc, index, currentPos > 2 ? currentPos : undefined);
      video.src = streamUrl;
      video.load();
      video.play().catch(() => setStatus('paused'));
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
  }, []);

  // Désactivation / sélection d'une piste de sous-titres.
  // index = -1 → désactivé. Sinon = index UI 0-based dans subtitleTracks.
  // Le streamIndex absolu (envoyé à ffmpeg) est récupéré depuis subtitleTracksRef.
  const setSubtitle = useCallback((index: number) => {
    setCurrentSubtitle(index);
    currentSubRef.current = index;

    // Désactivation
    if (index < 0) {
      subCuesRef.current = [];
      setSubtitleText('');
      return;
    }

    // Lookup de la piste pour récupérer le streamIndex absolu
    const track = subtitleTracksRef.current.find((t) => t.index === index);
    if (!track) {
      console.warn('[subtitle] piste introuvable pour index', index);
      return;
    }
    const streamIdx = track.streamIndex;

    // Cache hit (clé = streamIndex absolu, ne cache PAS les VTT vides)
    const cached = subCuesCacheRef.current.get(streamIdx);
    if (cached && cached.length > 0) {
      subCuesRef.current = cached;
      return;
    }

    if (!mediaUrlRef.current) {
      console.warn('[subtitle] mediaUrl non défini — extraction impossible');
      return;
    }

    subCuesRef.current = [];   // évite les cues de l'ancienne piste pendant le fetch
    setSubtitleText('');

    // Fetch + parse VTT côté JS. Le serveur extrait la piste demandée du fichier
    // source via ffmpeg et la convertit en WebVTT. La piste est référencée par
    // son streamIndex ABSOLU (résistant au filtrage des codecs image par le probe).
    fetch(`/api/subtitle?url=${encodeURIComponent(mediaUrlRef.current)}&track=${streamIdx}`)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((text) => {
        const cues = parseVtt(text);
        if (cues.length > 0) {
          subCuesCacheRef.current.set(streamIdx, cues);
        } else {
          console.warn(`[subtitle] aucune cue parsée pour streamIndex=${streamIdx}`);
        }
        // Si l'utilisateur a changé de piste pendant le fetch, ne pas écraser
        if (currentSubRef.current === index) subCuesRef.current = cues;
      })
      .catch((err) => {
        console.warn('[subtitle] fetch échoué:', err);
      });
  }, []);

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
