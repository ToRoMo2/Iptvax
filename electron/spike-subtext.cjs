// PROBE — mpv expose-t-il `sub-text` quand `sub-visibility=no` ?
// Si oui → on rend les sous-titres en REACT (match exact de la preview + lever
// avec l'overlay). Sinon → on garde le rendu mpv et on règle le style en options.
// Jetable. Lancement : electron electron/spike-subtext.cjs

const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const MPV = path.join(__dirname, '..', 'vendor', 'mpv', 'mpv.exe');
const FILE = path.join(__dirname, '..', 'vendor', 'test-sub.mkv');
const PIPE = `\\\\.\\pipe\\iptvax-subtext-${process.pid}`;

let sock = null, rid = 0, buf = '';
function cmd(c) { if (sock) sock.write(JSON.stringify({ command: c, request_id: ++rid }) + '\n'); }

app.whenReady().then(async () => {
  const win = new BrowserWindow({ x: 200, y: 120, width: 900, height: 560, frame: false, transparent: true, alwaysOnTop: true, backgroundColor: '#00000000' });
  win.setAlwaysOnTop(true, 'screen-saver');
  await win.loadURL('data:text/html,<body style="margin:0;background:transparent"></body>');
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE(0).toString();

  const proc = spawn(MPV, [`--wid=${hwnd}`, `--input-ipc-server=${PIPE}`, '--idle=yes', '--no-config', '--terminal=no', '--msg-level=all=no', '--keep-open=yes'], { stdio: ['ignore', 'ignore', 'inherit'] });
  proc.on('exit', (c) => console.log('[mpv] exit', c));

  const connect = () => {
    const s = net.connect(PIPE);
    s.on('connect', () => {
      sock = s; s.setEncoding('utf8');
      s.on('data', (chunk) => {
        buf += chunk; let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let m; try { m = JSON.parse(line); } catch { continue; }
          if (m.event === 'property-change' && m.name === 'sub-text') {
            console.log('[SUB-TEXT]', JSON.stringify(m.data));
          }
          if (m.event === 'property-change' && m.name === 'track-list') {
            console.log('[TRACKS]', JSON.stringify((m.data || []).map((t) => ({ id: t.id, type: t.type, sel: t.selected }))));
          }
          if (m.event === 'file-loaded') {
            console.log('[test] file-loaded → sid=1 (visibility ON, default)');
            cmd(['set_property', 'sid', 1]);
          }
        }
      });
      console.log('[test] IPC connected → observe sub-text + loadfile');
      cmd(['observe_property', 100, 'sub-text']);
      cmd(['observe_property', 101, 'track-list']);
      cmd(['loadfile', FILE, 'replace']);
    });
    s.on('error', () => { s.destroy(); setTimeout(connect, 80); });
  };
  connect();

  setTimeout(() => { console.log('[test] DONE'); try { proc.kill(); } catch {} app.quit(); }, 9000);
});
app.on('window-all-closed', () => app.quit());
