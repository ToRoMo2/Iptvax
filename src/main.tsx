import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { init } from '@noriginmedia/norigin-spatial-navigation';
import App from './App.tsx';
import './index.css';

init({ debug: false, visualDebug: false });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
