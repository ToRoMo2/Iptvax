#!/usr/bin/env node
/**
 * Build Iptvax pour Samsung Tizen TV — voir docs/native-port.md §4 Phase 4b.
 *
 * Étapes :
 *   1. Lance `vite build` avec VITE_RUNTIME=tizen → bascule isNative + isTizen
 *      (URLs Xtream directes, plus tard lecteur AVPlay en Phase 4c).
 *   2. Assemble le dossier `tizen/Iptvax/` prêt à packager :
 *        tizen/Iptvax/
 *        ├─ index.html
 *        ├─ assets/...               (copie depuis dist/)
 *        ├─ config.xml               (depuis tizen/config.xml)
 *        ├─ icon.png                 (depuis public/logo.png — source unique)
 *        ├─ .project / .tproject     (fichiers Eclipse legacy requis par tz)
 *        └─ tizen_web_project.yaml   (descripteur de la CLI Samsung moderne)
 *   3. Affiche la commande `tz pack` manuelle à lancer ensuite.
 *
 * Le packaging final (.wgt) et l'installation sur la TV sont volontairement
 * gardés hors de ce script : ils dépendent du certificat installé en local
 * (Certificate Manager → profil « Iptvax ») et de la TV cible (IP variable
 * selon le réseau), donc se font à la main avec `tz package --sign Iptvax` et
 * `sdb install`. Voir docs/native-port.md.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const TIZEN_DIR = join(ROOT, 'tizen');
// Le nom du dossier détermine le nom du .wgt produit (`tz pack` ignore
// `output_name` dans le yaml). On utilise `Iptvax` pour que le packaging
// produise `Iptvax.wgt`, cohérent avec le `<name>Iptvax</name>` du `.project`
// et l'`output_name` du yaml.
const OUT = join(TIZEN_DIR, 'Iptvax');
const CONFIG = join(TIZEN_DIR, 'config.xml');
const ICON_SRC = join(ROOT, 'public', 'logo.png');

function log(msg) {
  console.log(`[build-tizen] ${msg}`);
}

// 1. Vite build avec VITE_RUNTIME=tizen (npm est cross-plateforme, contrairement
//    à un cross-env inline — on hérite du PATH parent).
log('Vite build (VITE_RUNTIME=tizen)…');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const build = spawnSync(npmCmd, ['run', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, VITE_RUNTIME: 'tizen' },
});
if (build.status !== 0) {
  console.error('[build-tizen] échec du vite build.');
  process.exit(build.status ?? 1);
}

// 2. Vérifications de présence avant de toucher au filesystem.
for (const p of [DIST, CONFIG, ICON_SRC]) {
  if (!existsSync(p)) {
    console.error(`[build-tizen] introuvable : ${p}`);
    process.exit(1);
  }
}

// 3. Assemblage : on repart d'un dossier propre pour ne pas accumuler
//    d'anciens assets entre deux builds.
log(`Assemblage dans ${OUT}…`);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
cpSync(DIST, OUT, { recursive: true });
cpSync(CONFIG, join(OUT, 'config.xml'));
cpSync(ICON_SRC, join(OUT, 'icon.png'));

// `.project` et `.tproject` : fichiers de structure exigés par `tz pack` pour
// reconnaître le dossier comme un projet web Tizen. Format Eclipse legacy
// hérité de Tizen Studio — `tz` les lit pour identifier les buildCommands, la
// plateforme cible et les natures actives. ⚠ Le contenu DOIT correspondre à
// ce que `tz new` produit (vérifié par diff avec un projet template
// `Basic_Empty / tv-samsung-10.0` créé via la GUI). Toute déviation
// (notamment `<name>tv-0.1</name>` au lieu de `tv-samsung-10.0`) fait
// échouer `tz pack` avec une erreur « invalid path » trompeuse.
const projectXml = `<?xml version="1.0" encoding="UTF-8"?>
<projectDescription>
\t<name>Iptvax</name>
\t<comment></comment>
\t<projects></projects>
\t<buildSpec>
\t\t<buildCommand>
\t\t\t<name>json.validation.builder</name>
\t\t\t<arguments></arguments>
\t\t</buildCommand>
\t\t<buildCommand>
\t\t\t<name>org.tizen.web.project.builder.WebBuilder</name>
\t\t\t<arguments></arguments>
\t\t</buildCommand>
\t</buildSpec>
\t<natures>
\t\t<nature>json.validation.nature</nature>
\t\t<nature>org.eclipse.wst.jsdt.core.jsNature</nature>
\t\t<nature>org.tizen.web.project.builder.WebNature</nature>
\t</natures>
</projectDescription>
`;
const tprojectXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<tproject xmlns="http://www.tizen.org/tproject">
\t<platforms>
\t\t<platform>
\t\t\t<name>tv-samsung-10.0</name>
\t\t</platform>
\t</platforms>
\t<package>
\t\t<blacklist/>
\t</package>
</tproject>
`;
writeFileSync(join(OUT, '.project'), projectXml);
writeFileSync(join(OUT, '.tproject'), tprojectXml);

// `tizen_web_project.yaml` : descripteur consommé par la nouvelle CLI Samsung
// (`tz pack`). Sans ce fichier, ou avec une section `files:` absente, `tz pack`
// échoue avec une erreur « invalid path » trompeuse. Le format DOIT suivre
// celui produit par `tz new` (vérifié par diff avec un projet template
// `Basic_Empty / tv-samsung-10.0` créé via la GUI VS Code).
//
// ⚠ Bien distinguer les deux versions :
//   - `api_version` ici = version du SDK utilisée pour PACKAGER (rootstrap
//     installé en local — 10.0 sur la machine de dev).
//   - `required_version` dans `config.xml` (4.0) = version Tizen MINIMUM de
//     la TV qui pourra installer l'app. Le SDK 10.0 produit un .wgt
//     compatible Tizen 4.0+ tant que le code n'utilise pas d'API exclusives 5+.
//
// La section `files:` énumère TOUS les fichiers à inclure dans le .wgt (chemins
// relatifs à OUT, slashs Unix). Génération dynamique : on walk OUT après les
// copies pour rester à jour quand Vite ajoute/retire un asset.
function walkRelative(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    // On skippe les fichiers de structure et descripteurs — Tizen ne les
    // veut pas dans la liste packagée.
    if (name === '.project' || name === '.tproject' || name === 'tizen_web_project.yaml') continue;
    const full = join(dir, name);
    const rel = full.slice(base.length + 1).replace(/\\/g, '/');
    if (statSync(full).isDirectory()) out.push(...walkRelative(full, base));
    else out.push(rel);
  }
  return out;
}
const filesList = walkRelative(OUT).map((f) => `  - ${f}`).join('\n');

const projectYaml = `project_type: web_app
profile: tv-samsung
api_version: "10.0"
build_type: Release
output_name: Iptvax
output_path: ""
opt: false
signing_profile: ""
trust_anchor: []
files:
${filesList}
excludes:
  - Build/*
  - Debug/*
  - Directory.Build.targets
  - Release/*
  - Test/*
  - \\.Build/.*
  - \\.buildResult/.*
  - \\.csproj
  - \\.externalToolBuilders/.*
  - \\.gn
  - \\.obj/.*
  - \\.package/.*
  - \\.project
  - \\.rds_delta
  - \\.sdk_delta.info
  - \\.settings/.*
  - \\.sign/.*
  - \\.tizen-ui-builder-tool.xml
  - \\.tproject
  - \\.wgt
  - tizen_web_project.yaml
  - webUnitTest/*
deps: []
`;
writeFileSync(join(OUT, 'tizen_web_project.yaml'), projectYaml);

log('OK. Étapes suivantes (manuelles, certificat « Iptvax » requis) :');
log('  tz pack -t wgt -s Iptvax tizen/Iptvax');
log('  sdb -s <IP_TV>:26101 install tizen/Iptvax/Release/Iptvax.wgt');
