# Portage applications natives — feuille de route & avancement

> **À lire au début de toute session liée au portage.** Ce document est le fil
> conducteur : il décrit la cible, les phases, et **où on en est**. Mettre à
> jour la section « 7. État d'avancement » à la fin de chaque session.

---

## 1. Pourquoi ce chantier

L'app est aujourd'hui une SPA web qui dépend d'un **backend proxy** (`/api/*` :
ffmpeg, ffprobe, proxy Xtream). Ce modèle a deux défauts rédhibitoires pour un
produit grand public :

1. **Blocage d'IP** — tous les flux sortent par l'IP unique du serveur. Les
   fournisseurs IPTV blacklistent les IP de datacenter (OVH…) → HTTP 403 sur
   une partie des sources (constaté : sur une même playlist, certaines sources
   marchent et d'autres non, selon le serveur/CDN qui les héberge).
2. **Coût / scalabilité** — chaque flux est remuxé par ffmpeg (CPU lourd) et
   chaque octet transite fournisseur → serveur → utilisateur (bande passante
   payée deux fois). Ingérable au-delà de quelques utilisateurs.

Les apps de référence (IPTV Smarters, TiviMate…) n'ont **aucun backend** : ce
sont des apps natives qui streament directement de l'appareil au serveur
Xtream, depuis l'IP de chaque utilisateur. Pas d'IP centrale à bloquer, pas de
serveur à payer.

## 2. Architecture cible

- **Site web** → simple **vitrine** : marketing, connexion, achat Premium
  (Stripe), gestion du compte. Plus aucune lecture vidéo.
- **Applications natives** (Android, Android TV, LG webOS, Samsung Tizen,
  Windows) → réutilisent l'UI React actuelle, mais :
  - appels Xtream **directs** depuis l'appareil (IP de l'utilisateur) ;
  - lecture par un **lecteur natif** (libVLC) — plus de ffmpeg ;
  - aucun backend proxy `/api/*`.
- **Supabase** reste le backend des comptes / abonnements / profils / social /
  notes — backend managé scalable, appelé directement par tous les clients.

## 3. Décisions techniques arrêtées

| Sujet | Décision | Raison |
|---|---|---|
| Enrobage mobile/TV | **Capacitor** | Conserve l'UI React/CSS existante (React Native = réécriture totale) |
| Lecteur natif | **libVLC** | Lit tout (MKV, HEVC, MPEG-TS, sous-titres) — la raison d'être de ffmpeg |
| Windows | **Electron** | Option B possible : embarquer `server/proxy.cjs` en local (IP résidentielle) → réutilise tout l'existant |
| Ordre des plateformes | Android → Android TV → Windows → Tizen/webOS | Audience + difficulté croissante |
| Mode d'exécution | `VITE_RUNTIME` (`web` \| `native`), figé au build | Marche pour tous les shells (Capacitor / Electron / Tizen / webOS) |
| Paiement | Toujours sur la **vitrine web** | Évite Google Play Billing (commission 15-30 % sur les achats in-app de biens numériques) |
| Onboarding TV | Page d'accueil + **QR code** (auth + creds saisis sur le téléphone) | Saisie texte à la télécommande pénible ; le téléphone est déjà l'écran de création de compte / profil — voir Phase 2f |

## 4. Phases

### Phase 1 — Découpler le frontend du backend proxy *(terminée)*
Pur refactor dans le repo actuel, sans code natif, sans rien casser côté web.

- **1a — Couche données** ✅ *(fait — 2026-05-22)*
  - `src/lib/platform.ts` : `isNative` / `isWeb` (lit `VITE_RUNTIME`).
  - `src/lib/http.ts` : `httpGetJson` — point de bascule unique vers le HTTP natif.
  - `src/services/xtream.service.ts` : URLs d'API et de stream **directes** en
    mode natif (sans proxy), comportement web inchangé.
  - `src/utils/image.ts` : `safeImgUrl` renvoie l'URL directe en mode natif.
