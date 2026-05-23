// Shell Electron pour l'app Windows — voir CLAUDE.md §XI Phase 3 et
// docs/native-port.md §4 Phase 3 (Option B : embarquer server/proxy.cjs).
//
// Idée : le main process démarre le proxy Express (server/proxy.cjs) sur la
// loopback à un port libre, puis charge l'app React (dist/) servie par ce même
// proxy. L'app tourne donc en mode `web` (VITE_RUNTIME non défini) — comportement
// historique, juste hébergé localement. Les flux sortent par l'IP résidentielle
// de l'utilisateur → plus de blocage 403 d'IP datacenter (cf. docs/native-port.md §1).

const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');

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

// ─── Protocole custom pour le retour OAuth (Phase 3b) ────────────────────────
// Pendant le clic « Se connecter avec Google » dans Electron, on ouvre l'URL
// d'autorisation Supabase dans le navigateur système (cookies Chrome/Edge déjà
// posés, sélecteur de compte natif). Supabase redirige ensuite vers
// `iptvax://auth-callback?code=…`. Windows/macOS rappellent Iptvax via le
// protocole enregistré ; on récupère l'URL et on la transmet au renderer
// (SupabaseAuthContext appelle `exchangeCodeForSession` — flux PKCE). Même
// pattern que la Phase 2e Android (deep link `com.iptvax.app://auth-callback`).
const OAUTH_PROTOCOL = 'iptvax';
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
  // (`Iptvax.exe`), un simple appel suffit.
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(OAUTH_PROTOCOL);
  }
}

function forwardAuthCallback(url) {
  if (typeof url !== 'string' || !url.startsWith(OAUTH_REDIRECT_PREFIX)) return;
  if (mainWindow && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('iptvax:auth-callback', url);
  } else {
    pendingAuthUrl = url;
  }
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
}

// Single-instance lock : sous Windows, un clic sur `iptvax://auth-callback?…`
// lance une 2e Iptvax.exe ; il faut que la 1ère reçoive l'URL et que la 2nde
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
  ipcMain.handle('iptvax:open-external', async (_event, url) => {
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
    backgroundColor: '#000',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // libère l'accès Node pour le preload si on en a besoin plus tard
    },
  });

  // Liens externes (ex. paiement Stripe sur iptvax.com) → navigateur par défaut.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  const url = `http://127.0.0.1:${serverHandle.port}/`;
  await mainWindow.loadURL(url);

  // Si l'app a été lancée PAR un clic sur `iptvax://…` (1er lancement à froid),
  // l'URL est dans `process.argv` côté Windows — on la rejoue maintenant.
  const initialAuthUrl = process.argv.find((a) => typeof a === 'string' && a.startsWith(OAUTH_REDIRECT_PREFIX));
  if (initialAuthUrl) pendingAuthUrl = initialAuthUrl;

  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingAuthUrl) {
      mainWindow.webContents.send('iptvax:auth-callback', pendingAuthUrl);
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
  if (!serverHandle) return;
  // Laisser le proxy fermer ses sockets (ffmpeg pipes inclus) avant le exit.
  e.preventDefault();
  try { await serverHandle.close(); } catch { /* ignore */ }
  serverHandle = null;
  app.exit(0);
});
