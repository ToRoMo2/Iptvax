// Téléchargeur hors-ligne Electron (Windows) — voir CLAUDE.md §XI
// (téléchargements) et src/services/downloads/electron.engine.ts.
//
// Le main process est l'UNIQUE propriétaire des fichiers (userData/downloads/)
// et du registre de métadonnées (registry.json). Il télécharge le fichier
// direct Xtream COMPLET (MKV/MP4, toutes pistes embarquées) en streaming via
// Node http(s), avec reprise par en-tête `Range`, et ré-émet la liste complète
// au renderer à chaque changement (progression / statut). mpv lit ensuite le
// fichier local hors-ligne (toutes pistes audio/sous-titres natives).
//
// En-têtes HTTP alignés sur le proxy (§IV-8) : VOD/série → UA navigateur +
// Referer/Origin de l'upstream. (Le live n'est pas téléchargeable.)

const { app } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const http = require('http');
const https = require('https');
const { pathToFileURL } = require('url');

const UA_DEFAULT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let dir = null;
let registryPath = null;
/** id → DownloadItem (métadonnées persistées). */
const registry = new Map();
/** id → { req, dest, aborted } (transferts actifs en mémoire). */
const active = new Map();
let sink = null;

function emit() {
  if (typeof sink === 'function') {
    sink({ items: Array.from(registry.values()) });
  }
}

function ensureDir() {
  if (dir) return;
  dir = path.join(app.getPath('userData'), 'downloads');
  registryPath = path.join(dir, 'registry.json');
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* ignore */ }
  // Charge le registre persistant.
  try {
    const raw = fs.readFileSync(registryPath, 'utf8');
    const arr = JSON.parse(raw);
    if (Array.isArray(arr)) {
      for (const it of arr) registry.set(it.id, it);
    }
  } catch { /* registre vide / premier lancement */ }
  // Réconcilie : un téléchargement « downloading » au dernier arrêt n'a pas pu
  // reprendre tout seul → marqué « paused » (l'utilisateur le relance).
  for (const it of registry.values()) {
    if (it.status === 'downloading' || it.status === 'queued') it.status = 'paused';
  }
}

function persist() {
  if (!registryPath) return;
  fsp
    .writeFile(registryPath, JSON.stringify(Array.from(registry.values())), 'utf8')
    .catch(() => {});
}

function filePart(item) {
  return path.join(dir, `${item.id}.${item.ext}.part`);
}
function fileFinal(item) {
  return path.join(dir, `${item.id}.${item.ext}`);
}
function posterPath(item) {
  return path.join(dir, `${item.id}.jpg`);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Requête GET suivant les redirections (Xtream/CDN), avec en-têtes + Range.
function request(url, headers, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    let mod;
    try {
      mod = new URL(url).protocol === 'http:' ? http : https;
    } catch (e) {
      reject(e);
      return;
    }
    const req = mod.get(url, { headers }, (res) => {
      const code = res.statusCode || 0;
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume();
        if (redirectsLeft <= 0) {
          reject(new Error('Trop de redirections'));
          return;
        }
        const next = new URL(res.headers.location, url).href;
        resolve(request(next, headers, redirectsLeft - 1));
        return;
      }
      if (code !== 200 && code !== 206) {
        res.resume();
        reject(new Error(`HTTP ${code}`));
        return;
      }
      resolve(res);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Délai dépassé')));
  });
}

