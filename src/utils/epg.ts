/**
 * Décodage + normalisation des programmes EPG Xtream (`get_short_epg`).
 * Fonctions pures — `title`/`description` arrivent encodés en base64 (UTF-8).
 */
import type { EpgListing } from '../types/xtream.types';

/** Décode un champ base64 (UTF-8). Repli silencieux sur la chaîne brute. */
export function decodeB64(s: string): string {
  if (!s) return '';
  try {
    const bin = atob(s);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes).trim();
  } catch {
    return s;
  }
}

/** "2026-05-16 19:00:00" → "19:00". */
export function epgTime(raw: string): string {
  const m = /(\d{1,2}):(\d{2})/.exec(raw ?? '');
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

export interface EpgRow {
  key: string;
  time: string;
  title: string;
  desc: string;
  playing: boolean;
  progress: number;
}

/**
 * Dédoublonne par horaire de début, décode les champs base64 et calcule l'état
 * « en cours » + la progression. Certains panels Xtream renvoient chaque
 * programme en double (l'un marqué `now_playing`).
 */
export function buildEpgRows(epg: EpgListing[]): EpgRow[] {
  const nowSec = Date.now() / 1000;
  const byStart = new Map<string, EpgListing>();
  for (const p of epg) {
    const key = p.start_timestamp || p.start || p.id;
    const existing = byStart.get(key);
    if (!existing || (p.now_playing === 1 && existing.now_playing !== 1)) {
      byStart.set(key, p);
    }
  }
  return Array.from(byStart.values())
    .sort((a, b) => Number(a.start_timestamp) - Number(b.start_timestamp))
    .map((p) => {
      const s = Number(p.start_timestamp);
      const e = Number(p.stop_timestamp);
      const playing =
        p.now_playing === 1 ||
        (Number.isFinite(s) && Number.isFinite(e) && nowSec >= s && nowSec < e);
      const progress =
        Number.isFinite(s) && Number.isFinite(e) && e > s
          ? Math.min(100, Math.max(0, ((nowSec - s) / (e - s)) * 100))
          : 0;
      return {
        key: p.id || `${p.start_timestamp}-${p.start}`,
        time: epgTime(p.start),
        title: decodeB64(p.title),
        desc: decodeB64(p.description),
        playing,
        progress,
      };
    });
}
