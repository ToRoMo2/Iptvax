// Abstraction « moteur de téléchargement » — une interface, plusieurs
// implémentations natives derrière le flag plateforme (même doctrine que le
// dispatch lecteur 5 voies de VideoPlayer.tsx). Le moteur est l'unique
// propriétaire des fichiers ET du registre de métadonnées (device-local) :
// `DownloadsContext` ne fait qu'en refléter l'état (list + abonnement) et y
// superposer le filtrage par profil + le gating Premium.
//
// Plateformes : Electron (Windows, main process Node) et Capacitor (Android,
// plugin DownloadManager). Partout ailleurs (web vitrine / TV) → `noopEngine`,
// la feature est masquée par `isDownloadCapable`.

import { isCapacitor, isElectron } from '../../lib/platform';
import type { DownloadItem, DownloadRequest } from '../../types/download.types';
import { electronDownloads } from '../../native/electronDownloads';
import { capacitorDownloads } from '../../native/capacitorDownloads';

export interface DownloadEngine {
  /** `true` si la plateforme courante sait télécharger. */
  available(): boolean;
  /** Démarre (ou re-met en file) un téléchargement. */
  enqueue(req: DownloadRequest): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  /** Annule un transfert en cours et supprime le fichier partiel. */
  cancel(id: string): Promise<void>;
  /** Supprime un téléchargement terminé (fichier + entrée de registre). */
  remove(id: string): Promise<void>;
  /** Snapshot courant du registre (tous profils). */
  list(): Promise<DownloadItem[]>;
  /** Abonnement à la liste complète, ré-émise à chaque changement. */
  subscribe(cb: (items: DownloadItem[]) => void): () => void;
}

const noopEngine: DownloadEngine = {
  available: () => false,
  enqueue: async () => {},
  pause: async () => {},
  resume: async () => {},
  cancel: async () => {},
  remove: async () => {},
  list: async () => [],
  subscribe: () => () => {},
};

const electronEngine: DownloadEngine = {
  available: () => electronDownloads.available(),
  enqueue: (req) => electronDownloads.start(req),
  pause: (id) => electronDownloads.pause(id),
  resume: (id) => electronDownloads.resume(id),
  cancel: (id) => electronDownloads.cancel(id),
  remove: (id) => electronDownloads.remove(id),
  list: () => electronDownloads.list(),
  subscribe: (cb) => electronDownloads.onChange(cb),
};

const capacitorEngine: DownloadEngine = {
  available: () => capacitorDownloads.available(),
  enqueue: (req) => capacitorDownloads.start(req),
  pause: (id) => capacitorDownloads.pause(id),
  resume: (id) => capacitorDownloads.resume(id),
  cancel: (id) => capacitorDownloads.cancel(id),
  remove: (id) => capacitorDownloads.remove(id),
  list: () => capacitorDownloads.list(),
  subscribe: (cb) => capacitorDownloads.onChange(cb),
};

/** Moteur figé au build/boot selon le shell — jamais de détection ad-hoc. */
export const downloadEngine: DownloadEngine = isElectron
  ? electronEngine
  : isCapacitor
    ? capacitorEngine
    : noopEngine;
