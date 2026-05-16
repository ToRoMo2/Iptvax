import { useState, useEffect } from 'react';
import { safeImgUrl } from '../utils/image';
import { perceptualHash, hammingDistance } from '../utils/imageHash';
import styles from './BackdropSlideshow.module.css';

interface Props {
  /** URLs BRUTES (proxifiées ici via safeImgUrl au rendu). */
  images: string[];
  intervalMs?: number;
}

// En-dessous de ce seuil de distance de Hamming, deux backdrops sont jugés
// trop similaires (TMDB héberge souvent des quasi-doublons du même fond).
const SIMILARITY_THRESHOLD = 12;

/**
 * Diaporama de fonds d'écran paysage en fondu enchaîné. Élimine les images
 * visuellement quasi identiques (hash perceptuel) puis auto-avance s'il reste
 * ≥ 2 images. Présentationnel : reçoit les URLs déjà récupérées (TMDB) en
 * props — aucun accès service (règle de couplage).
 */
export function BackdropSlideshow({ images, intervalMs = 6000 }: Props) {
  const [display, setDisplay] = useState(images);
  const [idx, setIdx] = useState(0);
  const [navTick, setNavTick] = useState(0);
  const key = images.join('|');

  const step = (dir: 1 | -1) => {
    setIdx((i) => (i + dir + display.length) % display.length);
    setNavTick((n) => n + 1); // relance le minuteur d'auto-défilement
  };

  // Affiche d'abord toutes les images, puis retire les quasi-doublons dès que
  // les hashs sont calculés (graceful : une image non lisible est conservée).
  useEffect(() => {
    setDisplay(images);
    setIdx(0);
    if (images.length < 2) return;
    let alive = true;
    Promise.all(images.map((src) => perceptualHash(safeImgUrl(src) ?? src)))
      .then((hashes) => {
        if (!alive) return;
        const kept: string[] = [];
        const keptHashes: bigint[] = [];
        images.forEach((src, i) => {
          const h = hashes[i];
          if (h === null) { kept.push(src); return; } // illisible → on garde
          const dup = keptHashes.some((kh) => hammingDistance(kh, h) < SIMILARITY_THRESHOLD);
          if (!dup) { kept.push(src); keptHashes.push(h); }
        });
        if (kept.length > 0 && kept.length < images.length) {
          setDisplay(kept);
          setIdx(0);
        }
      });
    return () => { alive = false; };
    // `key` capture le contenu du tableau (identité stable suffisante).
  }, [key, images]);

  useEffect(() => {
    if (display.length < 2) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % display.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [display, intervalMs, navTick]);

  if (display.length === 0) return null;

  return (
    <div className={styles.wrap}>
      {display.map((src, i) => (
        <div
          key={src}
          className={`${styles.layer} ${i === idx ? styles.active : ''}`}
          style={{ backgroundImage: `url(${safeImgUrl(src)})` }}
        />
      ))}
      {display.length > 1 && (
        <>
          <button
            className={`${styles.nav} ${styles.prev}`}
            onClick={() => step(-1)}
            aria-label="Image précédente"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m15 18-6-6 6-6"/></svg>
          </button>
          <button
            className={`${styles.nav} ${styles.next}`}
            onClick={() => step(1)}
            aria-label="Image suivante"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="m9 18 6-6-6-6"/></svg>
          </button>
        </>
      )}
    </div>
  );
}
