# Architecture — IPTV App

> **Lire uniquement lors d'une modification structurelle.** Référence depuis CLAUDE.md §II.

---

## 1. Vue d'ensemble

L'application est une **SPA React 18** avec un backend média embarqué dans le plugin Vite (`vite.config.ts`). Il n'existe pas de serveur Node.js séparé en développement — les 6 routes `/api/*` sont des middlewares Express-like injectés directement dans le dev server Vite.

En production, `server/proxy.cjs` remplace le plugin Vite et sert les mêmes routes via Express 5.

**Backends orthogonaux** :
- **Proxy média `/api/*`** (Vite/Express) — streaming, probe, sous-titres, images. Sans état.
- **Supabase** (auth + Postgres + RLS) — compte utilisateur, profils IPTV, favoris, historique/reprise, abonnement. Accédé via le SDK frontend (`src/lib/supabase.ts`), **jamais** via `/api/*`. Données isolées par profil IPTV (`profile_id`) sous RLS `auth.uid()`. **Persistance bi-mode selon l'abonnement** : tier **Premium** → favoris/historique en BDD (sync cross-device, RLS `profile_id`) ; tier **gratuit** → `localStorage` (`library.local.ts`, lié à l'appareil) — override assumé de l'ancienne règle « localStorage interdit » (CLAUDE.md §IV-12). Credentials Xtream : **toujours** en BDD, jamais en local. Profil actif + prefs sous-titres : toujours local.
- **Abonnement Premium (Stripe)** — table `subscriptions` au **niveau compte** (`user_id` PK, RLS lecture seule). Checkout via 2 **Edge Functions Deno** (`supabase/functions/`) : `create-checkout-session` (JWT) et `stripe-webhook` (**seul écrivain**, service-role, signature vérifiée, déployé `--no-verify-jwt`). Orthogonal au proxy média `/api/*`. `SubscriptionContext` calcule `isPremium`, écoute le Realtime (déblocage TV auto). Détail : CLAUDE.md §X.
- **TMDB** (enrichissement métadonnées) — `src/services/tmdb.service.ts`, HTTP direct (CORS TMDB), **jamais** via `/api/*`. Couche `services/` standard (importe `types/` only). **Strictement additif** : clé absente (`VITE_TMDB_API_KEY`) ou échec réseau → `null`/`{}`, l'UI retombe sur Xtream, aucun `console.error`. Cache mémoire de session (Map, partage des Promises concurrentes). La déduplication des doublons IPTV est un pur util (`src/utils/catalog.ts`, zéro import) consommé par les pages.

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
│  pages/           (écrans : Home, Player, ProfileSelect…) │
│    ↓ importe                                         │
│  components/      (VideoPlayer, TopNav, ProfilePanel…) │
│    ↓ importe                        ↑ lit context    │
│  hooks/           (usePlayer — toute la logique AV)  │
│    ↓ importe                                         │
│  contexts/        (SupabaseAuth → Subscription → IptvProfile → Library → Ratings) │
│  context/         (XtreamContext — creds profil actif)│
│    ↓ importe                                         │
│  services/        (xtream.service, library.service)  │
│  lib/             (supabase.ts — client singleton)   │
│    ↓ importe                                         │
│  types/           (xtream / profile / library .types)│
│  utils/           (image.ts — fonctions pures)       │
└─────────────────────────────────────────────────────┘
       │ fetch /api/*                  │ SDK Supabase
       ▼                               ▼
┌──────────────────────────────┐  ┌──────────────────────┐
│  VITE PLUGIN (vite.config.ts)│  │  SUPABASE            │
│  Node.js — proxy média       │  │  Auth (OAuth/mail)   │
│                              │  │  Postgres + RLS      │
│  /api/xtream    → Xtream API │  │  profiles            │
│  /api/hlsproxy  → m3u8       │  │  iptv_profiles       │
│  /api/liveproxy → MPEG-TS    │  │  favorites           │
│  /api/img       → node:https │  │  watch_history       │
│  /api/probe     → ffprobe    │  │  user_settings       │
│  /api/subtitle  → ffmpeg VTT │  │  watched_titles      │
│  /api/streambase→ keyframe   │  │  (toutes RLS         │
│  /api/stream    → ffmpeg fMP4│  │   auth.uid() +       │
│                              │  │   profile_id)        │
└──────────────────────────────┘  └──────────────────────┘
```

**Abonnement / facturation (Stripe — orthogonal au proxy `/api/*`)** :
- Table `subscriptions` : **niveau compte** (`user_id` PK → `auth.users`), pas profil. RLS = lecture seule de sa propre ligne ; **aucune** policy insert/update/delete. Ajoutée à la publication `supabase_realtime`.
- 2 **Edge Functions Deno** (`supabase/functions/`) : `create-checkout-session` (vérifie le JWT Supabase, mappe `plan`→Price ID secret, crée la session Stripe Checkout) et `stripe-webhook` (**seul écrivain** de `subscriptions`, service-role bypass RLS, signature Stripe vérifiée, déployé **`--no-verify-jwt`**).
- Secrets **côté serveur uniquement** (`supabase secrets set`) : `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`. Aucun secret Stripe dans le frontend (le client n'envoie que `"monthly"|"yearly"`).
- `SubscriptionContext` lit la ligne + écoute le Realtime → `isPremium` (déblocage TV auto après paiement mobile via QR).

**Couche communautaire (opt-in, lecture seule)** — seule entorse à l'isolation par profil :
- Tables : `profile_follows`, `profile_member_ratings` (RLS : côté acteur ∈ profils de `auth.uid()`, cible publique).
- Colonnes ajoutées à `iptv_profiles` : `is_public`, `discriminator` (jamais lues en cross-profil).
- **Vues definer** `public_profiles` / `public_profile_stats` : seul canal de lecture cross-compte, exposant un sous-ensemble **sûr** (jamais `user_id`, jamais credentials Xtream).
- Policy additive `watched_titles` `for select` si profil propriétaire `is_public`.
- RPC `set_profile_public` (SECURITY DEFINER) : bascule public + alloue le discriminateur Discord-style.

---

## 3. Règles de couplage

| Couche | Peut importer | Ne doit JAMAIS importer |
|---|---|---|
| `types/` | rien | tout le reste |
| `utils/` | rien | tout le reste |
| `lib/` | npm libs | `services/`, `context(s)/`, `hooks/`, `components/`, `pages/` |
| `services/` | `lib/`, `types/` | `hooks/`, `context(s)/`, `components/`, `pages/` |
| `context/` (legacy : `XtreamContext`) | `services/`, `types/` | `hooks/`, `components/`, `pages/` |
| `contexts/` (Supabase/Profil/Library/Ratings/Social) | `lib/`, `services/`, `types/`, `utils/` (pur, zéro import), autres `contexts/` | `hooks/`, `components/`, `pages/` |
| `hooks/` | `types/`, `utils/` | `services/` directement, `context(s)/`, `pages/`, `components/` |
| `components/` | `hooks/`, `types/`, `utils/`, `*.module.css`, **hooks de context (`use*`) en lecture** | `services/`, `lib/`, `pages/` |
| `pages/` | tout sauf `pages/` entre elles | import circulaire entre pages |
| `vite.config.ts` | `node:*`, npm libs Node.js | tout `src/` |

> **Règle des hooks** : un hook ne doit pas appeler `xtreamService` directement. Si un hook a besoin de credentials, il reçoit l'URL finale en paramètre (découplage). Seules les pages/context font le lien services ↔ hooks.
>
> **Composants ↔ context** : un composant peut *consommer* un context via son hook (`useXtream`, `useIptvProfile`, `useLibrary`…) — ex. `TopNav`, `ProfilePanel`. Il ne doit jamais importer un `*.service` ni `lib/` en direct.
>
> **Ordre des providers** (`App.tsx`) : `SupabaseAuthProvider` → `SubscriptionProvider` → `IptvProfileProvider` → (profil actif) → `XtreamProvider key={profileId}` → `LibraryProvider` → `RatingsProvider` → `SocialProvider`. `SubscriptionProvider` est monté juste sous l'auth (entre `SupabaseAuthProvider` et `IptvProfileProvider`) car `IptvProfileContext` (limite 1 profil gratuit), `LibraryContext` (choix adaptateur Supabase/localStorage) et `RatingsContext` (Mon ciné Premium) consomment tous `useSubscription().isPremium`. `LibraryProvider`/`XtreamProvider` sont remontés au changement de profil via la `key` → rechargement propre des données du nouveau profil. `RatingsProvider` est imbriqué **dans** `LibraryProvider` car il lit `useLibrary().history` pour l'auto-« vu » des films terminés (>90 %). `SocialProvider` (suivis + notes de membres du profil actif) est le plus interne. `IptvProfileContext` importe `socialService` pour la RPC `set_profile_public` (un `contexts/` peut importer un `services/`).
>
> **Identité de contenu « Mon ciné »** : `RatingsContext` et les fiches détail importent le pur `utils/catalog.titleKey()` comme clé canonique stable (un titre garde sa note malgré un changement de serveur Xtream ou de variante). C'est l'unique cas où un `contexts/` consomme `utils/` — autorisé car `utils/` est la couche la plus basse (zéro import runtime), strictement en dessous de `services/`.

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
| `runProbe()` réinitialise `currentAudio`/`currentAudioRef` à `0` inconditionnellement | ffprobe résout en **async**, souvent APRÈS un switch audio (reprise ou choix utilisateur) → l'UI repasse sur la piste par défaut alors que le flux ffmpeg joue déjà la bonne piste | Préserver la sélection si `currentAudioRef.current` est un index valide ; ne forcer `0` que sans sélection |
| Appliquer la reprise (seek/audio/sous-titres) plus d'une fois ou re-dériver la logique de seek | Re-seeks en boucle, désync `seekOffset` | `VideoPlayer` applique chaque dimension UNE fois (refs `resume*Done`) via l'API publique `usePlayer` (`seek`/`setAudio`/`setSubtitle`) ; persistance via `LibraryContext.saveProgress` (5 s + démontage) |
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
| Recherche catalogue chargée paresseusement + repli sur catégorie courante | Avant fin du fetch global → résultats partiels trompeurs ; filtre + monte des milliers de `MediaCard` à chaque frappe → jank (surtout Films) | Précharger le dataset global au montage ; debounce ~200 ms ; `MIN_SEARCH_LEN` (3 car.) ; plafond `RESULT_LIMIT` (80) |
| **Credentials Xtream** en `localStorage` (quel que soit le tier) | La table porte les mots de passe IPTV ; pas d'isolation par profil | `iptv_profiles` Supabase scopé `auth.uid()`, **toujours** — jamais en local |
| Dupliquer la logique de persistance favoris/historique par tier (au lieu de basculer l'adaptateur) | Deux chemins à maintenir, désync garantie | `LibraryContext` choisit `libraryService` (Premium, Supabase) **ou** `localLibraryService` (gratuit, localStorage) via `useSubscription().isPremium` — **même signature**, un seul branchement |
| Lire la table `subscriptions` en direct pour gater une feature, ou poser l'état Premium depuis le front | `subscriptions` est en lecture seule (RLS) ; seul `stripe-webhook` (service-role) écrit → tout write client est ignoré, tout gating ad-hoc dérive | Consommer `useSubscription().isPremium` (calculé une seule fois dans `SubscriptionContext` : `status ∈ {active,trialing}` + période non expirée). `VITE_DEV_FORCE_PREMIUM` n'agit que si `import.meta.env.DEV` |
| Price IDs / clé secrète Stripe dans le frontend ou passés par le client | Falsification du montant / fuite de secret | Côté serveur uniquement (secrets Edge Function) ; le client n'envoie que `"monthly"\|"yearly"` |
| Lire favoris/historique de façon synchrone (`useState(() => get())`) | Les données arrivent en async de Supabase → état figé vide au 1er rendu | Charger dans le provider, exposer via context ; mises à jour optimistes + upsert async |
| Policy RLS de lecture publique sur `iptv_profiles` ou `select('*')` cross-profil pour le social | La table porte les credentials Xtream (RLS est par ligne, pas par colonne) → fuite massive de mots de passe IPTV | Lecture cross-compte UNIQUEMENT via vues definer `public_profiles`/`public_profile_stats` (sous-ensemble sûr, jamais `user_id`/credentials) + policy `watched_titles` `for select` si `is_public` |
| `getWatched`/`isFollowing`/`memberRating` (lecture via `ref`) utilisés directement dans le rendu | Le `ref` n'est pas réactif → l'UI ne se rafraîchit pas au changement (note, suivi) | Dériver l'affichage de l'état réactif (`watched`/`following`/`memberRatings`) ; réserver les helpers `ref` aux callbacks |
| Enfant `aspect-ratio` (aperçu vidéo) dans un flex column scrollable sans `flex-shrink: 0` | L'algo flexbox écrase à 0 px de haut l'élément sans contenu texte (les blocs de texte gardent leur taille) → aperçu invisible | `flex-shrink: 0` sur le conteneur ratio (`ChannelPreview`) |
| Décoder les champs base64 EPG (`atob`+`TextDecoder`) dans le JSX du `.map` | ~3 décodages × N lignes **par rendu** du parent (frappe recherche, etc.) | Décoder + dédoublonner + calculer l'état « en cours » UNE fois dans un `useMemo([epg])` ; les panels Xtream renvoient souvent chaque créneau en double (clé = `start_timestamp`) |
| Aperçu vidéo non muté / sans `key` par chaîne | Autoplay sans geste refusé si non muté ; réutilisation de l'instance au switch → frame figée de l'ancienne chaîne | `<video muted>` + propriété forcée sur `[src]` ; `key={stream_id}` côté parent pour un remount propre |
| Navigation télécommande (norigin) : assigner `useFocusable().ref.current`, Backspace capté dans un champ, ou écouteur clavier global actif sur le `/player` | Le `ref` norigin est un `RefObject` **lecture seule** (`.current` non assignable → erreur TS) ; Backspace global casserait la saisie de recherche ; un global key-handler entrerait en conflit avec l'Échap du lecteur | Attacher le `ref` norigin directement (`ref={cellRef}`) et ne faire que LE LIRE pour mesurer/scroller (pas de merge par assignation). `RemoteControl` (global Back + lock scroll flèches + focus initial) monté **dans le Shell uniquement** → absent de `/player` (route hors Shell, garde son Échap). Back ignoré si `document.activeElement` est input/textarea/contenteditable. Halo focus via classe `.focused`/`.rc-focused` (tokens Aurora) + `scrollIntoView` sur focus (l'élément sélectionné doit rester visible sur TV) |
| Aperçu au survol (`PreviewCard`) : reflow de la grille, `<iframe>` YouTube brut, ou lecteur laissé vivant après le survol | Le reflow de pistes CSS grid ne s'anime pas (saccades, surtout en bout de ligne) ; un `<iframe>` brut affiche le gros bouton « play » / branding YouTube et ne démarre pas le son ; lecteur non détruit = audio + réseau en fond. NB : l'extrait du vrai flux a été tenté (HLS via `useHls`) mais beaucoup de fournisseurs Xtream ne servent pas un `.m3u8` VOD seekable → aperçu vide ; on s'en tient au trailer YouTube | Overlay `position: fixed` en portal sur `body`, scalé depuis le centre de la carte, clampé au viewport (jamais de rewrap). Trailer via l'**API YouTube IFrame** (pas un iframe brut) : autoplay muté programmatique ; `unMute()`+`setVolume` bas best-effort (politique autoplay navigateur peut re-muter) ; pas de `loop`/`playlist` (boucle manuelle sur `ENDED` → pas de boutons skip) ; `scale(1.5)` rogne le filigrane. `player.destroy()` + `abort()` du résolveur sur `mouseleave`/scroll/unmount ; intention survol ~1 s ; cap 30 s. Résolveur TMDB passé en prop par la **page** (couplage : un composant n'importe pas `services/`) |
| `PreviewCard` : iframe YouTube en `opacity: 0` jusqu'à la lecture (« révéler quand `currentTime` croît ») | **Deadlock confirmé** : YouTube REFUSE l'autoplay muté d'un lecteur qu'il juge masqué (`opacity: 0`) → l'état reste `-1` (UNSTARTED), `PLAYING` ne fire jamais → on ne révèle jamais → jamais de lecture. Le chemin Xtream `youtube_trailer` (sync) masquait le bug ; le chemin TMDB (async) l'expose | L'iframe (`.frameHost`) est rendue **en premier et TOUJOURS visible** (`opacity: 1`) → YouTube accepte l'autoplay. Le poster/backdrop (`.mediaCover`) est posé **par-dessus** dans l'ordre DOM pour masquer l'état « non démarré » ; on le fait disparaître en fondu (`.mediaCoverHidden`) quand la lecture démarre vraiment (`currentTime` croît, ou filet 33 ticks). UX identique (poster → fondu vidéo) sans le deadlock |
| `React.memo(PreviewCard, cmp)` avec comparateur ignorant les props fonctions | Gèle `resolveTrailer`/`onOpen`/`onFavorite` à la 1ʳᵉ valeur → casse la résolution asynchrone du trailer (et autres dispatchers). Le composant porte un état async non trivial (lecteur YT) | Ne PAS mémoïser `PreviewCard`. Le coût de montage des grilles est déjà borné par `useProgressiveList` (fenêtre progressive) + `content-visibility:auto` (zéro paint hors écran). `MediaCard` (chaînes, pas d'async) peut rester `memo` |
| Catalogue Xtream re-fetché à chaque navigation (Home → Films → retour) | `getVodStreams`/`getSeries`/`getLiveStreams` re-téléchargent des milliers d'items (upstream lent) ; une même page peut fetch 2× le même catalogue (catégorie + global recherche) | Cache mémoire de session dans `xtream.service` (Promise partagée, clé `serverUrl|action|category`, TTL 10 min ; EPG 1 min ; `authenticate` JAMAIS caché) |

---

## 5. Architecture cible — Backend externalisé (multi-plateforme)

> ⚠️ **Pivot (2026-05)** : la stratégie multi-plateforme a changé. Les apps
> natives ne porteront PAS le backend proxy `/api/*` — elles streament en direct
> depuis l'appareil via un lecteur natif. Le mécanisme `apiUrl` / `VITE_API_BASE_URL`
> ci-dessous ne sert plus qu'au **site web (vitrine)**. Le découplage proxy-vs-direct
> passe désormais par `src/lib/platform.ts` (`isNative`). Feuille de route du
> portage natif : [`native-port.md`](./native-port.md).

> Ce §5 décrit l'état **à implémenter** (voir `CLAUDE.md` §IX pour le contexte et les commandes).

### Problème
Samsung Tizen, LG webOS, Android Capacitor, iOS : le bundle web est exécuté dans un WebView — pas de Node.js disponible. Les routes `/api/*` (ffmpeg, ffprobe, proxy Xtream) ne peuvent pas tourner localement sur ces plateformes.

### Solution : `VITE_API_BASE_URL` + helper `apiUrl`

**`src/lib/api.ts`** — seul endroit qui construit les URL `/api/*` :
```ts
/** Préfixe l'URL du backend si VITE_API_BASE_URL est défini (builds TV/mobile).
 *  En web co-localisé la variable est vide → chemin relatif inchangé. */
