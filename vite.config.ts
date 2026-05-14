import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { Readable } from 'node:stream';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const ffmpegPath: string  = _require('ffmpeg-static') as string;
const ffprobePath: string = (_require('ffprobe-static') as { path: string }).path;

// Résout une URI relative (chemin absolu ou relatif) par rapport à baseUrl
function resolveUrl(uri: string, baseUrl: string): string {
  if (uri.startsWith('http://') || uri.startsWith('https://')) return uri;
  // Chemin absolu (commence par /) : résoudre par rapport à l'origine
  if (uri.startsWith('/')) {
    const origin = new URL(baseUrl).origin;
    return origin + uri;
  }
  // Chemin relatif : résoudre par rapport au répertoire de base
  return baseUrl + uri;
}

// Réécrit les URLs dans un manifest HLS.
// Stratégie :
//   - Sous-playlists (.m3u8) → proxy (CORS sur le manifest)
//   - Fichiers clé (URI="...") → proxy
//   - Segments (.ts, .aac, .mp4…) → URL directe (le navigateur les demande lui-même ;
//     Chrome passe le filtre TLS de Cloudflare, contrairement à Node.js fetch)
function rewriteM3u8(content: string, baseUrl: string): string {
  return content
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      if (trimmed.startsWith('#')) {
        // Réécrire les URI="..." (EXT-X-KEY, EXT-X-MAP…) → proxy
        return line.replace(/URI="([^"]+)"/g, (_: string, uri: string) => {
          const abs = resolveUrl(uri, baseUrl);
          return `URI="/api/hlsproxy?url=${encodeURIComponent(abs)}"`;
        });
      }

      const abs = resolveUrl(trimmed, baseUrl);

      // Sous-playlist → proxy
      if (abs.includes('.m3u8')) {
        return `/api/hlsproxy?url=${encodeURIComponent(abs)}`;
      }

      // Segment média → URL directe (navigateur natif, TLS Chrome)
      return abs;
    })
    .join('\n');
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Cookie store par origine — les serveurs IPTV utilisent souvent des cookies de session
// pour authentifier les requêtes de segments après avoir servi le manifest.
const cookieStore = new Map<string, string>();

// Cache des sous-titres extraits (clé = url+track, valeur = WebVTT).
// Évite de relancer ffmpeg sur tout le fichier à chaque clic utilisateur.
const subtitleCache = new Map<string, string>();
const subtitleInFlight = new Map<string, Promise<string>>();

