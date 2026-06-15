// Pont typé vers le téléchargeur Electron exposé par le preload
// (`window.electron.downloads`, cf. electron/preload.cjs + electron/downloads.cjs).
//
// Pendant « téléchargement » de src/native/electronMpv.ts : transforme les
// appels JS en messages IPC. Le main process est l'unique propriétaire du
// registre (downloads.json dans userData) et des fichiers sur le disque ; il
// ré-émet la liste complète à chaque changement (progression / statut).
//
// Voir src/services/downloads/electron.engine.ts et CLAUDE.md §XI.

import { isElectron } from '../lib/platform';
import type { DownloadItem, DownloadRequest } from '../types/download.types';

function api() {
  return isElectron && window.electron ? window.electron.downloads : null;
}

export const electronDownloads = {
  available(): boolean {
    return !!api();
  },
  async start(req: DownloadRequest): Promise<void> {
    await api()?.start(req);
  },
  async pause(id: string): Promise<void> {
    await api()?.pause(id);
  },
  async resume(id: string): Promise<void> {
    await api()?.resume(id);
  },
  async cancel(id: string): Promise<void> {
    await api()?.cancel(id);
  },
  async remove(id: string): Promise<void> {
    await api()?.remove(id);
  },
  async list(): Promise<DownloadItem[]> {
    const raw = await api()?.list();
    return Array.isArray(raw) ? (raw as DownloadItem[]) : [];
  },
  /** Abonnement à la liste complète (ré-émise à chaque changement). */
  onChange(handler: (items: DownloadItem[]) => void): () => void {
    const a = api();
    if (!a) return () => {};
    return a.onEvent((ev) => {
      const items = (ev as { items?: unknown })?.items;
      if (Array.isArray(items)) handler(items as DownloadItem[]);
    });
  },
};
