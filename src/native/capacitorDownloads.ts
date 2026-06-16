// Pont typé vers le plugin Capacitor maison `Downloader`
// (android/app/src/main/java/com/iptvax/app/DownloaderPlugin.java) : un
// téléchargeur en-process déterministe (un fil par transfert, HttpURLConnection
// + RandomAccessFile) qui rapatrie le fichier par tranches `Range` dans le
// dossier app-specific (sans permission runtime). Remplace l'ancien
// `DownloadManager` (restait bloqué en PENDING sur les sources IPTV).
//
// ⚠ Validation device requise (non compilable/testable en CI) — comme tout le
// natif Android. Voir CLAUDE.md §XI (téléchargements) et docs/native-port.md.

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
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
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

// ⚠ Enregistrement STATIQUE de `registerPlugin`, comme tous les autres plugins
// natifs (tvDetect, volumeControl, MediaPlayer). L'ancienne version chargeait
// `@capacitor/core` par `import()` dynamique avec un `.catch(() => null)` : si
// le chunk async échouait à charger dans la WebView native, `getPlugin()`
// renvoyait `null`, et `(await null)?.start(req)` devenait un NO-OP qui se
// RÉSOUT sans erreur → l'item optimiste « queued » restait à tourner à l'infini
// (jamais confirmé par le moteur, jamais marqué en erreur), `list()` renvoyait
// `[]` et aucun event `downloadsChanged` n'arrivait. Symptôme exact : « le
// téléchargement s'initialise à l'infini et ne démarre jamais ». `@capacitor/core`
// est déjà importé statiquement ailleurs (tvDetect via main.tsx) et inerte en
// web (le proxy n'est jamais appelé, engine = noop hors Capacitor).
const Downloader = registerPlugin<DownloaderPlugin>('Downloader');

export const capacitorDownloads = {
  available(): boolean {
    return isCapacitor;
  },
  // ⚠ Les erreurs natives sont volontairement PROPAGÉES (pas de catch silencieux) :
  // un échec d'enqueue doit faire passer l'item en `error` (bouton « Réessayer »)
  // côté DownloadsContext, jamais le laisser tourner indéfiniment.
  async start(req: DownloadRequest): Promise<void> {
    await Downloader.start(req);
  },
  async pause(id: string): Promise<void> {
    await Downloader.pause({ id });
  },
  async resume(id: string): Promise<void> {
    await Downloader.resume({ id });
  },
  async cancel(id: string): Promise<void> {
    await Downloader.cancel({ id });
  },
  async remove(id: string): Promise<void> {
    await Downloader.remove({ id });
  },
  async list(): Promise<DownloadItem[]> {
    const res = await Downloader.list();
    return res?.items ?? [];
  },
  onChange(handler: (items: DownloadItem[]) => void): () => void {
    let remove: (() => void) | null = null;
    let cancelled = false;
    Downloader.addListener('downloadsChanged', (data) => handler(data.items ?? []))
      .then((h) => {
        if (cancelled) h.remove();
        else remove = h.remove;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      remove?.();
    };
  },
};
