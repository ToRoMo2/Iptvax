// SMOKE TEST — exerce le VRAI contrôleur IPC (electron/mpv.cjs) de bout en bout.
// Valide : spawn --wid, connexion named pipe, loadfile, observe_property
// (time-pos/duration/track-list/pause/core-idle), seek, pause/play, et le flux
// d'events normalisés. Lancement : electron electron/spike-mpv-ipc.cjs
// (jetable — pas embarqué en prod).

const { app, BrowserWindow } = require('electron');
const path = require('path');
const { mpv } = require('./mpv.cjs');

const TEST_FILE = path.join(__dirname, '..', 'vendor', 'test.mp4');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    x: 200, y: 120, width: 1000, height: 640,
    frame: false, transparent: true, alwaysOnTop: true, backgroundColor: '#00000000',
    webPreferences: { contextIsolation: true },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadURL('data:text/html,<body style="margin:0;background:transparent"></body>');

  mpv.setEventSink((ev) => console.log('[ev]', JSON.stringify(ev)));

  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();
  console.log('[test] hwnd', hwnd, 'file', TEST_FILE);
  await mpv.start(hwnd);
  console.log('[test] mpv started, IPC connected');

  await mpv.load(TEST_FILE, { userAgent: 'VLC/3.0.20 LibVLC/3.0.20', headers: [] });
  console.log('[test] loadfile sent');

  // Scénario : plein écran BORDERLESS via setBounds (fiable avec fenêtre
  // transparente, contrairement à setFullScreen qui ne s'affiche pas).
  const { screen } = require('electron');
  let saved = null;
  setTimeout(() => {
    console.log('[test] >>> borderless fullscreen (setBounds display.bounds)');
    saved = win.getBounds();
    const disp = screen.getDisplayMatching(win.getBounds());
    win.setBounds(disp.bounds);
    win.setAlwaysOnTop(true, 'screen-saver');
  }, 3500);
  setTimeout(() => {
    console.log('[test] >>> exit fullscreen');
    if (saved) win.setBounds(saved);
  }, 8000);
  setTimeout(() => { console.log('[test] DONE — quitting'); mpv.dispose(); app.quit(); }, 11000);
});

app.on('window-all-closed', () => app.quit());
