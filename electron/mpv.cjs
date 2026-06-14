// Contrôleur mpv (main process Electron) — lecteur natif Windows.
//
// Pourquoi mpv : l'app Electron lisait jusqu'ici via le proxy ffmpeg local
// (remux MP4 fragmenté pour le <video> de Chromium) → démarrage 5-10 s, seek =
// redémarrage ffmpeg, HEVC/x265 ré-encodé en temps réel. mpv décode DIRECTEMENT
// l'URL Xtream upstream (HEVC/AC3/MKV/MPEG-TS) depuis l'IP résidentielle, seek =
// requête Range → démarrage 1-2 s, seek quasi instantané (comme le libVLC mobile).
//
// Architecture (cf. CLAUDE.md §XI, dispatch Electron natif) :
//   - mpv tourne dans un process séparé, sa surface vidéo rendue DERRIÈRE la
//     WebView transparente via `--wid=<HWND de la fenêtre Electron>` (spike A
//     validé : Chromium z-ordonne sa couche web AU-DESSUS de l'enfant mpv, la
//     zone transparente du player révèle la vidéo — même modèle qu'Android/Tizen).
//   - Pilotage 100 % en IPC JSON via `--input-ipc-server` (named pipe Windows) →
//     aucune compilation native / node-gyp.
//
// Ce module expose un singleton `mpv` consommé par electron/main.cjs (handlers
// ipcMain), qui relaie commandes ⇄ events vers le renderer (preload bridge
// window.electron.mpv ; cf. src/native/electronMpv.ts + src/hooks/useElectronPlayer.ts).

const { spawn } = require('child_process');
const net = require('net');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// ─── Résolution du binaire ───────────────────────────────────────────────────
// Dev (`electron .`)      → vendor/mpv/mpv.exe (récupéré par `npm run fetch:mpv`).
// Packagé (electron-builder) → resources/mpv/mpv.exe (extraResources, cf. package.json).
function resolveMpvPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mpv', 'mpv.exe');
  }
  return path.join(__dirname, '..', 'vendor', 'mpv', 'mpv.exe');
}

function isAvailable() {
  try {
    return fs.existsSync(resolveMpvPath());
  } catch {
    return false;
  }
}

// Ids stables pour observe_property (renvoyés dans les events property-change).
const PROP = {
  TIME_POS: 1,
  DURATION: 2,
  PAUSE: 3,
  CORE_IDLE: 4,
  EOF_REACHED: 5,
  TRACK_LIST: 6,
  VOLUME: 7,
  MUTE: 8,
};

class MpvController {
  constructor() {
    this.proc = null;
    this.sock = null;
    this.pipePath = null;
    this.reqId = 0;
    this.pending = new Map(); // request_id → { resolve, reject }
    this.buf = '';
    this.onEvent = null; // callback(ev) posé par main.cjs → webContents.send
    this.ready = null; // Promise résolue quand le socket IPC est connecté
    // État dérivé (évite de réémettre des transitions identiques au renderer).
    this.lastState = null;
    this.paused = true;
    this.coreIdle = true;
    this.loaded = false;
  }

  available() {
    return isAvailable();
  }

  setEventSink(cb) {
    this.onEvent = cb;
  }

  emit(ev) {
    if (this.onEvent) {
      try {
        this.onEvent(ev);
      } catch {
        /* renderer parti */
      }
    }
  }

  // Démarre mpv embarqué dans la fenêtre Electron (hwnd) et connecte l'IPC.
  // Idempotent : un seul process pour la session ; réutilisé via loadfile replace.
  start(hwnd) {
    if (this.proc) return this.ready;
    const bin = resolveMpvPath();
    this.pipePath = `\\\\.\\pipe\\umbra-mpv-${process.pid}-${Date.now()}`;

    const args = [
      `--wid=${hwnd}`,
      `--input-ipc-server=${this.pipePath}`,
      '--idle=yes', // reste vivant sans fichier (réutilisé entre deux lectures)
      '--force-window=no',
      '--no-config', // ignore le mpv.conf de l'utilisateur
      '--no-osc', // pas d'OSD mpv (l'UI est React)
      '--osd-level=0',
      '--no-input-default-bindings',
      '--no-input-cursor',
      '--input-vo-keyboard=no',
      '--cursor-autohide=no',
      '--keep-open=yes', // ne décharge pas à l'EOF (on gère l'état « terminé »)
      '--hr-seek=yes', // seek précis (sinon saut au keyframe le plus proche)
      '--hwdec=auto-safe', // décodage matériel quand dispo
      '--volume=100',
      '--volume-max=100',
      '--terminal=no',
      '--msg-level=all=no',
    ];

    this.proc = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    this.proc.stderr.on('data', (d) => {
      const s = String(d).trim();
      if (s) console.warn('[mpv]', s);
    });
    this.proc.on('error', (e) => {
      console.error('[mpv] spawn error:', e.message);
      this.emit({ type: 'state', state: 'error', error: 'mpv introuvable' });
    });
    this.proc.on('exit', (code) => {
      console.warn('[mpv] exit', code);
      this.proc = null;
      this.sock = null;
      this.ready = null;
    });

    this.ready = this.connect();
    return this.ready;
  }

