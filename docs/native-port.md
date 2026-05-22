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
- **2d — Android TV** ⬜
  - Intent leanback + navigation D-pad (`norigin-spatial-navigation` déjà là).
- **2e — OAuth natif (deep link)** ✅ *(fait — 2026-05-22)*
  - Connexion Google/Apple : en natif, `signInWithOAuth` ouvre un onglet
    système (`@capacitor/browser`) ; le retour passe par le deep link
    `com.iptvax.app://auth-callback` (intent filter dans `AndroidManifest.xml`),
    capté via `@capacitor/app`, puis `exchangeCodeForSession` (flux PKCE).
    Client Supabase en `flowType: 'pkce'` uniquement en natif (web inchangé).
  - ⚙️ **Config requise côté Supabase** : ajouter `com.iptvax.app://auth-callback`
    dans Authentication → URL Configuration → **Redirect URLs**.
- **Valider** qu'une source qui renvoyait 403 sur le VPS joue maintenant
  (le flux part de l'IP de l'utilisateur).

> **Pré-requis machine** : builder l'APK demande **Android Studio + SDK Android**.
> Le scaffolding (2a) et le code (2b/2c) n'en ont pas besoin ; le build final si.

### Phase 3 — App Windows (Electron)
- Shell Electron hébergeant le même build React.
- Option A : binding libVLC. Option B (raccourci) : embarquer `server/proxy.cjs`
  en local dans l'app → réutilise tout l'existant, tourne sur l'IP de
  l'utilisateur, zéro réécriture du lecteur.

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

**Phase 1 terminée** (frontend découplé du backend proxy). **Phase 2 Android
terminée** : l'app native Android tourne sur appareil réel — connexion Google
(deep link), sélection de profil, navigation dans le catalogue, chargement des
images **et lecture vidéo native (libVLC)** fonctionnent, le tout en parlant
**directement** aux serveurs Xtream depuis l'IP de l'appareil (plus de blocage
403). Reste **2d (Android TV)** pour clore la Phase 2.

Correctifs natifs appliqués en cours de route : `usesCleartextTraffic` (serveurs
Xtream en HTTP), `allowMixedContent` (covers HTTP chargées dans le WebView
servi en HTTPS), et — pour la lecture native — `getVodStreamUrl` /
`getSeriesStreamUrl` renvoient désormais le **fichier direct** (conteneur
MKV/MP4) en mode natif au lieu du `.m3u8` : ce dernier n'est qu'un artefact du
remux ffmpeg du proxy web, beaucoup de serveurs Xtream ne le servent pas pour
les films/épisodes → libVLC n'avait rien à lire (écran noir). Le lecteur natif
force aussi l'orientation paysage pendant la lecture (`VlcPlayerPlugin`).

**Prochaine étape : Phase 2d — Android TV.** À faire (voir §4) :
1. Déclarer l'app comme application TV : `<category android:name="android.intent.category.LEANBACK_LAUNCHER">`
   dans `AndroidManifest.xml` + `uses-feature` `android.software.leanback`
   (`required="false"`) et `android.hardware.touchscreen` (`required="false"`).
2. Bannière TV (`android:banner`) pour le lanceur Android TV.
3. Navigation D-pad : `norigin-spatial-navigation` est déjà intégré côté UI —
   vérifier que tous les écrans (catalogue, lecteur, sélection de profil) sont
   parcourables à la télécommande, et soigner le focus visible.
4. Tester le lecteur libVLC sur une vraie box / un émulateur Android TV
   (attention RAM : cf. point WebView OOM en §6).

**Détails de finition différés** (cf. §6 — à reprendre après la Phase 2, sauf
si bloquant) : pause auto en arrière-plan, encoches (cutout) en paysage,
polish esthétique du lecteur mobile.