- **1b — Couche lecture** ✅ *(fait — 2026-05-22)*
  - `src/types/player.types.ts` : interface `PlayerController` (contrat de
    lecture agnostique) + types `PlayerStatus` / `QualityLevel` / `AudioTrack` /
    `SubtitleTrack`.
  - `usePlayer.ts` : importe ces types ; expose `WebPlayerController`
    (`PlayerController` + refs DOM `<video>`/conteneur) ; son retour est annoté
    contre ce contrat → toute dérive de l'API est rattrapée par le compilateur.
  - `VideoPlayer.tsx` typé contre `WebPlayerController`.
  - Aucun lecteur natif encore — juste l'abstraction qui permet d'en brancher un :
    une future implémentation native fournira un `PlayerController` (sans refs DOM).

### Phase 2 — App Android & Android TV *(en cours)*

- **2a — Scaffolding Capacitor** ✅ *(fait — 2026-05-22)*
  - Capacitor **7.6.5** installé (`@capacitor/core` + `@capacitor/android` +
    `@capacitor/cli`). Capacitor 8 exige Node ≥ 22 → resté en 7 (Node 20 sur la
    machine de dev et le Docker). Pour passer à Cap 8 plus tard : Node 22+.
  - `capacitor.config.ts` : appId `com.iptvax.app`, appName `Iptvax`, webDir `dist`.
  - Projet natif généré dans `android/` (versionné ; le `.gitignore` Capacitor
    exclut les artefacts de build, les assets web copiés, `local.properties`).
  - Scripts npm : `build:native` (build avec `VITE_RUNTIME=native`), `cap:sync`
    (build natif + `cap sync`), `cap:android` (ouvre Android Studio).
- **2b — HTTP natif** ✅ *(fait — 2026-05-22)*
  - `src/lib/http.ts` : en mode natif, `httpGetJson` utilise `CapacitorHttp`
    (client HTTP natif — ignore le CORS, pose le `User-Agent`). Mode web
    inchangé (`fetch`). Branché via `isNative`.
  - `AndroidManifest.xml` : `android:usesCleartextTraffic="true"` — Android
    bloque le HTTP en clair par défaut (API 28+), or les serveurs Xtream sont
    massivement en HTTP simple. Indispensable aussi pour le streaming (2c).
- **2c — Lecteur natif libVLC** ✅ *(fait — 2026-05-22 ; à valider sur appareil)*
  - **Plugin maison** `VlcPlayer` — aucun plugin Capacitor libVLC communautaire
    maintenu n'existe → plugin local dans le projet Android :
    `android/app/src/main/java/com/iptvax/app/VlcPlayerPlugin.java`, enregistré
    dans `MainActivity`. Dépendance Gradle `org.videolan.android:libvlc-all:3.6.5`
    (+ `abiFilters` arm64/armv7/x86_64 pour ne pas embarquer x86).
  - **Rendu** : libVLC affiche la vidéo dans une `VLCVideoLayout` (SurfaceView)
    insérée DERRIÈRE la WebView. Pendant la lecture, la WebView est rendue
    transparente (`setBackgroundColor(TRANSPARENT)`) → les contrôles React
    s'affichent par-dessus la vidéo native. La transparence de la chaîne web
    (`html`/`body`/`#root` + conteneurs du lecteur) est portée par la classe
    `iptvax-native-playback` posée sur `<html>` par `useNativePlayer`, et la
    classe `native-video-surface` sur les conteneurs (`Player`, `VideoPlayer`).
    `stop()` rétablit la WebView opaque → aucun impact hors lecture.
  - **JS** : `src/native/vlcPlayer.ts` (interface du plugin : `load`/`play`/
    `pause`/`stop`/`seek`/`setAudioTrack`/`setSubtitleTrack`/`setVolume`/
    `setSubtitleDelay` + events `state`/`time`/`tracks`).
  - `src/hooks/useNativePlayer.ts` : implémentation native du contrat
    `PlayerController` — pendant de `usePlayer` (web). `VideoPlayer.tsx` choisit
    l'un ou l'autre via `isNative` (branche figée au build → sûre).
  - **Sous-titres** : rendus PAR libVLC sur la surface native (pas d'overlay
    React, pas de `/api/subtitle`). Le décalage g/h pilote `setSpuDelay`. Pistes
    audio/sous-titres énumérées via libVLC. Niveaux de qualité HLS non exposés
    (`levels` vide → menu qualité masqué) ; bouton plein écran masqué (l'app
    native est déjà plein écran).
