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
import { isNative, isCapacitor } from '../lib/platform';
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
// `value` : snapshot SYNCHRONE de la donnée une fois la Promise résolue. Les
// pages (Movies/Series/Live) se démontent à chaque navigation puis se remontent
// avec `loading=true` + état vide → même quand la Promise est en cache, elles
// re-rendent un squelette le temps qu'elle re-résolve sur une microtask
// (flash visible). En exposant la valeur résolue de façon synchrone (`peek*`),
// la page peut SEED son état initial → aucun squelette sur cache chaud.
interface CacheEntry { at: number; data: Promise<unknown>; value?: unknown; }
const catalogCache = new Map<string, CacheEntry>();
const CATALOG_TTL = 10 * 60_000; // 10 min — catalogue stable sur une session
const EPG_TTL = 60_000;          // 1 min — le « en cours » doit rester frais

function cacheKey(creds: XtreamCredentials, params: Record<string, string>): string {
  return `${creds.serverUrl}|${new URLSearchParams(params).toString()}`;
}

function cachedFetch<T>(
  creds: XtreamCredentials,
  params: Record<string, string>,
  ttl: number,
): Promise<T> {
  const key = cacheKey(creds, params);
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data as Promise<T>;

  const entry: CacheEntry = { at: Date.now(), data: Promise.resolve() };
  entry.data = apiFetch<T>(creds, params)
    .then((v) => {
      entry.value = v; // snapshot synchrone pour peekCatalog
      return v;
    })
    .catch((err) => {
      // Ne pas mémoriser un échec : le prochain appel doit pouvoir réessayer.
      if (catalogCache.get(key) === entry) catalogCache.delete(key);
      throw err;
    });
  catalogCache.set(key, entry);
  return entry.data as Promise<T>;
}

// Lecture SYNCHRONE de la donnée déjà résolue (null si absente ou TTL expiré).
// Sert à seeder l'état initial des pages catalogue → pas de squelette au retour.
function peekCatalog<T>(
  creds: XtreamCredentials,
  params: Record<string, string>,
  ttl = CATALOG_TTL,
): T | null {
  const hit = catalogCache.get(cacheKey(creds, params));
  if (hit && hit.value !== undefined && Date.now() - hit.at < ttl) return hit.value as T;
  return null;
}

/** Vide le cache catalogue (changement de profil/serveur, pull-to-refresh). */
function clearCatalogCache(): void {
  catalogCache.clear();
}

// ─── Chargement par catégorie (anti-OOM appareils faibles RAM) ─────────────
// Un `get_vod_streams` / `get_series` GLOBAL renvoie UNE réponse énorme (≈36 Mo
// sur un gros provider) → CapacitorHttp + le bridge Capacitor doivent allouer
// cette chaîne d'un seul bloc côté natif (Java), ce qui fait OOM les box 1 Go
// (Fire TV Stick Lite : « Failed to allocate a 37748744 byte allocation »,
// tas Dalvik plafonné à 256 Mo même avec largeHeap). On reconstruit donc le
// catalogue complet en BOUCLANT sur les catégories : chaque réponse filtrée par
// `category_id` est petite → aucune allocation géante, aucun gonflement du
// bridge. Le tableau assemblé vit côté V8 (qui n'était pas le point d'OOM).
//
// - Sous-requêtes via `apiFetch` (PAS `cachedFetch`) → chaque réponse de
//   catégorie est GC'able après concat : on ne retient QUE le tableau assemblé
//   (sinon on garderait en RAM le catalogue complet DEUX fois : par catégorie
//   + assemblé). Les pages catégorie (`getVodStreams(creds, catId)`) refetchent
//   à la demande (petit, rapide).
// - Caché sous la MÊME clé que le fetch global → `peek*` et tous les callers
//   restent transparents (ils reçoivent le tableau complet, comme avant).
// - Réservé à Capacitor (cible Fire TV). Web (proxy + serveur costaud) et les
//   autres shells gardent le fetch global d'un bloc, comportement inchangé.
function getFullCatalogByCategory<T>(
  creds: XtreamCredentials,
  streamAction: string,
  categoryAction: string,
): Promise<T[]> {
  const fullParams = { action: streamAction };
  const key = cacheKey(creds, fullParams);
  const hit = catalogCache.get(key);
  if (hit && Date.now() - hit.at < CATALOG_TTL) return hit.data as Promise<T[]>;

  const entry: CacheEntry = { at: Date.now(), data: Promise.resolve() };
  entry.data = (async () => {
    const cats = await cachedFetch<{ category_id: string }[]>(
      creds,
      { action: categoryAction },
      CATALOG_TTL,
    );
    // Pas de catégories exploitables → repli sur le fetch global d'un bloc
    // (mieux vaut risquer le gros fetch que de ne rien charger du tout).
    if (!Array.isArray(cats) || cats.length === 0) {
      return apiFetch<T[]>(creds, fullParams);
    }
    const out: T[] = [];
    const CONCURRENCY = 4; // borne le nombre de réponses simultanées en RAM
    let idx = 0;
    const worker = async (): Promise<void> => {
      while (idx < cats.length) {
        const cat = cats[idx++];
        try {
          const items = await apiFetch<T[]>(creds, {
            action: streamAction,
            category_id: cat.category_id,
          });
          // Boucle (pas `push(...items)`) : un spread d'un grand tableau dépasse
          // la limite d'arguments → RangeError. Le sous-tableau est libéré après.
          if (Array.isArray(items)) for (const it of items) out.push(it);
        } catch {
          // Une catégorie en échec ne doit pas faire échouer tout le catalogue.
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, cats.length) }, worker),
    );
    return out;
  })()
    .then((v) => {
      entry.value = v; // snapshot synchrone pour peekCatalog
      return v;
    })
    .catch((err) => {
      if (catalogCache.get(key) === entry) catalogCache.delete(key);
      throw err;
    });
  catalogCache.set(key, entry);
  return entry.data as Promise<T[]>;
}

