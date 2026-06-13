import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import App from './App.tsx';
import { initTvDetection } from './native/tvDetect';
import { initElectronMpv } from './native/electronMpv';
import { isElectron, isVitrine } from './lib/platform';
import './index.css';

init({ debug: false, visualDebug: false });

// Electron : fenêtre frameless → réserve le strip de la barre de titre maison en
// posant `--safe-top` à sa hauteur (toute la chrome fixe descend sous la barre,
// cf. TitleBar.tsx). Posé AVANT le rendu pour éviter un saut de mise en page.
if (isElectron) document.documentElement.classList.add('electron-chrome');

// Direction artistique « Lumière / Halo doré » (re-skin de l'app connectée).
// Le re-skin est 100 % CSS + tokens, scopé sous `html.lumiere` dans app.css →
// on pose la classe uniquement hors vitrine (= app native/Electron). Le site
// vitrine (web pur) garde le système « Vanta » intact (brief : ne pas toucher
// la vitrine). Posé AVANT le rendu pour éviter tout flash de l'ancienne palette.
if (!isVitrine) document.documentElement.classList.add('lumiere');

// Résout AVANT le premier rendu : (1) le type d'appareil (TV vs téléphone) pour
// `isTvDevice()`, (2) la disponibilité du lecteur natif mpv pour
// `isElectronMpvReady()` (dispatch Electron dans VideoPlayer). Instantané/no-op
// hors des shells concernés. Une seule des deux fait réellement quelque chose.
void Promise.all([initTvDetection(), initElectronMpv()]).finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
