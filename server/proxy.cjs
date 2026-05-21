const express = require('express');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { spawn } = require('child_process');
const nodeHttps = require('https');
const nodeHttp = require('http');

// Préfère le ffmpeg/ffprobe système quand il existe (binaire apt dans Docker).
// Le binaire de `ffmpeg-static` (johnvansickle 7.0.2) segfault sur tout input
// HTTP/HTTPS dans Debian Bookworm. Le binaire système est plus fiable.
// Hors Docker (Windows / dev local), on retombe sur les versions npm.
const SYS_FFMPEG = '/usr/bin/ffmpeg';
const SYS_FFPROBE = '/usr/bin/ffprobe';
const ffmpegPath = fs.existsSync(SYS_FFMPEG) ? SYS_FFMPEG : require('ffmpeg-static');
const ffprobePath = fs.existsSync(SYS_FFPROBE) ? SYS_FFPROBE : require('ffprobe-static').path;
process.stdout.write(`[server] ffmpeg=${ffmpegPath}\n[server] ffprobe=${ffprobePath}\n`);

const app = express();
const PORT = process.env.PORT ?? 4000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? '*';

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
  if (_req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ─── Endpoint de diagnostic réseau ──────────────────────────────────────────
// /api/debug-reach?url=http://… — teste si Railway peut atteindre une URL
app.get('/api/debug-reach', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string')
    return res.status(400).json({ error: 'Paramètre url manquant' });
  const t0 = Date.now();
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.json({ ok: true, status: r.status, ms: Date.now() - t0 });
  } catch (err) {
    const cause = err?.cause ? (err.cause?.code || err.cause?.message || String(err.cause)) : '';
    return res.json({ ok: false, error: err.message, cause, ms: Date.now() - t0 });
  }
});

// ─── Proxy Xtream Codes API ────────────────────────────────────────────────
// /api/xtream?_server=https://…&username=X&password=Y&action=…
app.get('/api/xtream', async (req, res) => {
  const { _server, ...params } = req.query;
  if (!_server || typeof _server !== 'string')
    return res.status(400).json({ error: 'Paramètre _server manquant' });

  try {
    const qs = new URLSearchParams(params).toString();
    const target = `${_server.replace(/\/$/, '')}/player_api.php${qs ? '?' + qs : ''}`;
    const upstream = await fetch(target, {
      signal: AbortSignal.timeout(20_000),
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });

    if (!upstream.ok)
      return res.status(upstream.status).json({ error: `Serveur IPTV: HTTP ${upstream.status}` });

    const ct = upstream.headers.get('content-type') ?? '';
    const text = await upstream.text();
    try {
      return res.json(JSON.parse(text));
    } catch {
      if (ct.includes('json'))
        return res.status(502).json({ error: 'JSON invalide', raw: text.slice(0, 200) });
      return res.json(JSON.parse(text));
    }
  } catch (err) {
    const cause = err?.cause ? (err.cause?.code || err.cause?.message || String(err.cause)) : '';
    process.stderr.write(`[xtream] fetch error: ${err.message}${cause ? ` (${cause})` : ''} — target: ${_server}\n`);
    return res.status(502).json({ error: err instanceof Error ? err.message : String(err), cause });
  }
});

// ─── Proxy HLS & vidéo (CORS pour les streams) ────────────────────────────

// Résout une URI HLS (absolue HTTP / absolue serveur `/foo` / relative) contre
// `baseUrl` (URL du manifest, AVEC son dernier slash). Garde-fou critique :
// la concaténation naïve `baseUrl + uri` produit `…/play/TOKEN//hls/…` quand
// l'upstream renvoie un chemin absolu serveur — beaucoup de panels Xtream
// (Cloudflare devant) répondent **509 Bandwidth Limit Exceeded** sur les
// URLs à `//`. `new URL(uri, baseUrl)` gère les trois cas correctement.
function resolveUrl(uri, baseUrl) {
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  if (uri.startsWith('/')) {
    // Chemin absolu serveur : résout contre l'origine du manifest (pas la
    // baseUrl complète) — élimine le double-slash sur la jointure.
    return new URL(baseUrl).origin + uri;
  }
  // Chemin relatif : résout contre le répertoire du manifest.
  return baseUrl + uri;
}