- **2d — Android TV** ✅ *(fait — 2026-05-22 ; à valider sur box/émulateur TV)*
  - **Manifeste** : catégorie `LEANBACK_LAUNCHER` ajoutée à l'intent-filter
    MAIN → l'app apparaît sur le home Android TV. `uses-feature`
    `android.software.leanback` et `android.hardware.touchscreen` déclarées
    `required="false"` → l'app reste installable sur téléphone (tactile) ET
    box TV (télécommande seule). `android:banner` sur `<application>`.
  - **Bannière** : `res/drawable/tv_banner.xml` — layer-list (logo du launcher
    centré sur fond noir `@color/tv_banner_background`, dans `res/values/
    colors.xml`). Réutilise le foreground adaptatif → aucun asset PNG ajouté.
  - **Navigation D-pad** : la grille de `ProfileSelect` (cartes profil, carte
    « ajouter », bouton « gérer ») était en `<button>` natifs **non
    navigables** à la télécommande → convertie en `Focusable` (norigin), avec
    focus initial ancré sur le 1er profil et flèches `preventDefault` pour
    bloquer le scroll natif. Les pages catalogue (Shell) utilisaient déjà
    `Focusable` + `RemoteControl`. Le lecteur (`VideoPlayer`) pilote déjà tout
    au clavier/D-pad (flèches = seek/volume/chaîne) ; ajout de `Enter` (bouton
    OK de la télécommande) → lecture/pause.
  - **Focus visible** : règle `:focus-visible` globale (anneau cyan `--accent`)
    sur les `button`/`[role=button]` natifs hors couverture norigin. Ne
    s'affiche qu'en navigation clavier/D-pad — jamais à la souris/au tactile.
  - ⚠️ `Focusable`, `:focus-visible` et `Enter`→play/pause sont **additifs et
    inertes sans télécommande** → web et app mobile Android inchangés. Seul
    l'amorçage D-pad de `ProfileSelect` (focus initial + `preventDefault` des
    flèches) est gardé derrière `isNative` : sinon le focus posé par programme
    afficherait un halo au chargement côté web desktop.
- **2e — OAuth natif (deep link)** ✅ *(fait — 2026-05-22)*
  - Connexion Google/Apple : en natif, `signInWithOAuth` ouvre un onglet
    système (`@capacitor/browser`) ; le retour passe par le deep link
    `com.iptvax.app://auth-callback` (intent filter dans `AndroidManifest.xml`),
    capté via `@capacitor/app`, puis `exchangeCodeForSession` (flux PKCE).
    Client Supabase en `flowType: 'pkce'` uniquement en natif (web inchangé).
  - ⚙️ **Config requise côté Supabase** : ajouter `com.iptvax.app://auth-callback`
    dans Authentication → URL Configuration → **Redirect URLs**.