async function cachePoster(item) {
  if (!item.poster || !/^https?:\/\//i.test(item.poster)) return;
  try {
    const res = await request(item.poster, { 'User-Agent': UA_DEFAULT });
    const out = fs.createWriteStream(posterPath(item));
    await new Promise((resolve, reject) => {
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.on('error', reject);
    });
    item.posterLocalPath = pathToFileURL(posterPath(item)).href;
    persist();
    emit();
  } catch { /* best-effort : on garde le poster distant */ }
}

async function run(item) {
  const rec = { reason: null };
  active.set(item.id, rec);

  const part = filePart(item);
  let startAt = 0;
  try {
    const st = await fsp.stat(part);
    startAt = st.size;
  } catch { startAt = 0; }

  const origin = originOf(item.sourceUrl);
  const headers = { 'User-Agent': UA_DEFAULT };
  if (origin) {
    headers.Referer = `${origin}/`;
    headers.Origin = origin;
  }
  if (startAt > 0) headers.Range = `bytes=${startAt}-`;

  item.status = 'downloading';
  item.bytesDownloaded = startAt;
  persist();
  emit();

  void cachePoster(item);

  try {
    const res = await request(item.sourceUrl, headers);
    // Taille totale : Content-Range (reprise) sinon Content-Length (+ offset).
    const cr = res.headers['content-range'];
    if (cr && /\/(\d+)$/.test(cr)) {
      item.bytesTotal = parseInt(cr.match(/\/(\d+)$/)[1], 10);
    } else {
      const cl = parseInt(res.headers['content-length'] || '0', 10);
      if (cl > 0) item.bytesTotal = startAt + cl;
    }

    const out = fs.createWriteStream(part, { flags: startAt > 0 ? 'a' : 'w' });
    let received = startAt;
    let lastEmit = 0;

    await new Promise((resolve, reject) => {
      rec.abort = () => {
        res.destroy();
        out.destroy();
        reject(new Error('__aborted__'));
      };
      res.on('data', (chunk) => {
        received += chunk.length;
        item.bytesDownloaded = received;
        const now = Date.now();
        if (now - lastEmit > 500) {
          lastEmit = now;
          emit();
        }
      });
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.on('error', reject);
    });

    await fsp.rename(part, fileFinal(item));
    item.fileUri = pathToFileURL(fileFinal(item)).href;
    item.status = 'done';
    if (!item.bytesTotal) item.bytesTotal = received;
    item.bytesDownloaded = received;
  } catch (e) {
    if (rec.reason === 'pause') {
      // Pause : on garde le .part pour reprendre plus tard (Range).
      item.status = 'paused';
    } else if (rec.reason === 'cancel') {
      // Annulation : le fichier partiel est supprimé par `cancel()`.
      item.status = 'paused';
    } else {
      item.status = 'error';
      item.error = e && e.message ? e.message : 'Échec du téléchargement';
    }
  } finally {
    active.delete(item.id);
    persist();
    emit();
  }
}

const downloads = {
  setEventSink(fn) {
    sink = fn;
  },

  async start(req) {
    ensureDir();
    const existing = registry.get(req.id);
    const item = existing || {
      ...req,
      bytesDownloaded: 0,
      bytesTotal: req.bytesTotal || 0,
      status: 'queued',
      addedAt: Date.now(),
    };
    // Re-déclenchement (retry / reprise) : on repart du descripteur frais.
    Object.assign(item, { sourceUrl: req.sourceUrl, ext: req.ext, status: 'queued' });
    registry.set(item.id, item);
    persist();
    emit();
    void run(item);
  },

  async pause(id) {
    const rec = active.get(id);
    if (rec && rec.abort) {
      rec.reason = 'pause'; // conserve le .part (reprise par Range)
      try { rec.abort(); } catch { /* ignore */ }
    } else {
      const item = registry.get(id);
      if (item && item.status !== 'done') {
        item.status = 'paused';
        persist();
        emit();
      }
    }
  },

  async resume(id) {
    const item = registry.get(id);
    if (!item || item.status === 'done') return;
    ensureDir();
    void run(item);
  },

  async cancel(id) {
    const rec = active.get(id);
    if (rec && rec.abort) {
      rec.reason = 'cancel';
      try { rec.abort(); } catch { /* ignore */ }
    }
    const item = registry.get(id);
    if (item) {
      try { await fsp.unlink(filePart(item)); } catch { /* ignore */ }
      try { await fsp.unlink(fileFinal(item)); } catch { /* ignore */ }
      try { await fsp.unlink(posterPath(item)); } catch { /* ignore */ }
      registry.delete(id);
      persist();
      emit();
    }
  },

  async remove(id) {
    return this.cancel(id);
  },

  async list() {
    ensureDir();
    return Array.from(registry.values());
  },

  dispose() {
    for (const rec of active.values()) {
      try { if (rec.abort) { rec.reason = 'pause'; rec.abort(); } } catch { /* ignore */ }
    }
    active.clear();
  },
};

module.exports = { downloads };
