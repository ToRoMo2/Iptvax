import type { DownloadItem } from '../types/download.types';
import type { PlayerState } from '../types/xtream.types';

/** Formate un nombre d'octets en libellé court (Ko / Mo / Go). */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Formate un débit (octets/seconde) en libellé court (« 4,2 Mo/s »). */
export function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  return `${formatBytes(bytesPerSec)}/s`;
}

/** Progression 0–100 d'un téléchargement (0 si taille totale inconnue). */
export function downloadPercent(item: DownloadItem): number {
  if (item.status === 'done') return 100;
  if (!item.bytesTotal) return 0;
  return Math.min(100, Math.round((item.bytesDownloaded / item.bytesTotal) * 100));
}

/**
 * Construit le `PlayerState` d'une lecture HORS-LIGNE depuis une entrée
 * téléchargée : `url`/`fallbackUrl` pointent sur le fichier LOCAL (`file://`)
 * → le lecteur natif (mpv / ExoPlayer) le lit sans réseau ni proxy. Le
 * `historyId` est conservé (= `item.id`) → la reprise réutilise la
 * bibliothèque locale, exactement comme en ligne.
 */
export function localPlayerState(item: DownloadItem): PlayerState | null {
  if (!item.fileUri) return null;
  return {
    url: item.fileUri,
    fallbackUrl: item.fileUri,
    title: item.title,
    type: item.type,
    poster: item.posterLocalPath ?? item.poster,
    historyId: item.id,
    seriesContext: item.seriesContext,
  };
}