- **2f — Onboarding TV (QR code)** ✅ *(fait — 2026-05-22 ; à valider sur box/émulateur TV)*
  - Sur Android TV, la saisie de texte à la télécommande est pénible →
    décision produit : la TV n'affiche **aucun formulaire**. Elle montre une
    page d'accueil avec un **QR code** ; l'utilisateur le scanne avec son
    téléphone, se connecte et choisit son profil côté mobile, et la TV reçoit
    la session (appairage TV ↔ téléphone).
  - **Détection TV** : le même APK s'installe sur téléphone ET box → la
    distinction se fait au runtime. Plugin natif maison `TvDetect`
    (`android/.../TvDetectPlugin.java`, enregistré dans `MainActivity`) :
    `UiModeManager.UI_MODE_TYPE_TELEVISION` (repli `FEATURE_LEANBACK`). Côté
    JS `src/native/tvDetect.ts` : résolu une fois au boot (`main.tsx`), exposé
    en getter sync `isTvDevice()` — **toujours `false` hors natif** → web et
    app mobile strictement inchangés.
  - **Schéma Supabase** : `supabase/migrations/0002_tv_pairings.sql` — table
    `tv_pairings` **scellée** (RLS activée, AUCUNE policy) ; tout passe par 3
    RPC `SECURITY DEFINER` : `create_tv_pairing` (TV, anon), `authorize_tv_pairing`
    (téléphone, authentifié — vérifie que le profil appartient à `auth.uid()`),
    `claim_tv_pairing` (TV, anon — atomique, usage unique, nullifie les tokens).
    Même principe que `public_profiles` / `get_member_watched` (CLAUDE.md §IV-15).
  - **Flux** : la TV appelle `create_tv_pairing` → affiche le QR pointant vers
    `VITE_WEB_URL/tv-link?code=…`. Le téléphone ouvre cette page web, se
    connecte, choisit un profil → `refreshSession()` (tokens frais) +
    `authorize_tv_pairing` ; puis l'onglet web fait `signOut({scope:'local'})`
    → la TV devient seule détentrice du refresh token (pas de conflit de
    rotation). La TV est réveillée par **Realtime Broadcast** (canal
    `tv-pairing:<code>`, indépendant du RLS) + **poll de repli 6 s**, récupère
    la session via `claim_tv_pairing`, pré-amorce le profil dans `localStorage`
    et appelle `setSession` → `onAuthStateChange` enchaîne sur le reste de l'app.
  - **Fichiers** : `src/services/tvPairing.service.ts` (RPC + broadcast),
    `src/pages/TvPairing.tsx` (écran TV natif), `src/pages/TvLink.tsx` (page
    web `/tv-link`). `App.tsx` : route `/tv-link` traitée dans `AppGate` en
    amont du gating ; `!user` → `<TvPairing/>` si `isTvDevice()`, sinon
    `<Login/>`. `signInWithGoogle/Apple` acceptent un `redirectTo` optionnel.
  - ⚙️ **Config requise** : exécuter `0002_tv_pairings.sql` dans le SQL Editor ;
    renseigner `VITE_WEB_URL` pour les builds natifs ; ajouter
    `VITE_WEB_URL/tv-link` aux Redirect URLs Supabase (retour OAuth web).
  - Rend caduques les limitations D-pad de `Login` / `ProfileEditor` sur TV
    (§6) : plus de formulaire à parcourir à la télécommande.
  - **Limite connue** : `TvLink` permet de *sélectionner* un profil existant.
    La *création* d'un profil (saisie des identifiants Xtream) reste à faire
    dans l'app/le web classique — raffinement futur si besoin.
- **Valider** qu'une source qui renvoyait 403 sur le VPS joue maintenant
  (le flux part de l'IP de l'utilisateur).

> **Pré-requis machine** : builder l'APK demande **Android Studio + SDK Android**.
> Le scaffolding (2a) et le code (2b/2c) n'en ont pas besoin ; le build final si.

### Phase 3 — App Windows (Electron) *(scaffolding fait — à valider sur machine de l'utilisateur)*

Option B retenue : embarquer `server/proxy.cjs` en local. Le proxy tourne sur
la **loopback** à un port libre choisi par l'OS, et la fenêtre Electron pointe
sur `http://127.0.0.1:<port>/` — donc l'app tourne exactement en mode `web`
(VITE_RUNTIME non défini, `isNative = false`), juste hébergée localement.
Comportement web historique strictement préservé, mais les flux sortent par
l'**IP résidentielle de l'utilisateur** → plus de blocage 403 d'IP datacenter
(cf. §1) et zéro réécriture du lecteur (ffmpeg / sous-titres custom / parseur
VTT inchangés).

