import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { SubtitleTrack } from './usePlayer';

// ─────────────────────────────────────────────────────────────────────────────
// useSubtitles — hook de synchronisation des sous-titres frame-accurate.
//
// PRINCIPE FONDAMENTAL
// ────────────────────
// Au lieu de poller `video.currentTime` via requestAnimationFrame (qui peut être
// stale, décalé d'une frame, ou rester sur l'ancienne valeur pendant qu'un
// nouveau flux ffmpeg se charge), on utilise **requestVideoFrameCallback**.
// Cette API du navigateur déclenche un callback exactement quand une nouvelle
// frame vidéo est affichée à l'écran, et fournit son `mediaTime` réel — le
// timestamp exact de cette frame dans la timeline du média.
//
// → Le sous-titre est sélectionné en fonction de la frame VRAIMENT affichée,
//   pas d'un compteur découplé du rendu visuel.
// → Plus de race condition entre seekOffsetRef et video.currentTime.
// → Plus d'écart dû au keyframe alignment ou au PTS clamping de Chrome.
//
// CALCUL DU SOURCE TIME
// ─────────────────────
// La timeline du média n'est PAS la timeline du fichier source quand ffmpeg
// fait un seek (-ss X + -output_ts_offset -X) → on a `mediaTime` qui repart
// de 0 mais on est en réalité à la position X dans le fichier source.
//
//   sourceTime = mediaTime + getStreamBase() + userOffset
//
//   - mediaTime : timestamp de la frame affichée (fourni par le navigateur)
//   - getStreamBase() : seekOffset du player (0 pour HLS/natif, X pour ffmpeg)
//   - userOffset : décalage manuel utilisateur (touches g/h)
//
// CYCLE DE VIE
// ────────────
// 1. mediaUrl change → reset complet (cues, cache, offset, sélection)
// 2. streamEpoch change → effacement immédiat et synchrone (streamEpochRef mis
//    à jour au render, détecté dans computeAndShow avant le cycle useEffect).
//    Couvre le rewind keyframe lors du changement de piste audio.
// 3. setSubtitle(i) → fetch + parse VTT + remplit cuesRef
// 4. Frame callback fire à chaque nouvelle frame → lookup + maj texte
// 5. RAF fallback couvre la pause + navigateurs sans frame callback
// ─────────────────────────────────────────────────────────────────────────────

// ── Parser WebVTT robuste ────────────────────────────────────────────────────
// On parse les sous-titres en JS plutôt que d'utiliser <track> car Chrome ne
// charge pas fiablement les cues en mode 'hidden' sur HLS.
// Le parser couvre toutes les variantes produites par ffmpeg :
// WebVTT, SRT (virgules dans timestamps), tags ASS/SSA, voice/class tags,
// timestamps karaoke inline, entités HTML, BOM, CRLF.

interface VttCue { start: number; end: number; text: string; }

function parseTimestamp(ts: string): number {
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
    .replace(/\{\\[^}]*\}/g, '')                            // ASS/SSA overrides
    .replace(/<v[\s.][^>]*>/gi, '').replace(/<\/v>/gi, '')  // voice tags
    .replace(/<c[\s.][^>]*>/gi, '').replace(/<\/c>/gi, '')  // class tags
    .replace(/<\d{2}:\d{2}:\d{2}[.,]\d{3}>/g, '')           // karaoke timestamps
    .replace(/<[^>]+>/g, '')                                 // toutes balises
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .split('\n').map((l) => l.trimEnd()).join('\n').trim();
}

function parseVtt(text: string): VttCue[] {
  const cues: VttCue[] = [];
  // Strip BOM (U+FEFF) si présent, normalise les fins de ligne.
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n|\r/g, '\n');
  const lines = normalized.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const arrow = lines[i].indexOf('-->');
    if (arrow === -1) continue;

    const startStr = lines[i].substring(0, arrow).trim();
    const afterArrow = lines[i].substring(arrow + 3).trim();
    const endStr = afterArrow.split(/\s+/)[0];
    const start = parseTimestamp(startStr);
    const end = parseTimestamp(endStr);
    if (!isFinite(start) || !isFinite(end) || end <= start) continue;

    i++;
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      textLines.push(lines[i]);
      i++;
    }
    const cleaned = cleanCueText(textLines.join('\n'));
    if (cleaned) cues.push({ start, end, text: cleaned });
  }

  cues.sort((a, b) => a.start - b.start);
  return cues;
}

