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

// Téléchargement SEGMENTÉ + PARALLÈLE (anti-étranglement + débit). Les serveurs
// Xtream throttlent CHAQUE connexion indépendamment (token-bucket par connexion :
// burst rapide puis effondrement du débit). On récupère donc le fichier par
// tranches via en-tête `Range`, et SURTOUT plusieurs tranches EN PARALLÈLE :
// chaque connexion a son propre bucket → le débit total est multiplié par le
// nombre de connexions (= ce que font les accélérateurs IDM/aria2 -x). Chaque
// tranche reste courte donc dans la fenêtre de burst. La progression de reprise
// est tenue dans un fichier annexe (`.prog.json`) listant les tranches finies.
const CHUNK_BYTES = 8 * 1024 * 1024; // taille d'une tranche Range
// Connexions parallèles. Multiplie le débit sur les serveurs à throttle par
// connexion. Surchargé par IPTVAX_DL_CONNECTIONS (au cas où un fournisseur
// limite le nombre de connexions simultanées par compte).
const MAX_CONNECTIONS = Math.max(1, parseInt(process.env.IPTVAX_DL_CONNECTIONS || '6', 10) || 6);
const STALL_MS = 15000; // une connexion sans octet pendant ce délai → on la coupe (la tranche continue ailleurs)
const GLOBAL_STALL_MS = 60000; // AUCUN octet (toutes connexions) pendant ce délai → échec
const MAX_RANGE_RETRIES = 5; // connexions consécutives SANS octet sur une tranche → on la remet en file
const MAX_NOPROGRESS = 20; // (repli sans Range) flux consécutifs sans progrès avant échec
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

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
// Manifeste de reprise : tranches déjà téléchargées (écritures positionnelles
// parallèles → la taille du `.part` ne reflète plus la progression).
function progPath(item) {
  return path.join(dir, `${item.id}.${item.ext}.prog.json`);
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

// Charge le manifeste de reprise (tranches finies) si compatible (même taille
// totale + même découpage), sinon repart de zéro.
async function loadProg(item, total) {
  try {
    const s = JSON.parse(await fsp.readFile(progPath(item), 'utf8'));
    if (s && s.total === total && s.chunk === CHUNK_BYTES && Array.isArray(s.done)) {
      return new Set(s.done.filter((n) => Number.isInteger(n)));
    }
  } catch { /* pas de manifeste / illisible */ }
  return new Set();
}
function saveProg(item, total, done) {
  fsp
    .writeFile(progPath(item), JSON.stringify({ total, chunk: CHUNK_BYTES, done: Array.from(done) }), 'utf8')
    .catch(() => {});
}

// Sonde la source : taille totale + support des requêtes Range (206).
// Réessaie quelques fois — un aléa transitoire ne doit pas faire échouer le
// téléchargement avant même qu'il démarre.
async function probeSource(sourceUrl, baseHeaders, state) {
  let lastErr;
  for (let attempt = 0; attempt < 4 && !(state && state.aborted); attempt++) {
    try {
      const res = await request(sourceUrl, { ...baseHeaders, Range: 'bytes=0-0' });
      const code = res.statusCode || 0;
      const cr = res.headers['content-range'];
      const cl = parseInt(res.headers['content-length'] || '0', 10);
      try { res.resume(); res.destroy(); } catch { /* ignore */ }
      if (code === 206 && cr && /\/(\d+)$/.test(cr)) {
        return { rangeOk: true, total: parseInt(cr.match(/\/(\d+)$/)[1], 10) };
      }
      return { rangeOk: false, total: cl > 0 ? cl : 0 };
    } catch (e) {
      lastErr = e;
      await delay(500 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Source injoignable');
}

// Télécharge UNE connexion pour la plage [start, end] et l'écrit à sa POSITION
// dans `part`. Résout avec le NOMBRE d'octets effectivement écrits (qui peut
// être < plage demandée si le serveur ferme la connexion tôt — fréquent quand
// plusieurs connexions se partagent la bande passante). Les octets écrits sont
// VALIDES (positionnels) → l'appelant continue la tranche depuis `start + got`,
// sans jamais jeter ce qui a été reçu (progression monotone). Rejette seulement
// si rien n'a été reçu (à rejouer avec backoff).
function fetchRange(sourceUrl, headers, part, start, end, state, onBytes) {
  return new Promise((resolve, reject) => {
    request(sourceUrl, { ...headers, Range: `bytes=${start}-${end}` })
      .then((res) => {
        const code = res.statusCode || 0;
        // Mode parallèle = Range confirmé au probe → on EXIGE 206. Un 200
        // renverrait tout le fichier depuis 0 ; l'écrire à l'offset corromprait
        // le fichier → on rejette (la tranche sera rejouée).
        if (code !== 206) {
          try { res.resume(); res.destroy(); } catch { /* ignore */ }
          reject(new Error(`HTTP ${code}`));
          return;
        }
        const out = fs.createWriteStream(part, { flags: 'r+', start });
        let got = 0;
        let errored = false;
        let lastData = Date.now();
        let settled = false;
        let watch = null;
        const settle = () => {
          if (settled) return;
          settled = true;
          if (watch) clearInterval(watch);
          if (got > 0) resolve(got); // progrès partiel accepté
          else reject(new Error(errored ? 'Connexion interrompue' : 'Aucune donnée'));
        };
        const cut = () => {
          if (watch) { clearInterval(watch); watch = null; }
          try { res.destroy(); } catch { /* ignore */ }
          try { out.end(); } catch { /* ignore */ }
        };
        watch = setInterval(() => {
          if (state.aborted) cut();
          else if (Date.now() - lastData > STALL_MS) cut();
        }, 2000);
        res.on('data', (chunk) => {
          got += chunk.length;
          lastData = Date.now();
          onBytes(chunk.length);
        });
        res.on('error', () => { errored = true; try { out.end(); } catch { /* ignore */ } });
        out.on('error', () => { errored = true; try { res.destroy(); } catch { /* ignore */ } });
        // 'close' (fd libéré) couvre fin naturelle ET coupure → on résout avec
        // ce qui a été écrit.
        out.on('close', settle);
        res.pipe(out);
      })
      .catch(reject);
  });
}

// Téléchargement PARALLÈLE par tranches Range (chemin nominal).
async function downloadParallel(item, part, baseHeaders, total, state) {
  item.bytesTotal = total;
  const nChunks = Math.max(1, Math.ceil(total / CHUNK_BYTES));
  const chunkSize = (i) => Math.min((i + 1) * CHUNK_BYTES, total) - i * CHUNK_BYTES;

  // Reprise seulement si le `.part` existe ENCORE (manifeste sans fichier =
  // incohérent → on repart de zéro pour ne pas « sauter » des tranches vides).
  let partExists = false;
  try { await fsp.stat(part); partExists = true; } catch { /* absent */ }
  const done = partExists ? await loadProg(item, total) : new Set();

  // Le `.part` doit exister pour les écritures positionnelles en 'r+'.
  await fsp.open(part, 'a').then((fh) => fh.close());

  let downloaded = 0;
  for (const i of done) downloaded += chunkSize(i);
  item.bytesDownloaded = downloaded;
  persist();
  emit();

  // File de tâches : { i (index de tranche), pos (prochain octet à récupérer) }.
  // `pos` est conservé en cas de remise en file → aucune plage n'est
  // re-téléchargée deux fois dans une même session (pas de double comptage).
  const queue = [];
  for (let i = 0; i < nChunks; i++) if (!done.has(i)) queue.push({ i, pos: i * CHUNK_BYTES });

  let lastEmit = 0;
  let lastProgress = Date.now();
  let saveTimer = null;
  const scheduleSave = () => {
    if (saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; saveProg(item, total, done); }, 1000);
  };
  // MONOTONE : ne décompte jamais (les octets écrits restent valides sur disque).
  const onBytes = (n) => {
    downloaded = Math.min(downloaded + n, total);
    lastProgress = Date.now();
    item.bytesDownloaded = downloaded;
    const now = Date.now();
    if (now - lastEmit > 400) { lastEmit = now; emit(); }
  };

  // Watchdog GLOBAL : si plus AUCUNE connexion ne progresse, on abandonne.
  const globalWatch = setInterval(() => {
    if (!state.aborted && Date.now() - lastProgress > GLOBAL_STALL_MS) {
      state.globalStall = true;
      state.aborted = true; // stoppe tous les workers
    }
  }, 5000);

  const worker = async () => {
    while (!state.aborted) {
      const job = queue.shift();
      if (job === undefined) return;
      const { i } = job;
      let pos = job.pos;
      const end = Math.min(i * CHUNK_BYTES + CHUNK_BYTES, total) - 1; // inclusif
      let fails = 0;
      // Remplit la tranche depuis `pos` via autant de connexions que nécessaire
      // (chacune peut être coupée tôt par le serveur → on reprend là où on en est).
      while (pos <= end && !state.aborted) {
        let wrote = 0;
        try {
          wrote = await fetchRange(item.sourceUrl, baseHeaders, part, pos, end, state, onBytes);
        } catch { wrote = 0; }
        if (wrote > 0) {
          pos += wrote;
          fails = 0;
        } else {
          if (state.aborted) break;
          if (++fails > MAX_RANGE_RETRIES) break; // on remet la tranche en file (progrès conservé)
          await delay(Math.min(500 * fails, 4000));
        }
      }
      if (pos > end) {
        done.add(i);
        scheduleSave();
      } else if (state.aborted) {
        queue.unshift({ i, pos });
        return;
      } else {
        queue.push({ i, pos }); // reprise plus tard, depuis la position atteinte
        await delay(400 + Math.floor(Math.random() * 400));
      }
    }
  };

  const n = Math.min(MAX_CONNECTIONS, Math.max(1, queue.length));
  const workers = [];
  for (let k = 0; k < n; k++) workers.push(worker());
  await Promise.all(workers);
  clearInterval(globalWatch);
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  saveProg(item, total, done);

  if (state.globalStall) throw new Error('Connexion trop instable (téléchargement interrompu)');
  if (state.aborted) throw new Error('__aborted__'); // pause / annulation
  if (done.size < nChunks) throw new Error('Téléchargement incomplet');
  item.bytesDownloaded = total;
}

// Repli : serveur sans support Range → un seul flux depuis 0 (avec watchdog).
async function downloadSingle(item, part, baseHeaders, total, state) {
  item.bytesTotal = total;
  let noProgress = 0;
  let lastEmit = 0;

  while (!state.aborted) {
    let res;
    try {
      res = await request(item.sourceUrl, baseHeaders);
    } catch (e) {
      if (state.aborted) break;
      if (++noProgress > MAX_NOPROGRESS) throw e;
      await delay(Math.min(750 * noProgress, 5000));
      continue;
    }
    if (state.aborted) { try { res.destroy(); } catch { /* ignore */ } break; }

    const out = fs.createWriteStream(part, { flags: 'w' });
    let received = 0;
    let resEnded = false;
    let lastData = Date.now();
    let settled = false;
    let watch = null;

    await new Promise((resolve) => {
      const finish = () => { if (settled) return; settled = true; if (watch) clearInterval(watch); resolve(); };
      const cut = () => { if (watch) { clearInterval(watch); watch = null; } try { res.destroy(); } catch { /* ignore */ } try { out.end(); } catch { /* ignore */ } };
      watch = setInterval(() => {
        if (state.aborted) cut();
        else if (Date.now() - lastData > STALL_MS) cut();
      }, 2000);
      res.on('data', (chunk) => {
        received += chunk.length;
        item.bytesDownloaded = received;
        lastData = Date.now();
        const now = Date.now();
        if (now - lastEmit > 500) { lastEmit = now; emit(); }
      });
      res.on('end', () => { resEnded = true; });
      res.on('error', () => { try { out.end(); } catch { /* ignore */ } });
      out.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
      out.on('close', finish);
      res.pipe(out);
    });

    if (state.aborted) break;
    // Complet seulement si le flux est allé jusqu'au bout (sinon une coupure
    // précoce serait enregistrée comme un fichier « done » tronqué).
    if (resEnded && received > 0 && (!total || received >= total)) {
      item.bytesTotal = received;
      item.bytesDownloaded = received;
      return; // fichier complet
    }
    if (++noProgress > MAX_NOPROGRESS) throw new Error('Téléchargement bloqué (aucune donnée reçue)');
    await delay(Math.min(750 * noProgress, 5000));
  }
  throw new Error('__aborted__');
}

async function run(item) {
  // Un seul transfert à la fois par id : on attend la fin du précédent (workers
  // en cours d'arrêt) avant d'en relancer un, sinon deux jeux de workers
  // écriraient le même `.part`.
  const prev = active.get(item.id);
  if (prev) {
    try { prev.abort(); await prev.finished; } catch { /* ignore */ }
  }

  const state = { aborted: false, globalStall: false };
  let resolveFinished;
  const rec = {
    reason: null,
    abort: () => { state.aborted = true; },
    finished: new Promise((r) => { resolveFinished = r; }),
  };
  active.set(item.id, rec);

  const part = filePart(item);
  const origin = originOf(item.sourceUrl);
  const baseHeaders = { 'User-Agent': UA_DEFAULT };
  if (origin) {
    baseHeaders.Referer = `${origin}/`;
    baseHeaders.Origin = origin;
  }

  item.status = 'downloading';
  item.error = undefined;
  persist();
  emit();

  void cachePoster(item);

  try {
    const { rangeOk, total } = await probeSource(item.sourceUrl, baseHeaders, state);
    if (state.aborted) throw new Error('__aborted__');

    if (rangeOk && total > 0) {
      await downloadParallel(item, part, baseHeaders, total, state);
    } else {
      await downloadSingle(item, part, baseHeaders, total, state);
    }

    await fsp.rename(part, fileFinal(item));
    fsp.unlink(progPath(item)).catch(() => {});
    item.fileUri = pathToFileURL(fileFinal(item)).href;
    item.status = 'done';
    if (!item.bytesTotal) item.bytesTotal = item.bytesDownloaded;
    item.bytesDownloaded = item.bytesTotal || item.bytesDownloaded;
  } catch (e) {
    if (e && e.message === '__aborted__') {
      // Pause (on garde le .part + le manifeste pour reprendre) ou annulation
      // (fichiers supprimés par cancel()) — dans les deux cas, statut « pause ».
      item.status = 'paused';
    } else {
      item.status = 'error';
      item.error = e && e.message ? e.message : 'Échec du téléchargement';
    }
  } finally {
    active.delete(item.id);
    persist();
    emit();
    resolveFinished();
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
      // On attend l'arrêt effectif des workers (fds fermés) avant de supprimer
      // le fichier, sinon `unlink` échoue sur un handle encore ouvert (Windows).
      try { await rec.finished; } catch { /* ignore */ }
    }
    const item = registry.get(id);
    if (item) {
      try { await fsp.unlink(filePart(item)); } catch { /* ignore */ }
      try { await fsp.unlink(fileFinal(item)); } catch { /* ignore */ }
      try { await fsp.unlink(posterPath(item)); } catch { /* ignore */ }
      try { await fsp.unlink(progPath(item)); } catch { /* ignore */ }
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
