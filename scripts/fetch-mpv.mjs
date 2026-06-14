// Télécharge le binaire mpv.exe (lecteur natif Windows/Electron) dans vendor/mpv/.
//
// Pourquoi : l'app Electron lit les flux Xtream avec un LECTEUR NATIF mpv (décodage
// HEVC/AC3/MKV direct, seek instantané) au lieu du remux ffmpeg du proxy — voir
// CLAUDE.md §XI (dispatch Electron natif). mpv.exe est trop volumineux (~112 Mo)
// pour être versionné → on le récupère depuis une release figée (intégrité SHA-256
// vérifiée). Idempotent : ne re-télécharge pas si vendor/mpv/mpv.exe existe déjà.
//
// Usage : `npm run fetch:mpv` (lancé automatiquement avant electron:dev/start/build
// et dans le workflow CI windows-exe).
//
// Extraction : le binaire est distribué en .7z ; on s'appuie sur `tar` (libarchive,
// présent sur Windows 10/11 et les runners GitHub windows-latest) qui sait lire le 7z.

import { createWriteStream, existsSync, mkdirSync, rmSync, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VENDOR = join(ROOT, 'vendor', 'mpv');
const MPV_EXE = join(VENDOR, 'mpv.exe');

// Release figée (zhongfly/mpv-winbuild) — build x86_64 générique (PAS la variante
// v3 qui exige AVX2, pour rester compatible avec tous les CPU). Pour mettre à jour :
// changer URL + SHA256 ensemble (récupérer le hash via `Get-FileHash <fichier> -Algorithm SHA256`).
const MPV_URL =
  'https://github.com/zhongfly/mpv-winbuild/releases/download/2026-06-08-6444c05059/mpv-x86_64-20260608-git-6444c05059.7z';
const MPV_SHA256 = '240e4a49ca8098a6b4da017740abb8882a22d566bdeb60a4c09752b3c9c7e478';

async function sha256(file) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(file), hash);
  return hash.digest('hex');
}

async function download(url, dest, redirectsLeft = 5) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} pour ${url}`);
  }
  await pipeline(res.body, createWriteStream(dest));
  void redirectsLeft;
}

async function main() {
  if (existsSync(MPV_EXE)) {
    console.log('[fetch-mpv] mpv.exe déjà présent → rien à faire.');
    return;
  }
  if (process.platform !== 'win32') {
    console.log('[fetch-mpv] plateforme non-Windows → mpv natif inutile, skip.');
    return;
  }
  mkdirSync(VENDOR, { recursive: true });
  const archive = join(tmpdir(), 'umbra-mpv.7z');

  console.log('[fetch-mpv] téléchargement de mpv (~32 Mo)…');
  await download(MPV_URL, archive);

  console.log('[fetch-mpv] vérification de l’intégrité (SHA-256)…');
  const got = await sha256(archive);
  if (got !== MPV_SHA256) {
    rmSync(archive, { force: true });
    throw new Error(`SHA-256 incorrect.\n  attendu : ${MPV_SHA256}\n  obtenu  : ${got}`);
  }

  console.log('[fetch-mpv] extraction (tar/libarchive)…');
  // tar (libarchive) sait lire le 7z sur Windows 10/11 et les runners CI.
  execFileSync('tar', ['-xf', archive, '-C', VENDOR], { stdio: 'inherit' });
  rmSync(archive, { force: true });

  if (!existsSync(MPV_EXE)) {
    throw new Error('mpv.exe introuvable après extraction.');
  }
  console.log('[fetch-mpv] OK →', MPV_EXE);
}

main().catch((err) => {
  console.error('[fetch-mpv] échec :', err.message);
  process.exit(1);
});
