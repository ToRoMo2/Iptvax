import { useEffect, useRef, useState, type PointerEvent } from 'react';
import './TitleBar.css';

/**
 * Barre de titre maison pour l'app Electron (fenêtre `frame:false` requise par
 * le lecteur natif mpv — surface vidéo derrière une WebView transparente, cf.
 * CLAUDE.md §XI). Occupe le strip de 30 px vacant en haut : `--safe-top` est posé
 * à la hauteur de la barre (`html.electron-chrome`, main.tsx) → toute la chrome
 * fixe de l'app (brand/topnav/profil, qui intègrent déjà `var(--safe-top)`)
 * descend sous la barre, sans collision.
 *
 * Rendu UNIQUEMENT en Electron (gardé par `isElectron` côté App.tsx) → web et
 * shells natifs strictement inchangés.
 */
export function TitleBar() {
  const [isMax, setIsMax] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const draggingRef = useRef(false);
  const win = typeof window !== 'undefined' ? window.electron?.window : undefined;

  useEffect(() => {
    if (!win) return;
    win.isMaximized().then(setIsMax).catch(() => {});
    return win.onMaxStateChange(setIsMax);
  }, [win]);

  // En plein écran natif : masquer la barre + libérer le strip (`--safe-top` → 0)
  // pour que le lecteur occupe toute la hauteur.
  useEffect(() => {
    if (!win) return;
    return win.onFullscreenChange((fs) => {
      setIsFs(fs);
      document.documentElement.classList.toggle('electron-fullscreen', fs);
    });
  }, [win]);

  if (!win || isFs) return null;

  // Déplacement custom : la fenêtre transparente n'a pas le drag natif
  // (`-webkit-app-region`) ni l'Aero Snap. On pilote le move via pointer capture
  // → le main suit le curseur et maximise si relâché en haut (cf. main.cjs).
  const onDragPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    win.dragStart();
  };
  const onDragPointerMove = () => {
    if (draggingRef.current) win.dragMove();
  };
  const onDragPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* déjà relâché */ }
    win.dragEnd();
  };

  return (
    <div className="titlebar">
      <div
        className="titlebar-drag"
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={onDragPointerUp}
        onDoubleClick={() => win.maximize()}
      >
        <span className="titlebar-title">Umbra</span>
      </div>
      <div className="titlebar-controls">
        <button className="titlebar-btn" aria-label="Réduire" onClick={() => win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="4.5" width="8" height="1" fill="currentColor" /></svg>
        </button>
        <button
          className="titlebar-btn"
          aria-label={isMax ? 'Restaurer' : 'Agrandir'}
          onClick={() => win.maximize()}
        >
          {isMax ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1" y="2.5" width="6" height="6" fill="none" stroke="currentColor" strokeWidth="1" />
              <path d="M3 2.5 V1 H8.5 V6.5 H7" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1.5" y="1.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button className="titlebar-btn titlebar-close" aria-label="Fermer" onClick={() => win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M1 1 L9 9 M9 1 L1 9" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  );
}