export const apiUrl = (path: string): string =>
  `${import.meta.env.VITE_API_BASE_URL ?? ''}${path}`;
```
- Tous les appels `/api/*` existants dans `src/` remplacés par `apiUrl('/api/...')`.
- **Règle** : `import.meta.env.VITE_API_BASE_URL` n'est jamais concaténé en dehors de ce fichier.

### Changements `server/proxy.cjs`
- Middleware CORS : `Access-Control-Allow-Origin: ${process.env.ALLOWED_ORIGINS ?? '*'}` (avec preflight OPTIONS).
- Port configurable via `process.env.PORT` (défaut 4000).
- Script `npm run server` dans `package.json`.
- Aucune logique métier modifiée — uniquement les garde-fous opérationnels (`ffprobe pipe:0`, UA VLC, etc.) restent intacts.

### Builds par cible
| Cible | Commande | `VITE_API_BASE_URL` |
|---|---|---|
| Web (co-localisé) | `npm run build` | `` (vide, chemins relatifs) |
| TV / Mobile | `npm run build:tv` | `https://mon-api.example.com` |

### Règle de couplage (ajout au §3)
`apiUrl()` depuis `src/lib/api.ts` est le **seul** point de construction des URL `/api/*`. Aucun hook, service, composant ou page ne doit référencer `import.meta.env.VITE_API_BASE_URL` directement.

### Ce qui ne change PAS
- `npm run dev` : plugin Vite inline inchangé — DX identique.
- Supabase : SDK frontend direct, jamais via `/api/*`.
- TMDB : HTTP direct, jamais via `/api/*`.
- Tous les garde-fous §IV (ffprobe stdin pipe, seekOffset, UA live, etc.).

---

### HLS / Sous-titres

| Anti-pattern | Pourquoi | Correctif |
|---|---|---|
| Handler `SUBTITLE_TRACKS_UPDATED` HLS.js | Les pistes HLS ne correspondent pas aux tracks du fichier source | Probe toujours depuis `mediaUrl` (fichier direct) |
| Afficher les sous-titres en mode natif HLS | HLS.js crée des TextTracks que Chrome n'active pas fiablement | Désactiver tous les textTracks, utiliser overlay custom |
| `timeupdate` pour la sync sous-titres | Ne fire qu'à ~4 Hz → lag visible de 250 ms | `requestAnimationFrame` (~60 Hz) |
| Recherche linéaire O(n) dans les cues | Lente sur les fichiers avec milliers de cues | Recherche binaire + hint d'index (`lastIdx`) |
| Préchauffer TOUTES les pistes de sous-titres en parallèle (`runProbe`) | Chaque `/api/subtitle` = un ffmpeg qui lit TOUT le fichier distant → 10 pistes = 10 ffmpeg concurrents qui étranglent CPU/bande passante et **retardent le démarrage de la vidéo elle-même** | Préchauffage **sérialisé** (1 piste à la fois), **priorisé** (piste sélectionnée > langue FR > reste), **différé ~3 s** (ne concurrence pas `/api/stream`) et **annulable** (`AbortController`) — coupé au changement de source / démontage. La déduplication in-flight serveur évite tout double travail si l'utilisateur clique avant |