function rewriteM3u8(content, originalUrl) {
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);

  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = resolveUrl(uri, baseUrl);
        return `URI="/api/hlsproxy?url=${encodeURIComponent(abs)}"`;
      });
    }

    const abs = resolveUrl(trimmed, baseUrl);
    return `/api/hlsproxy?url=${encodeURIComponent(abs)}`;
  }).join('\n');
}

function isM3u8(url, contentType) {
  return url.includes('.m3u8') || (contentType ?? '').includes('mpegurl');
}

// UA pour les routes /live/ : Xtream Codes rejette souvent les UA navigateur.
const UA_LIVE = 'VLC/3.0.20 LibVLC/3.0.20';
const UA_DEFAULT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const isLivePath = (u) => /\/live\//.test(u);

// Normalise les `//` dans le chemin d'une URL HTTP (pas le `://` du schéma).
// Pare-feu contre les vieilles URLs cachées côté client générées par l'ancienne
// version buggée de rewriteM3u8 (concatenation naïve `baseUrl + "/path"`).
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    u.pathname = u.pathname.replace(/\/{2,}/g, '/');
    return u.toString();
  } catch {
    return raw;
  }
}

app.get('/api/hlsproxy', async (req, res) => {
  const { url: rawUrl } = req.query;
  if (!rawUrl || typeof rawUrl !== 'string') return res.status(400).end();
  const url = normalizeUrl(rawUrl);

  // Timeout uniquement sur l'établissement de la connexion (réception des
  // headers) — sinon les streams longs (.mp4 entier, ~1h) sont coupés à 30s.
  const controller = new AbortController();
  const connTimeout = setTimeout(() => controller.abort(), 30_000);
  req.on('close', () => controller.abort());

  try {
    const origin = new URL(url).origin;
    const storedCookies = cookieStore.get(origin);
    const isLive = isLivePath(url);

    // Live : UA VLC seul (garde-fou §IV-8 — pas de Referer/Origin).
    // VOD/movies : UA navigateur + Referer + Origin obligatoires, sinon
    // beaucoup de serveurs Xtream (souvent derrière Cloudflare) renvoient
    // 551/403 sur les manifests .m3u8.
    const upstreamHeaders = isLive
      ? { 'User-Agent': UA_LIVE }
      : { 'User-Agent': UA_DEFAULT, 'Referer': `${origin}/`, 'Origin': origin };
    if (storedCookies) upstreamHeaders['Cookie'] = storedCookies;
    if (req.headers['range']) upstreamHeaders['Range'] = req.headers['range'];

    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: upstreamHeaders,
    });
    clearTimeout(connTimeout);

    // Capture cookies de session pour les prochaines requêtes (segments).
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) cookieStore.set(origin, mergeCookies(storedCookies, setCookie));

    const ct = upstream.headers.get('content-type') ?? '';
    const isManifest = url.includes('.m3u8') || ct.includes('mpegurl');

    if (!upstream.ok && upstream.status !== 206) {
      console.warn(`[hlsproxy] ${upstream.status} pour ${url.slice(0, 80)}`);
      if (isManifest) {
        // Manifest échec : retourne 200 + contenu non parseable plutôt que
        // propager le 5xx (Chrome log inévitablement "Failed to load resource"
        // en console pour tout non-2xx). HLS.js échoue alors proprement avec
        // MANIFEST_PARSING_ERROR, capté par le handler côté client.
        res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
        return res.end(`#EXT-UNAVAILABLE:${upstream.status}`);
      }
      return res.status(upstream.status).end();
    }

    if (isManifest) {
      const text = await upstream.text();
      // URL finale (après redirects Cloudflare → CDN) requise pour résoudre
      // les chemins relatifs des segments — garde-fou §IV-9 CLAUDE.md.
      const finalUrl = upstream.url || url;
      const rewritten = rewriteM3u8(text, finalUrl);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // Segment .ts ou .mp4 — forward statut (préserver 206 Partial Content) +
    // headers Range pour que la barre de progression / seek fonctionnent.
    res.status(upstream.status);
    res.setHeader('Content-Type', ct || 'application/octet-stream');
    const cl = upstream.headers.get('content-length');
    const cr = upstream.headers.get('content-range');
    const ar = upstream.headers.get('accept-ranges');
    if (cl) res.setHeader('Content-Length', cl);
    if (cr) res.setHeader('Content-Range', cr);
    if (ar) res.setHeader('Accept-Ranges', ar);

    if (upstream.body) {
      const bodyStream = Readable.fromWeb(upstream.body);
      bodyStream.on('error', () => { try { res.end(); } catch { /* */ } });
      req.on('close', () => { try { bodyStream.destroy(); } catch { /* */ } });
      bodyStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    clearTimeout(connTimeout);
    const isAbort = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    if (!isAbort) console.error('[hlsproxy]', err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(isAbort ? 499 : 502).end();
  }
});