  // Le named pipe est créé par mpv peu après le spawn → on retente la connexion.
  connect() {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + 8000;
      const attempt = () => {
        const sock = net.connect(this.pipePath);
        sock.on('connect', () => {
          this.sock = sock;
          sock.setEncoding('utf8');
          sock.on('data', (chunk) => this.onData(chunk));
          sock.on('error', () => {});
          sock.on('close', () => {
            this.sock = null;
          });
          this.observeProperties();
          resolve();
        });
        sock.on('error', () => {
          sock.destroy();
          if (Date.now() > deadline) {
            reject(new Error('IPC mpv: connexion impossible'));
          } else {
            setTimeout(attempt, 60);
          }
        });
      };
      attempt();
    });
  }

  observeProperties() {
    this.rawCommand(['observe_property', PROP.TIME_POS, 'time-pos']);
    this.rawCommand(['observe_property', PROP.DURATION, 'duration']);
    this.rawCommand(['observe_property', PROP.PAUSE, 'pause']);
    this.rawCommand(['observe_property', PROP.CORE_IDLE, 'core-idle']);
    this.rawCommand(['observe_property', PROP.EOF_REACHED, 'eof-reached']);
    this.rawCommand(['observe_property', PROP.TRACK_LIST, 'track-list']);
    this.rawCommand(['observe_property', PROP.VOLUME, 'volume']);
    this.rawCommand(['observe_property', PROP.MUTE, 'mute']);
  }

  // ── Envoi de commandes ─────────────────────────────────────────────────────
  rawCommand(command) {
    if (!this.sock) return Promise.resolve(null);
    const request_id = ++this.reqId;
    const line = JSON.stringify({ command, request_id }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(request_id, { resolve, reject });
      try {
        this.sock.write(line);
      } catch (e) {
        this.pending.delete(request_id);
        reject(e);
      }
    });
  }

  setProp(name, value) {
    return this.rawCommand(['set_property', name, value]);
  }

  // ── Réception ──────────────────────────────────────────────────────────────
  onData(chunk) {
    this.buf += chunk;
    let nl;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.event) this.handleEvent(msg);
      else if (msg.request_id != null) {
        const p = this.pending.get(msg.request_id);
        if (p) {
          this.pending.delete(msg.request_id);
          if (msg.error && msg.error !== 'success') p.reject(new Error(msg.error));
          else p.resolve(msg.data);
        }
      }
    }
  }

  handleEvent(msg) {
    switch (msg.event) {
      case 'property-change':
        this.handlePropChange(msg);
        break;
      case 'start-file':
        this.loaded = false;
        this.setState('loading');
        break;
      case 'file-loaded':
        this.loaded = true;
        break;
      case 'playback-restart':
        // Première image affichée (aussi après un seek) → état réel.
        this.deriveState();
        break;
      case 'end-file':
        if (msg.reason === 'error') {
          this.setState('error', msg.file_error || 'Lecture impossible');
        } else if (msg.reason === 'eof') {
          this.setState('ended');
        }
        break;
      default:
        break;
    }
  }

  handlePropChange(msg) {
    switch (msg.id) {
      case PROP.TIME_POS:
        if (typeof msg.data === 'number') {
          this.emit({ type: 'time', position: msg.data });
        }
        break;
      case PROP.DURATION:
        this.emit({ type: 'duration', duration: typeof msg.data === 'number' ? msg.data : 0 });
        break;
      case PROP.PAUSE:
        this.paused = !!msg.data;
        this.deriveState();
        break;
      case PROP.CORE_IDLE:
        this.coreIdle = !!msg.data;
        this.deriveState();
        break;
      case PROP.EOF_REACHED:
        if (msg.data === true) this.setState('ended');
        break;
      case PROP.TRACK_LIST:
        this.emitTracks(Array.isArray(msg.data) ? msg.data : []);
        break;
      case PROP.VOLUME:
        if (typeof msg.data === 'number') {
          this.emit({ type: 'volume', volume: Math.max(0, Math.min(1, msg.data / 100)) });
        }
        break;
      case PROP.MUTE:
        this.emit({ type: 'mute', muted: !!msg.data });
        break;
      default:
        break;
    }
  }

  deriveState() {
    if (!this.loaded) return;
    if (this.paused) this.setState('paused');
    else if (this.coreIdle) this.setState('buffering');
    else this.setState('playing');
  }

  setState(state, error) {
    if (state === this.lastState && state !== 'error') return;
    this.lastState = state;
    this.emit({ type: 'state', state, error });
  }

  emitTracks(list) {
    const audio = [];
    const sub = [];
    let currentAudio = -1;
    let currentSub = -1;
    for (const tr of list) {
      const entry = {
        id: tr.id,
        name: tr.title || langName(tr.lang) || '',
        language: tr.lang || '',
        codec: tr.codec || '',
        selected: !!tr.selected,
      };
      if (tr.type === 'audio') {
        if (entry.selected) currentAudio = audio.length;
        audio.push(entry);
      } else if (tr.type === 'sub') {
        if (entry.selected) currentSub = sub.length;
        sub.push(entry);
      }
    }
    this.emit({ type: 'tracks', audio, sub, currentAudio, currentSub });
  }

  // ── API de lecture (appelée depuis les handlers ipcMain) ────────────────────
  async load(url, opts = {}) {
    if (!this.sock) return;
    this.loaded = false;
    this.lastState = null;
    // En-têtes HTTP par flux (cf. proxy §IV-8) : live → UA VLC sans Referer/Origin ;
    // VOD/série → UA navigateur + Referer/Origin de l'upstream.
    await this.setProp('user-agent', opts.userAgent || 'VLC/3.0.20 LibVLC/3.0.20').catch(() => {});
    await this.setProp('http-header-fields', Array.isArray(opts.headers) ? opts.headers : []).catch(() => {});
    this.setState('loading');
    await this.rawCommand(['loadfile', url, 'replace']).catch((e) => {
      this.setState('error', e.message);
    });
  }

  play() {
    return this.setProp('pause', false);
  }
  pause() {
    return this.setProp('pause', true);
  }
  seek(time) {
    return this.rawCommand(['seek', time, 'absolute']);
  }
  setVolume(v) {
    return this.setProp('volume', Math.max(0, Math.min(100, Math.round(v * 100))));
  }
  setMute(m) {
    return this.setProp('mute', !!m);
  }
  setAudio(id) {
    return this.setProp('aid', id < 0 ? 'no' : id);
  }
  setSubtitle(id) {
    return this.setProp('sid', id < 0 ? 'no' : id);
  }
  setSubScale(scale) {
    return this.setProp('sub-scale', scale);
  }
  setSubColor(hex) {
    return this.setProp('sub-color', hex);
  }
  setSubBackColor(rgba) {
    return this.setProp('sub-back-color', rgba);
  }
  setSubBold(on) {
    return this.setProp('sub-bold', !!on);
  }
  // Position verticale des sous-titres (0 = haut, 100 = bas par défaut). On la
  // remonte quand l'overlay des contrôles apparaît (lever en tandem, §IV overlay).
  setSubPos(pos) {
    return this.setProp('sub-pos', Math.max(0, Math.min(150, pos)));
  }
  setSubDelay(sec) {
    return this.setProp('sub-delay', sec);
  }
  stop() {
    this.loaded = false;
    this.lastState = null;
    return this.rawCommand(['stop']);
  }

  dispose() {
    try {
      if (this.sock) this.sock.destroy();
    } catch {
      /* ignore */
    }
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {
        /* ignore */
      }
    }
    this.proc = null;
    this.sock = null;
    this.ready = null;
  }
}

// Noms de langue ISO courts → libellé lisible (table minimale ; sinon le code brut).
const LANGS = {
  eng: 'Anglais', fre: 'Français', fra: 'Français', spa: 'Espagnol', ger: 'Allemand',
  deu: 'Allemand', ita: 'Italien', por: 'Portugais', ara: 'Arabe', rus: 'Russe',
  jpn: 'Japonais', chi: 'Chinois', zho: 'Chinois', kor: 'Coréen', nld: 'Néerlandais',
  tur: 'Turc', pol: 'Polonais', hin: 'Hindi', und: '',
};
function langName(code) {
  if (!code) return '';
  return LANGS[code.toLowerCase()] || code;
}

const mpv = new MpvController();

module.exports = { mpv, isAvailable, resolveMpvPath };
