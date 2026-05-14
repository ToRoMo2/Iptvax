# CLAUDE.md — Corset cognitif IPTV App

## I. Finalité (métier)
Client IPTV web connecté aux serveurs **Xtream Codes API**. Interface française. Trois domaines : Live (MPEG-TS), VOD (films), Séries (épisodes). Un seul écran de lecture (`/player`) pour les trois types.

## II. Architecture
```
SPA React 18 ──► React Router v7 ──► pages/components
XtreamContext (auth) ──► services ──► /api/* (Vite plugin)
Media pipeline : HLS.js | mpegts.js | ffmpeg fMP4 | ffprobe stdin
```
Tout le "backend" vit dans `vite.config.ts`. Zéro serveur séparé en dev.

> ⚠️ **Modification architecturale ?** Lire d'abord [`docs/architecture.md`](./docs/architecture.md) — diagramme complet, règles de couplage par couche, catalogue des anti-patterns. Ne pas charger ce fichier pour des tâches courantes (bug fix, UI).

## III. Pile Technologique (versions strictes)
| Rôle | Lib | Version |
|---|---|---|
| UI | React + ReactDOM | 18.3.1 |
| Langage | TypeScript | ~5.6.2 |
| Bundler | Vite + plugin-react | 5.4.10 / 4.3.3 |
| Router | react-router-dom | 7.15.0 |
| HLS | hls.js | 1.6.16 |
| MPEG-TS | mpegts.js | 1.8.0 |
| ffmpeg | ffmpeg-static | 5.3.0 |
| ffprobe | ffprobe-static | 3.1.0 |
| Prod server | Express | 5.2.1 |
| Lint | eslint + typescript-eslint | 9.13 / 8.11 |

## IV. Garde-Fous non négociables
1. **Sous-titres** : TOUJOURS via `/api/subtitle` + parser JS custom (`parseVtt`). JAMAIS `<track>` natif ni `textTracks` pour le rendu — Chrome ne charge pas les cues en mode `hidden` sur HLS.
2. **ffprobe** : TOUJOURS via stdin pipe (`pipe:0`) dans `ffprobeFromStream()`. Jamais de connexion HTTP depuis le process enfant (firewall Windows bloque).
3. **seekOffset pattern** : `video.currentTime` repart à 0 à chaque restart ffmpeg → position affichée = `video.currentTime + seekOffsetRef.current`. Ne jamais lire `video.currentTime` seul pour la timeline.
4. **Images IPTV** : toujours via `safeImgUrl()` (`src/utils/image.ts`) — les serveurs retournent des chemins relatifs → 404 si passés tels quels.
5. **Codecs sous-titres image** (PGS/DVB/VobSub) : filtrés au niveau du probe. `streamIndex` absolu utilisé côté ffmpeg (`-map 0:N`), jamais l'index relatif (`0:s:N`).
6. **TypeScript strict** : `noUnusedLocals` + `noUnusedParameters` actifs. Variables intentionnellement inutilisées préfixées `_`.
7. **CSS** : jamais de couleurs hardcodées — toujours les tokens Aurora (`--accent`, `--bg-1`, etc.) définis dans `src/styles/app.css`.

## V. Flux de Travail (TDD imposé)
```
Analyse → Plan → Test (unitaire/intégration) → Implémentation → Lint → Build → Vérification manuelle
```
- Toute modification du player (`usePlayer.ts`) doit valider : seek, switch audio, switch sous-titres, mode live.
- `npm run build` doit passer sans erreur TypeScript avant tout commit.
- Zéro `console.error` non intentionnel en prod (logging de debug préfixé `[module]`, retiré avant commit).

## VI. Commandes de Développement
```bash
npm run dev          # Vite dev server (frontend + proxy /api/* intégré)
npm run build        # tsc -b && vite build
npm run lint         # ESLint strict
npm run preview      # Aperçu du build prod
```

## VII. Standards de Qualité
- **Composants** : exports nommés, PascalCase, CSS Module co-localisé (`*.module.css`).
- **Hooks** : `use*`, camelCase, dans `src/hooks/`. Dépendances `useCallback`/`useEffect` exhaustives.
- **Services** : singleton exporté, `*.service.ts`, zéro état global mutable.
- **Types** : interfaces uniquement (`src/types/*.types.ts`), pas d'enums.
- **Refs vs State** : valeurs lues dans les callbacks → `useRef`. Valeurs rendues dans le JSX → `useState`.
- **Async** : toujours `AbortController` ou `AbortSignal.timeout()` sur les fetch longue durée.

## VIII. Maintenance documentaire
- Ce fichier = source de vérité des règles **opérationnelles** (commandes, garde-fous, versions).
- `docs/architecture.md` = source de vérité des règles **structurelles** (couplage, flux, anti-patterns).
- Toute nouvelle route `/api/*` → mettre à jour §II ici ET `docs/architecture.md` §2.
- Toute nouvelle dépendance → §III avec version exacte.
- Nouveau anti-pattern confirmé → `docs/architecture.md` §4, jamais dans ce fichier.