// ─── Proxy MPEG-TS live (chaînes TV continues) ───────────────────────────
app.get('/api/liveproxy', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).end();

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).end(); }

  const controller = new AbortController();
  const connTimeout = setTimeout(() => controller.abort(), 30_000);
  req.on('close', () => controller.abort());

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': UA_LIVE,
        'Connection': 'keep-alive',
      },
    });
    clearTimeout(connTimeout);

    if (!upstream.ok) {
      console.warn(`[liveproxy] ${upstream.status} pour ${url.slice(0, 80)}`);
      return res.status(upstream.status).end();
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'video/MP2T');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    if (upstream.body) {
      const bodyStream = Readable.fromWeb(upstream.body);
      bodyStream.on('error', () => { try { res.end(); } catch { /* */ } });
      req.on('close', () => { try { bodyStream.destroy(); } catch { /* */ } });
      bodyStream.pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    clearTimeout(connTimeout);
    const isAbort = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    if (!isAbort) console.error('[liveproxy]', err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(isAbort ? 499 : 502).end();
  }
  void parsed; // référencé uniquement pour la validation URL
});

// ─── Proxy d'images IPTV (cert HTTPS souvent expiré côté upstream) ────────
app.get('/api/img', (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).end();

  let attempts = 0;
  let current = url;
  let aborted = false;
  let activeReq = null;
  req.on('close', () => {
    aborted = true;
    try { activeReq && activeReq.destroy(); } catch (_) { /* */ }
  });

  const fire = () => {
    if (aborted) return;
    let parsed;
    try { parsed = new URL(current); }
    catch { if (!res.headersSent) res.status(400).end(); return; }

    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? nodeHttps : nodeHttp;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: { 'User-Agent': UA_DEFAULT, 'Accept': 'image/*,*/*;q=0.8' },
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    };

    const upstreamReq = lib.request(opts, (upstreamRes) => {
      const status = upstreamRes.statusCode || 502;

      if ([301, 302, 303, 307, 308].includes(status) && upstreamRes.headers.location && attempts < 3) {
        attempts++;
        upstreamRes.resume();
        current = new URL(String(upstreamRes.headers.location), current).toString();
        fire();
        return;
      }

      if (status < 200 || status >= 300) {
        upstreamRes.resume();
        if (!res.headersSent) res.status(status).end();
        return;
      }

      const ct = upstreamRes.headers['content-type'] || 'image/jpeg';
      res.status(200);
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      upstreamRes.pipe(res);
      upstreamRes.on('error', () => { try { res.end(); } catch (_) { /* */ } });
    });
    activeReq = upstreamReq;
    upstreamReq.on('error', () => {
      if (!res.headersSent) res.status(502).end();
    });
    upstreamReq.setTimeout(15_000, () => {
      try { upstreamReq.destroy(); } catch (_) { /* */ }
      if (!res.headersSent) res.status(504).end();
    });
    upstreamReq.end();
  };

  fire();
});