function mergeCookies(existing: string | undefined, setCookieHeader: string): string {
  const newPairs = setCookieHeader.split(',').map((c) => c.split(';')[0].trim());
  const map = new Map<string, string>();
  for (const pair of (existing ?? '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const pair of newPairs) {
    const eq = pair.indexOf('=');
    if (eq > 0) map.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  return [...map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

// ── ffprobe: detect audio & subtitle tracks in a video URL ─────────────────
interface ProbeStream {
  index: number;
  codec_type: string;
  codec_name: string;
  tags?: { language?: string; title?: string };
}
interface ProbeResult {
  streams: ProbeStream[];
  format?: { duration?: string };
}

// ffprobe lit depuis stdin (pipe:0) — évite les problèmes de connexion HTTP
// entre les processus enfants et le serveur Vite sur Windows.
function ffprobeFromStream(input: NodeJS.ReadableStream): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'error',
      '-probesize', '5000000',  // max 5 Mo analysés (évite de tout télécharger)
      '-analyzeduration', '0',  // pas d'analyse de durée — on veut juste les pistes
      '-print_format', 'json',
      '-show_streams',
      '-show_format',           // inclut la durée du conteneur
      'pipe:0',                 // lire depuis stdin
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    input.pipe(proc.stdin);
    input.on('error', () => { try { proc.stdin.destroy(); } catch { /* */ } });
    proc.stdin.on('error', () => {}); // ignorer EPIPE quand ffprobe ferme tôt

    let out = '';
    let errOut = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => { errOut += d.toString(); });

    proc.on('close', (code) => {
      // Arrêter le téléchargement upstream (ffprobe n'a lu que les premiers Mo)
      try { (input as any).destroy?.(); } catch { /* */ }
      try { proc.stdin.destroy(); } catch { /* */ }
      if (code === 0) {
        try {
          const result = JSON.parse(out) as ProbeResult;
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

// Plugin Vite : proxy IPTV intégré (dev uniquement — pas de processus séparé)
function iptvProxyPlugin(): Plugin {
  return {
    name: 'iptv-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if ((req.url ?? '').startsWith('/api/')) {
          process.stdout.write(`[iptv-proxy] ${req.method} ${req.url}\n`);
        }
        // OPTIONS preflight
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', '*');
        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        const reqUrl = new URL(req.url ?? '/', 'http://localhost');

        // ── /api/xtream : proxy vers l'API Xtream Codes ──────────────────
        if (reqUrl.pathname === '/api/xtream') {
          const params = Object.fromEntries(reqUrl.searchParams.entries());
          const { _server, ...apiParams } = params;

          if (!_server) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Paramètre _server manquant' }));
            return;
          }

          try {
            const qs = new URLSearchParams(apiParams).toString();
            const target = `${_server.replace(/\/$/, '')}/player_api.php${qs ? `?${qs}` : ''}`;

            const upstream = await fetch(target, {
              signal: AbortSignal.timeout(20_000),
              headers: { 'User-Agent': UA },
            });

            const text = await upstream.text();
            res.setHeader('Content-Type', 'application/json');

            try {
              res.end(JSON.stringify(JSON.parse(text)));
            } catch {
              res.statusCode = 502;
              res.end(JSON.stringify({ error: 'Réponse non-JSON du serveur IPTV' }));
            }
          } catch (err) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: (err as Error).message }));
          }
          return;
        }

        // ── /api/hlsproxy : proxy HLS + vidéo (résout le CORS des streams) ─
        if (reqUrl.pathname === '/api/hlsproxy') {
          const targetUrl = reqUrl.searchParams.get('url');
          if (!targetUrl) {
            res.statusCode = 400;
            res.end();
            return;
          }

          // Abort upstream fetch when client disconnects (navigateur ou ffmpeg ferme la connexion).
          // On utilise une AbortController plutôt qu'AbortSignal.timeout() pour ne PAS couper
          // les streams longs (ffmpeg transcoding ~1h) après 30 secondes.
          // Le timeout de 30s ne s'applique qu'à l'établissement de la connexion (réception des headers).
          const controller = new AbortController();
          const connTimeout = setTimeout(() => controller.abort(), 30_000);
          req.on('close', () => controller.abort());

          try {
            const origin = new URL(targetUrl).origin;
            const storedCookies = cookieStore.get(origin);

            const upstreamHeaders: Record<string, string> = {
              'User-Agent': UA,
              'Referer': `${origin}/`,
              'Origin': origin,
            };
            if (storedCookies) upstreamHeaders['Cookie'] = storedCookies;
            if (req.headers['range']) upstreamHeaders['Range'] = req.headers['range'] as string;

            const upstream = await fetch(targetUrl, {
              signal: controller.signal,
              headers: upstreamHeaders,
            });

            // Headers reçus → annuler le timeout de connexion.
            // Le body peut maintenant streamer indéfiniment (limite = déconnexion client).
            clearTimeout(connTimeout);

            // Capturer les cookies de session pour les prochaines requêtes
            const setCookie = upstream.headers.get('set-cookie');
            if (setCookie) {
              cookieStore.set(origin, mergeCookies(storedCookies, setCookie));
            }

            const ct = upstream.headers.get('content-type') ?? '';
            const isManifest = targetUrl.includes('.m3u8') || ct.includes('mpegurl');

            if (!upstream.ok && upstream.status !== 206) {
              console.warn(`[hlsproxy] ${upstream.status} ← ${targetUrl}`);

              if (isManifest) {
                // Pour les manifests HLS : retourner HTTP 200 avec un contenu non-parseable
                // au lieu de propager le code d'erreur upstream (ex: 551 = trop de connexions).
                // Raison : Chrome log automatiquement "Failed to load resource: 5xx" dans la
                // console pour toute réponse non-2xx — il n'existe aucun moyen de supprimer
                // ce message depuis JS. En retournant 200, HLS.js tente de parser le contenu,
                // échoue (MANIFEST_PARSING_ERROR, fatal), notre handler l'attrape et affiche
                // l'UI d'erreur — sans aucun bruit dans la console du navigateur.
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.end(`#EXT-UNAVAILABLE:${upstream.status}`);
                return;
              }

              res.statusCode = upstream.status;
              res.end();
              return;
            }

            if (isManifest) {
              const text = await upstream.text();
              const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
              const rewritten = rewriteM3u8(text, baseUrl);
              res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
              res.end(rewritten);
            } else {
              // Segment .ts, fichier vidéo mp4, etc. — stream direct
              res.statusCode = upstream.status; // préserve 206 Partial Content
              res.setHeader('Content-Type', ct || 'application/octet-stream');
              const cl = upstream.headers.get('content-length');
              const cr = upstream.headers.get('content-range');
              const ar = upstream.headers.get('accept-ranges');
              if (cl) res.setHeader('Content-Length', cl);
              if (cr) res.setHeader('Content-Range', cr);
              if (ar) res.setHeader('Accept-Ranges', ar);

              if (upstream.body) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const bodyStream = Readable.fromWeb(upstream.body as any);
                // Crucial : sans handler 'error', un abort upstream (client déconnecté)
                // remonte en exception non capturée et crashe le serveur Vite.
                bodyStream.on('error', () => { try { res.end(); } catch { /* */ } });
                req.on('close', () => { try { bodyStream.destroy(); } catch { /* */ } });
                bodyStream.pipe(res);
              } else {
                res.end();
              }
            }
          } catch (err) {
            clearTimeout(connTimeout);
            // Ignorer les erreurs d'abandon normales (client déconnecté)
            const isAbort = (err as Error).name === 'AbortError' || (err as NodeJS.ErrnoException).code === 'ABORT_ERR';
            if (!isAbort) {
              console.error('[hlsproxy]', (err as Error).message);
            }
            if (!res.headersSent) {
              res.statusCode = isAbort ? 499 : 502;
              res.end();
            }
          }
          return;
        }

        // ── /api/liveproxy : stream MPEG-TS live continu ─────────────────
        if (reqUrl.pathname === '/api/liveproxy') {
          const targetUrl = reqUrl.searchParams.get('url');
          if (!targetUrl) { res.statusCode = 400; res.end(); return; }

          let parsed: URL;
          try { parsed = new URL(targetUrl); } catch {
            res.statusCode = 400; res.end(); return;
          }

          const transport = parsed.protocol === 'https:' ? https : http;
          const proxyReq = transport.request(
            {
              hostname: parsed.hostname,
              port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
              path: parsed.pathname + parsed.search,
              method: 'GET',
              headers: {
                'User-Agent': UA,
                'Referer': `${parsed.origin}/`,
                'Connection': 'keep-alive',
              },
            },
            (proxyRes) => {
              if (!proxyRes.statusCode || proxyRes.statusCode >= 400) {
                console.warn(`[liveproxy] ${proxyRes.statusCode} ← ${targetUrl}`);
                res.statusCode = proxyRes.statusCode ?? 502;
                res.end();
                return;
              }
              res.setHeader('Content-Type', proxyRes.headers['content-type'] ?? 'video/MP2T');
              res.setHeader('Transfer-Encoding', 'chunked');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('X-Accel-Buffering', 'no');
              proxyRes.pipe(res, { end: true });
              proxyRes.on('error', () => { if (!res.headersSent) res.end(); });
            },
          );

          // Si le client (navigateur) se déconnecte, couper la connexion IPTV
          req.on('close', () => proxyReq.destroy());
          proxyReq.on('error', (err) => {
            if ((err as NodeJS.ErrnoException).code !== 'ECONNRESET' && !res.headersSent) {
              res.statusCode = 502; res.end();
            }
          });
          proxyReq.end();
          return;
        }

        // ── /api/probe : détecte pistes audio & sous-titres via ffprobe ───
        // Stratégie : Node.js fetch le fichier (UA navigateur → passe Cloudflare)
        // puis pipe le flux vers ffprobe via stdin — aucune connexion HTTP depuis
        // le processus enfant (évite les blocages firewall Windows).
        if (reqUrl.pathname === '/api/probe') {
          const targetUrl = reqUrl.searchParams.get('url');
          res.setHeader('Content-Type', 'application/json');
          if (!targetUrl) { res.end(JSON.stringify({ audio: [], subtitles: [] })); return; }

          let probeOrigin: string;
          try { probeOrigin = new URL(targetUrl).origin; } catch {
            res.end(JSON.stringify({ audio: [], subtitles: [] })); return;
          }

          const probeCookies = cookieStore.get(probeOrigin);
          const probeHeaders: Record<string, string> = {
            'User-Agent': UA, 'Referer': `${probeOrigin}/`, 'Origin': probeOrigin,
          };
          if (probeCookies) probeHeaders['Cookie'] = probeCookies;

          try {
            const upstream = await fetch(targetUrl, {
              signal: AbortSignal.timeout(30_000),
              headers: probeHeaders,
            });

            if (!upstream.ok || !upstream.body) {
              throw new Error(`upstream ${upstream.status}`);
            }

            const setCookie = upstream.headers.get('set-cookie');
            if (setCookie) cookieStore.set(probeOrigin, mergeCookies(probeCookies, setCookie));

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const nodeStream = Readable.fromWeb(upstream.body as any);
            const info = await ffprobeFromStream(nodeStream);

            let audioIdx = 0, subIdx = 0;
            const audio = info.streams
              .filter((s) => s.codec_type === 'audio')
              .map((s) => ({
                index: audioIdx++, streamIndex: s.index, codec: s.codec_name,
                language: s.tags?.language ?? '', title: s.tags?.title ?? '',
              }));
            // Codecs sous-titres "image" (PGS Blu-ray, DVB-sub TNT, VobSub DVD) : ffmpeg
            // ne peut PAS les convertir en WebVTT (ce ne sont pas du texte mais des bitmaps).
            // Les filtrer ici évite de polluer le menu avec des pistes qui ne marcheraient
            // jamais — l'utilisateur ne voit que les sous-titres qui s'afficheront.
            const IMAGE_SUB_CODECS = new Set([
              'hdmv_pgs_subtitle', 'pgssub', 'pgs',
              'dvb_subtitle', 'dvbsub', 'dvb_teletext',
              'dvd_subtitle', 'vobsub',
              'xsub',
            ]);
            const subtitles = info.streams
              .filter((s) => s.codec_type === 'subtitle')
              .filter((s) => !IMAGE_SUB_CODECS.has((s.codec_name ?? '').toLowerCase()))
              // subIdx compte uniquement les sous-titres TEXTE → l'index ffmpeg 0:s:N
              // référence le N-ième sous-titre du fichier après filtrage des codecs image.
              // ⚠ ATTENTION : on doit utiliser streamIndex absolu côté ffmpeg, pas subIdx.
              .map((s) => ({
                index: subIdx++, streamIndex: s.index, codec: s.codec_name,
                language: s.tags?.language ?? '', title: s.tags?.title ?? '',
              }));
            // Durée réelle du fichier (en secondes) — depuis les métadonnées du conteneur
            const duration = parseFloat(info.format?.duration ?? '0') || 0;
            res.end(JSON.stringify({ audio, subtitles, duration }));
          } catch (err) {
            process.stderr.write(`[probe] ${(err as Error).message}\n`);
            res.end(JSON.stringify({ audio: [], subtitles: [], error: (err as Error).message }));
          }
          return;
        }

        // ── /api/subtitle : extrait une piste de sous-titres → WebVTT ─────
        // ffmpeg lit le fichier en HTTP+Range, ne décode que la piste sub demandée,
        // convertit en WebVTT (compris nativement par <track>). Mis en cache.
        if (reqUrl.pathname === '/api/subtitle') {
          const targetUrl = reqUrl.searchParams.get('url');
          const trackIdx = parseInt(reqUrl.searchParams.get('track') ?? '0', 10);
          if (!targetUrl) { res.statusCode = 400; res.end(); return; }

          let subOrigin: string;
          try { subOrigin = new URL(targetUrl).origin; } catch {
            res.statusCode = 400; res.end(); return;
          }

          const cacheKey = `${targetUrl}#${trackIdx}`;
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          res.setHeader('Access-Control-Allow-Origin', '*');

          const cached = subtitleCache.get(cacheKey);
          if (cached) { res.end(cached); return; }

          // Si une extraction est déjà en cours pour cette clé, attendre son résultat
          // (déduplication des clics utilisateur rapides)
          const inFlight = subtitleInFlight.get(cacheKey);
          if (inFlight) {
            try { res.end(await inFlight); } catch { res.end(''); }
            return;
          }

          const cookies = cookieStore.get(subOrigin);
          const ffArgs: string[] = [];
          ffArgs.push('-user_agent', UA);
          const headerLines = [`Referer: ${subOrigin}/`, `Origin: ${subOrigin}`];
          if (cookies) headerLines.push(`Cookie: ${cookies}`);
          ffArgs.push('-headers', headerLines.join('\r\n') + '\r\n');
          ffArgs.push('-multiple_requests', '1');
          ffArgs.push('-i', targetUrl);
          // ⚠️ CRUCIAL : préserver les timestamps absolus du fichier source.
          // Sans -copyts, ffmpeg rebase l'output pour démarrer à 0 (via
          // -avoid_negative_ts make_non_negative par défaut). Si la piste de
          // sous-titres a un start_time non-nul dans le conteneur (très courant
          // sur MKV où la piste sub commence un peu avant la vidéo), TOUS les
          // cues sont décalés vers l'avant → sous-titres systématiquement en avance.
          // -copyts conserve les PTS d'origine → alignement parfait avec la timeline vidéo.
          ffArgs.push('-copyts');
          // Désactive explicitement le rebasage négatif (ceinture + bretelles avec -copyts).
          ffArgs.push('-avoid_negative_ts', 'disabled');
          // On utilise l'index ABSOLU de stream (0:N) plutôt que 0:s:N car le probe
          // filtre les codecs image (PGS/DVB) → 0:s:N ne correspondrait plus à la
          // numérotation côté JS. L'index absolu reste valide quoi qu'il arrive.
          ffArgs.push('-map', `0:${trackIdx}`);
          ffArgs.push('-c:s', 'webvtt');
          ffArgs.push('-f', 'webvtt');
          ffArgs.push('pipe:1');

          const extractPromise = new Promise<string>((resolve, reject) => {
            const ff = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            let out = '';
            let errBuf = '';
            ff.stdout.on('data', (d: Buffer) => { out += d.toString(); });
            ff.stderr.on('data', (d: Buffer) => {
              errBuf += d.toString();
              if (errBuf.length > 4000) errBuf = errBuf.slice(-2000);
            });
            ff.on('error', reject);
            ff.on('close', (code) => {
              if (code === 0 && out.trim()) {
                subtitleCache.set(cacheKey, out);
                resolve(out);
              } else {
                process.stderr.write(`[subtitle] ffmpeg exit ${code}: ${errBuf.slice(-300)}\n`);
                // Codec image-based (PGS, DVB) ou erreur → renvoyer un VTT vide valide
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
            process.stderr.write(`[subtitle] ${(err as Error).message}\n`);
            if (!res.headersSent) { res.statusCode = 502; res.end(); }
          } finally {
            subtitleInFlight.delete(cacheKey);
          }
          return;
        }

        // ── /api/stream : remux vidéo → MP4 fragmenté, piste audio sélectionnée ─
        // Stratégie : Node.js fetch le fichier, pipe vers ffmpeg via stdin (pipe:0).
        // ffmpeg copie la vidéo et transcode l'audio en AAC (universel navigateur).
        // Aucune connexion HTTP depuis ffmpeg — évite les blocages firewall Windows.
        if (reqUrl.pathname === '/api/stream') {
          const targetUrl  = reqUrl.searchParams.get('url');
          const audioTrack = parseInt(reqUrl.searchParams.get('audio') ?? '0', 10);
          const seekSec    = reqUrl.searchParams.get('seek');

          if (!targetUrl) { res.statusCode = 400; res.end(); return; }

          let streamOrigin: string;
          try { streamOrigin = new URL(targetUrl).origin; } catch {
            res.statusCode = 400; res.end(); return;
          }

          const streamCookies = cookieStore.get(streamOrigin);

          // Stratégie : ffmpeg fetch directement l'upstream (pas de stdin pipe).
          // → son client HTTP utilise Range, donc seek = quasi instantané.
          // On lui passe UA + Referer + Origin + Cookie pour passer Cloudflare.
          const ffArgs: string[] = [];
          // Démarrage rapide : analyser seulement le minimum avant de commencer à sortir.
          ffArgs.push('-fflags', '+fastseek+discardcorrupt');
          ffArgs.push('-probesize', '1000000');         // 1 MB (vs 5 MB par défaut)
          ffArgs.push('-analyzeduration', '1000000');   // 1s (vs 5s par défaut)
          ffArgs.push('-thread_queue_size', '1024');
          ffArgs.push('-user_agent', UA);
          const headerLines = [
            `Referer: ${streamOrigin}/`,
            `Origin: ${streamOrigin}`,
          ];
          if (streamCookies) headerLines.push(`Cookie: ${streamCookies}`);
          ffArgs.push('-headers', headerLines.join('\r\n') + '\r\n');
          // Auto-reconnect en cas de coupure réseau pendant la lecture longue
          ffArgs.push('-reconnect', '1');
          ffArgs.push('-reconnect_streamed', '1');
          ffArgs.push('-reconnect_on_network_error', '1');
          ffArgs.push('-reconnect_delay_max', '5');
          // HTTP keep-alive : permet à ffmpeg de réutiliser la même connexion TCP
          // pour plusieurs requêtes Range — accélère sensiblement le seek.
          ffArgs.push('-multiple_requests', '1');

          if (seekSec) {
            ffArgs.push('-ss', seekSec);
            // Crucial pour la sync A/V : sans ça, ffmpeg lit la vidéo depuis la
            // keyframe précédente (avec -c:v copy, obligatoire) MAIS jette la
            // portion d'audio entre la keyframe et X (puisque l'audio est ré-encodé).
            // Résultat : audio démarre à X, vidéo à X-2s → audio en avance de 2s.
            // -noaccurate_seek force l'audio à démarrer à la même keyframe que la vidéo.
            ffArgs.push('-noaccurate_seek');
          }
          ffArgs.push(
            '-i', targetUrl,
            '-map', '0:v:0',
            '-map', `0:a:${audioTrack}`,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-aac_coder', 'fast',  // encodeur AAC le plus rapide (vs twoloop par défaut)
            '-b:a', '128k',         // qualité standard, encode plus vite que 192k
          );
          if (seekSec) {
            // Décale la sortie pour démarrer à 0 (le seekOffset côté JS compense)
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
          ff.stderr.on('data', (d: Buffer) => {
            errBuf += d.toString();
            if (errBuf.length > 4000) errBuf = errBuf.slice(-2000);
          });

          ff.stdout.pipe(res, { end: true });
          req.on('close', () => ff.kill('SIGTERM'));

          ff.on('error', (err) => {
            process.stderr.write(`[stream] ffmpeg spawn error: ${err.message}\n`);
            if (!res.headersSent) { res.statusCode = 502; res.end(); }
          });

          ff.on('close', (code) => {
            if (code !== 0 && code !== null) {
              process.stderr.write(`[stream] ffmpeg exited ${code}: ${errBuf.slice(-500)}\n`);
            }
          });

          return;
        }

        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), iptvProxyPlugin()],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          hls: ['hls.js'],
          mpegts: ['mpegts.js'],
          nav: ['@noriginmedia/norigin-spatial-navigation'],
        },
      },
    },
  },
});
