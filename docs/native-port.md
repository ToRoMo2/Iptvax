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
| Mode d'exécution | `VITE_RUNTIME` (`web` \| `capacitor` \| `tizen` \| `webos`), figé au build | Une valeur par shell ; `isNative` = union des 3 sous-modes natifs (bascule data layer commune) ; Electron reste sur `web` (Option B) |
| Paiement | Toujours sur la **vitrine web** | Évite Google Play Billing (commission 15-30 % sur les achats in-app de biens numériques) |
| Onboarding TV | Page d'accueil + **QR code** (auth + creds saisis sur le téléphone) | Saisie texte à la télécommande pénible ; le téléphone est déjà l'écran de création de compte / profil — voir Phase 2f |

## 4. Phases

### Phase 1 — Découpler le frontend du backend proxy *(terminée)*
Pur refactor dans le repo actuel, sans code natif, sans rien casser côté web.

- **1a — Couche données** ✅ *(fait — 2026-05-22)*
  - `src/lib/platform.ts` : `isNative` / `isWeb` + sous-flags `isCapacitor` /
    `isTizen` / `isWebOS` (lit `VITE_RUNTIME`).
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
  - Scripts npm : `build:capacitor` (build avec `VITE_RUNTIME=capacitor`),
    `cap:sync` (build Capacitor + `cap sync`), `cap:android` (ouvre Android
    Studio). `build:native` est gardé comme alias rétrocompatible de
    `build:capacitor`.
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
- **3b — OAuth navigateur système (protocole custom)** ✅ *(fait — 2026-05-23 ; à valider sur machine utilisateur)*
  - Symptôme à corriger : par défaut, le clic « Se connecter avec Google »
    naviguait DANS la fenêtre Electron → l'utilisateur perdait ses cookies
    Chrome/Edge, devait retaper email + mot de passe, pas de sélecteur de
    compte Google. UX largement en dessous d'IPTV Smarters & co.
  - Solution : reproduire la Phase 2e Android dans Electron — ouvrir l'URL
    OAuth dans le **navigateur système** (`shell.openExternal`), et capter le
    retour via un **protocole custom** `iptvax://auth-callback?code=…` que
    Supabase appelle à la fin du flow.
  - **Détection runtime `isElectron`** dans `src/lib/platform.ts` : présence
    du pont `window.electron` exposé par le preload. ⚠ `isNative` reste
    **`false`** en Electron (Option B = mode `web`) — `isElectron` est un
    sur-flag ciblé qui ne déclenche QUE la bascule OAuth.
  - **Pont preload** (`electron/preload.cjs`, via `contextBridge`) :
    `window.electron.openExternal(url)` et `window.electron.onAuthCallback(handler)`.
    Validation `^https?://` côté main process pour empêcher un renderer
    compromis de spawn `file://`, `ftp://`, `javascript:` etc.
  - **Main process** (`electron/main.cjs`) : enregistre le protocole via
    `app.setAsDefaultProtocolClient('iptvax', …)` (avec script en arg en dev,
    sans en prod). `app.requestSingleInstanceLock()` + handler
    `second-instance` pour récupérer l'URL `iptvax://…` de l'argv quand
    Windows lance une 2e Iptvax.exe au clic sur le lien. Handler `open-url`
    macOS pour le futur. URL initiale dans `process.argv` traitée aussi
    (1er lancement à froid par clic protocole). L'URL est forwardée au
    renderer via `webContents.send('iptvax:auth-callback', url)` — bufferisée
    si la fenêtre n'a pas fini `did-finish-load`.
  - **Frontend** : `supabase.ts` active `flowType: 'pkce'` quand `isElectron`
    (en plus d'`isNative`) → PKCE obligatoire car le redirect n'aboutit pas
    dans la fenêtre Electron, on doit échanger un `code` manuellement.
    `SupabaseAuthContext` ajoute la branche `isElectron` :
    `signInWithOAuth({ redirectTo:'iptvax://auth-callback', skipBrowserRedirect:true })`
    → `window.electron.openExternal(data.url)` ; puis le `useEffect`
    `onAuthCallback` parse `code` / `error_description` et appelle
    `exchangeCodeForSession`. Branche Capacitor strictement inchangée.
  - ⚙️ **Config requise côté Supabase** : ajouter `iptvax://auth-callback`
    dans Authentication → URL Configuration → **Redirect URLs**. Sans ça,
    Supabase refuse la redirection vers le protocole custom.

### Phase 4 — Tizen & webOS

Ordre arrêté : **Tizen d'abord**, puis webOS. Trois raisons : AVPlay est
l'équivalent direct de libVLC (toutes pistes, tous codecs nativement),
audience plus large (~32 % marché TV connecté), outillage Samsung plus mature
(la nouvelle extension VS Code « Tizen » remplace Tizen Studio Eclipse et
embarque la CLI `tz` + `sdb` dans `~/.tizen-extension-platform/...`).

- **4a — Refactor préparatoire `platform.ts`** ✅ *(fait — 2026-05-23)*
  - `RuntimeMode` étendue à `web | capacitor | tizen | webos` ; sous-flags
    `isCapacitor` / `isTizen` / `isWebOS` ajoutés. `isNative` reste l'union
    des 3 sous-modes natifs → la couche données (`xtream.service.ts`,
    `image.ts`, `http.ts`) est strictement intouchée.
  - `initTvDetection` étendue : court-circuit `true` pour Tizen/webOS (TV par
    construction), garde l'appel plugin Capacitor pour Android.
  - Script npm `build:native` renommé `build:capacitor` (alias rétrocompatible
    conservé) ; `cap:sync` pointe sur `build:capacitor`.

- **4b — Scaffolding Tizen** ✅ *(fait — 2026-05-23 ; sans Tizen Studio requis)*
  - `tizen/config.xml` : manifeste W3C Widget Samsung TV, profile `tv-samsung`,
    `required_version="4.0"` (cible TV 2018+), `<access origin="*">`, privilège
    `internet`, orientation paysage forcée, `background-support="disable"`.
  - `scripts/build-tizen.mjs` : orchestre `VITE_RUNTIME=tizen vite build` →
    assemble `tizen/build/` (index.html + assets + config.xml + icon.png +
    fichiers de structure exigés par la CLI Samsung : `.project`, `.tproject`,
    `tizen_web_project.yaml`). L'icône est copiée depuis `public/logo.png`
    → source unique de vérité. Le yaml descripteur est posé nous-mêmes
    plutôt que laissé à `tz build` car ce dernier produit des valeurs par
    défaut inadaptées (cf. prose §7 sur le rootstrap manquant).
  - `tizen/.gitignore` : ignore `build/` et `*.wgt`.
  - Script npm `build:tizen` câblé.
  - **Workflow CLI moderne (post-Tizen Studio Eclipse)** — la nouvelle CLI
    Samsung s'appelle `tz` (« Tizen Core »), pas l'ancien `tizen`. Les verbes
    ont changé : c'est `tz pack` (et non `tz package`), et il y a une étape
    facultative `tz build` avant. Les binaires `tz.exe` et `sdb.exe` sont dans
    `%USERPROFILE%\.tizen-extension-platform\server\sdktools\data\tools\`
    (à ajouter au PATH user pour les commandes manuelles depuis n'importe quel
    terminal).
  - Pré-requis machine documenté : extension VS Code « Tizen » + TIZEN-TV
    installé via Package Manager + **rootstrap TV Samsung installé** (cf.
    prose §7 — l'absence de rootstrap fait échouer `tz pack` avec une erreur
    « invalid path » trompeuse) + certificat « Iptvax » créé via Certificate
    Manager.
  - **Validation sur TV réelle** : `sdb capability` répond `profile_name: tv`,
    `vendor_name: Samsung`, `platform_version: 4.0` → la TV est appairée et
    prête à recevoir un `.wgt` une fois le rootstrap installé et Phase 4c
    livrée.

- **4c — Lecteur Tizen (AVPlay)** ✅ *(fait — 2026-05-29 ; à valider sur émulateur Tizen TV)*
  - `src/native/tizenAvplay.ts` : typings minimaux de `webapis.avplay` (open/
    prepareAsync/play/pause/stop/seekTo/getTotalTrackInfo/setSelectTrack/
    setListener/setDisplayRect/setSilentSubtitle/close) + helpers `getAvPlay()`,
    `hasAvPlay()`, `getTvAudioControl()` (volume système via
    `tizen.tvaudiocontrol`, AVPlay n'ayant pas de volume propre) et
    `parseTrackLang()` (extrait la langue de `extra_info`, clés variables selon
    Tizen).
  - `src/hooks/useTizenPlayer.ts` : implémentation `WebPlayerController` via
    AVPlay — pendant Tizen de `useNativePlayer` (libVLC). Cycle de vie :
    `open` → `setListener` → `setDisplayRect(0,0,1920,1080)` +
    `setDisplayMethod(LETTER_BOX)` → `prepareAsync` → `getTotalTrackInfo` +
    `getDuration` (0 = live) → `play`. Re-open (changement de chaîne/source)
    fait `stop()` + `close()` avant le nouvel `open`. Pistes audio/sous-titres
    via `getTotalTrackInfo` + `setSelectTrack('AUDIO'|'TEXT', index)` ;
    sous-titres rendus PAR AVPlay sur le plan vidéo (`setSilentSubtitle`),
    `subtitleText` reste vide. Position via `oncurrentplaytime` (ms→s).
  - `<object type="application/avplayer">` rendu par `VideoPlayer.tsx` quand
    `isTizen` (réserve le plan vidéo) à la place du `<video>` ; AVPlay rend
    DERRIÈRE la WebView → `usesNativeSurface = true` + classe
    `iptvax-native-playback` (mêmes plombings CSS que libVLC).
  - **Dispatch 4 voies** dans `VideoPlayer.tsx` :
    ```ts
    const player =
      isCapacitor ? useNativePlayer(url, mediaUrl) :  // libVLC (Android)
      isWebOS     ? useWebOSPlayer(url, mediaUrl)  :  // <video>/hls.js/luna (LG)
      isTizen     ? useTizenPlayer(url, mediaUrl)  :  // AVPlay (Samsung)
                    usePlayer(url, mediaUrl);          // ffmpeg /api/* (web+Electron)
    ```
  - `tizen/config.xml` : privilège `http://tizen.org/privilege/tv.audio` ajouté
    (volume système). `scripts/build-tizen.mjs` injecte en post-build
    `<script src="$WEBAPIS/webapis/webapis.js">` dans l'index.html packagé
    (filet de sécurité pour la dispo d'AVPlay ; posé après le `vite build` pour
    que Vite ne résolve pas le chemin `$WEBAPIS`).
  - **Validation : émulateur Tizen TV** (pas la TV physique 2018, bloquée par la
    politique Partner — cf. §7). L'émulateur accepte un install dev sans cert
    Partner ET fait tourner le vrai AVPlay → validation lecture de bout en bout.
    Workflow émulateur dans §7.
  - **Risque résiduel à valider sur émulateur** : si AVPlay ne lit pas un
    conteneur qu'on a (MKV/HEVC selon firmware), `onerror` remonte → retomber
    sur Media Pipeline (alternative bas niveau) en v2. Note WebView Tizen 4.0 :
    Chromium ancien → vérifier le `build.target` de Vite si du JS moderne
    explose (build actuel : OK, `tsc -b && vite build` passe).

- **4d — Scaffolding webOS** ✅ *(fait — 2026-05-23)*
  - `webos/appinfo.json` (manifeste LG), icônes 80×80 + 130×130,
    `scripts/build-webos.mjs` + script npm `build:webos`. Packaging manuel via
    `ares-package webos/Iptvax -o webos` (CLI `@webosose/ares-cli`).
  - Trois correctifs appliqués pendant la validation sur simulateur webOS 26 :
    1. **`setSession()` error check + `window.location.reload()`**
       (`src/pages/TvPairing.tsx`) : Supabase retourne `{ data, error }` sans
       lancer d'exception — l'erreur était ignorée ; sur webOS le navigateur
       embarqué ne déclenche pas `onAuthStateChange` → reload forcé après
       `setSession` réussi pour que `getSession()` récupère la session depuis
       le storage.
    2. **`http.ts` branché sur `isCapacitor` au lieu de `isNative`** : le
       branchement `isNative → CapacitorHttp` incluait webOS (et Tizen) qui
       n'ont pas de Capacitor runtime → toutes les requêtes catalogue
       échouaient silencieusement. `isCapacitor` (Android uniquement) règle
       le ciblage ; webOS/Tizen utilisent `fetch` standard.
    3. **`HashRouter` pour webOS et Tizen** (`src/App.tsx`) : les apps
       empaquetées `.ipk`/`.wgt` sont servies depuis `file://` ou une URL
       interne dont le `pathname` n'est pas `/`. Avec `BrowserRouter`,
       `<Route path="/">` ne correspondait jamais → `main-content` restait
       vide (noir) malgré TopNav visible et auth Xtream réussie. `HashRouter`
       utilise `window.location.hash` — invariant par rapport au pathname de
       base. `BrowserRouter` reste inchangé pour web et Capacitor.
  - **Résultat** : sur simulateur webOS 26, après appairage QR → reload →
    l'app affiche TopNav + contenu (catalogue Xtream). ✅
  - **Limitation connue post-4d** : les assets statiques référencés par chemin
    absolu dans le JSX (`/logo.png`, `/tmdb.png`) ne se chargent pas dans le
    shell webOS (chemin `/` ne résout pas vers le dossier de l'app). À corriger
    en Phase 4e : utiliser des imports Vite ou des chemins relatifs (`./logo.png`
    etc.) pour que le bundler les gère correctement.

- **4e — Lecteur webOS + polish assets** ✅ *(fait — 2026-05-24 ; à valider sur simulateur)*
  - **Correction assets statiques** : `AppLogo` (`src/components/AppLogo.tsx`)
    et `TmdbPill` (`src/pages/Home.tsx`) construisent leur `src` via
    `` `${import.meta.env.BASE_URL}logo.png` `` / `tmdb.png`. Vite substitue
    `BASE_URL` au build (constante figée) : `/` côté web et Capacitor (proxy
    same-origin / `http://localhost`), `./` côté Tizen/webOS (configuré dans
    `vite.config.ts` via `NATIVE_RELATIVE_BASE`). Même traitement appliqué aux
    favicons dans `index.html` via le placeholder Vite `%BASE_URL%`. Aucun
    fichier déplacé : les sources restent dans `public/` (lues par
    `scripts/build-tizen.mjs` au build) — seule la résolution change selon
    le bundle cible.
  - **Lecteur vidéo** : `src/hooks/useWebOSPlayer.ts` — implémentation
    `WebPlayerController` minimaliste basée sur `<video>` HTML5 + `hls.js`
    (déjà bundlé). Stratégie de chargement à 3 niveaux :
    1. URL HLS + `canPlayType('application/vnd.apple.mpegurl')` truthy →
       lecture HLS native (décodage hardware, démarrage rapide, peu de RAM).
    2. URL HLS + MSE disponible → hls.js (expose les `levels` HLS dans le
       menu qualité).
    3. Fichier direct (MP4/MKV) → `video.src = url` (webOS lit ces conteneurs
       nativement). Pas de probe ffprobe, pas de transcodage ; sur codec non
       supporté, l'event `error` déclenche le fallback URL côté `VideoPlayer`.
    Pistes audio multi-langue : exposées via `video.audioTracks` (MP4) ou
    `AUDIO_TRACKS_UPDATED` (hls.js). **Sous-titres : non implémentés en v1**
    — pas de proxy `/api/subtitle` en mode natif, et webOS n'expose pas les
    pistes embarquées des MKV sans la Media Pipeline. Le menu CC est
    automatiquement masqué par `VideoPlayer.tsx` (condition
    `player.subtitleTracks.length > 0`). Bouton plein écran également masqué
    (l'app .ipk est déjà plein écran). Si v1 insuffisant pour le multi-audio
    MKV ou les sous-titres → v2 via Media Pipeline webOS
    (`luna://com.webos.media`).
  - **Branchement** : `VideoPlayer.tsx` passe d'une bascule binaire
    `isNative ? useNativePlayer : usePlayer` à un dispatch à 3 voies sur les
    sous-flags figés au build :
    ```ts
    const player =
      isCapacitor ? useNativePlayer(url, mediaUrl) :  // libVLC (Android)
      isWebOS     ? useWebOSPlayer(url, mediaUrl)  :  // <video> + hls.js (LG TV)
                    usePlayer(url, mediaUrl);         // ffmpeg via /api/* (web + Electron)
    ```
    La surface vidéo bascule aussi sur `isCapacitor` (pas `isNative`) : seul
    Android a besoin du `<div>` transparent (libVLC rend derrière la
    WebView) — webOS rend un `<video>` standard. Tizen ajoutera son
    `useTizenPlayer` + injection `<object type="application/avplayer">` en
    Phase 4c.

- **4f — Media Pipeline webOS** ✅ *(code en place — 2026-05-25, cul-de-sac sur simulateur)*

  Tentative d'aller chercher les pistes audio/sous-titres embarquées des
  fichiers MKV/MP4 directs via la **Media Pipeline luna://**, équivalent
  logique du plugin libVLC d'Android. Code livré dans `useWebOSPlayer.ts`
  (déjà préexistant en partie, restauré après un merge qui l'avait écrasé),
  `src/native/webosMedia.ts` et `src/native/webosLuna.ts`. Architecture :
  - `WebOSMedia.load(uri)` → `mediaId`
  - `WebOSMedia.subscribe(mediaId, onUpdate)` reçoit les events de la pipeline,
    notamment `sourceInfo` contenant `tracks: MediaTrack[]` filtrés en
    audio/text et mappés vers les states UI `audioTracks`/`subtitleTracks`
    via `applyPipelineTracks` (ref `pipelineAudioMapRef` / `pipelineSubMapRef`
    pour retraduire l'index UI vers l'index pipeline).
  - `WebOSMedia.selectTrack(mediaId, 'audio'|'text', index)` pour switcher.
  - Surface native transparente via `usesNativeSurface=true` + classe
    `iptvax-native-playback` sur `<html>` (mêmes plombings que libVLC).

  Robustesse — **`startPipeline` retourne `boolean`** et le caller appelle
  `fallbackToVideo()` en cas d'échec (service indispo / refusé / firmware
  incompatible). Le `<video>` direct reprend la main, lecture garantie même
  si la pipeline ne marche pas. Bug subtil corrigé : `setUsesNativeSurface(true)`
  ne doit être appelé QU'APRÈS que `WebOSMedia.load` ait réussi, sinon le
  `<video>` est démonté du DOM par `VideoPlayer.tsx` avant que `fallbackToVideo`
  ait lieu → écran noir.

  Robustesse — **3 noms de service Luna essayés en cascade** dans
  `webosMedia.ts` (`MEDIA_SERVICE_URIS`) : `com.webos.media` (canonique),
  `com.webos.service.mediaserver` (alias intermédiaire),
  `com.palm.umediapipeline` (alias historique). `resolveMediaService()`
  probe chacun avec une méthode légère (`getMediaId`) et mémorise le premier
  qui répond. Si tous échouent, le caller bascule sur fallback.

  Fallback `<video>` enrichi — sur le chemin sans pipeline :
  - Attribut `data-mediaoption` posé sur le `<video>` avant `src` (extension
    propriétaire LG, peut déclencher l'attachement de tous les flux du
    conteneur sur certains firmwares).
  - Listener `umsmediainfo` event custom webOS (le plus documenté ; structure
    `e.detail.info.audio[]` / `subtitle[]`).
  - Probe `video.audioTracks` / `video.textTracks` standards HTML5 sur
    `loadedmetadata` (au cas où Blink flag expérimental est activé).
  - `setAudio` / `setSubtitle` étendus avec 3ᵉ chemin HTMLAudioTrackList /
    TextTrackList pour switching natif.

  **Diagnostic sur simulateur webOS 26 (2026-05-25)** : la WebView simu
  refuse les 3 services Luna (`Service does not exist`), 18 names d'event
  DOM custom testés → 0 fire, dump des propriétés non-standards du
  HTMLVideoElement ne révèle aucune extension LG (que les `webkit*`
  standards de Chromium). Conclusion : **les apps `type: "web"` sur webOS
  n'ont aucun canal JS pour accéder aux tracks embarquées des fichiers
  MKV/MP4 directs**. La lecture marche via fallback `<video>` mais les menus
  audio/sous-titres restent vides. HLS Live garde ses tracks via hls.js
  (`AUDIO_TRACKS_UPDATED` / `SUBTITLE_TRACKS_UPDATED`).

  **Test sur TV LG physique reporté** : sur la TV de test de l'utilisateur
  (LG ~2023), l'app `Developer Mode` est instable — le toggle `Key Server`
  ne persiste pas entre lancements, `prisoner` SSH ne peut pas ouvrir de
  PTY ni écrire dans `/media/developer/temp`. Causes possibles : compte LG
  Dev non vérifié, app Dev Mode corrompue, firmware bridé sur ce modèle.
  Tentative d'install échouée (`ssh exec failure: Permission denied` sur
  cleanup du staging). **Décision** : on accepte la limitation pour le moment
  et on retentera au déploiement réel sur d'autres TVs ou après une mise à
  jour firmware. Le code Phase 4d/4e/4f est en place et fonctionnel sur le
  papier ; il faut juste une TV LG dont le Dev Mode est sain pour le valider.

  Conclusion provisoire Phase 4 LG : webOS shippe avec **lecture OK pour
  tout type de contenu** mais **menus piste audio/sous-titres limités à HLS
  via hls.js** sur le simulateur — à confirmer/infirmer sur TV réelle dès
  que possible.

- **Pré-requis machine pour 4c+** : pour Tizen, l'extension VS Code + un
  certificat actif suffisent. Pour webOS, installer `@webosose/ares-cli`
  (npm global) + compte LG Developer + TV en Developer Mode (app dédiée du
  LG Content Store).

### Phase 5 — Site vitrine *(livrée)*

Le web pur devient une **vitrine pure** (cut net) : marketing, connexion, achat
Premium, gestion du compte, téléchargements, appairage TV. La lecture, le
catalogue, Journal et Communauté ne sont **plus accessibles via URL** sur le web
— mais tout le code reste en place et intact pour les builds natifs/Electron.

- **Bascule runtime** : `isVitrine = isWeb && !isElectron` (`src/lib/platform.ts`).
  Vrai uniquement sur le web pur ; faux en Capacitor/Tizen/webOS (sous-flags
  natifs) et en Electron (`window.electron` du preload) → ces builds gardent
  l'app complète. `App.tsx` branche `VitrineGate` (sous-arbre marketing) ou
  `AppGate` (app complète) selon `isVitrine`.
- **Sous-arbre vitrine** : `VitrineGate` monte uniquement I18n + Supabase +
  Subscription (pas de IptvProfile/Xtream/Library/Ratings/Social — inutiles sans
  catalogue). `/tv-link` reste rendu **standalone** (sans chrome marketing).
- **Routes** : `/` (HomeVitrine), `/downloads`, `/premium` (réutilisé, Stripe),
  `/login` (réutilisé), `/settings` (SettingsVitrine — compte minimal, sépare de
  Settings app qui dépend de Xtream/IptvProfile), `/tv-link` (réutilisé),
  `/mentions-legales` · `/cgv` · `/confidentialite` (placeholders). Toute URL
  d'app (live/movies/series/player/journal/communaute…) → redirect `/downloads`.
- **Téléchargements** : `src/config/vitrine.ts` = source de vérité unique
  (`WEB_URL=iptvax.com`, `GITHUB_REPO=ToRoMo2/Iptvax`, `RELEASES_BASE` →
  `github.com/.../releases/latest/download/<filename>`). Détection OS
  (`detectVisitorPlatform`) met en avant le binaire pertinent.
- **Design** (intégration d'un bundle Claude Design « OLED-First/Vanta ») :
  - `src/styles/vitrine.css` — tout le design **scopé sous `.vitrine`** pour ne
    JAMAIS polluer le `.btn`/tokens de `app.css` (partagé avec les builds
    natifs). Keyframes préfixées `v-`.
  - Moteur d'interaction porté en hooks React zéro-dépendance :
    `useScrollReveal` (IntersectionObserver `[data-reveal]`), `useVitrineChrome`
    (curseur custom + boutons magnétiques), `useHomeFx` (hero + ondes broadcast
    canvas + showcase power-on/tilt/parallaxe/hop + compteurs + story sticky +
    pricing spotlight/odometer). Tout dégrade sous `prefers-reduced-motion`.
  - `VitrineLayout` partagé (grain, curseur, header sticky blur, footer
    watermark, smooth/hash-scroll). `HeaderVitrine`/`FooterVitrine`/
    `DeviceShowcase`/`HomeVitrine`/`Downloads` réécrits sur le markup du design.
- **Paiement** (Stripe + Supabase) et **OAuth** réutilisés tels quels — rien à
  refaire (voir CLAUDE.md §X).

**Reste à faire (hors code)** : DNS `iptvax.com` ; premier GitHub Release des 4
binaires (`iptvax.apk`, `Iptvax-Setup.exe`, `com.iptvax.app_1.0.0_all.ipk`,
`Iptvax.wgt`) ; vrais screenshots dans `DeviceShowcase` (placeholders CSS
`// screenshot …` en attendant) ; contenu juridique réel des 3 pages.

## 5. Conventions

- **`VITE_RUNTIME`** : non défini ou `web` → mode web (proxy). Sinon une des
  trois valeurs natives : `capacitor` (Android), `tizen` (Samsung TV), `webos`
  (LG TV). Chaque shell natif construit le bundle avec sa valeur ; Electron
  reste sur `web` (Option B : proxy local embarqué).
- **`isNative`** = union des 3 sous-modes natifs → c'est ce drapeau qui pilote
  la bascule **data layer** (URLs Xtream directes, `safeImgUrl` direct, etc.).
  Inchangé sémantiquement par l'ajout de Tizen/webOS.
- **`isCapacitor` / `isTizen` / `isWebOS`** : à utiliser uniquement pour des
  branchements **spécifiques à un shell** (ex. choix du lecteur natif : libVLC
  pour Capacitor, AVPlay pour Tizen, `<video>` pour webOS ; HTTP via
  `CapacitorHttp` pour Capacitor, `fetch` pour Tizen/webOS).
- **Garde-fou** : tout branchement proxy-vs-direct passe par `isNative` ; tout
  branchement spécifique à un shell passe par son sous-flag dédié. Jamais de
  détection ad-hoc ailleurs.
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
| 2026-05-23 | Validation 3a sur machine utilisateur (lecture VOD OK, installeur NSIS OK) | ✅ OK |
| 2026-05-23 | Phase 3b — OAuth navigateur système Electron (protocole `iptvax://`, preload bridge, PKCE) | ✅ Fait |
| 2026-05-23 | Validation 3b sur machine utilisateur (clic Google → navigateur système → sélecteur de compte → retour `iptvax://` → session) | ✅ OK |
| 2026-05-23 | Phase 4a — Refactor `platform.ts` (`RuntimeMode` étendue → `web` \| `capacitor` \| `tizen` \| `webos`, sous-flags `isCapacitor`/`isTizen`/`isWebOS`, renommage `build:native`→`build:capacitor`, `initTvDetection` étendue) | ✅ Fait |
| 2026-05-23 | Phase 4b — Scaffolding Tizen (`tizen/config.xml`, `scripts/build-tizen.mjs` génère .project + .tproject + tizen_web_project.yaml, script npm `build:tizen`, icône depuis `public/logo.png`) | ✅ Fait |
| 2026-05-23 | Validation 4b : `sdb capability` sur TV réelle Samsung répond `platform_version: 4.0`, TV appairée | ✅ OK |
| 2026-05-23 | Packaging `tz pack` → `Iptvax.wgt` 708 KB signé. Diagnostic clé : `<!-- commentaire -->` en tête de `config.xml` faisait échouer `tz pack` avec erreur trompeuse « invalid path ». Retiré → packaging passe. Détails et pièges associés : prose §7. | ✅ OK |
| 2026-05-23 | Install `tz install` étape 1 : ❌ `download failed[116]` corrigé en créant un **Samsung Certificate** (profil `Iptvax-TV` avec Author + Distributor Samsung lié DUID `BDCJ72JNDIBYM`). | ✅ Signature OK |
| 2026-05-23 | Install `tz install` étape 2 : ❌ `install failed[118012]` **systématiquement à 23 %**, indépendamment du wgt (Iptvax ET Probe template Samsung vierge échouent pareil, en CLI `tz` ET via le bouton Run Project de l'extension VS Code). Wgt structurellement OK ; cert Samsung avec DUID correcte ; Factory Reset TV fait ; mode dev réactivé. → **Mur côté Samsung confirmé : sideload Individual / Public n'est plus accepté sur les TV Tizen 4.0 (UE_NU76xx 2018) depuis ~2024-2025** (politique Samsung restreinte aux comptes Partner). Pas de voie restante côté repo. Phase 4 pivote sur LG webOS — ré-attaque Samsung Tizen plus tard via émulateur, Samsung Partner, ou TV plus récente. | 🛑 Bloqué (Samsung policy) |
| 2026-05-23 | Phase 4d — Scaffolding LG webOS (`webos/appinfo.json`, icônes `icon.png` 80×80 + `largeIcon.png` 130×130 générées depuis `public/logo.png`, `scripts/build-webos.mjs`, script npm `build:webos`, `webos/.gitignore`) | ✅ Fait |
| 2026-05-23 | Correctif 4d-1 : `TvPairing.tsx` — `setSession()` error check + `window.location.reload()` (webOS n'émet pas `onAuthStateChange` dans le navigateur embarqué) | ✅ Fait |
| 2026-05-23 | Correctif 4d-2 : `http.ts` — branchement `isCapacitor` au lieu de `isNative` pour `CapacitorHttp` (Tizen/webOS n'ont pas de runtime Capacitor → fetch standard) | ✅ Fait |
| 2026-05-23 | Correctif 4d-3 : `App.tsx` — `HashRouter` pour `isWebOS \|\| isTizen` (pathname `file://` ≠ `/` → `<Route path="/">` ne correspondait jamais → main-content vide/noir) | ✅ Fait |
| 2026-05-23 | Validation 4d sur simulateur webOS 26 : appairage QR → reload → catalogue Xtream visible. Assets statiques (`/logo.png`, `/tmdb.png`) non résolus dans le shell webOS → à corriger Phase 4e | ✅ App fonctionne (logos à corriger) |
| 2026-05-24 | Phase 4e — Correction assets (`AppLogo` + `TmdbPill` + favicon index.html via `import.meta.env.BASE_URL` / `%BASE_URL%`) | ✅ Fait |
| 2026-05-24 | Phase 4e — Lecteur webOS (`src/hooks/useWebOSPlayer.ts` : `<video>` natif + hls.js, pistes audio MP4 et HLS, pas de sous-titres v1) | ✅ Fait |
| 2026-05-24 | Phase 4e — Dispatch 3 voies dans `VideoPlayer.tsx` (`isCapacitor` / `isWebOS` / web) + surface vidéo conditionnée à `isCapacitor` | ✅ Fait |
| 2026-05-25 | Cleanup résidus de merge (3 imports/vars inutilisés dans `AppLogo`, `Home`, `VideoPlayer`) | ✅ Fait |
| 2026-05-25 | Fix critique TV pairing — suppression de `signOut({scope:'local'})` côté téléphone dans `TvLink.tsx`. `scope:'local'` fait quand même un POST `/logout` qui révoque le `session_id` du JWT côté serveur, invalidant le token donné à la TV. Côté TV `setSession()` appelait ensuite `GET /user` qui retournait `Auth session missing!`. Plus de signOut côté téléphone → l'appairage marche fiablement sur webOS (et Android TV est plus fiable aussi). | ✅ Fait + validé sur simu webOS 26 |
| 2026-05-25 | Phase 4f — Intégration Media Pipeline luna://com.webos.media dans `useWebOSPlayer.ts` (en réalité restaurée après merge qui l'avait écrasée — fichier était passé de 626 lignes à 393). Dispatch HLS via hls.js / fichier direct via WebOSMedia. Surface native transparente quand pipeline active. `applyPipelineTracks` parse les events `sourceInfo` pour peupler `audioTracks`/`subtitleTracks`. `selectTrack` luna pour switching à chaud. | ✅ Code en place |
| 2026-05-25 | Phase 4f — Fallback robustness : `startPipeline` retourne `boolean`, en cas d'échec luna `fallbackToVideo()` prend la main et `<video src=url>` joue normalement. Surface bascule `usesNativeSurface=true` UNIQUEMENT après `WebOSMedia.load` réussi (sinon le `<video>` est démonté du DOM avant que le fallback ait lieu → écran noir, bug corrigé). | ✅ Fait |
| 2026-05-25 | Phase 4f — 3 noms de service Luna essayés en cascade dans `webosMedia.ts` (`com.webos.media`, `com.webos.service.mediaserver`, `com.palm.umediapipeline`) — variants selon firmware. Le premier qui répond est mémorisé `resolvedService` pour la session. | ✅ Fait |
| 2026-05-25 | Phase 4f — Fallback `<video>` enrichi : attribut `data-mediaoption` posé avant `src` (extension propriétaire LG qui peut débloquer l'exposition des pistes sur certains firmwares), listener `umsmediainfo` (event custom webOS le plus documenté) + probe `video.audioTracks`/`video.textTracks` sur `loadedmetadata`. Tout no-op silencieux quand rien ne remonte. `setAudio`/`setSubtitle` étendus avec 3ᵉ chemin HTML5 (HTMLAudioTrackList / TextTrackList). | ✅ Fait |
| 2026-05-25 | Phase 4f — Diagnostic exhaustif sur simulateur webOS 26 : 3 services Luna → tous `Service does not exist`. 18 events DOM custom testés (`umsmediainfo`, `mediainfoupdate`, `webostvtracks`, `sourceinfo`, `audiotrackschanged`, ...) → 0 fire. Dump propriétés non-standards de `HTMLVideoElement` → uniquement extensions `webkit*` standards de Chromium (`webkitDecodedFrameCount`, `requestPictureInPicture`, etc.) — aucune extension LG exposée. `video.mediaOption`, `video.mediaInfo`, `video.audioTrack`, `video.setMediaOption` tous `undefined`. **Cul-de-sac JS confirmé** sur simulateur pour les fichiers MKV/MP4 directs. La lecture fonctionne via fallback `<video>` mais menus piste vides. | 🛑 Bloqué (simu webOS 26 — apps `type: "web"` n'ont pas l'ACL `mediaclient`) |
| 2026-05-25 | Tentative install TV LG physique (2023) | 🛑 Bloqué — Developer Mode app instable sur la TV de test (toggle `Key Server` ne persiste pas entre lancements de l'app, `prisoner` SSH ne peut pas ouvrir de PTY ni écrire dans `/media/developer/temp`). Plusieurs causes possibles : compte LG Dev non vérifié, app Dev Mode corrompue, firmware bridé sur ce modèle. **Reporté au déploiement réel** (autre TV LG, ou correction firmware future) — le code Phase 4d/4e/4f reste en place et marchera dès qu'une TV LG fonctionnelle accepte l'install. |
| 2026-05-29 | Phase 5 — Bascule vitrine (`isVitrine = isWeb && !isElectron` dans `platform.ts`) + `src/config/vitrine.ts` (WEB_URL/GITHUB_REPO/DOWNLOADS/detectVisitorPlatform) + `App.tsx` branche `VitrineGate` vs `AppGate`. Sous-arbre vitrine minimal (I18n+Supabase+Subscription). | ✅ Fait |
| 2026-05-29 | Phase 5 — Pages vitrine : `HomeVitrine`, `Downloads`, `SettingsVitrine`, pages légales placeholders. Routes orphelines → redirect `/downloads`. `/tv-link` standalone. Meta SEO/og: pour iptvax.com. | ✅ Fait |
| 2026-05-29 | Phase 5 — Intégration design Claude Design « OLED-First/Vanta » : `src/styles/vitrine.css` scopé sous `.vitrine` (zéro pollution `app.css` natif, keyframes `v-`), hooks `useScrollReveal`/`useVitrineChrome`/`useHomeFx` (zéro dép.), `VitrineLayout` + composants réécrits (hero ondes canvas, bento, story sticky, pricing odometer, showcase power-on, downloads détection OS). | ✅ Fait + vérifié (build/lint OK, preview, 0 erreur console) |
| 2026-05-29 | Phase 4c — Lecteur Tizen AVPlay : `src/native/tizenAvplay.ts` (typings webapis.avplay + helpers volume/langue), `src/hooks/useTizenPlayer.ts` (WebPlayerController via AVPlay, surface native), dispatch 4 voies dans `VideoPlayer.tsx` + `<object type="application/avplayer">`, privilège `tv.audio` dans config.xml, injection `webapis.js` post-build. `tsc -b && vite build` OK, lint OK. | ✅ Code en place — à valider sur émulateur Tizen TV |
| 2026-05-29 | Validation 4c sur émulateur Tizen TV : install OK (cert Samsung avec DUID émulateur ajoutée `XTCJYJZXZBZVK`), nav télécommande + lecture vidéo OK. Fluidité dégradée (émulateur = decode logiciel, pas de SoC média) → non représentatif d'une vraie TV ; codecs/sous-titres à confirmer sur hardware réel au déploiement. | ✅ Fonctionnel validé (perf hors scope émulateur) |
| 2026-05-29 | Overlay TV télécommande dédié : `src/components/TvPlayerOverlay.tsx` + `PlayerIcons.tsx` (SVG zéro emoji). Machine à états D-pad (`idle`/`controls`/`scrub`/`panel`) ; volume retiré ; focus anneau cyan `--accent` (DA Iptvax) ; rangée centrée. Panneau sous-titres en double vue (`tracks` + bouton Personnaliser → `customize` : aperçu live au-dessus de la barre de progression sur le film + 3 colonnes Taille/Couleur/Fond, chips « Aa » qui reflètent visuellement chaque option, prefs partagées avec `VideoPlayer`). Point cyan sur l'icône CC quand piste active. Branchement via `isTvDevice()` ; l'overlay souris/tactile historique reste intact hors TV. | ✅ Itéré avec validation utilisateur sur émulateur Tizen |

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

**Phase 3 entièrement livrée et validée.** App Windows Electron : le shell
démarre `server/proxy.cjs` sur la loopback à un port libre, la fenêtre charge
l'app React servie par ce proxy local — flux sortent par l'IP résidentielle
(plus de blocage 403). Installeur NSIS produit. OAuth Google via navigateur
système (protocole `iptvax://`) validé de bout en bout : clic → Chrome/Edge
s'ouvre avec sélecteur de compte natif → retour `iptvax://auth-callback` →
session. UX desktop alignée sur IPTV Smarters & co.

**Phase 4a livrée** (refactor préparatoire `platform.ts`). `isNative` reste
l'union des 3 sous-modes natifs → la couche données (`xtream.service.ts`,
`image.ts`, `http.ts`) est intouchée et l'app Android continue de tourner à
l'identique avec le nouveau `VITE_RUNTIME=capacitor`. Les sous-flags
`isCapacitor` / `isTizen` / `isWebOS` ouvrent la voie au branchement du
lecteur natif spécifique à chaque shell TV (AVPlay pour Tizen, `<video>` pour
webOS).

**Phase 4b côté repo livrée** (scaffolding Tizen + packaging). `npm run
build:tizen` produit un dossier `tizen/Iptvax/` complet : index.html + assets
+ `config.xml` (manifeste W3C Widget) + `icon.png` + `.project` + `.tproject`
+ `tizen_web_project.yaml` (descripteur de la CLI Samsung moderne avec
section `files:` énumérée dynamiquement, profile `tv-samsung`, api_version
`"10.0"`, build_type `Release`). Le packaging `tz pack -t wgt -s <profile>
tizen/Iptvax` produit un `.wgt` signé structurellement valide.

**🛑 Sideload TV physique bloqué côté Samsung.** Après livraison complète du
pipeline (cert Samsung avec DUID lié, wgt signé propre, Factory Reset TV,
mode dev réactivé), `tz install` ET le bouton « Run Project » de l'extension
VS Code échouent **systématiquement à 23 %** (`install failed[118012]`) sur
notre app Iptvax **et sur le template Probe vierge officiel Samsung** —
confirmation que la cause est côté TV/Samsung et non côté code. Politique
Samsung restreinte (depuis ~2024-2025) au niveau de privilège **Partner**
pour les TV Tizen 4.0 anciennes (UE_NU76xx 2018) ; un cert Individual /
Public n'est plus accepté pour l'install. Reprises possibles plus tard :
émulateur Tizen TV (Package Manager VS Code) pour validation isolée du
lecteur AVPlay, inscription Samsung Partner (process long), ou TV Tizen
plus récente. Le repo reste prêt — dès que la TV accepte un cert,
`npm run build:tizen` + `tz pack` produit un wgt installable sans changement
côté code.

**Validation par ÉMULATEUR Tizen TV (voie retenue 2026-05-29).** Puisque la TV
physique 2018 est murée par la politique Partner (et qu'on reste en
émulateur-only par choix produit), la validation du lecteur AVPlay (Phase 4c)
passe par l'**émulateur Tizen TV** — il accepte un install dev SANS cert Partner
et embarque le vrai pipeline AVPlay. Workflow :

1. **Installer l'image émulateur** : VS Code → extension « Tizen » → Package
   Manager → sous `TIZEN-TV`, cocher l'**Emulator** (image TV, en plus des
   paquets « 10.0 Tizen » + « 10.0 TV » déjà requis pour `tz pack`). Installe
   aussi l'« Emulator Manager ».
2. **Lancer l'émulateur** : Tizen → Emulator Manager → créer une instance TV
   (résolution 1920×1080) → Launch. L'émulateur démarre une TV Tizen virtuelle.
3. **Builder + packager** : `npm run build:tizen` → `tz pack -t wgt -s Iptvax
   tizen/Iptvax` (le profil de signature « Iptvax » suffit, pas besoin du cert
   Samsung DUID-bound réservé aux TV physiques).
4. **Installer sur l'émulateur** : `sdb devices` doit lister l'émulateur (ex.
   `0.0.0.0:26101  device  emulator-...`). Puis `tz install -p
   tizen/Iptvax/Release/Iptvax.wgt` (ou bouton « Run Project » de l'extension,
   cible = émulateur). Pas de `download failed[116]` / `install failed[118012]`
   ici : ces erreurs étaient spécifiques à la TV physique 2018.
5. **Tester** : lancer l'app, appairer via QR (TvPairing → téléphone), entrer
   dans le catalogue, puis ouvrir un VOD/série/Live. Cas à vérifier :
   (a) `<object type="application/avplayer">` rend la vidéo derrière la WebView
   (chaîne `iptvax-native-playback` active) ; (b) lecture HLS Live ;
   (c) lecture VOD/série fichier direct (MP4 ; MKV selon support firmware émul.) ;
   (d) menus audio/sous-titres peuplés via `getTotalTrackInfo` ; (e) switch de
   piste audio/CC ; (f) seek + reprise.
   Si AVPlay refuse un conteneur (MKV/HEVC sur cet émulateur) → `onerror`
   remonte une erreur visible ; noter le `eventType` pour décider d'un fallback
   Media Pipeline en v2.

⚠ L'émulateur ne reproduit pas parfaitement les codecs hardware d'une vraie TV
(décodage logiciel, support MKV variable) : il valide le **branchement AVPlay**
et l'UI, pas la garantie codec-par-codec. La validation codec définitive
nécessitera une TV Samsung réelle (Tizen 5.5+ où le cert Individual passe, ou
compte Partner) — reportée au déploiement, comme pour LG webOS.

⚠ **Pièges Tizen rencontrés et résolus en session 2026-05-23** (à garder en
tête pour Phase 4c et tout futur changement de `config.xml`) :

- **Packages SDK obligatoires** : « 10.0 Tizen » + « 10.0 TV » dans le Package
  Manager VS Code (sous TIZEN-TV). Sans ces deux paquets, `tz list rootstraps`
  retourne vide et `tz pack` échoue avec une erreur trompeuse.
- **CLI moderne** : `tz pack` (et non `tz package` — ancien Tizen Studio
  Eclipse), et `tz new` au lieu de `tizen create`. `tz pack -t wgt -s <profile>
  <dir>` est l'incantation pour produire un .wgt signé.
- **Structure projet requise** par `tz pack` (générée par notre
  `scripts/build-tizen.mjs`) : `.project` + `.tproject` (formats Eclipse legacy,
  contenu calqué sur ce que `tz new` produit avec template `Basic_Empty` /
  profil `tv-samsung-10.0`) + `tizen_web_project.yaml` (descripteur moderne
  avec section `files:` listant explicitement TOUS les fichiers à packager).
  Sans `files:` ou avec un format inadéquat, `tz pack` échoue.
- **⚠️ PIÈGE MAJEUR — pas de commentaires XML dans `config.xml`** : un bloc
  `<!-- … -->` en tête du fichier (avant `<widget>`) fait échouer `tz pack`
  avec l'erreur générique « invalid path: … » sans aucune indication de la
  cause. La CLI Samsung a un parseur strict qui ne tolère pas les commentaires
  en préambule. Garder `config.xml` strictement constitué de la déclaration
  XML + élément `<widget>`. Documenter les choix de design ailleurs (dans le
  script `scripts/build-tizen.mjs` ou ce document).
- **Format `<tizen:application id>`** : `[a-zA-Z0-9]{10}.AppName` (préfixe 10
  caractères lié au certificat). On utilise `iptvaxtv00.Iptvax` ; le préfixe
  est sealed par le certificat de signature « Iptvax » à `tz pack`.
- **Nom du wgt produit = nom du dossier source**, pas l'`output_name` du yaml.
  D'où le choix d'assembler dans `tizen/Iptvax/` et non `tizen/build/` →
  packaging produit `tizen/Iptvax/Release/Iptvax.wgt`.
- **⚠️ Install Tizen ≠ `sdb install` standard** : `sdb install Iptvax.wgt`
  pousse le fichier mais ne déclenche PAS l'installation Tizen native (la
  sortie se termine sur `closed` sans `Installed`). Utiliser à la place
  `tz install -p tizen/Iptvax/Release/Iptvax.wgt -e <IP_TV>:26101` qui passe
  par le bon flow `was_install_app` (déclenche pkginfo + signature check).
- **⚠️ Deux niveaux de certificat — distinction critique** : l'extension VS
  Code Tizen propose **Create Tizen Certificate** *et* **Create Samsung
  Certificate**. Le premier (auteur générique + distributor Public Test) ne
  fonctionne PAS pour sideloader sur une TV Samsung 2018 réelle (Tizen 4.0).
  Il faut **en plus** lancer **Create Samsung Certificate** qui :
    - demande la connexion à un **compte Samsung Developer** (gratuit, lié au
      compte créé pour Certificate Manager) ;
    - demande la **DUID** de la TV cible (récupérée via
      `sdb -s <IP_TV>:26101 shell 0 getduid` — la nôtre : `BDCJ72JNDIBYM` sur
      le modèle UE55NU7645) ;
    - génère un Distribution Key 2 supplémentaire qui s'ajoute au profil de
      signing existant (le profil « Iptvax » porte alors **deux** distribution
      keys : Tizen Public + Samsung DUID-bound).
  Sans le Samsung cert, `tz install` échoue avec `download failed[116]` — la
  TV refuse le wgt parce que la signature distributeur ne valide pas pour ce
  device. Pour Tizen 5.0+ le Public Test peut parfois suffire ; pour Tizen
  4.0 le Samsung cert est obligatoire.
- **⚠️ Espace disque TV — cause #1 de `install failed[118012]`** sur Samsung
  TV 2018 (Tizen 4.0, ~800 MB de stockage utilisateur partagé). Diagnostic
  observé : 7 MB libres → Tizen exige typiquement 50-100 MB de marge pour
  décompresser un wgt → install abandonnée à 23 %. Symptôme reproductible
  avec le template Probe vierge (donc indépendant du code). **Cause** :
  caches résiduels des apps désinstallées (Netflix, YouTube, Prime…) que
  Tizen ne libère pas tout seul. **Solution** : Smart Hub Reset (Paramètres
  TV → Support → Self Diagnosis → Smart Hub Reset, PIN 0000). Libère
  300-500 MB typiquement, mais déconnecte tous les services de streaming
  (à reconnecter manuellement après). ⚠️ Le reset désactive aussi le
  Developer Mode → à réactiver après (Apps → tape `12345`).
- **DUID dans Samsung Apps Seller Office** — non requis tant que le Samsung
  Certificate généré par le Certificate Manager local porte la DUID (le
  cert encode déjà l'autorisation). L'enregistrement web sur
  https://seller.samsungapps.com (section TV Seller Office) ne devient
  obligatoire que pour la soumission au Samsung Apps Store, pas pour le
  sideload mode dev.

La TV de validation est appairée (`sdb capability` répond `platform_version:
4.0`). L'app ne tournera pas encore correctement à l'install : le lecteur web
(`<video>` + ffmpeg) n'a aucun fichier à attaquer en natif — c'est l'objet de
Phase 4c.

**Phase 4d livrée et validée** (scaffolding webOS + correctifs de validation).
`npm run build:webos` produit `webos/Iptvax/` complet : `index.html` + assets
Vite (bundle figé sur `VITE_RUNTIME=webos` → `isNative` + `isWebOS`) +
`appinfo.json` (manifeste LG : `id=com.iptvax.app`, `type=web`,
`resolution=1920x1080`, `disableBackHistoryAPI=true`, `supportTouchMode=none`)
+ `icon.png` 80×80 + `largeIcon.png` 130×130 (générés depuis `public/logo.png`
500×500). Pas de fichiers `.project`/`.tproject` : `ares-package` se contente
du dossier + `appinfo.json` valide.

Trois correctifs appliqués lors de la validation sur simulateur webOS 26 :
**(1)** `TvPairing.tsx` — vérification de `setSession()` + `window.location.reload()`
(le navigateur embarqué webOS n'émet pas `onAuthStateChange`) ;
**(2)** `http.ts` — branchement `isCapacitor` au lieu de `isNative` pour
`CapacitorHttp` (webOS/Tizen n'ont pas de runtime Capacitor — toutes les
requêtes catalogue échouaient silencieusement) ;
**(3)** `App.tsx` — `HashRouter` pour `isWebOS || isTizen` (les apps `.ipk`/`.wgt`
sont servies depuis `file://` ou une URL interne dont le pathname ≠ `/` → avec
`BrowserRouter`, `<Route path="/">` ne correspondait jamais → `main-content`
restait noir malgré TopNav visible et auth Xtream réussie).

Résultat : sur simulateur webOS 26, appairage QR → reload → catalogue Xtream
visible ✅. **Limitation restante** : les assets statiques référencés avec
des chemins absolus (`/logo.png`, `/tmdb.png`) ne sont pas résolus dans le
shell webOS → AppLogo et TmdbPill n'affichent rien. À corriger en Phase 4e.

**Phase 4e livrée (à valider sur simulateur)**. Deux livrables :

1. **Assets statiques** — `AppLogo`, `TmdbPill` et les favicons d'`index.html`
   construisent leur URL via `import.meta.env.BASE_URL` (constante Vite figée
   au build) / `%BASE_URL%` (placeholder index.html). Web/Capacitor reçoivent
   `/`, Tizen/webOS reçoivent `./` — déjà câblé dans `vite.config.ts` via
   `NATIVE_RELATIVE_BASE`. Aucun fichier déplacé : les sources restent dans
   `public/` (lues par `scripts/build-tizen.mjs` au build), seule la
   résolution finale change.

2. **Lecteur webOS** — `src/hooks/useWebOSPlayer.ts` implémente
   `WebPlayerController` en s'appuyant sur `<video>` HTML5 + hls.js (déjà
   bundlé). Chargement à 3 niveaux : HLS natif si `canPlayType` truthy, sinon
   hls.js via MSE (webOS 4.0+ a Chromium récent → OK), sinon URL directe pour
   les conteneurs MP4/MKV (webOS les lit nativement). Pistes audio
   exposées via `video.audioTracks` (MP4) ou `AUDIO_TRACKS_UPDATED` (hls.js).
   Sous-titres et plein écran : sans objet en v1 (menu CC + bouton fullscreen
   masqués par `VideoPlayer.tsx`). Les sous-titres MKV embarqués
   nécessiteraient la Media Pipeline webOS — réservé à une v2 si besoin.

   `VideoPlayer.tsx` dispatch désormais sur 3 voies :
   - `isCapacitor` → `useNativePlayer` (libVLC derrière surface transparente)
   - `isWebOS`     → `useWebOSPlayer` (`<video>` natif + hls.js)
   - défaut        → `usePlayer` (ffmpeg via `/api/*` — web + Electron Option B)

   La surface vidéo conditionne sur `isCapacitor` (et non plus `isNative`) :
   seul Android a besoin du `<div>` transparent ; webOS rend un `<video>`
   standard. Tizen suivra le même schéma (`useTizenPlayer` + AVPlay
   `<object>`) en Phase 4c.

**Validation à faire** : rebuild `npm run build:webos`, repackager
(`ares-package webos/Iptvax -o webos`), installer sur simulateur webOS 26 et
lancer une lecture VOD/série/Live. Cas à vérifier : (a) logos AppLogo + TMDB
affichés ; (b) `<video>` rend correctement ; (c) lecture HLS live ; (d)
lecture VOD/série depuis l'IP résidentielle (pas de 403). Si le flux HLS live
échoue, vérifier l'UA envoyé par le WebView webOS (Xtream rejette certains
UA navigateur sur `/live/`).

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
- **Liste des épisodes dans l'overlay TV** : bouton dédié (icône « épisodes »)
  ouvrant la liste des épisodes d'une série directement dans le lecteur, façon
  Netflix. Demandé par l'utilisateur, **reporté** (feature en plus, à faire
  après la passe overlay TV de base).
- **Overlay souris/tactile (mobile/desktop)** : la refonte D-pad a livré
  `TvPlayerOverlay` (TV uniquement). La même refonte visuelle (pictogrammes
  SVG `PlayerIcons`, overlay transparent, suppression des emojis) reste à
  appliquer à l'overlay `VideoPlayer` classique pour mobile/desktop. Inclut le
  décalage des sous-titres React quand l'overlay est visible (sur TV les
  sous-titres sont rendus nativement par le lecteur → non concernés).

**Phase 5 livrée et vérifiée** (site vitrine). Le web pur passe en mode
**vitrine** via `isVitrine = isWeb && !isElectron` : `App.tsx` monte
`VitrineGate` (marketing + compte + Stripe + téléchargements + `/tv-link`) au
lieu de l'app complète. Les builds natifs (Capacitor/Tizen/webOS) et Electron
gardent `isVitrine=false` → `AppGate` complet **inchangé** (aucune ligne touchée
dans les lecteurs, services natifs ou pages app). Le design « OLED-First/Vanta »
(bundle Claude Design) est porté en React/CSS-Modules : `src/styles/vitrine.css`
**scopé sous `.vitrine`** (n'altère jamais `app.css` partagé), hooks
zéro-dépendance (`useScrollReveal`/`useVitrineChrome`/`useHomeFx`), `VitrineLayout`
partagé. Build `tsc -b && vite build` OK (0 erreur), lint OK (warnings
préexistants seulement), preview validée (hero ondes canvas, bento, story
sticky, pricing odometer, showcase power-on, downloads détection OS, 0 erreur
console). Détails Phase 5 : §4 ci-dessus. Reste hors-code : DNS `iptvax.com`,
premier GitHub Release des 4 binaires, vrais screenshots du `DeviceShowcase`,
contenu juridique réel.