- **3a — Shell Electron + proxy embarqué** ✅ *(fait — 2026-05-23 ; à valider sur machine utilisateur)*
  - `server/proxy.cjs` refactoré pour exporter `startServer({ port, host,
    serveStatic, distDir })` (Promise → `{ port, server, close }`). Mode CLI
    préservé via `require.main === module` → `npm run start` / `npm run server`
    / Docker inchangés. Le réglage `host: '127.0.0.1'` (Electron) empêche
    d'exposer le proxy sur le LAN, tandis qu'en CLI on reste sur `0.0.0.0`.
  - `electron/main.cjs` : main process — appelle `startServer({ port: 0,
    host: '127.0.0.1', serveStatic: true, distDir: '<root>/dist' })`,
    puis ouvre `BrowserWindow` (contextIsolation activé, sandbox désactivé
    pour pouvoir spawn ffmpeg) sur l'URL retournée. Lifecycle : `before-quit`
    attend `serverHandle.close()` avant `app.exit(0)` → ffmpeg pipes fermés
    proprement (sinon zombies sous Windows).
  - **Binaires ffmpeg en bundle asar** : `ffmpeg-static` / `ffprobe-static`
    embarquent un exécutable qui ne tourne PAS depuis une archive asar.
    `electron-builder` les déballe en parallèle via `build.asarUnpack`
    (`node_modules/ffmpeg-static/**` + `…/ffprobe-static/**` →
    `app.asar.unpacked/…`). `electron/main.cjs` réécrit le chemin renvoyé
    par chaque package (`app.asar` → `app.asar.unpacked`) et le pousse dans
    `process.env.FFMPEG_PATH` / `FFPROBE_PATH` / `FFMPEG_PATH_SUB` AVANT
    le `require('server/proxy.cjs')`. `pickBinary` (CLAUDE.md §IV-25) lit ces
    env vars en priorité 1, ce qui laisse Docker (apt) et le dev local
    (`ffmpeg-static` direct) strictement inchangés.
  - `electron/preload.cjs` : intentionnellement vide (l'app reste 100 % web,
    aucun pont natif). `contextIsolation` reste activé.
  - `package.json` : `main: electron/main.cjs`, scripts `electron:dev`
    (lance le shell sur le `dist/` actuel), `electron:start` (`build && electron .`),
    `electron:build` (`build && electron-builder`). Bloc `build` electron-builder
    minimal : `appId com.iptvax.app`, `productName Iptvax`, target Windows
    NSIS, sortie dans `release/`. **Le mode `web` reste figé** : aucun
    branchement `isNative` ajouté pour Electron — Option B → mode `web` =
    comportement historique exact.
