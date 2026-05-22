import type {
  XtreamCredentials,
  XtreamAuthResponse,
  LiveCategory,
  LiveStream,
  VodCategory,
  VodStream,
  SeriesCategory,
  SeriesItem,
  SeriesInfo,
  EpgListing,
} from '../types/xtream.types';
import { apiUrl } from '../lib/api';
import { isNative } from '../lib/platform';
import { httpGetJson } from '../lib/http';

// ─── API Xtream ───────────────────────────────────────────────────────────

// Retire un éventuel slash final (les chemins Xtream sont concaténés derrière).
function normalizeServer(serverUrl: string): string {
  return serverUrl.replace(/\/$/, '');
}

// URL d'appel de l'API Xtream (player_api.php).
// - web    : via le proxy CORS /api/xtream — le backend ajoute le bon UA et
//            contourne l'absence de CORS des serveurs Xtream.
// - native : appel DIRECT depuis l'appareil → la requête part de l'IP de
//            l'utilisateur (pas de blocage d'IP datacenter), aucune contrainte
//            CORS dans un shell natif. Voir docs/native-port.md.
function buildApiUrl(creds: XtreamCredentials, params: Record<string, string>): string {
  if (isNative) {
    const search = new URLSearchParams({
      username: creds.username,
      password: creds.password,
      ...params,
    });
    return `${normalizeServer(creds.serverUrl)}/player_api.php?${search}`;
  }
  const search = new URLSearchParams({
    _server: creds.serverUrl,
    username: creds.username,
    password: creds.password,
    ...params,
  });
  return apiUrl(`/api/xtream?${search}`);
}

async function apiFetch<T>(creds: XtreamCredentials, params: Record<string, string>): Promise<T> {
  return httpGetJson<T>(buildApiUrl(creds, params));
}

// ─── Cache catalogue (durée de session) ───────────────────────────────────
// Les catalogues Xtream (catégories, listes de streams, infos série) sont
// volumineux (milliers d'items, upstream lent) et ne changent quasiment pas
// pendant une session. Sans cache, chaque navigation (Home → Films → retour)
// re-télécharge tout. On mémorise la Promise (partage les requêtes
// concurrentes : Movies fetch la catégorie ET le catalogue global au montage)
// avec un TTL. Clé scopée au serveur → un changement de profil/serveur ne
// sert jamais un cache croisé. `authenticate` n'est JAMAIS caché (doit rester
// une vérification réseau live). EPG : TTL court (programme « en cours »).
interface CacheEntry { at: number; data: Promise<unknown>; }
const catalogCache = new Map<string, CacheEntry>();
const CATALOG_TTL = 10 * 60_000; // 10 min — catalogue stable sur une session
const EPG_TTL = 60_000;          // 1 min — le « en cours » doit rester frais

function cachedFetch<T>(
  creds: XtreamCredentials,
  params: Record<string, string>,
  ttl: number,
): Promise<T> {
  const key = `${creds.serverUrl}|${new URLSearchParams(params).toString()}`;
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data as Promise<T>;

  const p = apiFetch<T>(creds, params).catch((err) => {
    // Ne pas mémoriser un échec : le prochain appel doit pouvoir réessayer.
    if (catalogCache.get(key)?.data === p) catalogCache.delete(key);
    throw err;
  });
  catalogCache.set(key, { at: Date.now(), data: p });
  return p;
}

/** Vide le cache catalogue (changement de profil/serveur, pull-to-refresh). */
function clearCatalogCache(): void {
  catalogCache.clear();
}

