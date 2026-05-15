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

export const xtreamService = {
  authenticate: (creds: XtreamCredentials) =>
    apiFetch<XtreamAuthResponse>(creds, {}),

  getLiveCategories: (creds: XtreamCredentials) =>
    apiFetch<LiveCategory[]>(creds, { action: 'get_live_categories' }),

  getLiveStreams: (creds: XtreamCredentials, categoryId?: string) =>
    apiFetch<LiveStream[]>(creds, {
      action: 'get_live_streams',
      ...(categoryId ? { category_id: categoryId } : {}),
    }),

  getVodCategories: (creds: XtreamCredentials) =>
    apiFetch<VodCategory[]>(creds, { action: 'get_vod_categories' }),

  getVodStreams: (creds: XtreamCredentials, categoryId?: string) =>
    apiFetch<VodStream[]>(creds, {
      action: 'get_vod_streams',
      ...(categoryId ? { category_id: categoryId } : {}),
    }),

  getSeriesCategories: (creds: XtreamCredentials) =>
    apiFetch<SeriesCategory[]>(creds, { action: 'get_series_categories' }),

  getSeries: (creds: XtreamCredentials, categoryId?: string) =>
    apiFetch<SeriesItem[]>(creds, {
      action: 'get_series',
      ...(categoryId ? { category_id: categoryId } : {}),
    }),

  getSeriesInfo: (creds: XtreamCredentials, seriesId: number) =>
    apiFetch<SeriesInfo>(creds, { action: 'get_series_info', series_id: String(seriesId) }),

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
