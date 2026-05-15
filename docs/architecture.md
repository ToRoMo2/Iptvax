# Architecture — IPTV App

> **Lire uniquement lors d'une modification structurelle.** Référence depuis CLAUDE.md §II.

---

## 1. Vue d'ensemble

L'application est une **SPA React 18** avec un backend embarqué dans le plugin Vite (`vite.config.ts`). Il n'existe pas de serveur Node.js séparé en développement — les 6 routes `/api/*` sont des middlewares Express-like injectés directement dans le dev server Vite.

En production, `server/proxy.cjs` remplace le plugin Vite et sert les mêmes routes via Express 5.

Le pipeline média est hybride :
- **HLS / live** → HLS.js ou mpegts.js (natif dans le navigateur)
- **Fichiers directs** → ffmpeg retranscode en fMP4 fragmenté streamé en chunked HTTP
- **Sous-titres** → toujours ffmpeg → WebVTT, parsé en JS, rendu via `div` overlay (jamais `<track>`)

---

## 2. Diagramme de flux (couches)

```
┌─────────────────────────────────────────────────────┐
│  NAVIGATEUR                                          │
│                                                      │
│  pages/           (écrans : Home, Player, Series…)   │
│    ↓ importe                                         │
│  components/      (VideoPlayer, Sidebar, MediaCard…) │
│    ↓ importe                                         │
│  hooks/           (usePlayer — toute la logique AV)  │
│    ↓ importe                        ↑ lit context    │
│  context/         (XtreamContext — auth, creds)      │
│    ↓ importe                                         │
│  services/        (xtream.service, storage.service)  │
│    ↓ importe                                         │
│  types/           (xtream.types, iptv.types)         │
│  utils/           (image.ts — fonctions pures)       │
└─────────────────────────────────────────────────────┘
            │ fetch /api/*
            ▼
┌─────────────────────────────────────────────────────┐
│  VITE PLUGIN (vite.config.ts) — Node.js uniquement  │
│                                                      │
│  /api/xtream    → fetch Xtream Codes API             │
│  /api/hlsproxy  → fetch (follow-redirects) + m3u8     │
│  /api/liveproxy → fetch (follow-redirects) MPEG-TS    │
│  /api/img       → node:https (rejectUnauthorized:false)│
│  /api/probe     → spawn ffprobe (stdin pipe)         │
│  /api/subtitle  → spawn ffmpeg → WebVTT (cache RAM)  │
│  /api/streambase→ spawn ffmpeg 1-frame → PTS keyframe │
│  /api/stream    → spawn ffmpeg fMP4 + Range seek     │
└─────────────────────────────────────────────────────┘
```

---

## 3. Règles de couplage

| Couche | Peut importer | Ne doit JAMAIS importer |
|---|---|---|
| `types/` | rien | tout le reste |
| `utils/` | rien | tout le reste |
| `services/` | `types/` | `hooks/`, `context/`, `components/`, `pages/` |
| `context/` | `services/`, `types/` | `hooks/`, `components/`, `pages/` |
| `hooks/` | `types/`, `utils/` | `services/` directement, `context/`, `pages/`, `components/` |
| `components/` | `hooks/`, `types/`, `utils/`, `*.module.css` | `context/`, `services/`, `pages/` |
| `pages/` | tout sauf `pages/` entre elles | import circulaire entre pages |
| `vite.config.ts` | `node:*`, npm libs Node.js | tout `src/` |

> **Règle des hooks** : un hook ne doit pas appeler `xtreamService` directement. Si un hook a besoin de credentials, il reçoit l'URL finale en paramètre (découplage). Seules les pages/context font le lien services ↔ hooks.

---

## 4. Anti-patterns critiques à éviter

### Média / Player

