const express = require('express');
const path = require('path');
const { Readable } = require('stream');
const nodeHttps = require('https');
const nodeHttp = require('http');

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
      return res.json(JSON.parse(text)); // retry once (some servers send wrong ct)
    }
  } catch (err) {
    return res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ─── Proxy HLS & vidéo (CORS pour les streams) ────────────────────────────
// /api/hlsproxy?url=https://serveur-iptv/…/stream.m3u8
//
// Pour les manifests .m3u8 : réécrit toutes les URLs de segments / sous-playlists
// pour qu'elles passent elles aussi par ce proxy.
// Pour les segments .ts / fichiers vidéo : pipe direct.

function rewriteM3u8(content, originalUrl) {
  const baseUrl = originalUrl.substring(0, originalUrl.lastIndexOf('/') + 1);

  return content.split('\n').map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      // Réécrire les URI= dans les tags (#EXT-X-KEY, #EXT-X-MAP, etc.)
      return line.replace(/URI="([^"]+)"/g, (_, uri) => {
        const abs = uri.startsWith('http') ? uri : baseUrl + uri;
        return `URI="/api/hlsproxy?url=${encodeURIComponent(abs)}"`;
      });
    }

    // Ligne de contenu : URL de segment ou sous-playlist
    const abs = trimmed.startsWith('http') ? trimmed : baseUrl + trimmed;
    return `/api/hlsproxy?url=${encodeURIComponent(abs)}`;
  }).join('\n');
}

function isM3u8(url, contentType) {
  return url.includes('.m3u8') || (contentType ?? '').includes('mpegurl');
}

// UA pour les routes /live/ : Xtream Codes rejette souvent les UA navigateur
// (renvoie une page HTML d'erreur). VLC est universellement accepté.
const UA_LIVE = 'VLC/3.0.20 LibVLC/3.0.20';
const UA_DEFAULT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const isLivePath = (u) => /\/live\//.test(u);

app.get('/api/hlsproxy', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).end();

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent': isLivePath(url) ? UA_LIVE : UA_DEFAULT,
      },
    });

    if (!upstream.ok) {
      console.warn(`[hlsproxy] ${upstream.status} pour ${url.slice(0, 80)}`);
      return res.status(upstream.status).end();
    }

    const ct = upstream.headers.get('content-type') ?? '';
    res.setHeader('Content-Type', ct || 'application/octet-stream');

    if (isM3u8(url, ct)) {
      const text = await upstream.text();
      // Utiliser l'URL finale après redirects (sinon les segments tapent
      // l'origine d'origine — Cloudflare / 400 Bad Request + pas de CORS).
      const finalUrl = upstream.url || url;
      const rewritten = rewriteM3u8(text, finalUrl);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      return res.send(rewritten);
    }

    // Fichiers binaires : segment .ts, vidéo mp4, etc. — pipe direct
    const cl = upstream.headers.get('content-length');
    if (cl) res.setHeader('Content-Length', cl);

    if (upstream.body) {
      Readable.fromWeb(upstream.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('[hlsproxy]', err instanceof Error ? err.message : err);
    if (!res.headersSent) res.status(502).end();
  }
});

// ─── Proxy MPEG-TS live (chaînes TV continues) ───────────────────────────
// /api/liveproxy?url=http://serveur/live/user/pass/streamId.ts
// fetch auto-suit les redirections (302) — capital pour Xtream Codes qui
// renvoie souvent vers un CDN / load-balancer.
app.get('/api/liveproxy', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).end();

  let parsed;
  try { parsed = new URL(url); } catch { return res.status(400).end(); }

  const controller = new AbortController();
  // 30 s pour l'établissement de la connexion (headers reçus) — le body peut
  // ensuite streamer indéfiniment.
  const connTimeout = setTimeout(() => controller.abort(), 30_000);
  req.on('close', () => controller.abort());

  try {
    // UA VLC obligatoire pour /live/ — pas de Referer/Origin (un vrai lecteur
    // n'en envoie pas, et certains serveurs s'en servent pour bloquer les bots).
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
});

// ─── Proxy d'images IPTV (cert HTTPS souvent expiré côté upstream) ────────
// Cf. vite.config.ts /api/img — même logique en CJS pour la prod.
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

// ─── Production : servir le build React ───────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`[server] port ${PORT}`));
