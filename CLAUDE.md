# CLAUDE.md — Corset cognitif IPTV App

## I. Finalité (métier)
Client IPTV web connecté aux serveurs **Xtream Codes API**. Interface française. Trois domaines : Live (MPEG-TS), VOD (films), Séries (épisodes). Un seul écran de lecture (`/player`) pour les trois types. Compte utilisateur (Supabase) avec **profils IPTV multiples** par compte (style Netflix) — favoris et historique/reprise synchronisés cross-device, isolés par profil.

**Modèle économique — Freemium.** Abonnement **au niveau compte** (table `subscriptions`, jamais profil) : un abonnement débloque tous les profils. Paiement via **Stripe Checkout** hébergé (2 Edge Functions Supabase). Tier **gratuit** : 1 profil, favoris/historique **locaux** (cet appareil), pas de Mon ciné / communauté / TMDB. Tier **Premium** : profils illimités, sync Supabase cross-device, Mon ciné, communauté, TMDB. Voir §IV-12 et §X.

## II. Architecture
```
SPA React 18 ──► React Router v7 ──► pages/components
SupabaseAuthContext (compte Google/Apple/mail)
  └─► IptvProfileContext (profils IPTV multiples par compte)
        └─► XtreamContext (creds du profil actif) ──► services ──► /api/* (Vite plugin)
SubscriptionProvider (abonnement compte : isPremium/plan, Realtime) ──► Supabase (table subscriptions, RLS lecture seule) ; checkout ──► Edge Functions Stripe
LibraryContext (favoris + historique/reprise + removeFromHistory + clearHistory) ──► Premium : Supabase (RLS par profil) | Gratuit : localStorage (library.local.ts)
RatingsContext (« Mon ciné » : mur visionnages + notes 0,5–5 + critique, snapshot genre/acteur/réal) ──► Supabase (table watched_titles, RLS par profil)
SocialContext (communauté opt-in : suivis + note de membre /5) ──► Supabase (vues definer public_profiles / public_profile_stats + profile_follows / profile_member_ratings — JAMAIS de credentials exposés)
TMDB (images paysage / casting / note / synopsis / vignettes épisodes / bandes-annonces) ──► tmdb.service (HTTP direct)
Media pipeline : HLS.js | mpegts.js | ffmpeg fMP4 | ffprobe stdin
```
Le "backend" média vit dans `vite.config.ts` en **dev** (plugin inline, DX inchangée) et dans `server/proxy.cjs` en **prod**. `src/lib/api.ts` expose `apiUrl(path)` — **seul endroit** qui lit `VITE_API_BASE_URL` ; tous les appels `/api/*` passent par là (chemins relatifs si vide, URL absolue pour les builds TV/mobile).
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
| Navigation TV (télécommande) | @noriginmedia/norigin-spatial-navigation | 3.1.0 |
| ffmpeg | ffmpeg-static | 5.3.0 |
| ffprobe | ffprobe-static | 3.1.0 |
| Prod server | Express | 5.2.1 |
| Auth + BDD | @supabase/supabase-js | 2.105.4 |
| QR code (page Premium / TV) | qrcode | 1.5.4 (`@types/qrcode` 1.5.6 dev) |
| Paiement | Stripe Checkout (Edge Functions Deno, `stripe` esm.sh 17.7.0) | — |
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
9. **Live : URL après redirects + résolution stricte** : la réécriture des manifests HLS DOIT utiliser `upstream.url` (URL finale après suivis de redirects), pas l'URL originale. Les serveurs Xtream/Cloudflare redirigent vers un CDN avec tokens — les segments doivent pointer vers l'origin du CDN, sinon 400 + CORS bloqué. ⚠ La résolution segment→URL absolue dans `rewriteM3u8` (Vite ET `server/proxy.cjs`) DOIT utiliser `resolveUrl(uri, baseUrl)` qui distingue 3 cas (HTTP absolu / `/path` absolu serveur / relatif). La concaténation naïve `baseUrl + uri` produit `…/play/TOKEN//hls/…` (double slash) quand le manifest renvoie un chemin absolu — Cloudflare le voit comme une path-traversal et répond **509 Bandwidth Limit Exceeded** sur chaque segment. Filet additionnel : `normalizeUrl()` côté proxy aplatit les `//` dans le `pathname` au cas où une vieille URL bugguée traîne dans les caches client.
10. **Live : stall recovery** : Chrome n'auto-resume PAS une vidéo live après buffer underrun. Un watchdog JS (`waiting`/`stalled` → seek au live edge après 4 s) est obligatoire dans `usePlayer.ts`. Utiliser `userPausedRef` pour ne pas écraser une pause utilisateur.
11. **Live : pas de probe** : sauter `runProbe()` en mode live (pas de durée à afficher, pas de sous-titres attendus) → démarrage plus rapide, moins de bande passante.
12. **Persistance — bi-mode selon l'abonnement** (override assumé de l'ancienne règle « localStorage interdit ») :
    - **Premium** : favoris + historique/reprise en BDD Supabase, **isolés par profil IPTV** (RLS `auth.uid()` + `profile_id`) → sync cross-device.
    - **Gratuit** : favoris + historique/reprise en **`localStorage`**, liés à l'appareil, via `src/services/library.local.ts` (signature alignée sur `library.service`). C'est ce qui fait du sync cross-device une vraie valeur Premium.
    - `LibraryContext` choisit l'adaptateur via `useSubscription().isPremium` — **ne jamais dupliquer la logique de persistance**, juste basculer l'adaptateur. Les deux services partagent la même signature.
    - Credentials Xtream : **toujours** Supabase (`iptv_profiles`), jamais en local, quel que soit le tier. Id du profil actif + prefs sous-titres : toujours local.
