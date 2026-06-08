/**
 * Génère build/icon.ico pour Electron/Windows depuis public/logo.png.
 * Embed PNG ICO multi-taille : 16, 24, 32, 48, 64, 128, 256 px.
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const root  = path.resolve(__dir, '..');
const src   = path.join(root, 'public', 'logo.png');
const out   = path.join(root, 'build', 'icon.ico');

const SIZES = [16, 24, 32, 48, 64, 128, 256];

async function buildIco() {
  const pngBuffers = await Promise.all(
    SIZES.map(size =>
      sharp(src)
        .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  const HEADER   = 6;
  const DIR_ENTRY = 16;

  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // réservé
  header.writeUInt16LE(1, 2); // type ICO
  header.writeUInt16LE(SIZES.length, 4);

  let dataOffset = HEADER + DIR_ENTRY * SIZES.length;
  const dirs = SIZES.map((size, i) => {
    const buf = pngBuffers[i];
    const dir = Buffer.alloc(DIR_ENTRY);
    dir.writeUInt8(size === 256 ? 0 : size, 0); // width  (0 = 256)
    dir.writeUInt8(size === 256 ? 0 : size, 1); // height
    dir.writeUInt8(0, 2);  // palette
    dir.writeUInt8(0, 3);  // réservé
    dir.writeUInt16LE(1, 4);  // planes
    dir.writeUInt16LE(32, 6); // bits par pixel
    dir.writeUInt32LE(buf.length, 8);
    dir.writeUInt32LE(dataOffset, 12);
    dataOffset += buf.length;
    return dir;
  });

  return Buffer.concat([header, ...dirs, ...pngBuffers]);
}

async function main() {
  const meta = await sharp(src).metadata();
  console.log(`source : ${meta.width}×${meta.height} ${meta.format}`);

  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ico = await buildIco();
  fs.writeFileSync(out, ico);

  const kb = (ico.length / 1024).toFixed(1);
  console.log(`✅ build/icon.ico — ${SIZES.join(', ')} px — ${kb} Ko`);
}

main().catch(e => { console.error('❌', e); process.exit(1); });
