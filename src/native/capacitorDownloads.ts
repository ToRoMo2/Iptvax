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

// Enregistrement STATIQUE du plugin (même pattern que tvDetect/volumeControl).
// ⚠ NE PAS revenir à un `import('@capacitor/core').then(m => m.registerPlugin)`
// paresseux : `registerPlugin` renvoie un Proxy qui expose `.then` → renvoyé
// depuis un `.then`, le Promise l'« assimile » comme thenable et invoque la
// méthode native `then()` inexistante → `"Downloader.then() is not implemented
// on android"`. `@capacitor/core` est de toute façon déjà bundlé (http.ts,
// nativePlayer.ts, tvDetect.ts l'importent statiquement) → zéro gain au lazy.
// En web/Electron → `null` (engine = noop, feature masquée par isDownloadCapable).
const Downloader: DownloaderPlugin | null = isCapacitor
  ? registerPlugin<DownloaderPlugin>('Downloader')
  : null;

export const capacitorDownloads = {
  available(): boolean {
    return isCapacitor;
  },
  // ⚠ Les erreurs natives sont volontairement PROPAGÉES (pas de catch silencieux) :
  // un échec d'enqueue doit faire passer l'item en `error` (bouton « Réessayer »)
  // côté DownloadsContext, jamais le laisser tourner indéfiniment.
  async start(req: DownloadRequest): Promise<void> {
    await Downloader?.start(req);
  },
  async pause(id: string): Promise<void> {
    await Downloader?.pause({ id });
  },
  async resume(id: string): Promise<void> {
    await Downloader?.resume({ id });
  },
  async cancel(id: string): Promise<void> {
    await Downloader?.cancel({ id });
  },
  async remove(id: string): Promise<void> {
    await Downloader?.remove({ id });
  },
  async list(): Promise<DownloadItem[]> {
    const res = await Downloader?.list();
    return res?.items ?? [];
  },
  onChange(handler: (items: DownloadItem[]) => void): () => void {
    if (!Downloader) return () => {};
    let remove: (() => void) | null = null;
    let cancelled = false;
    void Downloader.addListener('downloadsChanged', (data) =>
      handler(data.items ?? []),
    ).then((h) => {
      if (cancelled) h.remove();
      else remove = h.remove;
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  },
};
