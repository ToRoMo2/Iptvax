import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import App from './App.tsx';
import { initTvDetection } from './native/tvDetect';
import { initElectronMpv } from './native/electronMpv';
import { isElectron } from './lib/platform';
import './index.css';

init({ debug: false, visualDebug: false });

// Electron : fenêtre frameless → réserve le strip de la barre de titre maison en
// posant `--safe-top` à sa hauteur (toute la chrome fixe descend sous la barre,
// cf. TitleBar.tsx). Posé AVANT le rendu pour éviter un saut de mise en page.
if (isElectron) document.documentElement.classList.add('electron-chrome');

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
