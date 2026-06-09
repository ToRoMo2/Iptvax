// SPIKE — surface vidéo mpv derrière la WebView Electron (make-or-break).
//
// But : prouver qu'on peut afficher l'image décodée par mpv.exe AU BON ENDROIT
// dans une fenêtre Electron, avec l'UI React (ici un faux bandeau haut/bas)
// PAR-DESSUS la vidéo. Deux approches testées via la variable d'env APPROACH :
//
//   APPROACH=A  → embedding HWND : une SEULE fenêtre `transparent:true`,
//                 mpv lancé avec --wid=<HWND de la fenêtre> → il devient un
//                 enfant et tente de rendre dans la zone transparente.
//
//   APPROACH=B  → deux fenêtres : une fenêtre « vidéo » opaque en dessous
//                 (hôte mpv via --wid), une fenêtre « UI » transparente
//                 au-dessus (même bounds, enfant), synchronisées sur move/resize.
//
// Lancement : voir scripts npm `spike:mpv:a` / `spike:mpv:b`.
// Source de test : mire lavfi (aucun réseau requis).

const { app, BrowserWindow, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const APPROACH = (process.env.APPROACH || 'A').toUpperCase();
const MPV = path.join(__dirname, '..', 'vendor', 'mpv', 'mpv.exe');
// Mire animée : carré déplaçable visible, pas de réseau, pas de fichier.
const TEST_SRC = 'av://lavfi:testsrc=size=1280x720:rate=30';

const WIN = { x: 200, y: 120, width: 1100, height: 720 };

let videoWin = null; // approche B : fenêtre hôte mpv
let uiWin = null; // approche B : fenêtre UI transparente (= la fenêtre unique en A)
let mpv = null;

function log(...a) {
  console.log('[spike]', ...a);
}

// getNativeWindowHandle() renvoie un Buffer ; sous Windows x64 c'est le HWND
// encodé en little-endian sur 8 octets.
function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.readBigUInt64LE(0).toString();
}

// Faux UI React : bandeau haut opaque + zone vidéo transparente au milieu +
// barre de contrôles opaque en bas. Si la vidéo passe PAR-DESSUS les bandeaux,
// mpv est mal z-ordonné. Si la zone du milieu reste vide (fond fenêtre / bureau),
// la surface mpv n'est pas composée.
function uiHtml(approach) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(`
<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;font-family:Segoe UI,sans-serif;background:transparent;overflow:hidden;}
  .col{display:flex;flex-direction:column;height:100vh;}
  .bar{background:rgba(20,20,28,.92);color:#7fe7ff;padding:14px 18px;font-size:15px;
       backdrop-filter:blur(6px);border-bottom:1px solid #2a2a3a;}
  .bottom{margin-top:auto;border-top:1px solid #2a2a3a;border-bottom:none;display:flex;gap:10px;align-items:center;}
  .btn{background:#1d6cff;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-size:14px;}
  .hole{flex:1;border:2px dashed rgba(255,120,120,.5);margin:8px;border-radius:10px;
        display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.35);font-size:13px;}
</style></head><body><div class="col">
  <div class="bar">⬆️ BANDEAU UI (opaque) — approche ${approach} — doit rester visible AU-DESSUS de la vidéo</div>
  <div class="hole">zone vidéo (transparente) — la mire mpv doit apparaître ICI</div>
  <div class="bar bottom"><button class="btn">⏯ Lecture</button><button class="btn">🔊</button>
    <span style="color:#9aa">⬇️ CONTRÔLES (opaque) — doivent rester visibles</span></div>
</div></body></html>`)}`;
}

function spawnMpv(hwnd) {
  log('spawn mpv --wid=' + hwnd);
  mpv = spawn(
    MPV,
    [
      `--wid=${hwnd}`,
      '--no-config',
      '--no-osc',
      '--no-input-default-bindings',
      '--no-input-cursor',
      '--cursor-autohide=no',
      '--loop-file=inf',
      '--keep-open=yes',
      '--force-window=yes',
      '--idle=no',
      TEST_SRC,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  mpv.on('error', (e) => log('mpv error', e.message));
  mpv.on('exit', (c) => log('mpv exit', c));
}

function startA() {
  uiWin = new BrowserWindow({
    ...WIN,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true },
  });
  uiWin.setAlwaysOnTop(true, 'screen-saver');
  uiWin.loadURL(uiHtml('A'));
  uiWin.webContents.once('did-finish-load', () => {
    setTimeout(() => spawnMpv(hwndOf(uiWin)), 300);
  });
}

function startB() {
  // Fenêtre vidéo (dessous) : opaque, hôte mpv.
  videoWin = new BrowserWindow({
    ...WIN,
    frame: false,
    alwaysOnTop: true,
    backgroundColor: '#000000',
    webPreferences: { contextIsolation: true },
  });
  videoWin.setAlwaysOnTop(true, 'screen-saver');
  videoWin.loadURL('data:text/html,<body style="margin:0;background:#000"></body>');

  // Fenêtre UI (dessus) : transparente, enfant, même bounds.
  uiWin = new BrowserWindow({
    ...WIN,
    parent: videoWin,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    webPreferences: { contextIsolation: true },
  });
  uiWin.setAlwaysOnTop(true, 'screen-saver');
  uiWin.loadURL(uiHtml('B'));

  // Synchronisation de position/taille : la fenêtre UI suit la fenêtre vidéo.
  const sync = () => {
    if (videoWin && uiWin) uiWin.setBounds(videoWin.getBounds());
  };
  videoWin.on('move', sync);
  videoWin.on('resize', sync);

  videoWin.webContents.once('did-finish-load', () => {
    setTimeout(() => spawnMpv(hwndOf(videoWin)), 300);
  });
}

app.whenReady().then(() => {
  log('approach', APPROACH, 'mpv', MPV);
  // Place la fenêtre sur l'écran principal au cas où le multi-écran décale.
  const area = screen.getPrimaryDisplay().workArea;
  WIN.x = area.x + 200;
  WIN.y = area.y + 120;
  if (APPROACH === 'B') startB();
  else startA();
});

function killMpv() {
  if (mpv && !mpv.killed) {
    try {
      mpv.kill();
    } catch {
      /* ignore */
    }
  }
}

app.on('window-all-closed', () => {
  killMpv();
  app.quit();
});
app.on('before-quit', killMpv);
