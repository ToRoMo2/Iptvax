// Preload Electron — pont minimal pour l'OAuth navigateur système.
//
// On garde l'app 100 % web (mode `web`, `isNative=false`). La seule chose
// qu'on expose au renderer, c'est ce qui ne peut pas se faire en pur web :
//  - ouvrir une URL dans le navigateur SYSTÈME (sinon Electron navigue dans
//    sa propre fenêtre — UX OAuth dégradée : pas de cookies Chrome/Edge,
//    pas de sélecteur de compte Google) ;
//  - recevoir l'URL de retour `umbra://auth-callback?code=…` que l'OS
//    transmet à Electron via le protocole custom (cf. electron/main.cjs).
//
// `contextIsolation: true` côté renderer → on passe par `contextBridge`,
// jamais par `window.X = …` (qui serait inaccessible côté page).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  /** Ouvre une URL http(s) dans le navigateur par défaut de l'OS. */
  openExternal: (url) => ipcRenderer.invoke('umbra:open-external', url),

  /** Écoute les callbacks `umbra://auth-callback?…` reçus par le main process.
   *  Renvoie un unsubscribe — penser à l'appeler à l'unmount du listener. */
  onAuthCallback: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, url) => handler(url);
    ipcRenderer.on('umbra:auth-callback', listener);
    return () => ipcRenderer.removeListener('umbra:auth-callback', listener);
  },

  // ── Contrôles de la fenêtre (titlebar maison, fenêtre frameless) ────────────
  window: {
    minimize: () => ipcRenderer.send('umbra:window', 'minimize'),
    maximize: () => ipcRenderer.send('umbra:window', 'maximize'),
    close: () => ipcRenderer.send('umbra:window', 'close'),
    isMaximized: () => ipcRenderer.invoke('umbra:window-is-maximized'),
    /** Bascule le plein écran (borderless) de la fenêtre (lecteur mpv). */
    toggleFullscreen: () => ipcRenderer.send('umbra:window', 'toggle-fullscreen'),
    /** Force la sortie du plein écran (ex. au démontage du lecteur). */
    exitFullscreen: () => ipcRenderer.send('umbra:window', 'exit-fullscreen'),
    /** Déplacement custom de la fenêtre (titlebar) — la fenêtre transparente
     *  n'a pas le drag/snap natif. Émis depuis les events pointer du titlebar :
     *  `start` au pointerdown, `move` au pointermove, `end` au pointerup (snap
     *  « agrandir » si relâché en haut de l'écran). */
    dragStart: () => ipcRenderer.send('umbra:window-drag', 'start'),
    dragMove: () => ipcRenderer.send('umbra:window-drag', 'move'),
    dragEnd: () => ipcRenderer.send('umbra:window-drag', 'end'),
    /** Notifie le renderer des changements maximisé/restauré (icône du bouton). */
    onMaxStateChange: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, isMax) => handler(!!isMax);
      ipcRenderer.on('umbra:window-max-state', listener);
      return () => ipcRenderer.removeListener('umbra:window-max-state', listener);
    },
    /** Notifie le renderer des changements plein écran (icône + titlebar). */
    onFullscreenChange: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, isFs) => handler(!!isFs);
      ipcRenderer.on('umbra:window-fs-state', listener);
      return () => ipcRenderer.removeListener('umbra:window-fs-state', listener);
    },
  },

  // ── Lecteur natif mpv (cf. src/native/electronMpv.ts) ───────────────────────
  mpv: {
    /** `true` si le binaire mpv est présent (sinon repli proxy ffmpeg). */
    available: () => ipcRenderer.invoke('umbra:mpv-available'),
    /** Invoque une méthode du contrôleur mpv (whitelist côté main). */
    call: (method, args) => ipcRenderer.invoke('umbra:mpv', method, args),
    /** Flux d'events normalisés (time/duration/state/tracks/volume/mute).
     *  Renvoie un unsubscribe. */
    onEvent: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, ev) => handler(ev);
      ipcRenderer.on('umbra:mpv-event', listener);
      return () => ipcRenderer.removeListener('umbra:mpv-event', listener);
    },
  },
});
