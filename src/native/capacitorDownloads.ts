// Pont typé vers le plugin Capacitor maison `Downloader`
// (android/app/src/main/java/com/iptvax/app/DownloaderPlugin.java), qui
// s'appuie sur Android `DownloadManager` (téléchargement en arrière-plan,
// notification système, reprise réseau, écriture dans le dossier app-specific
// sans permission runtime).
//
// ⚠ Validation device requise (non compilable/testable en CI) — comme tout le
// natif Android. Voir CLAUDE.md §XI (téléchargements) et docs/native-port.md.

import { isCapacitor } from '../lib/platform';
import type { DownloadItem, DownloadRequest } from '../types/download.types';

interface DownloaderPlugin {
  start(req: DownloadRequest): Promise<void>;
  pause(opts: { id: string }): Promise<void>;
  resume(opts: { id: string }): Promise<void>;
  cancel(opts: { id: string }): Promise<void>;
  remove(opts: { id: string }): Promise<void>;
  list(): Promise<{ items: DownloadItem[] }>;
  addListener(
    event: 'downloadsChanged',
    cb: (data: { items: DownloadItem[] }) => void,
  ): Promise<{ remove: () => void }>;
}

// Chargé paresseusement : `@capacitor/core` n'est résolu que dans le bundle
// natif. En web/Electron le module n'est jamais importé (engine = noop).
let pluginPromise: Promise<DownloaderPlugin | null> | null = null;

async function getPlugin(): Promise<DownloaderPlugin | null> {
  if (!isCapacitor) return null;
  if (!pluginPromise) {
    pluginPromise = import('@capacitor/core')
      .then((m) => m.registerPlugin<DownloaderPlugin>('Downloader'))
      .catch(() => null);
  }
  return pluginPromise;
}

export const capacitorDownloads = {
  available(): boolean {
    return isCapacitor;
  },
  async start(req: DownloadRequest): Promise<void> {
    await (await getPlugin())?.start(req);
  },
  async pause(id: string): Promise<void> {
    await (await getPlugin())?.pause({ id });
  },
  async resume(id: string): Promise<void> {
    await (await getPlugin())?.resume({ id });
  },
  async cancel(id: string): Promise<void> {
    await (await getPlugin())?.cancel({ id });
  },
  async remove(id: string): Promise<void> {
    await (await getPlugin())?.remove({ id });
  },
  async list(): Promise<DownloadItem[]> {
    const res = await (await getPlugin())?.list();
    return res?.items ?? [];
  },
  onChange(handler: (items: DownloadItem[]) => void): () => void {
    let remove: (() => void) | null = null;
    let cancelled = false;
    void getPlugin().then((p) => {
      if (!p || cancelled) return;
      p.addListener('downloadsChanged', (data) => handler(data.items ?? [])).then((h) => {
        if (cancelled) h.remove();
        else remove = h.remove;
      });
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  },
};
