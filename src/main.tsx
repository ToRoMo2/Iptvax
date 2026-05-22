import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import App from './App.tsx';
import { initTvDetection } from './native/tvDetect';
import './index.css';

init({ debug: false, visualDebug: false });

// Résout le type d'appareil (TV vs téléphone) AVANT le premier rendu, pour que
// `isTvDevice()` soit fiable dès `AppGate`. Instantané en web (court-circuit).
void initTvDetection().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
