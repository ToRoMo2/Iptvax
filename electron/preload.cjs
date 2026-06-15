// Preload Electron — pont minimal pour l'OAuth navigateur système.
//
// On garde l'app 100 % web (mode `web`, `isNative=false`). La seule chose
// qu'on expose au renderer, c'est ce qui ne peut pas se faire en pur web :
//  - ouvrir une URL dans le navigateur SYSTÈME (sinon Electron navigue dans
//    sa propre fenêtre — UX OAuth dégradée : pas de cookies Chrome/Edge,
//    pas de sélecteur de compte Google) ;
//  - recevoir l'URL de retour `iptvax://auth-callback?code=…` que l'OS
//    transmet à Electron via le protocole custom (cf. electron/main.cjs).
//
// `contextIsolation: true` côté renderer → on passe par `contextBridge`,
// jamais par `window.X = …` (qui serait inaccessible côté page).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  /** Ouvre une URL http(s) dans le navigateur par défaut de l'OS. */
  openExternal: (url) => ipcRenderer.invoke('iptvax:open-external', url),

  /** Écoute les callbacks `iptvax://auth-callback?…` reçus par le main process.
   *  Renvoie un unsubscribe — penser à l'appeler à l'unmount du listener. */
  onAuthCallback: (handler) => {
    if (typeof handler !== 'function') return () => {};
    const listener = (_event, url) => handler(url);
    ipcRenderer.on('iptvax:auth-callback', listener);
    return () => ipcRenderer.removeListener('iptvax:auth-callback', listener);
  },

  // ── Contrôles de la fenêtre (titlebar maison, fenêtre frameless) ────────────
  window: {
    minimize: () => ipcRenderer.send('iptvax:window', 'minimize'),
    maximize: () => ipcRenderer.send('iptvax:window', 'maximize'),
    close: () => ipcRenderer.send('iptvax:window', 'close'),
    isMaximized: () => ipcRenderer.invoke('iptvax:window-is-maximized'),
    /** Bascule le plein écran (borderless) de la fenêtre (lecteur mpv). */
    toggleFullscreen: () => ipcRenderer.send('iptvax:window', 'toggle-fullscreen'),
    /** Force la sortie du plein écran (ex. au démontage du lecteur). */
    exitFullscreen: () => ipcRenderer.send('iptvax:window', 'exit-fullscreen'),
    /** Déplacement custom de la fenêtre (titlebar) — la fenêtre transparente
     *  n'a pas le drag/snap natif. Émis depuis les events pointer du titlebar :
     *  `start` au pointerdown, `move` au pointermove, `end` au pointerup (snap
     *  « agrandir » si relâché en haut de l'écran). */
    dragStart: () => ipcRenderer.send('iptvax:window-drag', 'start'),
    dragMove: () => ipcRenderer.send('iptvax:window-drag', 'move'),
    dragEnd: () => ipcRenderer.send('iptvax:window-drag', 'end'),
    /** Notifie le renderer des changements maximisé/restauré (icône du bouton). */
    onMaxStateChange: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, isMax) => handler(!!isMax);
      ipcRenderer.on('iptvax:window-max-state', listener);
      return () => ipcRenderer.removeListener('iptvax:window-max-state', listener);
    },
    /** Notifie le renderer des changements plein écran (icône + titlebar). */
    onFullscreenChange: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, isFs) => handler(!!isFs);
      ipcRenderer.on('iptvax:window-fs-state', listener);
      return () => ipcRenderer.removeListener('iptvax:window-fs-state', listener);
    },
  },

  // ── Lecteur natif mpv (cf. src/native/electronMpv.ts) ───────────────────────
  mpv: {
    /** `true` si le binaire mpv est présent (sinon repli proxy ffmpeg). */
    available: () => ipcRenderer.invoke('iptvax:mpv-available'),
    /** Invoque une méthode du contrôleur mpv (whitelist côté main). */
    call: (method, args) => ipcRenderer.invoke('iptvax:mpv', method, args),
    /** Flux d'events normalisés (time/duration/state/tracks/volume/mute).
     *  Renvoie un unsubscribe. */
    onEvent: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, ev) => handler(ev);
      ipcRenderer.on('iptvax:mpv-event', listener);
      return () => ipcRenderer.removeListener('iptvax:mpv-event', listener);
    },
  },

  // ── Téléchargements hors-ligne (cf. src/native/electronDownloads.ts) ────────
  downloads: {
    start: (item) => ipcRenderer.invoke('iptvax:dl', 'start', item),
    pause: (id) => ipcRenderer.invoke('iptvax:dl', 'pause', id),
    resume: (id) => ipcRenderer.invoke('iptvax:dl', 'resume', id),
    cancel: (id) => ipcRenderer.invoke('iptvax:dl', 'cancel', id),
    remove: (id) => ipcRenderer.invoke('iptvax:dl', 'remove', id),
    list: () => ipcRenderer.invoke('iptvax:dl-list'),
    /** Liste complète ré-émise à chaque changement. Renvoie un unsubscribe. */
    onEvent: (handler) => {
      if (typeof handler !== 'function') return () => {};
      const listener = (_event, ev) => handler(ev);
      ipcRenderer.on('iptvax:dl-event', listener);
      return () => ipcRenderer.removeListener('iptvax:dl-event', listener);
    },
  },
});
