// Shell Electron pour l'app Windows — voir CLAUDE.md §XI Phase 3 et
// docs/native-port.md §4 Phase 3 (Option B : embarquer server/proxy.cjs).
//
// Idée : le main process démarre le proxy Express (server/proxy.cjs) sur la
// loopback à un port libre, puis charge l'app React (dist/) servie par ce même
// proxy. L'app tourne donc en mode `web` (VITE_RUNTIME non défini) — comportement
// historique, juste hébergé localement. Les flux sortent par l'IP résidentielle
// de l'utilisateur → plus de blocage 403 d'IP datacenter (cf. docs/native-port.md §1).

const { app, BrowserWindow, shell } = require('electron');
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

let serverHandle = null;
let mainWindow = null;

async function bootstrap() {
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

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error('[electron] bootstrap failed:', err);
  app.quit();
});

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
