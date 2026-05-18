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

// ─── API Xtream (via proxy CORS) ──────────────────────────────────────────

function buildProxyUrl(creds: XtreamCredentials, params: Record<string, string>): string {
  const search = new URLSearchParams({
    _server: creds.serverUrl,
    username: creds.username,
    password: creds.password,
    ...params,
  });
  return `/api/xtream?${search}`;
}

async function apiFetch<T>(creds: XtreamCredentials, params: Record<string, string>): Promise<T> {
  const res = await fetch(buildProxyUrl(creds, params));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
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
  // Tous les streams passent par /api/hlsproxy pour éviter les erreurs CORS.
  // On force le format .m3u8 (HLS) pour maximiser la compatibilité navigateur.
  // La plupart des serveurs Xtream Codes supportent HLS pour tous les contenus.

  // Live : HLS (.m3u8) en primaire — la plupart des serveurs Xtream Codes modernes
  // ne supportent plus le `.ts` continu fiablement. HLS bénéficie aussi de la
  // resync segment-par-segment et de la gestion CDN.
  getLiveStreamUrl(creds: XtreamCredentials, streamId: number): string {
    const m3u8 = `${creds.serverUrl}/live/${creds.username}/${creds.password}/${streamId}.m3u8`;
    return `/api/hlsproxy?url=${encodeURIComponent(m3u8)}`;
  },

  // Fallback : stream MPEG-TS continu via mpegts.js — utilisé si le serveur ne
  // sert pas le live en HLS (bascule automatique sur erreur HLS fatale).
  getLiveStreamTsUrl(creds: XtreamCredentials, streamId: number): string {
    const direct = `${creds.serverUrl}/live/${creds.username}/${creds.password}/${streamId}.ts`;
    return `/api/liveproxy?url=${encodeURIComponent(direct)}`;
  },

  // Films : HLS (.m3u8) en premier — HLS.js expose correctement les pistes audio/sous-titres.
  // Fallback = fichier direct (mp4/mkv) si le serveur ne supporte pas le HLS pour ce contenu.
  getVodStreamUrl(creds: XtreamCredentials, streamId: number, _ext: string): string {
    const m3u8 = `${creds.serverUrl}/movie/${creds.username}/${creds.password}/${streamId}.m3u8`;
    return `/api/hlsproxy?url=${encodeURIComponent(m3u8)}`;
  },

  getVodDirectUrl(creds: XtreamCredentials, streamId: number, ext: string): string {
    const direct = `${creds.serverUrl}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
    return `/api/hlsproxy?url=${encodeURIComponent(direct)}`;
  },

  // Épisodes : même logique — HLS en premier, fichier direct en fallback
  getSeriesStreamUrl(creds: XtreamCredentials, episodeId: string, _ext: string): string {
    const m3u8 = `${creds.serverUrl}/series/${creds.username}/${creds.password}/${episodeId}.m3u8`;
    return `/api/hlsproxy?url=${encodeURIComponent(m3u8)}`;
  },

  getSeriesDirectUrl(creds: XtreamCredentials, episodeId: string, ext: string): string {
    const direct = `${creds.serverUrl}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
    return `/api/hlsproxy?url=${encodeURIComponent(direct)}`;
  },
};
