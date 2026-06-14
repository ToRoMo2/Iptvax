#!/usr/bin/env node
/**
 * Build Umbra pour LG webOS TV — voir docs/native-port.md §4 Phase 4d.
 *
 * Étapes :
 *   1. Lance `vite build` avec VITE_RUNTIME=webos → bascule isNative + isWebOS
 *      (URLs Xtream directes, plus tard lecteur `<video>`/Media Pipeline en
 *      Phase 4e).
 *   2. Assemble le dossier `webos/Umbra/` prêt à packager :
 *        webos/Umbra/
 *        ├─ index.html
 *        ├─ assets/...               (copie depuis dist/)
 *        ├─ appinfo.json             (depuis webos/appinfo.json)
 *        ├─ icon.png                 (80×80, depuis webos/icon.png)
 *        └─ largeIcon.png            (130×130, depuis webos/largeIcon.png)
 *   3. Affiche les commandes `ares-package` / `ares-install` à lancer ensuite.
 *
 * Le packaging final (.ipk) et l'installation sur la TV sont volontairement
 * gardés hors de ce script : ils dépendent du CLI `@webosose/ares-cli`
 * installé en local et de la TV cible appairée via `ares-setup-device` (IP
 * variable selon le réseau, passphrase du Developer Mode renouvelable). Voir
 * docs/native-port.md.
 *
 * Pourquoi pas de fichiers de structure type `.project` / `.tproject` comme
 * sous Tizen : la CLI `ares-package` se contente d'un dossier contenant un
 * `appinfo.json` valide + le `main` qu'il référence. Pas de descripteur YAML
 * séparé, pas de buildSpec Eclipse — strictement plus simple que Tizen.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const WEBOS_DIR = join(ROOT, 'webos');
// Nom du dossier de sortie aligné sur les autres builds natifs (`Umbra`).
// `ares-package` produit un .ipk dont le nom est dérivé de `id` + `version` de
// `appinfo.json` (par défaut `com.umbra.app_1.0.0_all.ipk`).
const OUT = join(WEBOS_DIR, 'Umbra');
const APPINFO = join(WEBOS_DIR, 'appinfo.json');
const ICON = join(WEBOS_DIR, 'icon.png');
const LARGE_ICON = join(WEBOS_DIR, 'largeIcon.png');

function log(msg) {
  console.log(`[build-webos] ${msg}`);
}

// 1. Vite build avec VITE_RUNTIME=webos. npm est cross-plateforme, contrairement
//    à un cross-env inline — on hérite du PATH parent.
log('Vite build (VITE_RUNTIME=webos)…');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npmCmd, ['run', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_RUNTIME: 'webos' },
});
if (build.status !== 0) {
  console.error('[build-webos] échec du vite build.');
  process.exit(build.status ?? 1);
}

// 2. Vérifications de présence avant de toucher au filesystem.
for (const p of [DIST, APPINFO, ICON, LARGE_ICON]) {
  if (!existsSync(p)) {
    console.error(`[build-webos] introuvable : ${p}`);
    process.exit(1);
  }
}

// 3. Assemblage : on repart d'un dossier propre pour ne pas accumuler
//    d'anciens assets entre deux builds.
log(`Assemblage dans ${OUT}…`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(DIST, OUT, { recursive: true });
cpSync(APPINFO, join(OUT, 'appinfo.json'));
cpSync(ICON, join(OUT, 'icon.png'));
cpSync(LARGE_ICON, join(OUT, 'largeIcon.png'));

log('OK. Étapes suivantes (manuelles, @webosose/ares-cli requis) :');
log('  1) Appairer la TV (une fois)  : ares-setup-device');
log('  2) Packager                   : ares-package webos/Umbra -o webos');
log('  3) Installer                  : ares-install -d <TV> webos/com.umbra.app_1.0.0_all.ipk');
log('  4) Lancer                     : ares-launch -d <TV> com.umbra.app');
