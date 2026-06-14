// Shell Electron pour l'app Windows — voir CLAUDE.md §XI Phase 3 et
// docs/native-port.md §4 Phase 3 (Option B : embarquer server/proxy.cjs).
//
// Idée : le main process démarre le proxy Express (server/proxy.cjs) sur la
// loopback à un port libre, puis charge l'app React (dist/) servie par ce même
// proxy. L'app tourne donc en mode `web` (VITE_RUNTIME non défini) — comportement
// historique, juste hébergé localement. Les flux sortent par l'IP résidentielle
// de l'utilisateur → plus de blocage 403 d'IP datacenter (cf. docs/native-port.md §1).

const { app, BrowserWindow, shell, ipcMain, screen } = require('electron');
const path = require('path');
const { mpv } = require('./mpv.cjs');

// Réécriture des chemins ffmpeg/ffprobe pour la lecture en bundle asar.
// Les binaires de `ffmpeg-static` / `ffprobe-static` ne peuvent pas s'exécuter
// depuis l'archive asar — electron-builder les copie en parallèle dans
// `app.asar.unpacked/` (cf. bloc `build.asarUnpack` du package.json). On
// substitue donc le chemin renvoyé par le package avant d'instancier le serveur.
// `pickBinary` (server/proxy.cjs) consomme ces env vars en priorité maximale.
function unpackedPath(p) {
  return p ? p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`) : p;
}
try {
  process.env.FFMPEG_PATH     = unpackedPath(require('ffmpeg-static'));
  process.env.FFPROBE_PATH    = unpackedPath(require('ffprobe-static').path);
  process.env.FFMPEG_PATH_SUB = process.env.FFMPEG_PATH;
} catch (err) {
  console.warn('[electron] ffmpeg/ffprobe binaries introuvables :', err && err.message);
}

// Le require doit se faire APRÈS la pose des env vars — pickBinary les lit
// à l'évaluation du module (constantes top-level).
const { startServer } = require(path.join(__dirname, '..', 'server', 'proxy.cjs'));

const isDev = !app.isPackaged;

// ─── Anti-rechargement quand une autre fenêtre recouvre Umbra ───────────────
// Sur une fenêtre `transparent:true` (lecteur mpv), quand une autre fenêtre la
// recouvre entièrement, le calcul d'occlusion natif de Chromium marque la
// WebView « cachée » et libère sa surface GPU ; au retour (fenêtre retirée), la
// surface est recréée → la page se RECHARGE (le lecteur repart). On désactive ce
// calcul d'occlusion : la WebView garde sa surface, plus de rechargement. À
// poser avant `app.whenReady()`.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// ─── Protocole custom pour le retour OAuth (Phase 3b) ────────────────────────
// Pendant le clic « Se connecter avec Google » dans Electron, on ouvre l'URL
// d'autorisation Supabase dans le navigateur système (cookies Chrome/Edge déjà
// posés, sélecteur de compte natif). Supabase redirige ensuite vers
// `umbra://auth-callback?code=…`. Windows/macOS rappellent Umbra via le
// protocole enregistré ; on récupère l'URL et on la transmet au renderer
// (SupabaseAuthContext appelle `exchangeCodeForSession` — flux PKCE). Même
// pattern que la Phase 2e Android (deep link `com.umbra.app://auth-callback`).
const OAUTH_PROTOCOL = 'umbra';
const OAUTH_REDIRECT_PREFIX = `${OAUTH_PROTOCOL}://`;

let serverHandle = null;
let mainWindow = null;
// URL OAuth reçue avant que la fenêtre soit prête — on la garde et on la
// re-émet après `did-finish-load` (premier lancement par clic sur lien).
let pendingAuthUrl = null;

function registerOAuthProtocol() {
  // En dev (`electron .`), `process.execPath` = electron.exe dans node_modules
  // → il faut passer le script (`electron/main.cjs`) en argument explicite,
  // sinon Windows lance Electron sans pointer sur notre app. En prod
  // (`Umbra.exe`), un simple appel suffit.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL);
  }
}

function forwardAuthCallback(url) {
  if (typeof url !== 'string' || !url.startsWith(OAUTH_REDIRECT_PREFIX)) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('umbra:auth-callback', url);
  } else {
    pendingAuthUrl = url;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

// Single-instance lock : sous Windows, un clic sur `umbra://auth-callback?…`
// lance une 2e Umbra.exe ; il faut que la 1ère reçoive l'URL et que la 2nde
// quitte. `second-instance` fournit l'argv de la 2nde — l'URL OAuth y figure.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((a) => typeof a === 'string' && a.startsWith(OAUTH_REDIRECT_PREFIX));
    if (url) forwardAuthCallback(url);
  });

  // macOS : pour future-proof (pas la cible Phase 3, mais coût zéro).
  app.on('open-url', (event, url) => {
    event.preventDefault();
    forwardAuthCallback(url);
  });

  registerOAuthProtocol();

  app.whenReady().then(bootstrap).catch((err) => {
    console.error('[electron] bootstrap failed:', err);
    app.quit();
  });
}