13. **Reprise = position + audio + sous-titres** : `LibraryContext.saveProgress` (toutes les 5 s + au démontage du lecteur) upsert sur `(profile_id, content_id, content_type)`. `VideoPlayer` applique la reprise UNE seule fois quand le lecteur est prêt, via l'API publique de `usePlayer` (`seek`/`setAudio`/`setSubtitle`) — ne jamais dupliquer la logique seek. Reprise ignorée si position < 10 s ou > 95 % (considéré terminé).
14. **« Mon ciné » (notes/mur)** : table `watched_titles`, RLS par profil, conflit sur `(profile_id, content_type, title_key)`. **Identité = `catalog.titleKey()`** (jamais le `stream_id` Xtream, spécifique au serveur) → une note survit au changement de serveur/variante. Snapshot genre/acteur/réal **figé depuis Xtream** à la notation (TMDB additif uniquement, jamais bloquant — §IV-règle TMDB) → mur + filtres fonctionnent sans clé TMDB. Auto-« vu » réservé aux **films** terminés >90 % (`isFinishedProgress`) ; séries = action manuelle (pas d'identité série fiable dans l'historique d'épisodes). `RatingsProvider` monté **dans** `LibraryProvider` (lit `useLibrary().history` pour l'auto-vu).
15. **Communauté (social) — fuite de credentials INTERDITE** : c'est l'**unique exception** à l'isolation §IV-12, et elle est **opt-in + lecture seule**. La table `iptv_profiles` contient les credentials Xtream → **JAMAIS** de policy RLS de lecture publique dessus, **JAMAIS** de `select('*')` cross-profil. Toute lecture cross-compte passe par la **vue definer `public_profiles`** / `public_profile_stats` (sous-ensemble sûr : nom, discriminateur, avatar, couleur, agrégats — jamais `user_id`, jamais credentials) et la policy `watched_titles` `for select` quand `is_public`. Discriminateur Discord-style alloué par la RPC `set_profile_public` (SECURITY DEFINER, vérifie `auth.uid()` propriétaire). `profile_follows`/`profile_member_ratings` : le côté « acteur » (follower/rater) DOIT appartenir à `auth.uid()`, la cible DOIT être publique (RLS `with check`). Note membre = entier 1–5. Tout nouvel accès social → repasser par une vue definer, jamais par la table. ⚠️ **`getMemberWatched` utilise obligatoirement la RPC `get_member_watched` (SECURITY DEFINER)** — une requête directe sur `watched_titles` échoue cross-compte car la policy RLS publique fait une sous-requête sur `iptv_profiles` elle-même protégée par RLS (`user_id = auth.uid()`), retournant toujours vide pour un compte tiers.
16. **Historique — suppression** : `LibraryContext` expose `removeFromHistory(historyId)` (optimiste + revert) et `clearHistory()` (optimiste + revert). `library.service` expose `removeHistoryItem` et `clearHistory`. La section « Reprendre » de Home affiche un bouton × par carte + « Tout vider » avec confirmation 2 temps (3 s timeout).
18. **Intégrité abonnement — falsification INTERDITE** : la table `subscriptions` est au **niveau compte** (`user_id` PK → `auth.users`), jamais profil. RLS : **lecture seule** de sa propre ligne, **aucune** policy insert/update/delete. Le **seul écrivain** est la Edge Function `stripe-webhook` (service-role, bypass RLS) → l'état Premium ne peut pas être posé depuis le frontend. `isPremium` = `status ∈ {active, trialing}` ET période non expirée — calculé dans `SubscriptionContext`, jamais ailleurs. Les Price IDs + clé secrète Stripe restent **côté serveur** (secrets Edge Function) ; le client n'envoie que `"monthly"|"yearly"`. `VITE_DEV_FORCE_PREMIUM` n'agit **que** si `import.meta.env.DEV`. Tout nouveau gating → consommer `useSubscription().isPremium`, jamais relire la table en direct.
19. **`ScrollRail`** (`src/components/ScrollRail.tsx`) : wrapper réutilisable pour tout rail horizontal scrollable. Accepte `railClassName` (classe CSS du conteneur scrollable, ex. `styles.rowRail`). Affiche flèches gauche/droite (z-index: 10, > card:hover z-index 5 + transform stacking context) + gradient de bord. `ResizeObserver` + listener scroll pour maj état flèches. Utilisé sur les 4 rails de Home. Flèches masquées sur mobile (≤ 640px) — swipe tactile à la place.
20. **Responsive — mobile-first sans framework** : pas de Tailwind, pas de Bootstrap. Les tokens d'espacement `--pad-edge`, `--row-gap`, `--topnav-h` sont **redéfinis sur les media queries globales** dans `src/styles/app.css` ; toute page qui les utilise hérite automatiquement (ne pas hardcoder `72px` dans les pages). **Breakpoints standardisés** :
    - `≤ 900px` (tablette portrait / petit écran) : `--pad-edge` 28px, `--row-gap` 44px, `--topnav-h` 76px, font-size 15px. **Capsule top conservée** (compactée).
    - `≤ 640px` (mobile portrait) : `--pad-edge` 16px, `--row-gap` 32px, `--topnav-h` 72px ; cartes posters en grille `repeat(2, 1fr)`, hero en aspect-ratio 3/4, pas de hover (`.card:hover` neutralisé), boutons à hauteur ≥ 38px pour le tactile, **inputs en font-size 16px** (sinon iOS zoome au focus). **Capsule top remplacée par une bottom nav fixe** (voir §IV-21). Token `--bottomnav-h` réservé via `padding-bottom` sur `.main-content` pour ne pas masquer le dernier item.
    - `≤ 420px` / `≤ 380px` : ajustements ultra-compact uniquement (cartes encore plus petites, padding 12px). Ne pas ajouter d'autre breakpoint.
    - Player : sur ≤ 640px, volume slider masqué (volume hardware/OS sur mobile), sous-titres rapetissés (Sm 14px / Md 18px / Lg 24px / Xl 32px), back-btn à 14px top.
    - **Règle** : ajouter des `@media (max-width: 640px) { … }` en fin de chaque CSS module concerné (jamais au milieu, plus facile à grep). Ne **pas** recourir à des composants alternatifs « mobile » : un seul rendu, ajusté par CSS.