// ─── Stores et caches (durée de vie = processus) ────────────────────────────
// Cookie store par origine — les serveurs IPTV utilisent des cookies de session
// pour authentifier les requêtes de segments après avoir servi le manifest.
const cookieStore = new Map();
// Cache probe (url → JSON sérialisé). Évite de relancer ffprobe sur le même fichier.
const probeCache = new Map();
// Cache sous-titres (url+track → WebVTT). Évite de relancer ffmpeg à chaque clic.
const subtitleCache = new Map();
const subtitleInFlight = new Map();
// Cache streambase (url+seek → timestamp K). Évite de re-prober après un aller-retour.
const streamBaseCache = new Map();
const streamBaseInFlight = new Map();

function mergeCookies(existing, setCookieHeader) {
  const newPairs = setCookieHeader.split(',').map(c => c.split(';')[0].trim());
  const map = new Map();
  for (const pair of (existing ?? '').split(';').map(s => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const pair of newPairs) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ffprobe lit depuis stdin (pipe:0) — évite tout connexion HTTP depuis le
// processus enfant (garde-fou §IV-2 CLAUDE.md).
function ffprobeFromStream(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-probesize', '3000000',   // 3 Mo — les en-têtes MKV/MP4 tiennent en ~1 Mo
      '-analyzeduration', '0',   // pas d'analyse de durée, juste les pistes
      '-print_format', 'json',
      '-show_streams',
      '-show_format',            // inclut la durée du conteneur
      'pipe:0',                  // lire depuis stdin
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    input.pipe(proc.stdin);
    input.on('error', () => { try { proc.stdin.destroy(); } catch { /* */ } });
    proc.stdin.on('error', () => {}); // ignorer EPIPE quand ffprobe ferme tôt

    let out = '';
    let errOut = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { errOut += d.toString(); });

    proc.on('close', code => {
      try { input.destroy(); } catch { /* */ }
      try { proc.stdin.destroy(); } catch { /* */ }
      if (code === 0) {
        try {
          const result = JSON.parse(out);
          process.stdout.write(`[probe] ok — ${result.streams.length} flux détecté(s)\n`);
          resolve(result);
        } catch { reject(new Error('ffprobe: invalid JSON')); }
      } else {
        if (errOut) process.stderr.write(`[probe] stderr: ${errOut.slice(0, 400)}\n`);
        reject(new Error(`ffprobe exited ${code ?? 'null'}`));
      }
    });
    proc.on('error', reject);
  });
}