- **À valider manuellement** sur la machine utilisateur :
  - lancement (`npm run electron:start`) ouvre la fenêtre, l'app charge ;
  - lecture d'un VOD/série qui retournait 403 sur le VPS → joue depuis
    Electron (flux part de l'IP résidentielle) ;
  - packaging (`npm run electron:build`) produit un installeur NSIS dans
    `release/` et l'app installée lance ffmpeg sans erreur d'asar.

### Phase 4 — Tizen & webOS
- Packaging propre à chaque plateforme (Tizen Studio / webOS CLI) — **pas** de
  Capacitor, ça reste une web-app.
- Implémentation `PlayerController` via le lecteur natif de la plateforme
  (Tizen **AVPlay**, APIs média webOS).
- Déclarer les privilèges réseau pour les appels Xtream directs.

### Phase 5 — Site vitrine
- Réduire le web à : marketing, connexion, achat Premium, gestion du compte,
  liens de téléchargement. Retirer la lecture (et le catalogue, ou garder un
  aperçu).
- La partie paiement (Stripe + Supabase) existe déjà — rien à refaire.

## 5. Conventions

- **`VITE_RUNTIME`** : non défini ou `web` → mode web (proxy). `native` → mode
  natif (direct). Chaque shell natif construit le bundle avec `VITE_RUNTIME=native`.
- **Garde-fou** : tout branchement proxy-vs-direct passe par `isNative` de
  `src/lib/platform.ts`. Jamais de détection ad-hoc ailleurs.
- Le mode `web` doit **toujours** rester le comportement historique exact.

## 6. Points de vigilance (à traiter le moment venu)

- **Mémoire / WebView** : sur appareil à faible RAM (émulateur 2 Go, box Android
  TV bas de gamme), le process de rendu du WebView peut être tué par l'OOM-killer
  → l'app se ferme (`Renderer process crash — OOM`). Tester sur un appareil réel
  ou un émulateur ≥ 4 Go. À durcir pour le produit : gérer `onRenderProcessGone`
  côté natif (recharger le WebView au lieu de laisser Android tuer l'app) — sera
  important pour les box Android TV. Piste perf : exclure hls.js/mpegts.js des
  builds natifs (le lecteur natif les remplace).
- **Images** : en natif, `safeImgUrl` renvoie l'URL directe. Les covers Xtream
  en HTTP sont autorisées via `allowMixedContent` (`capacitor.config.ts`) +
  `usesCleartextTraffic`. ⚠️ Reste non géré : les images HTTPS à certificat
  expiré (que `/api/img` contournait côté web) — nécessitera un override natif
  `onReceivedSslError` si le cas se présente.
- **Auth OAuth** (Google/Apple) : sur Android, fait via deep link (Phase 2e).
  Pour Tizen / webOS / Electron, le retour de redirection devra être adapté à
  chaque plateforme le moment venu.
- **`tmdb.service.ts` / `utils/imageHash.ts`** utilisent `apiUrl` — vérifier
  s'ils ont besoin d'un branchement natif (TMDB lui-même est en HTTP direct,
  donc OK ; à confirmer pour le proxy d'images).
- **`usePlayer.ts`** est purement web (ffmpeg, `/api/stream`, parsing VTT…).
  Il n'est PAS porté : il reste l'implémentation `web` de `PlayerController`.
  L'implémentation native est `useNativePlayer.ts` (pilote libVLC) — Phase 2c.
- **Lecteur natif — points à durcir** (Phase 2c faite, à affiner) :
  - **Barre de statut / immersif** : ✅ fait — `VlcPlayerPlugin` masque les
    barres système (statut + navigation) via `WindowInsetsControllerCompat`
    pendant la lecture et les restaure sur `stop()`. Reste éventuellement à
    gérer les encoches (display cutout) en paysage si un cas se présente.
  - **Mise en arrière-plan** : libVLC continue de tourner si l'app passe en
    arrière-plan ; pas de pause auto. À décider (pause auto vs lecture audio
    continue).
  - **Niveaux de qualité HLS** : non exposés par le plugin (`levels` vide).
    Acceptable v1 ; libVLC fait l'ABR tout seul.
  - **Version libVLC** : `org.videolan.android:libvlc-all:3.6.5` épinglée dans
    `android/app/build.gradle`. Si la résolution Maven échoue, ajuster vers une
    3.6.x disponible.
- **Android TV — limitations connues (Phase 2d)** :
  - **`Login` et `ProfileEditor`** (saisie de texte) : **résolu par la Phase
    2f** — sur une box TV, l'app affiche un QR code d'appairage au lieu de ces
    formulaires, donc plus aucun champ texte à parcourir à la télécommande. Ces
    écrans restent inchangés pour le web et l'app mobile.
  - **Lecteur** : les flèches sont consommées pour seek/volume/chaîne → le
    focus D-pad ne peut pas atteindre les boutons audio / sous-titres /
    qualité de la barre de contrôle. Changer de piste audio ou de sous-titres
    *depuis le lecteur* n'est donc pas accessible à la télécommande. À
    concevoir (mode « focus » dédié, ou contrôles `Focusable`).
  - **WebView OOM** : cf. point « Mémoire / WebView » ci-dessus — d'autant
    plus critique sur box TV bas de gamme. `onRenderProcessGone` reste à
    gérer côté natif.
- **CLAUDE.md §IX** décrit l'ancien modèle « backend sur VPS » — ne vaut plus
  que pour le site vitrine. Le portage natif suit §XI + ce document.

## 7. État d'avancement

| Date | Étape | Statut |
|---|---|---|
| 2026-05-22 | Phase 1a — couche données (platform / http / xtream / image) | ✅ Fait |
| 2026-05-22 | Phase 1b — couche lecture (interface `PlayerController`) | ✅ Fait |
| 2026-05-22 | Phase 2a — scaffolding Capacitor 7 + projet `android/` | ✅ Fait |
| 2026-05-22 | Phase 2b — HTTP natif (`CapacitorHttp` + cleartext HTTP) | ✅ Fait |
| 2026-05-22 | Phase 2e — OAuth natif Android (deep link Google/Apple) | ✅ Fait |
| 2026-05-22 | Validation app native sur appareil réel (Galaxy S26 Ultra) | ✅ OK |
| 2026-05-22 | Phase 2c — lecteur natif libVLC (plugin maison + `useNativePlayer`) | ✅ Fait |
| 2026-05-22 | Validation lecture native sur appareil réel (Galaxy S26) | ✅ OK |
| 2026-05-22 | Phase 2d — Android TV (manifeste leanback + bannière + D-pad ProfileSelect) | ✅ Fait |
| 2026-05-22 | Validation 2d sur émulateur Android TV (lancement leanback) | ✅ OK |
| 2026-05-22 | Phase 2f — Onboarding TV par QR code (table `tv_pairings` + plugin `TvDetect` + TvPairing/TvLink) | ✅ Fait |
| 2026-05-23 | Validation 2f sur émulateur Android TV (appairage QR scan → connexion Google sur téléphone → choix profil → déblocage TV) | ✅ OK |
| 2026-05-23 | Phase 3a — Scaffolding Electron (refactor `startServer`, `electron/main.cjs`, asarUnpack ffmpeg, electron-builder 25, electron 34) | ✅ Fait |

**Phase 1 terminée** (frontend découplé du backend proxy). **Phase 2
terminée** : l'app native Android tourne sur appareil réel — connexion Google
(deep link), sélection de profil, navigation dans le catalogue, chargement des
images **et lecture vidéo native (libVLC)** fonctionnent, le tout en parlant
**directement** aux serveurs Xtream depuis l'IP de l'appareil (plus de blocage
403). **2d (Android TV)** : l'app se lance bien comme application leanback
(manifeste + bannière) sur l'émulateur Android TV, et la sélection de profil
est navigable à la télécommande. **2f (Onboarding TV par QR code)** : sur une
box TV, l'app affiche désormais un QR code au lieu du formulaire de connexion ;
l'utilisateur le scanne avec son téléphone, se connecte et choisit son profil
côté mobile, et la TV reçoit la session (appairage via la table scellée
`tv_pairings` + Realtime Broadcast). Plus aucune saisie de texte à la
télécommande. Appairage **validé de bout en bout** sur émulateur Android TV
(QR scanné depuis téléphone → connexion Google → choix du profil → la TV
reçoit la session et entre dans l'app).

Correctifs natifs appliqués en cours de route : `usesCleartextTraffic` (serveurs
Xtream en HTTP), `allowMixedContent` (covers HTTP chargées dans le WebView
servi en HTTPS), et — pour la lecture native — `getVodStreamUrl` /
`getSeriesStreamUrl` renvoient désormais le **fichier direct** (conteneur
MKV/MP4) en mode natif au lieu du `.m3u8` : ce dernier n'est qu'un artefact du
remux ffmpeg du proxy web, beaucoup de serveurs Xtream ne le servent pas pour
les films/épisodes → libVLC n'avait rien à lire (écran noir). Le lecteur natif
force aussi l'orientation paysage pendant la lecture (`VlcPlayerPlugin`).

**Phase 3a (Electron — Option B) livrée** : le shell Electron démarre
`server/proxy.cjs` sur la loopback à un port libre, la fenêtre charge l'app
React servie par ce proxy local. Mode `web` conservé → aucune régression sur
le site et l'app reste 100 % UI existante. Validation locale : le proxy
bootstrappe bien sous Electron (port libre + binaires ffmpeg-static via
`app.asar.unpacked`) et sert `dist/` + `/api/*` correctement. **À valider sur
la machine utilisateur** : lancement Electron en mode prod (`npm run
electron:start`), lecture d'un flux qui retournait 403 sur le VPS (preuve que
le flux sort par l'IP résidentielle), et packaging (`npm run electron:build`)
produisant l'installeur NSIS.

**Prochaine étape : Phase 4 — Tizen & webOS** (une fois Phase 3 validée à
l'œil). Option A (binding libVLC dans Electron) reste possible en plan B si
le proxy local pose un problème inattendu côté Windows — pour l'instant rien
ne le justifie.

**Détails de finition différés** (cf. §6 — à reprendre plus tard, sauf si
bloquant) :
- Polish UX / visuel des apps Android et Android TV (l'utilisateur s'en
  occupe lui-même).
- Polish UX de la page web `/tv-link` (ergonomie une fois sur le site
  signalée comme améliorable).
- Pause auto en arrière-plan, encoches (cutout) en paysage, polish
  esthétique du lecteur mobile, navigation D-pad des contrôles audio/CC du
  lecteur (limitations Android TV connues, §6).
- La navigation D-pad de `Login` / `ProfileEditor` est sans objet sur TV
  depuis 2f.
- Raffinement possible : permettre la *création* d'un profil (identifiants
  Xtream) depuis `TvLink` — aujourd'hui `TvLink` ne fait que *sélectionner*
  un profil existant.
