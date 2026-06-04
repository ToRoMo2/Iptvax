import type { FavoriteItem, WatchHistoryItem, ContentType } from '../types/library.types';

/**
 * Adaptateur favoris/historique du tier GRATUIT.
 *
 * Override assumé du garde-fou CLAUDE.md §IV-12 : pour le tier gratuit, la
 * persistance est volontairement LOCALE (localStorage, liée à l'appareil),
 * jamais Supabase. C'est ce qui fait du *sync cross-device* une vraie valeur
 * Premium. Signature alignée sur `library.service` → `LibraryContext` choisit
 * l'adaptateur selon `isPremium` sans dupliquer de logique.
 *
 * `userId` est accepté pour la parité de signature avec le service Supabase
 * mais inutilisé (stockage local non scopé au compte).
 */

const FAV_PREFIX = 'iptv.local.fav.';
const HIST_PREFIX = 'iptv.local.hist.';
const HISTORY_CAP = 60;

/**
 * Plafond de favoris du tier GRATUIT. Le tier Premium (adaptateur Supabase)
 * reste illimité. C'est un levier d'upsell assumé : passé ce seuil, l'UI
 * propose de débloquer l'illimité (sync cross-device). Exporté pour que
 * `LibraryContext` connaisse la limite côté UI sans la dupliquer.
 */
export const LOCAL_FAV_CAP = 10;

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}

function write<T>(key: string, list: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Quota dépassé / mode privé : on échoue silencieusement (l'état UI
    // optimiste du contexte reste cohérent pour la session courante).
  }
}

const favKey = (profileId: string) => `${FAV_PREFIX}${profileId}`;
const histKey = (profileId: string) => `${HIST_PREFIX}${profileId}`;

export const localLibraryService = {
  // ── Favoris ───────────────────────────────────────────────────────────────
  async listFavorites(profileId: string): Promise<FavoriteItem[]> {
    return read<FavoriteItem>(favKey(profileId));
  },

  async addFavorite(_userId: string, profileId: string, fav: FavoriteItem): Promise<void> {
    const list = read<FavoriteItem>(favKey(profileId)).filter(
      (f) => !(f.type === fav.type && f.id === fav.id),
    );
    // Filet de sécurité : on cape le stockage même si l'UI laisse passer un
    // ajout (la garde primaire est dans LibraryContext.toggleFavorite, qui
    // bloque + propose Premium avant d'atteindre cette ligne).
    write(favKey(profileId), [fav, ...list].slice(0, LOCAL_FAV_CAP));
  },

  async removeFavorite(profileId: string, type: ContentType, id: string): Promise<void> {
    const list = read<FavoriteItem>(favKey(profileId)).filter(
      (f) => !(f.type === type && f.id === id),
    );
    write(favKey(profileId), list);
  },

  // ── Historique / reprise ──────────────────────────────────────────────────
  async listHistory(profileId: string): Promise<WatchHistoryItem[]> {
    return read<WatchHistoryItem>(histKey(profileId))
      .sort((a, b) => b.watchedAt - a.watchedAt)
      .slice(0, HISTORY_CAP);
  },

  async removeHistoryItem(
    profileId: string,
    contentId: string,
    contentType: ContentType,
  ): Promise<void> {
    const list = read<WatchHistoryItem>(histKey(profileId)).filter(
      (h) => !(h.id === contentId && h.type === contentType),
    );
    write(histKey(profileId), list);
  },

  async clearHistory(profileId: string): Promise<void> {
    write(histKey(profileId), []);
  },

  async upsertHistory(
    _userId: string,
    profileId: string,
    item: WatchHistoryItem,
  ): Promise<void> {
    const list = read<WatchHistoryItem>(histKey(profileId)).filter(
      (h) => !(h.id === item.id && h.type === item.type),
    );
    write(
      histKey(profileId),
      [item, ...list].sort((a, b) => b.watchedAt - a.watchedAt).slice(0, HISTORY_CAP),
    );
  },
};