| Anti-pattern | Pourquoi | Correctif |
|---|---|---|
| `seekOffsetRef = position demandée X` | `-c:v copy` force ffmpeg à démarrer à la keyframe K ≤ X ; X est faux de (X−K) ≈ 1 GOP → barre + sous-titres en avance de ~1 s | Base optimiste X puis corriger `seekOffsetRef` sur K via `/api/streambase` (probe 1 frame `showinfo -copyts`), gardé par `seekGen` |
| Compter sur `-copyts` pour exposer le temps absolu via `video.src` | Chrome rebase quand même la timeline du fMP4 progressif à 0 → barre figée à 0 | Garder `-output_ts_offset -X` + `seekOffsetRef` côté JS |
| Utiliser `<track>` ou `textTracks.mode='showing'` | Chrome ne charge pas les cues en mode HLS+hidden | Overlay `<div>` + parser JS `parseVtt()` |
| `ffmpeg -map 0:s:N` (index relatif sous-titres) | Le probe filtre les codecs image → indices décalés | `ffmpeg -map 0:N` (streamIndex absolu) |
| `ffprobe` via connexion HTTP depuis child process | Windows firewall bloque le process enfant | stdin pipe (`pipe:0`) via `ffprobeFromStream()` |
| Mettre en cache un VTT vide | Bloque tous les retries sur cette piste | Cacher uniquement si `cues.length > 0` |
| `AbortSignal.timeout()` sur stream ffmpeg long | Tue le stream après N secondes | `AbortController` annulé sur `req.on('close')` |
| `http.request` brut pour proxy live | Ne suit pas les redirects 30x → mpegts reçoit du HTML vide | `fetch` (suit redirects par défaut) |
| `baseUrl = targetUrl` dans `rewriteM3u8` | Les segments tapent l'origine pré-redirect → 400 + pas de CORS | `baseUrl = upstream.url` (URL finale post-redirects) |
| UA navigateur sur `/live/` | Xtream rejette et renvoie une page HTML d'erreur | UA `VLC/3.x` + pas de Referer/Origin |
| Compter sur Chrome pour reprendre un live après buffer underrun | Chrome reste figé même quand le réseau revient | Watchdog JS : `waiting`/`stalled` 4 s → `seekToLiveEdge()` + `hls.startLoad()` |
| `runProbe()` sur un flux live | Spawn ffprobe + 5 MB téléchargés pour rien (pas de durée, pas de sous-titres) | Skipper `runProbe` si live |
| `liveMaxLatencyDurationCount` sans `liveSyncDurationCount` explicite | hls.js 1.6 valide la relation → crash au boot | Soit définir les deux, soit s'appuyer sur le watchdog JS |
| `<img src={url_xtream_https}>` direct | Beaucoup de serveurs d'icônes IPTV ont un cert HTTPS expiré → Chrome `ERR_CERT_DATE_INVALID` | Passer par `safeImgUrl()` → `/api/img` (Node ignore l'erreur cert, renvoie same-origin) |

### React / TypeScript

| Anti-pattern | Pourquoi | Correctif |
|---|---|---|
| `default export` sur les composants | Casse HMR fast-refresh et tree-shaking | `export function Foo()` (named export) |
| Importer un service depuis un composant | Court-circuite la couche hooks/context | Passer via props ou lire depuis context |
| `setState` dans une boucle RAF sans guard | Re-render à 60Hz → jank | Comparer avant de setter (`if (next !== lastShown)`) |
| Dépendances stales dans `useCallback` | Fermeture sur valeur obsolète | `useRef` pour les valeurs lues dans les callbacks |
| Couleurs hardcodées en CSS | Casse le design system Aurora | Toujours `var(--accent)`, `var(--bg-1)`, etc. |
| Image IPTV passée directement en `src` | Serveurs retournent des chemins relatifs → 404 | `safeImgUrl()` depuis `utils/image.ts` |
| `useEffect` avec tableau vide `[]` et dépendances implicites | Fermeture stale non détectée par ESLint | Extraire la valeur via `useRef` ou ajouter la dep |

### HLS / Sous-titres

| Anti-pattern | Pourquoi | Correctif |
|---|---|---|
| Handler `SUBTITLE_TRACKS_UPDATED` HLS.js | Les pistes HLS ne correspondent pas aux tracks du fichier source | Probe toujours depuis `mediaUrl` (fichier direct) |
| Afficher les sous-titres en mode natif HLS | HLS.js crée des TextTracks que Chrome n'active pas fiablement | Désactiver tous les textTracks, utiliser overlay custom |
| `timeupdate` pour la sync sous-titres | Ne fire qu'à ~4 Hz → lag visible de 250 ms | `requestAnimationFrame` (~60 Hz) |
| Recherche linéaire O(n) dans les cues | Lente sur les fichiers avec milliers de cues | Recherche binaire + hint d'index (`lastIdx`) |
