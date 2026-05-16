/**
 * Hash perceptuel (dHash 8×8) pour repérer des images visuellement proches.
 *
 * Sert à éviter d'afficher deux fonds d'écran quasi identiques dans le
 * diaporama (TMDB héberge souvent plusieurs variantes très similaires du même
 * backdrop). Les images transitant par `/api/img` sont same-origin → le canvas
 * n'est PAS « tainted », `getImageData` est lisible.
 *
 * Couche `utils/` : zéro import (API navigateur uniquement).
 */

const LOAD_TIMEOUT_MS = 6000;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('load error')); };
    img.src = src;
  });
}

/**
 * dHash 64 bits : compare la luminance de pixels horizontalement adjacents sur
 * une grille 9×8. Renvoie `null` si l'image ne peut être lue (taint, erreur).
 */
export async function perceptualHash(fetchUrl: string): Promise<bigint | null> {
  try {
    const img = await loadImage(fetchUrl);
    const w = 9;
    const h = 8;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    let hash = 0n;
    let bit = 0n;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        const j = (y * w + x + 1) * 4;
        const lum1 = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
        const lum2 = data[j] * 0.299 + data[j + 1] * 0.587 + data[j + 2] * 0.114;
        if (lum1 > lum2) hash |= 1n << bit;
        bit++;
      }
    }
    return hash;
  } catch {
    return null;
  }
}

/** Distance de Hamming entre deux hashs (nombre de bits différents, 0–64). */
export function hammingDistance(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x > 0n) {
    count += Number(x & 1n);
    x >>= 1n;
  }
  return count;
}