// Recherche binaire de la cue active à un instant donné.
// Hint d'index = dernière cue trouvée (cas linéaire dominant en lecture continue).
function findCueAt(cues: VttCue[], time: number, hint: number): number {
  // 1. Vérifie la zone autour de l'index précédent (cas séquentiel)
  const lo1 = Math.max(0, hint - 1);
  const hi1 = Math.min(cues.length, hint + 3);
  for (let i = lo1; i < hi1; i++) {
    const c = cues[i];
    if (time >= c.start && time <= c.end) return i;
    if (time < c.start) break;
  }
  // 2. Recherche binaire (seek important, démarrage)
  let lo = 0, hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (time < c.start) hi = mid - 1;
    else if (time > c.end) lo = mid + 1;
    else return mid;
  }
  return -1;
}

// requestVideoFrameCallback est typé nativement par TypeScript (lib.dom).

interface Props {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** URL upstream du fichier source — passée à /api/subtitle (via getter pour stabilité). */
  getMediaUrl: () => string | null;
  /** Pistes détectées par ffprobe (fournies par usePlayer). */
  tracks: SubtitleTrack[];
  /**
   * Getter du décalage de timestamp du flux courant (= seekOffsetRef du player).
   * - HLS / natif : retourne toujours 0 (mediaTime déjà en source time)
   * - ffmpeg /api/stream avec -ss X : retourne X
   * Lu à chaque frame — la fonction doit retourner la valeur la plus fraîche.
   */
  getStreamBase: () => number;
  /**
   * Compteur incrémenté par le player à chaque `video.src = ...`. Sert de signal
   * pour effacer le texte actuel — sinon, le cue de l'ancien flux resterait
   * affiché pendant le chargement du nouveau (jusqu'à la première frame).
   */
  streamEpoch: number;
}

// ── Persistance du décalage utilisateur ─────────────────────────────────────
// Le décalage est CONSERVÉ entre les médias et les sessions. Raison : si après
// le -copyts ffmpeg il subsiste un écart résiduel (lecture HLS où le serveur
// amont rebase différemment, ou décalage d'auteurage entre audio/sous-titres
// dans le fichier source), l'utilisateur règle UNE fois et c'est enregistré.
// → Comportement type ExoPlayer / VLC : le réglage suit l'utilisateur, pas le fichier.
const SAVED_OFFSET_KEY = 'iptv-subtitle-offset-global';

function loadSavedOffset(): number {
  try {
    const v = parseFloat(localStorage.getItem(SAVED_OFFSET_KEY) ?? '0');
    return isFinite(v) ? Math.max(-10, Math.min(10, v)) : 0;
  } catch { return 0; }
}

function saveOffset(v: number) {
  try { localStorage.setItem(SAVED_OFFSET_KEY, String(v)); } catch {/* */}
}

