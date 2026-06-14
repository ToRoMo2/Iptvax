/**
 * Génère les icônes launcher Android (legacy + adaptive) depuis public/logo.png.
 *
 * Tailles legacy (ic_launcher + ic_launcher_round) :
 *   mdpi 48 · hdpi 72 · xhdpi 96 · xxhdpi 144 · xxxhdpi 192
 *
 * Tailles foreground adaptive (ic_launcher_foreground) :
 *   mdpi 108 · hdpi 162 · xhdpi 216 · xxhdpi 324 · xxxhdpi 432
 *   Le logo est centré dans 72 % de la toile (zone sûre Android)
 *   et placé sur fond transparent.
 *
 * La couleur de fond adaptive (ic_launcher_background) est mise à jour dans
 * android/app/src/main/res/values/ic_launcher_background.xml → espresso #19120D
 * (cohérent avec le thème Umbra de l'app).
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root  = path.resolve(__dir, '..');
const src   = path.join(root, 'public', 'logo.png');
const res   = path.join(root, 'android', 'app', 'src', 'main', 'res');

const legacy = [
  { folder: 'mipmap-mdpi',    size: 48  },
  { folder: 'mipmap-hdpi',    size: 72  },
  { folder: 'mipmap-xhdpi',   size: 96  },
  { folder: 'mipmap-xxhdpi',  size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
];

const foreground = [
  { folder: 'mipmap-mdpi',    canvas: 108, logo: Math.round(108 * 0.72) },
  { folder: 'mipmap-hdpi',    canvas: 162, logo: Math.round(162 * 0.72) },
  { folder: 'mipmap-xhdpi',   canvas: 216, logo: Math.round(216 * 0.72) },
  { folder: 'mipmap-xxhdpi',  canvas: 324, logo: Math.round(324 * 0.72) },
  { folder: 'mipmap-xxxhdpi', canvas: 432, logo: Math.round(432 * 0.72) },
];

async function main() {
  console.log('📐 Lecture du logo source :', src);
  const meta = await sharp(src).metadata();
  console.log(`   ${meta.width}×${meta.height} ${meta.format}`);

  // ── Icônes legacy (ic_launcher + ic_launcher_round) ─────────────────────────
  for (const { folder, size } of legacy) {
    const dir = path.join(res, folder);
    fs.mkdirSync(dir, { recursive: true });
    await sharp(src).resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(src).resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } }).toFile(path.join(dir, 'ic_launcher_round.png'));
    console.log(`✅ legacy ${folder} (${size}×${size})`);
  }

  // ── Foreground adaptive (ic_launcher_foreground) ─────────────────────────────
  // Logo centré dans la zone sûre (72 %) sur fond transparent.
  for (const { folder, canvas, logo } of foreground) {
    const dir = path.join(res, folder);
    fs.mkdirSync(dir, { recursive: true });
    const off = Math.round((canvas - logo) / 2);
    const logoBuffer = await sharp(src).resize(logo, logo, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).toBuffer();
    await sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: logoBuffer, top: off, left: off }])
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
    console.log(`✅ foreground ${folder} (${canvas}×${canvas}, logo ${logo}×${logo})`);
  }

  // ── Couleur de fond adaptive → noir Vanta ────────────────────────────────────
  const bgXml = path.join(res, 'values', 'ic_launcher_background.xml');
  const bgContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#19120D</color>
</resources>
`;
  fs.writeFileSync(bgXml, bgContent, 'utf-8');
  console.log('✅ fond adaptive → #19120D (espresso Umbra)');

  console.log('\n🎉 Icônes générées avec succès !');
  console.log('   Rebuild + cap sync android pour les pousser dans le projet.');
}

main().catch((e) => { console.error('❌', e); process.exit(1); });