async function bootstrap() {
  // IPC : ouvre une URL http(s) dans le navigateur système. Validation stricte
  // côté main pour éviter qu'un compromis renderer ne fasse exécuter n'importe
  // quel `shell://` (potentiellement file://, ftp://, javascript:…).
  ipcMain.handle('umbra:open-external', async (_event, url) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'invalid url' };
    }
    await shell.openExternal(url);
    return { ok: true };
  });

  serverHandle = await startServer({
    port: 0,            // OS pioche un port libre — évite tout conflit utilisateur
    host: '127.0.0.1',  // jamais exposé sur le LAN
    serveStatic: true,  // sert dist/ en plus de /api/*
    distDir: path.join(__dirname, '..', 'dist'),
  });

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 880,
    minHeight: 560,
    // ── Fenêtre frameless + transparente (lecteur natif mpv) ──────────────────
    // Le lecteur natif mpv rend sa surface vidéo DERRIÈRE la WebView via --wid
    // (cf. electron/mpv.cjs + CLAUDE.md §XI). Pour que la zone transparente du
    // player la laisse voir, la fenêtre doit être transparente. La transparence
    // est figée à la création → on la pose toujours ; hors lecture, l'app peint
    // un fond opaque (`html,body,#root { background: var(--bg) }`) donc le rendu
    // reste identique au mode framed. `frame:false` impose un titlebar maison
    // (cf. src/components/TitleBar.tsx) — contrôles fenêtre via IPC window:*.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false, // évite un flash transparent (bureau visible) avant le 1er paint
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // libère l'accès Node pour le preload si on en a besoin plus tard
      // Ne pas brider les timers/RAF quand la fenêtre est masquée/occultée — la
      // lecture mpv continue, l'UI doit rester cohérente au retour (cf. occlusion).
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // ── Pont fenêtre (titlebar maison) ─────────────────────────────────────────
  // Plein écran BORDERLESS (setBounds) plutôt que setFullScreen : sur une fenêtre
  // `transparent:true` frameless, le vrai plein écran OS ne s'affiche pas
  // correctement (et l'API Fullscreen HTML a un ::backdrop opaque qui masque la
  // surface mpv → écran noir). On redimensionne simplement la fenêtre aux bornes
  // de l'écran ; mpv (enfant --wid) suit la taille.
  //
  // ⚠ PAS de `setAlwaysOnTop` (ni de toggle focus/blur). Le « toujours au-dessus »
  // empêchait une autre fenêtre de passer devant le lecteur, et le relâcher au
  // blur ne corrige pas le cas « je saisis directement une fenêtre » : Win32
  // HWND_NOTOPMOST RE-élève la fenêtre AU-DESSUS de toutes les non-topmost (donc
  // au-dessus de celle qu'on vient d'activer) → elle repassait derrière ; et
  // Electron n'expose aucun « move to bottom » pour compenser. En z-order naturel,
  // glisser une fenêtre par-dessus ou Alt-Tab se comporte comme en plein écran
  // navigateur (YouTube). La fenêtre couvrant tout l'écran au premier plan, le
  // shell Windows masque la barre des tâches de lui-même.
  let fsSavedBounds = null;
  const setBorderlessFullscreen = (on) => {
    if (!mainWindow) return;
    if (on && !fsSavedBounds) {
      fsSavedBounds = mainWindow.getBounds();
      const disp = screen.getDisplayMatching(mainWindow.getBounds());
      mainWindow.setBounds(disp.bounds);
    } else if (!on && fsSavedBounds) {
      mainWindow.setBounds(fsSavedBounds);
      fsSavedBounds = null;
    } else {
      return;
    }
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.send('umbra:window-fs-state', fsSavedBounds !== null);
    }
  };

  ipcMain.on('umbra:window', (_event, action) => {
    if (!mainWindow) return;
    if (action === 'minimize') mainWindow.minimize();
    else if (action === 'maximize') {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    } else if (action === 'close') mainWindow.close();
    else if (action === 'toggle-fullscreen') setBorderlessFullscreen(fsSavedBounds === null);
    else if (action === 'exit-fullscreen') setBorderlessFullscreen(false);
  });
  ipcMain.handle('umbra:window-is-maximized', () => !!(mainWindow && mainWindow.isMaximized()));
  const sendMaxState = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('umbra:window-max-state', mainWindow.isMaximized());
    }
  };
  mainWindow.on('maximize', sendMaxState);
  mainWindow.on('unmaximize', sendMaxState);

  // ── Déplacement custom + snap « glisser en haut = agrandir » ───────────────
  // La fenêtre est transparente (lecteur mpv) → Windows désactive l'Aero Snap
  // natif et `-webkit-app-region: drag` ne maximise pas au bord haut. On pilote
  // donc le déplacement nous-mêmes : le titlebar envoie start/move/end (pointer
  // capture) et on suit le curseur ; au relâchement collé en haut de l'écran, on
  // maximise (l'équivalent du snap natif). `getCursorScreenPoint`/`setPosition`
  // sont tous deux en DIP → l'offset reste cohérent (y compris multi-écran).
  const SNAP_TOP_PX = 6;
  let winDrag = null;
  ipcMain.on('umbra:window-drag', (_event, phase) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (phase === 'start') {
      const cursor = screen.getCursorScreenPoint();
      // Glisser une fenêtre maximisée la restaure sous le curseur (standard OS).
      if (mainWindow.isMaximized()) {
        const max = mainWindow.getBounds();
        const relX = max.width > 0 ? (cursor.x - max.x) / max.width : 0.5;
        mainWindow.unmaximize();
        const r = mainWindow.getBounds();
        mainWindow.setPosition(Math.round(cursor.x - r.width * relX), Math.round(cursor.y - 15));
      }
      const [wx, wy] = mainWindow.getPosition();
      winDrag = { offsetX: cursor.x - wx, offsetY: cursor.y - wy, moved: false };
    } else if (phase === 'move') {
      if (!winDrag) return;
      winDrag.moved = true;
      const p = screen.getCursorScreenPoint();
      mainWindow.setPosition(p.x - winDrag.offsetX, p.y - winDrag.offsetY);
    } else if (phase === 'end') {
      if (!winDrag) return;
      const { moved } = winDrag;
      winDrag = null;
      // Snap seulement après un vrai déplacement (pas un simple clic sur le
      // titre alors que la fenêtre est déjà collée en haut).
      if (!moved) return;
      const cursor = screen.getCursorScreenPoint();
      const wa = screen.getDisplayNearestPoint(cursor).workArea;
      if (cursor.y <= wa.y + SNAP_TOP_PX) mainWindow.maximize();
    }
  });

  // ── Pont lecteur natif mpv ─────────────────────────────────────────────────
  // mpv est démarré paresseusement à la 1re lecture (évite un process mpv quand
  // l'utilisateur ne lit rien), embarqué dans la fenêtre via son HWND. Une seule
  // instance pour la session, réutilisée via `loadfile replace`.
  mpv.setEventSink((ev) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('umbra:mpv-event', ev);
    }
  });
  const ensureMpv = async () => {
    if (!mpv.available()) throw new Error('mpv indisponible');
    const hwnd = mainWindow.getNativeWindowHandle().readBigUInt64LE(0).toString();
    await mpv.start(hwnd);
  };
  // Méthodes autorisées depuis le renderer (whitelist — pas d'appel arbitraire).
  const MPV_METHODS = new Set([
    'load', 'play', 'pause', 'seek', 'setVolume', 'setMute', 'setAudio',
    'setSubtitle', 'setSubScale', 'setSubColor', 'setSubBackColor', 'setSubBold',
    'setSubPos', 'setSubDelay', 'stop',
  ]);
  ipcMain.handle('umbra:mpv-available', () => mpv.available());
  ipcMain.handle('umbra:mpv', async (_event, method, args) => {
    if (!MPV_METHODS.has(method)) return { ok: false, error: 'method not allowed' };
    try {
      if (method === 'load') await ensureMpv();
      const result = await mpv[method](...(Array.isArray(args) ? args : []));
      return { ok: true, result: result ?? null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Liens externes (ex. paiement Stripe sur umbra.app) → navigateur par défaut.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const url = `http://127.0.0.1:${serverHandle.port}/`;
  await mainWindow.loadURL(url);

  // Si l'app a été lancée PAR un clic sur `umbra://…` (1er lancement à froid),
  // l'URL est dans `process.argv` côté Windows — on la rejoue maintenant.
  const initialAuthUrl = process.argv.find((a) => typeof a === 'string' && a.startsWith(OAUTH_REDIRECT_PREFIX));
  if (initialAuthUrl) pendingAuthUrl = initialAuthUrl;

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingAuthUrl) {
      mainWindow.webContents.send('umbra:auth-callback', pendingAuthUrl);
      pendingAuthUrl = null;
    }
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.on('window-all-closed', () => {
  // Windows/Linux : quitter à la fermeture de la dernière fenêtre.
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (e) => {
  // Tuer mpv en premier (process enfant séparé → sinon zombie sous Windows).
  try { mpv.dispose(); } catch { /* ignore */ }
  if (!serverHandle) return;
  // Laisser le proxy fermer ses sockets (ffmpeg pipes inclus) avant le exit.
  e.preventDefault();
  try { await serverHandle.close(); } catch { /* ignore */ }
  serverHandle = null;
  app.exit(0);
});
