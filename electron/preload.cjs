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
});
