const express = require('express');
const path = require('path');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 3001;

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (_req.method === 'OPTIONS') return res.sendStatus(200);
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

app.get('/api/hlsproxy', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).end();

  try {
    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
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
      const rewritten = rewriteM3u8(text, url);
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

// ─── Production : servir le build React ───────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const dist = path.join(__dirname, '..', 'dist');
  app.use(express.static(dist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`[Proxy IPTV] http://localhost:${PORT}`));