export const xtreamService = {
  clearCatalogCache,

  authenticate: (creds: XtreamCredentials) =>
    apiFetch<XtreamAuthResponse>(creds, {}),

  getLiveCategories: (creds: XtreamCredentials) =>
    cachedFetch<LiveCategory[]>(creds, { action: 'get_live_categories' }, CATALOG_TTL),

  getLiveStreams: (creds: XtreamCredentials, categoryId?: string) =>
    cachedFetch<LiveStream[]>(creds, {
      action: 'get_live_streams',
      ...(categoryId ? { category_id: categoryId } : {}),
    }, CATALOG_TTL),

  getVodCategories: (creds: XtreamCredentials) =>
    cachedFetch<VodCategory[]>(creds, { action: 'get_vod_categories' }, CATALOG_TTL),

  getVodStreams: (creds: XtreamCredentials, categoryId?: string) =>
    cachedFetch<VodStream[]>(creds, {
      action: 'get_vod_streams',
      ...(categoryId ? { category_id: categoryId } : {}),
    }, CATALOG_TTL),

  getSeriesCategories: (creds: XtreamCredentials) =>
    cachedFetch<SeriesCategory[]>(creds, { action: 'get_series_categories' }, CATALOG_TTL),

  getSeries: (creds: XtreamCredentials, categoryId?: string) =>
    cachedFetch<SeriesItem[]>(creds, {
      action: 'get_series',
      ...(categoryId ? { category_id: categoryId } : {}),
    }, CATALOG_TTL),

  getSeriesInfo: (creds: XtreamCredentials, seriesId: number) =>
    cachedFetch<SeriesInfo>(creds, { action: 'get_series_info', series_id: String(seriesId) }, CATALOG_TTL),

  // EPG court (programme en cours + suivants) d'une chaîne live.
  // Renvoie `epg_listings` (titre/description en base64). Tolère un serveur
  // sans EPG : la liste est alors vide et l'UI retombe sur le nom de chaîne.
  // TTL court : le programme « en cours » doit rester à jour.
  getShortEpg: (creds: XtreamCredentials, streamId: number, limit = 12) =>
    cachedFetch<{ epg_listings?: EpgListing[] }>(creds, {
      action: 'get_short_epg',
      stream_id: String(streamId),
      limit: String(limit),
    }, EPG_TTL),

  // ─── URLs de stream ────────────────────────────────────────────────────
  // - web    : tout transite par /api/hlsproxy (ou /api/liveproxy) — proxy
  //   CORS + remux ffmpeg côté serveur. On force .m3u8 (HLS) pour la
  //   compatibilité de l'élément <video> du navigateur.
  // - native : URL DIRECTE (l'upstream sans l'enveloppe proxy) — le lecteur
  //   natif (libVLC) lit nativement MKV/HEVC/MPEG-TS, et le flux part de l'IP
  //   de l'utilisateur → aucun blocage d'IP datacenter. Voir docs/native-port.md.

  // Live : HLS (.m3u8) — la plupart des serveurs Xtream Codes modernes ne
  // servent plus le `.ts` continu fiablement. HLS bénéficie aussi de la resync
  // segment-par-segment et de la gestion CDN.
  getLiveStreamUrl(creds: XtreamCredentials, streamId: number): string {
    const m3u8 = `${creds.serverUrl}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
    return isNative ? m3u8 : apiUrl(`/api/hlsproxy?url=${encodeURIComponent(m3u8)}`);
  },

  // Fallback live : MPEG-TS continu — utilisé si le serveur ne sert pas le
  // live en HLS (bascule automatique sur erreur HLS fatale côté web).
  getLiveStreamTsUrl(creds: XtreamCredentials, streamId: number): string {
    const direct = `${creds.serverUrl}/live/${creds.username}/${creds.password}/${streamId}.ts`;
    return isNative ? direct : apiUrl(`/api/liveproxy?url=${encodeURIComponent(direct)}`);
  },

  // Films : HLS (.m3u8) en premier côté web ; fichier direct en fallback.
  // Natif : fichier direct (conteneur MKV/MP4) — libVLC le lit nativement.
  // Le `.m3u8` VOD n'est qu'un artefact du proxy web (remux ffmpeg → HLS) ;
  // beaucoup de serveurs Xtream ne le servent pas pour les films → libVLC
  // n'aurait rien à lire. Voir docs/native-port.md.
  getVodStreamUrl(creds: XtreamCredentials, streamId: number, ext: string): string {
    if (isNative) {
      return `${creds.serverUrl}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
    }
    const m3u8 = `${creds.serverUrl}/movie/${creds.username}/${creds.password}/${streamId}.m3u8`;
    return apiUrl(`/api/hlsproxy?url=${encodeURIComponent(m3u8)}`);
  },

  getVodDirectUrl(creds: XtreamCredentials, streamId: number, ext: string): string {
    const direct = `${creds.serverUrl}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
    return isNative ? direct : apiUrl(`/api/hlsproxy?url=${encodeURIComponent(direct)}`);
  },

  // Épisodes : même logique — HLS côté web, fichier direct côté natif (libVLC).
  getSeriesStreamUrl(creds: XtreamCredentials, episodeId: string, ext: string): string {
    if (isNative) {
      return `${creds.serverUrl}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
    }
    const m3u8 = `${creds.serverUrl}/series/${creds.username}/${creds.password}/${episodeId}.m3u8`;
    return apiUrl(`/api/hlsproxy?url=${encodeURIComponent(m3u8)}`);
  },

  getSeriesDirectUrl(creds: XtreamCredentials, episodeId: string, ext: string): string {
    const direct = `${creds.serverUrl}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
    return isNative ? direct : apiUrl(`/api/hlsproxy?url=${encodeURIComponent(direct)}`);
  },
};
