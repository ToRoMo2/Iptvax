# CLAUDE.md — Corset cognitif IPTV App

## I. Finalité (métier)
Client IPTV web connecté aux serveurs **Xtream Codes API**. Interface française. Trois domaines : Live (MPEG-TS), VOD (films), Séries (épisodes). Un seul écran de lecture (`/player`) pour les trois types. Compte utilisateur (Supabase) avec **profils IPTV multiples** par compte (style Netflix) — favoris et historique/reprise synchronisés cross-device, isolés par profil.

## II. Architecture
```
SPA React 18 ──► React Router v7 ──► pages/components
SupabaseAuthContext (compte Google/Apple/mail)
  └─► IptvProfileContext (profils IPTV multiples par compte)
        └─► XtreamContext (creds du profil actif) ──► services ──► /api/* (Vite plugin)
LibraryContext (favoris + historique/reprise) ──► Supabase (BDD, RLS par profil)
TMDB (images paysage / casting / note / synopsis / vignettes épisodes) ──► tmdb.service (HTTP direct)
Media pipeline : HLS.js | mpegts.js | ffmpeg fMP4 | ffprobe stdin
```
Tout le "backend" média vit dans `vite.config.ts`. Zéro serveur séparé en dev.
**Supabase est orthogonal au proxy `/api/*`** : auth + persistance via SDK frontend (`src/lib/supabase.ts`), jamais via une route `/api/*`.
**TMDB est orthogonal au proxy `/api/*`** : enrichissement métadonnées via `src/services/tmdb.service.ts` (HTTP direct, CORS TMDB), jamais via une route `/api/*`. **Purement additif et jamais bloquant** : sans `VITE_TMDB_API_KEY` ou en cas d'échec, l'UI retombe sur les données Xtream sans régression. Doublons IPTV (langues/qualités) fusionnés en une carte via `src/utils/catalog.ts` (titre canonique) + sélecteur de version sur les fiches détail.

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
| Auth + BDD | @supabase/supabase-js | 2.105.4 |
| Lint | eslint + typescript-eslint | 9.13 / 8.11 |

## IV. Garde-Fous non négociables
1. **Sous-titres** : TOUJOURS via `/api/subtitle` + parser JS custom (`parseVtt`). JAMAIS `<track>` natif ni `textTracks` pour le rendu — Chrome ne charge pas les cues en mode `hidden` sur HLS.
2. **ffprobe** : TOUJOURS via stdin pipe (`pipe:0`) dans `ffprobeFromStream()`. Jamais de connexion HTTP depuis le process enfant (firewall Windows bloque).
3. **seekOffset + base keyframe réelle** : Chrome rebase à 0 la timeline d'un MP4 fragmenté servi via `video.src` → `video.currentTime` repart de 0 à chaque restart ffmpeg (`-copyts` ne change RIEN à ça, testé). Position réelle = `video.currentTime + seekOffsetRef`. ⚠ `seekOffsetRef` NE DOIT PAS valoir la position demandée X : avec `-c:v copy` ffmpeg démarre à la keyframe K ≤ X, donc poser X désync barre + sous-titres de (X − K) ≈ 1 GOP (~1 s, en avance). Pose X de façon optimiste puis CORRIGE `seekOffsetRef` sur K via `/api/streambase` (probe 1 frame `showinfo -copyts`). Garde-fou `seekGen` obligatoire pour ignorer une réponse obsolète après re-seek. Ne jamais lire `video.currentTime` seul pour la timeline.
4. **Images IPTV** : toujours via `safeImgUrl()` (`src/utils/image.ts`) — les serveurs retournent des chemins relatifs → 404 si passés tels quels.
5. **Codecs sous-titres image** (PGS/DVB/VobSub) : filtrés au niveau du probe. `streamIndex` absolu utilisé côté ffmpeg (`-map 0:N`), jamais l'index relatif (`0:s:N`).
6. **TypeScript strict** : `noUnusedLocals` + `noUnusedParameters` actifs. Variables intentionnellement inutilisées préfixées `_`.
7. **CSS** : jamais de couleurs hardcodées — toujours les tokens Aurora (`--accent`, `--bg-1`, etc.) définis dans `src/styles/app.css`.
8. **Live : User-Agent** : les routes Xtream `/live/` rejettent les UA navigateur (renvoient `text/html`). TOUJOURS UA VLC (`UA_LIVE`) côté proxy, et NE PAS envoyer `Referer`/`Origin` — un vrai lecteur média n'en envoie pas.
9. **Live : URL après redirects** : la réécriture des manifests HLS DOIT utiliser `upstream.url` (URL finale après suivis de redirects), pas l'URL originale. Les serveurs Xtream/Cloudflare redirigent vers un CDN avec tokens — les segments doivent pointer vers l'origin du CDN, sinon 400 + CORS bloqué.
10. **Live : stall recovery** : Chrome n'auto-resume PAS une vidéo live après buffer underrun. Un watchdog JS (`waiting`/`stalled` → seek au live edge après 4 s) est obligatoire dans `usePlayer.ts`. Utiliser `userPausedRef` pour ne pas écraser une pause utilisateur.
11. **Live : pas de probe** : sauter `runProbe()` en mode live (pas de durée à afficher, pas de sous-titres attendus) → démarrage plus rapide, moins de bande passante.
12. **Persistance Supabase** : favoris, historique/reprise et credentials Xtream vivent en BDD Supabase, **isolés par profil IPTV** (RLS `auth.uid()` + colonne `profile_id`). JAMAIS de favoris/historique en `localStorage` (le `storage.service` a été supprimé). Seul l'id du profil actif est persisté localement (`active_iptv_profile_id`) + les prefs visuelles de sous-titres.
13. **Reprise = position + audio + sous-titres** : `LibraryContext.saveProgress` (toutes les 5 s + au démontage du lecteur) upsert sur `(profile_id, content_id, content_type)`. `VideoPlayer` applique la reprise UNE seule fois quand le lecteur est prêt, via l'API publique de `usePlayer` (`seek`/`setAudio`/`setSubtitle`) — ne jamais dupliquer la logique seek. Reprise ignorée si position < 10 s ou > 95 % (considéré terminé).

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
- **Contextes** : providers transverses (compte/profil/bibliothèque) dans `src/contexts/` ; `src/context/` (sans `s`, legacy) ne contient que `XtreamContext`. Client Supabase singleton dans `src/lib/supabase.ts`.
- **Types** : interfaces uniquement (`src/types/*.types.ts`), pas d'enums.
- **Refs vs State** : valeurs lues dans les callbacks → `useRef`. Valeurs rendues dans le JSX → `useState`.
- **Async** : toujours `AbortController` ou `AbortSignal.timeout()` sur les fetch longue durée.

## VIII. Maintenance documentaire
- Ce fichier = source de vérité des règles **opérationnelles** (commandes, garde-fous, versions).
- `docs/architecture.md` = source de vérité des règles **structurelles** (couplage, flux, anti-patterns).
- Toute nouvelle route `/api/*` → mettre à jour §II ici ET `docs/architecture.md` §2.
- Toute nouvelle dépendance → §III avec version exacte.
- Nouveau anti-pattern confirmé → `docs/architecture.md` §4, jamais dans ce fichier.