// ─── /api/probe : détecte pistes audio & sous-titres via ffprobe ─────────
// Node.js fetch le fichier puis pipe le flux vers ffprobe via stdin —
// aucune connexion HTTP depuis le processus enfant (garde-fou §IV-2).
app.get('/api/probe', async (req, res) => {
  const { url: targetUrl } = req.query;
  res.setHeader('Content-Type', 'application/json');
  if (!targetUrl || typeof targetUrl !== 'string') {
    return res.end(JSON.stringify({ audio: [], subtitles: [] }));
  }

  let probeOrigin;
  try { probeOrigin = new URL(targetUrl).origin; } catch {
    return res.end(JSON.stringify({ audio: [], subtitles: [] }));
  }

  const cached = probeCache.get(targetUrl);
  if (cached) return res.end(cached);

  const probeCookies = cookieStore.get(probeOrigin);
  const probeHeaders = { 'User-Agent': UA_DEFAULT, 'Referer': `${probeOrigin}/`, 'Origin': probeOrigin };
  if (probeCookies) probeHeaders['Cookie'] = probeCookies;

  try {
    const upstream = await fetch(targetUrl, {
      signal: AbortSignal.timeout(30_000),
      headers: probeHeaders,
    });

    if (!upstream.ok || !upstream.body) throw new Error(`upstream ${upstream.status}`);

    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) cookieStore.set(probeOrigin, mergeCookies(probeCookies, setCookie));

    const nodeStream = Readable.fromWeb(upstream.body);
    const info = await ffprobeFromStream(nodeStream);

    let audioIdx = 0, subIdx = 0;
    const audio = info.streams
      .filter(s => s.codec_type === 'audio')
      .map(s => ({
        index: audioIdx++, streamIndex: s.index, codec: s.codec_name,
        language: s.tags?.language ?? '', title: s.tags?.title ?? '',
      }));

    // Codecs image (PGS/DVB/VobSub) : ffmpeg ne peut pas les convertir en WebVTT.
    // Les filtrer évite de polluer le menu avec des pistes inaffichables.
    const IMAGE_SUB_CODECS = new Set([
      'hdmv_pgs_subtitle', 'pgssub', 'pgs',
      'dvb_subtitle', 'dvbsub', 'dvb_teletext',
      'dvd_subtitle', 'vobsub', 'xsub',
    ]);
    const subtitles = info.streams
      .filter(s => s.codec_type === 'subtitle')
      .filter(s => !IMAGE_SUB_CODECS.has((s.codec_name ?? '').toLowerCase()))
      .map(s => ({
        index: subIdx++, streamIndex: s.index, codec: s.codec_name,
        language: s.tags?.language ?? '', title: s.tags?.title ?? '',
      }));

    const duration = parseFloat(info.format?.duration ?? '0') || 0;
    const probeResult = JSON.stringify({ audio, subtitles, duration });
    probeCache.set(targetUrl, probeResult);
    res.end(probeResult);
  } catch (err) {
    process.stderr.write(`[probe] ${err.message}\n`);
    res.end(JSON.stringify({ audio: [], subtitles: [], error: err.message }));
  }
});

// ─── /api/subtitle : extrait une piste de sous-titres → WebVTT ──────────
// ffmpeg se connecte directement à l'URL upstream via son client HTTP
// (Range requests pour un seek rapide), convertit en WebVTT.
app.get('/api/subtitle', async (req, res) => {
  const { url: targetUrl, track } = req.query;
  const trackIdx = parseInt(track ?? '0', 10);
  if (!targetUrl || typeof targetUrl !== 'string') return res.status(400).end();

  let subOrigin;
  try { subOrigin = new URL(targetUrl).origin; } catch {
    return res.status(400).end();
  }

  const cacheKey = `${targetUrl}#${trackIdx}`;
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');

  const cached = subtitleCache.get(cacheKey);
  if (cached) return res.end(cached);

  const inFlight = subtitleInFlight.get(cacheKey);
  if (inFlight) {
    try { return res.end(await inFlight); } catch { return res.end(''); }
  }

  const cookies = cookieStore.get(subOrigin);
  const ffArgs = [];
  ffArgs.push('-fflags', '+fastseek');
  ffArgs.push('-probesize', '1000000');
  ffArgs.push('-analyzeduration', '1000000');
  ffArgs.push('-user_agent', UA_DEFAULT);
  const headerLines = [`Referer: ${subOrigin}/`, `Origin: ${subOrigin}`];
  if (cookies) headerLines.push(`Cookie: ${cookies}`);
  ffArgs.push('-headers', headerLines.join('\r\n') + '\r\n');
  ffArgs.push('-multiple_requests', '1');
  ffArgs.push('-i', targetUrl);
  // Index ABSOLU (0:N) plutôt que 0:s:N — le probe filtre les codecs image,
  // décalant les indices relatifs. L'absolu reste valide quoi qu'il arrive.
  ffArgs.push('-map', `0:${trackIdx}`);
  ffArgs.push('-c:s', 'webvtt');
  ffArgs.push('-f', 'webvtt');
  ffArgs.push('pipe:1');

  const extractPromise = new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let errBuf = '';
    ff.stdout.on('data', d => { out += d.toString(); });
    ff.stderr.on('data', d => {
      errBuf += d.toString();
      if (errBuf.length > 4000) errBuf = errBuf.slice(-2000);
    });
    ff.on('error', reject);
    ff.on('close', code => {
      if (code === 0 && out.trim()) {
        subtitleCache.set(cacheKey, out);
        resolve(out);
      } else {
        process.stderr.write(`[subtitle] ffmpeg exit ${code}: ${errBuf.slice(-300)}\n`);
        resolve('WEBVTT\n\n');
      }
    });
    req.on('close', () => ff.kill('SIGTERM'));
  });
  subtitleInFlight.set(cacheKey, extractPromise);

  try {
    const result = await extractPromise;
    res.end(result);
  } catch (err) {
    process.stderr.write(`[subtitle] ${err.message}\n`);
    if (!res.headersSent) res.status(502).end();
  } finally {
    subtitleInFlight.delete(cacheKey);
  }
});