export const xtreamService = {
  clearCatalogCache,

  authenticate: (creds: XtreamCredentials) =>
    apiFetch<XtreamAuthResponse>(creds, {}),

  getLiveCategories: (creds: XtreamCredentials) =>
    cachedFetch<LiveCategory[]>(creds, { action: 'get_live_categories' }, CATALOG_TTL),

  getLiveStreams: (creds: XtreamCredentials, categoryId?: string) =>
    categoryId
      ? cachedFetch<LiveStream[]>(creds, { action: 'get_live_streams', category_id: categoryId }, CATALOG_TTL)
      : isCapacitor
        ? getFullCatalogByCategory<LiveStream>(creds, 'get_live_streams', 'get_live_categories')
        : cachedFetch<LiveStream[]>(creds, { action: 'get_live_streams' }, CATALOG_TTL),

  getVodCategories: (creds: XtreamCredentials) =>
    cachedFetch<VodCategory[]>(creds, { action: 'get_vod_categories' }, CATALOG_TTL),

  getVodStreams: (creds: XtreamCredentials, categoryId?: string) =>
    categoryId
      ? cachedFetch<VodStream[]>(creds, { action: 'get_vod_streams', category_id: categoryId }, CATALOG_TTL)
      : isCapacitor
        ? getFullCatalogByCategory<VodStream>(creds, 'get_vod_streams', 'get_vod_categories')
        : cachedFetch<VodStream[]>(creds, { action: 'get_vod_streams' }, CATALOG_TTL),

  getSeriesCategories: (creds: XtreamCredentials) =>
    cachedFetch<SeriesCategory[]>(creds, { action: 'get_series_categories' }, CATALOG_TTL),

  getSeries: (creds: XtreamCredentials, categoryId?: string) =>
    categoryId
      ? cachedFetch<SeriesItem[]>(creds, { action: 'get_series', category_id: categoryId }, CATALOG_TTL)
      : isCapacitor
        ? getFullCatalogByCategory<SeriesItem>(creds, 'get_series', 'get_series_categories')
        : cachedFetch<SeriesItem[]>(creds, { action: 'get_series' }, CATALOG_TTL),

  // ─── Snapshots synchrones (seed de l'état initial des pages catalogue) ────
  // Mêmes params que les `get*` du catalogue COMPLET (sans category_id) → la clé
  // de cache coïncide. Renvoie null si rien en cache ou TTL expiré → la page
  // affiche son squelette et lance le fetch normal (premier chargement / froid).
  peekLiveCategories: (creds: XtreamCredentials) =>
    peekCatalog<LiveCategory[]>(creds, { action: 'get_live_categories' }),
  peekLiveStreams: (creds: XtreamCredentials) =>
    peekCatalog<LiveStream[]>(creds, { action: 'get_live_streams' }),
  peekVodCategories: (creds: XtreamCredentials) =>
    peekCatalog<VodCategory[]>(creds, { action: 'get_vod_categories' }),
  peekVodStreams: (creds: XtreamCredentials) =>
    peekCatalog<VodStream[]>(creds, { action: 'get_vod_streams' }),
  peekSeriesCategories: (creds: XtreamCredentials) =>
    peekCatalog<SeriesCategory[]>(creds, { action: 'get_series_categories' }),
  peekSeries: (creds: XtreamCredentials) =>
    peekCatalog<SeriesItem[]>(creds, { action: 'get_series' }),

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

  // ─── URLs UPSTREAM brutes (téléchargement hors-ligne) ────────────────────
  // Toujours l'URL DIRECTE du serveur Xtream, jamais l'enveloppe proxy `/api/*`,
  // quel que soit le runtime. Le moteur de téléchargement (Electron main /
  // plugin Android) la récupère depuis l'IP de l'appareil (pas de blocage d'IP
  // datacenter) et écrit le fichier complet sur le disque. Voir
  // src/services/downloads/ + CLAUDE.md §XI (téléchargements).
  rawMovieUrl(creds: XtreamCredentials, streamId: number, ext: string): string {
    return `${normalizeServer(creds.serverUrl)}/movie/${creds.username}/${creds.password}/${streamId}.${ext}`;
  },

  rawSeriesUrl(creds: XtreamCredentials, episodeId: string, ext: string): string {
    return `${normalizeServer(creds.serverUrl)}/series/${creds.username}/${creds.password}/${episodeId}.${ext}`;
  },
};