21. **Navigation mobile — bottom nav** (`src/components/TopNav.tsx` + `TopNav.css`) : sur `≤ 640px`, la capsule top `.topnav` est masquée par CSS et remplacée par `<nav className="bottomnav">` fixée en bas, à 6 onglets icônes+label (les mêmes `LINKS` que desktop — **un seul array source de vérité**, pas de duplication de routes). Pourquoi bottom plutôt que burger : navigation primaire toujours visible, zones tactiles au pouce, modèle natif Netflix/Disney+/Prime — cohérent avec le portage Capacitor/TV prévu (§IX). Le bouton recherche, expulsé de la bottom nav (place limitée à 6 onglets), devient `.search-fixed-mobile` flottant en haut à droite à côté du profil. Safe-area iOS (`env(safe-area-inset-bottom)`) prise en compte via le token global `--safe-bottom`. ⚠ **NE PAS dupliquer la liste `LINKS`** : c'est cette source unique qui garantit que toute nouvelle route nav est dispo sur mobile sans modif supplémentaire.
22. **Live mobile — preview inline (pas de panneau latéral)** : sur `≤ 640px`, le panneau latéral `.panel` de `Live.tsx` est masqué (`display: none`) et `MediaCard` accepte une prop `inlinePreview?: ReactNode` qui, quand fournie, remplace l'image/placeholder par le slot (`<ChannelPreview>` dans le cas Live). Détection mobile via le hook `src/hooks/useMediaQuery.ts` (`useMediaQuery('(max-width: 640px)')`) — `Live.tsx` ne monte le ChannelPreview que sur mobile + carte sélectionnée. UX : 1ᵉʳ tap = sélection + aperçu inline, 2ᵉ tap = fullscreen (`handleCardClick` inchangé). `ChannelPreview` fait `e.stopPropagation()` sur son clic pour éviter le double-trigger via le wrapper card. Memo de MediaCard : `Boolean(inlinePreview)` comparé pour ne re-render que sur bascule selected. Cartes Live mobile : 2 par ligne strict (`.gridChannel { grid-template-columns: repeat(2, 1fr); }`).
23. **Filtres pliables — sidebar Watched/MemberCine mobile** : sur `≤ 640px`, chaque section de filtre (`Type`, `Statut`, `Genres`, `Réalisateurs`, `Acteurs`) est rendue **fermée par défaut** dans un accordéon CSS-only. Pattern partagé entre `Watched.tsx` et `MemberCine.tsx` : `<button className="filterHead" onClick={toggleSection(k)}>` + `<div className="filterBody filterBodyOpen?">`. Sur desktop : `.filterChev` est `display: none` et `.filterBody` reste toujours `display: flex` (l'état `openSections` est ignoré). Sur mobile uniquement : `.filterBody { display: none; }` + `.filterBodyOpen { display: flex; }`. Économie d'espace : la sidebar passe de ~6 écrans de scroll à 5 lignes-headers tappables. ⚠ Ne pas extraire en composant `<Collapsible>` réutilisable : la sidebar n'a que 2 pages consommatrices, et l'inline reste lisible (§Standards de qualité — pas d'abstraction prématurée).

## V. Flux de Travail (TDD imposé)
```
Analyse → Plan → Test (unitaire/intégration) → Implémentation → Lint → Build → Vérification manuelle
```
- Toute modification du player (`usePlayer.ts`) doit valider : seek, switch audio, switch sous-titres, mode live.
- `npm run build` doit passer sans erreur TypeScript avant tout commit.
- Zéro `console.error` non intentionnel en prod (logging de debug préfixé `[module]`, retiré avant commit).

## VI. Commandes de Développement
```bash
npm run dev          # Vite dev server (frontend + proxy /api/* intégré — DX inchangée)
npm run build        # tsc -b && vite build  (VITE_API_BASE_URL vide → chemins relatifs)
npm run build:tv     # bundle TV/mobile (remplacer PLACEHOLDER_URL par l'URL réelle du VPS)
npm run start        # prod : NODE_ENV=production node server/proxy.cjs
npm run server       # backend standalone (port $PORT ou 4000, ALLOWED_ORIGINS configurable)
npm run lint         # ESLint strict
npm run preview      # Aperçu du build prod
```

**Docker** (déploiement VPS / reproductibilité — voir `Dockerfile`, `docker-compose.yml`) :
```bash
docker compose --env-file .env.local up --build   # build + run (flag OBLIGATOIRE, voir ci-dessous)
docker compose --env-file .env.local up -d        # détaché
docker compose logs -f iptv                       # suivre les logs
docker compose down                               # arrêt
```
⚠ **`--env-file .env.local` obligatoire au build** : compose interpole les `${VITE_*}` depuis `.env` par défaut (et le repo n'a que `.env.local`). Sans ce flag, les `VITE_*` arrivent vides → bundle inliné sans Supabase URL → écran noir + `Error: supabaseUrl is required`. Alternative : symlinker/copier `.env.local` → `.env`.
- Base : `node:20-bookworm-slim` (**pas Alpine** : `ffmpeg-static`/`ffprobe-static` shippent du glibc, incompatibles musl).
- Multi-stage : `builder` compile (TS + Vite), `runner` ne contient que `dist/`, `server/`, deps prod, et `tini` (PID 1 → reaper des process `ffmpeg`).
- Container tourne en user `node` (non-root).
- Variables `VITE_*` injectées via `args:` au **build** (Vite les inline dans le bundle, pas modifiables à chaud). Variables runtime (`PORT`, `ALLOWED_ORIGINS`) via `environment:`/`env_file:`.
- Port exposé : `4000` → accès local sur `http://localhost:4000`.

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

## IX. Externalisation du backend — IMPLÉMENTÉ (prérequis multi-plateforme)

> **But** : rendre l'app déployable sur Samsung Tizen, LG webOS, Android (Capacitor) et iOS. Ces plateformes n'exécutent pas Node.js — le backend (ffmpeg, ffprobe, proxy Xtream) tourne sur un serveur externe (VPS, Raspberry Pi, NAS local).

**Implémenté** (voir `docs/architecture.md` §5) :
1. `src/lib/api.ts` → `apiUrl(path)` : préfixe `VITE_API_BASE_URL` si défini, sinon chemin relatif. **Seul endroit** qui lit cette variable — règle absolue.
2. Tous les appels `/api/*` dans `src/` passent par `apiUrl()` (hooks, services, utils/image).
3. `server/proxy.cjs` : CORS configurable via `ALLOWED_ORIGINS`, port via `PORT` (défaut 4000).
4. Scripts disponibles : `npm run build:tv` (remplacer `PLACEHOLDER_URL`) + `npm run server`.

**Invariants préservés** : Supabase (SDK direct), TMDB (HTTP direct), tous les garde-fous §IV. `npm run dev` inchangé.

**Pour un portage TV/mobile** : remplacer `PLACEHOLDER_URL` dans `build:tv` par l'URL du VPS, puis `npm run build:tv`. Servir le `dist/` sur la plateforme cible ; le backend tourne sur le VPS (`npm run server`).

**Déploiement VPS — Docker** (canonique) : voir §VI ci-dessus. L'image embarque dist/ + serveur Express + binaires ffmpeg Linux. Sur le VPS : `docker compose up -d` après avoir renseigné `.env.local` (Supabase, TMDB, `ALLOWED_ORIGINS`). Reverse proxy TLS recommandé devant (Caddy/Traefik/Nginx) — le conteneur expose HTTP brut sur 4000.

## X. Abonnement Premium (Stripe + Supabase)

**Flux** : `SubscriptionProvider` (monté dans `AppGate`, entre `SupabaseAuthProvider` et `IptvProfileProvider`) lit `subscriptions` par `user_id` + écoute le Realtime. `subscription.service.createCheckout(plan)` → Edge Function `create-checkout-session` (JWT Supabase) → URL Stripe Checkout hébergée. Retour `/premium?status=success` → polling `refresh()` (filet) + Realtime (déblocage TV auto après paiement mobile via QR).

**Backend** : 2 Edge Functions Deno dans `supabase/functions/` (orthogonal au proxy média `/api/*`, conforme §II) :
- `create-checkout-session` : authentifie via JWT, mappe `plan`→Price ID (secret), crée/réutilise le customer Stripe, renvoie l'URL.
- `stripe-webhook` : **seul écrivain** de `subscriptions` (service-role). Déployer **`--no-verify-jwt`**. Vérifie la signature Stripe (`constructEventAsync` + SubtleCrypto). Events : `checkout.session.completed`, `customer.subscription.created|updated|deleted`.

**Migration** : `supabase/migrations/0001_subscriptions.sql` (à exécuter dans SQL Editor).

**Secrets serveur** (`supabase secrets set`) : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`. `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_ANON_KEY` auto-injectés. **Aucun secret Stripe côté frontend.**

**Env frontend** (`.env.local`, optionnels) : `VITE_PREMIUM_URL` (URL publique encodée dans le QR ; défaut = origin courant), `VITE_DEV_FORCE_PREMIUM=true` (dev only — force Premium pour tester le gating).

**Gating** : routes `/journal`, `/communaute*` via `<PremiumOnly>`. Multi-profil bloqué dans `ProfileSelect` + garde-fou dans `IptvProfileContext.createProfile`. `RateBlock` + toggle « ciné public » Settings → état verrouillé. TMDB coupé à chaud via `tmdbService.setEnabled(isPremium)` (dégradation gracieuse §IV-TMDB). Tarifs : 2,49 €/mois · 17,99 €/an (`PLAN_OPTIONS` dans `src/types/subscription.types.ts`).