// ─── /api/streambase : PTS réel de la keyframe de démarrage ─────────────
// Décode 1 frame à la même position que /api/stream (-ss X -noaccurate_seek)
// et renvoie son PTS absolu K via showinfo -copyts.
// Le client corrige seekOffsetRef sur K → image, barre et sous-titres alignés.
app.get('/api/streambase', async (req, res) => {
  const { url: targetUrl, seek: seekSec } = req.query;
  res.setHeader('Content-Type', 'application/json');
  if (!targetUrl || typeof targetUrl !== 'string' || !seekSec) {
    return res.end(JSON.stringify({ base: 0 }));
  }

  let baseOrigin;
  try { baseOrigin = new URL(targetUrl).origin; } catch {
    return res.end(JSON.stringify({ base: 0 }));
  }

  const cacheKey = `${targetUrl}#${seekSec}`;
  const cachedBase = streamBaseCache.get(cacheKey);
  if (cachedBase !== undefined) return res.end(JSON.stringify({ base: cachedBase }));

  const inFlightBase = streamBaseInFlight.get(cacheKey);
  if (inFlightBase) {
    try { return res.end(JSON.stringify({ base: await inFlightBase })); }
    catch { return res.end(JSON.stringify({ base: 0 })); }
  }

  const baseCookies = cookieStore.get(baseOrigin);
  const baseArgs = [];
  baseArgs.push('-user_agent', UA_DEFAULT);
  const baseHeaders = [`Referer: ${baseOrigin}/`, `Origin: ${baseOrigin}`];
  if (baseCookies) baseHeaders.push(`Cookie: ${baseCookies}`);
  baseArgs.push('-headers', baseHeaders.join('\r\n') + '\r\n');
  baseArgs.push('-multiple_requests', '1');
  // Mêmes options de seek que /api/stream → MÊME keyframe K.
  baseArgs.push('-ss', seekSec, '-noaccurate_seek');
  baseArgs.push('-i', targetUrl);
  baseArgs.push('-map', '0:v:0');
  baseArgs.push('-vf', 'showinfo');   // imprime pts_time sur stderr
  baseArgs.push('-frames:v', '1');    // 1 frame → ffmpeg quitte aussitôt
  baseArgs.push('-copyts');           // pts_time = PTS source absolu (= K)
  baseArgs.push('-an', '-sn');
  baseArgs.push('-f', 'null', '-');

  const basePromise = new Promise(resolve => {
    const ff = spawn(ffmpegPath, baseArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errBuf = '';
    ff.stderr.on('data', d => {
      errBuf += d.toString();
      if (errBuf.length > 20000) errBuf = errBuf.slice(-10000);
    });
    ff.on('error', () => resolve(0));
    ff.on('close', () => {
      const m = errBuf.match(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/);
      const k = m ? parseFloat(m[1]) : NaN;
      const base = isFinite(k) && k >= 0 ? k : 0;
      if (base > 0) streamBaseCache.set(cacheKey, base);
      resolve(base);
    });
    req.on('close', () => ff.kill('SIGTERM'));
  });
  streamBaseInFlight.set(cacheKey, basePromise);

  try {
    res.end(JSON.stringify({ base: await basePromise }));
  } catch {
    if (!res.headersSent) res.end(JSON.stringify({ base: 0 }));
  } finally {
    streamBaseInFlight.delete(cacheKey);
  }
});

// ─── /api/stream : remux vidéo → MP4 fragmenté, piste audio sélectionnée ─
// ffmpeg se connecte directement à l'URL upstream (Range requests = seek
// quasi-instantané). Copie la vidéo, transcode l'audio en AAC universellement
// supporté par les navigateurs.
app.get('/api/stream', (req, res) => {
  const { url: targetUrl, audio: audioParam, seek: seekSec } = req.query;
  const audioTrack = parseInt(audioParam ?? '0', 10);

  if (!targetUrl || typeof targetUrl !== 'string') return res.status(400).end();

  let streamOrigin;
  try { streamOrigin = new URL(targetUrl).origin; } catch {
    return res.status(400).end();
  }

  const streamCookies = cookieStore.get(streamOrigin);

  const ffArgs = [];
  ffArgs.push('-fflags', '+fastseek+discardcorrupt');
  ffArgs.push('-probesize', '1000000');
  ffArgs.push('-analyzeduration', '1000000');
  ffArgs.push('-thread_queue_size', '1024');
  ffArgs.push('-user_agent', UA_DEFAULT);
  const headerLines = [`Referer: ${streamOrigin}/`, `Origin: ${streamOrigin}`];
  if (streamCookies) headerLines.push(`Cookie: ${streamCookies}`);
  ffArgs.push('-headers', headerLines.join('\r\n') + '\r\n');
  // Auto-reconnect en cas de coupure réseau pendant la lecture longue
  ffArgs.push('-reconnect', '1');
  ffArgs.push('-reconnect_streamed', '1');
  ffArgs.push('-reconnect_on_network_error', '1');
  ffArgs.push('-reconnect_delay_max', '5');
  ffArgs.push('-multiple_requests', '1');

  if (seekSec) {
    ffArgs.push('-ss', seekSec);
    // -noaccurate_seek : force l'audio à démarrer à la même keyframe que la
    // vidéo. Sans ça, audio démarre à X mais vidéo à keyframe K ≤ X → décalage.
    ffArgs.push('-noaccurate_seek');
  }
  ffArgs.push(
    '-i', targetUrl,
    '-map', '0:v:0',
    '-map', `0:a:${audioTrack}`,
    '-c:v', 'copy',
    '-c:a', 'aac',
    '-aac_coder', 'fast',
    '-b:a', '128k',
  );
  if (seekSec) {
    // Chrome rebase à 0 la timeline d'un fMP4 progressif → video.currentTime
    // repart de 0. Le JS recompose la position via seekOffsetRef, corrigé sur
    // la vraie keyframe K via /api/streambase (garde-fou §IV-3 CLAUDE.md).
    ffArgs.push('-output_ts_offset', `-${seekSec}`);
  }
  ffArgs.push(
    '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    'pipe:1',
  );

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');

  const ff = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  let errBuf = '';
  ff.stderr.on('data', d => {
    errBuf += d.toString();
    if (errBuf.length > 4000) errBuf = errBuf.slice(-2000);
  });

  ff.stdout.pipe(res, { end: true });
  req.on('close', () => ff.kill('SIGTERM'));

  ff.on('error', err => {
    process.stderr.write(`[stream] ffmpeg spawn error: ${err.message}\n`);
    if (!res.headersSent) res.status(502).end();
  });

  ff.on('close', code => {
    if (code !== 0 && code !== null) {
      process.stderr.write(`[stream] ffmpeg exited ${code}: ${errBuf.slice(-500)}\n`);
    }
  });
});

// ─── Production : servir le build React ───────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`[server] port ${PORT}`));