export function useSubtitles({ videoRef, getMediaUrl, tracks, getStreamBase, streamEpoch }: Props) {
  // Décalage initial chargé une fois au mount (pas via useState() pour éviter
  // de relire localStorage à chaque re-render — useState garde sa valeur init).
  const initialOffsetRef = useRef<number | null>(null);
  if (initialOffsetRef.current === null) initialOffsetRef.current = loadSavedOffset();
  const initialOffset = initialOffsetRef.current;

  // ── Refs (état "courant" lu dans les callbacks sans déclencher de re-render)
  const cuesRef = useRef<VttCue[]>([]);
  const cuesCacheRef = useRef<Map<number, VttCue[]>>(new Map());
  const tracksRef = useRef<SubtitleTrack[]>([]);
  const currentSubRef = useRef(-1);
  const subOffsetRef = useRef(initialOffset);
  const fetchGenRef = useRef(0);
  // mediaUrl tel que vu lors du dernier reset — invalide le cache si change.
  const lastMediaUrlRef = useRef<string | null>(null);

  // ── State (re-render UI sur changement)
  const [currentSubtitle, setCurrentSubtitle] = useState(-1);
  const [subtitleText, setSubtitleText] = useState('');
  const [subtitleOffset, setSubtitleOffsetState] = useState(initialOffset);

  // Synchronise la ref des pistes avec l'état (pour lookup dans setSubtitle)
  useEffect(() => { tracksRef.current = tracks; }, [tracks]);

  // ── Reset complet sur changement de média (URL source différente)
  // Détecté à chaque render via comparaison avec lastMediaUrlRef.
  // Note : on n'utilise PAS un useEffect [mediaUrl] car le getter retourne
  // null parfois avant que l'URL soit dispo — on veut réagir à la valeur réelle.
  useEffect(() => {
    const currentMediaUrl = getMediaUrl();
    if (currentMediaUrl === lastMediaUrlRef.current) return;
    lastMediaUrlRef.current = currentMediaUrl;

    currentSubRef.current = -1;
    setCurrentSubtitle(-1);
    cuesRef.current = [];
    cuesCacheRef.current.clear();
    fetchGenRef.current++;
    setSubtitleText('');
    // ⚠️ NE PAS réinitialiser subtitleOffset/subOffsetRef ici — le décalage
    // utilisateur est délibérément conservé entre médias (cf. SAVED_OFFSET_KEY).
    // streamEpoch est observé en dépendance pour détecter les changements
    // de stream (qui incluent les changements de mediaUrl).
  }, [getMediaUrl, streamEpoch]);

  // ── Effacement du texte à chaque transition de flux
  // Le player vient de changer video.src — la frame actuellement à l'écran
  // peut encore être de l'ancien flux. On attend la prochaine frame du
  // nouveau flux pour réafficher (via le frame callback).
  useEffect(() => {
    setSubtitleText('');
  }, [streamEpoch]);

  // ── Refs d'epoch synchrones ───────────────────────────────────────────────
  // streamEpochRef est mis à jour DIRECTEMENT au render (pas dans un useEffect)
  // afin que la boucle de frames puisse détecter un changement de flux
  // immédiatement, sans attendre le cycle asynchrone de React.
  // → Empêche les sous-titres de rester affichés pendant le rewind dû à
  //   l'alignement keyframe lors d'un changement de piste audio.
  const streamEpochRef = useRef(streamEpoch);
  streamEpochRef.current = streamEpoch; // toujours synchronisé au render courant
  const lastHandledEpochRef = useRef(streamEpoch);

  // ── Boucle de synchronisation frame-accurate ──────────────────────────────
  // PRIMAIRE : requestVideoFrameCallback. Le navigateur appelle notre callback
  // exactement quand une nouvelle frame est rendue, avec son mediaTime EXACT.
  // → Zéro désync : si la frame n'a pas changé, le sous-titre non plus.
  //
  // FALLBACK RAF : couvre les cas où le frame callback ne fire pas :
  //   - Vidéo en pause (pas de nouvelles frames)
  //   - Utilisateur ajuste l'offset alors que la vidéo est pausée
  //   - Navigateur ancien sans requestVideoFrameCallback
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let frameCbId: number | null = null;
    let rafId: number | null = null;
    let lastShown = '';
    let lastIdx = 0;

    const computeAndShow = (mediaTime: number) => {
      // ── Garde epoch synchrone ─────────────────────────────────────────────
      // streamEpochRef.current est mis à jour au render, pas dans un useEffect.
      // → Ce check est toujours sur la valeur la plus fraîche, même si React
      //   n'a pas encore schedulé l'effet [streamEpoch].
      // Cas typique : changement de piste audio → video.src change → ffmpeg
      // repart du keyframe le plus proche (quelques secondes en arrière).
      // Sans ce guard, le RAF/frame-cb continuerait d'afficher l'ancien cue
      // pendant le rewind et le chargement du nouveau flux → désync visible.
      if (streamEpochRef.current !== lastHandledEpochRef.current) {
        lastHandledEpochRef.current = streamEpochRef.current;
        lastShown = '';
        setSubtitleText('');
        return; // on attend la première frame confirmée du nouveau flux
      }

      let next = '';
      const cues = cuesRef.current;
      if (currentSubRef.current >= 0 && cues.length > 0) {
        const sourceTime = mediaTime + getStreamBase() + subOffsetRef.current;
        const found = findCueAt(cues, sourceTime, lastIdx);
        if (found !== -1) {
          next = cues[found].text;
          lastIdx = found;
        }
      }
      if (next !== lastShown) {
        lastShown = next;
        setSubtitleText(next);
      }
    };

    const hasFrameCb = typeof video.requestVideoFrameCallback === 'function';

    if (hasFrameCb) {
      const frameCallback: VideoFrameRequestCallback = (_now, metadata) => {
        computeAndShow(metadata.mediaTime);
        // Re-schedule pour la frame suivante (chain perpétuelle)
        frameCbId = video.requestVideoFrameCallback(frameCallback);
      };
      frameCbId = video.requestVideoFrameCallback(frameCallback);
    }

    // Tick RAF supplémentaire — couvre :
    //   1. Pause : pas de nouvelles frames donc pas de frame callback
    //   2. Ajustement d'offset manuel : il faut re-évaluer même sans nouvelle frame
    //   3. Navigateur sans frame callback
    const rafTick = () => {
      if (!hasFrameCb || video.paused) {
        // En l'absence de frame metadata, on utilise video.currentTime + base.
        // Acceptable ici car la vidéo est immobile (pas de désync visible).
        computeAndShow(video.currentTime);
      }
      rafId = requestAnimationFrame(rafTick);
    };
    rafId = requestAnimationFrame(rafTick);

    return () => {
      if (frameCbId !== null) {
        video.cancelVideoFrameCallback(frameCbId);
      }
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [videoRef, getStreamBase]);

  // ── Sélection / désactivation d'une piste
  const setSubtitle = useCallback((index: number) => {
    setCurrentSubtitle(index);
    currentSubRef.current = index;

    // Désactivation
    if (index < 0) {
      cuesRef.current = [];
      setSubtitleText('');
      return;
    }

    const track = tracksRef.current.find((t) => t.index === index);
    if (!track) return;

    // Cache hit (clé = streamIndex absolu, ne cache PAS les VTT vides)
    const cached = cuesCacheRef.current.get(track.streamIndex);
    if (cached && cached.length > 0) {
      cuesRef.current = cached;
      return;
    }

    const mediaUrl = getMediaUrl();
    if (!mediaUrl) return;

    cuesRef.current = [];
    setSubtitleText('');

    // Generation pour invalider les fetch concurrents (clic rapide entre pistes)
    const myGen = ++fetchGenRef.current;

    fetch(`/api/subtitle?url=${encodeURIComponent(mediaUrl)}&track=${track.streamIndex}`)
      .then((r) => r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((text) => {
        const cues = parseVtt(text);
        if (cues.length > 0) cuesCacheRef.current.set(track.streamIndex, cues);
        // Vérifier : la génération est-elle toujours valide ET la piste UI toujours
        // sélectionnée ? Sinon → résultat obsolète, ignorer.
        if (fetchGenRef.current === myGen && currentSubRef.current === index) {
          cuesRef.current = cues;
        }
      })
      .catch(() => {/* échec silencieux — l'utilisateur peut re-cliquer */});
  }, [getMediaUrl]);

  // ── Décalage manuel utilisateur (touches g/h ou boutons +/-)
  // Persiste dans localStorage à chaque changement → fixe une fois pour toutes
  // tout résidu de décalage systémique.
  const adjustSubtitleOffset = useCallback((delta: number) => {
    setSubtitleOffsetState((prev) => {
      const v = Math.max(-10, Math.min(10, prev + delta));
      subOffsetRef.current = v;
      saveOffset(v);
      return v;
    });
  }, []);

  const setSubtitleOffset = useCallback((value: number) => {
    const v = Math.max(-10, Math.min(10, value));
    subOffsetRef.current = v;
    setSubtitleOffsetState(v);
    saveOffset(v);
  }, []);

  return {
    currentSubtitle,
    subtitleText,
    subtitleOffset,
    setSubtitle,
    setSubtitleOffset,
    adjustSubtitleOffset,
  };
}
