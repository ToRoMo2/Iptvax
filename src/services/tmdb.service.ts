import type {
  TmdbEnrichment,
  TmdbCastMember,
  TmdbEpisodeStills,
  TmdbTrendingItem,
  TmdbTrailer,
} from '../types/tmdb.types';

/**
 * Enrichissement métadonnées via The Movie Database (TMDB).
 *
 * Orthogonal au proxy média `/api/*` : appels HTTP directs depuis le frontend
 * (l'API TMDB v3 expose le CORS), au même titre que le SDK Supabase. Aucune
 * route `/api/*` ajoutée → le proxy reste sans état.
 *
 * Dégradation gracieuse TOTALE : sans `VITE_TMDB_API_KEY` ou en cas d'erreur
 * réseau, chaque méthode renvoie `null` / `{}` → l'UI retombe sur les données
 * Xtream sans régression ni `console.error`.
 *
 * Couche `services/` : importe uniquement `types/`.
 */

const API_KEY = (import.meta.env.VITE_TMDB_API_KEY as string | undefined)?.trim() || '';
const BASE = 'https://api.themoviedb.org/3';
const IMG = 'https://image.tmdb.org/t/p';

// Interrupteur runtime : TMDB est une fonctionnalité Premium. Le
// SubscriptionContext appelle `setEnabled(isPremium)`. Coupé → mêmes
// renvois null/{} que sans clé API → l'UI retombe sur Xtream (§IV).
let enabled = true;

/** TMDB exploitable : clé présente ET activé (Premium). */
function active(): boolean {
  return Boolean(API_KEY) && enabled;
}

const BACKDROP_SIZE = 'w1280';
const POSTER_SIZE = 'w500';
const PROFILE_SIZE = 'w185';
const STILL_SIZE = 'w300';
const MAX_CAST = 12;
const TIMEOUT_MS = 6000;

function img(path: string | null | undefined, size: string): string | undefined {
  return path ? `${IMG}/${size}${path}` : undefined;
}

// Cache mémoire (session) — partage aussi les requêtes concurrentes via la
// Promise. Inclut les résultats null pour éviter de re-marteler une absence.
const cache = new Map<string, Promise<unknown>>();

async function tmdbGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  if (!active()) return null;
  const search = new URLSearchParams({ api_key: API_KEY, ...params });
  try {
    const res = await fetch(`${BASE}${path}?${search}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function cached<T>(key: string, producer: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = producer().catch(() => null as T);
  cache.set(key, p as Promise<unknown>);
  return p;
}

interface TmdbSearchResult {
  id: number;
  release_date?: string;
  first_air_date?: string;
}
interface TmdbSearchResponse {
  results?: TmdbSearchResult[];
}
interface TmdbCredits {
  cast?: Array<{ name: string; character?: string; profile_path?: string | null; order?: number }>;
}
interface TmdbImage {
  file_path: string;
  iso_639_1: string | null;
  vote_average?: number;
}
interface TmdbDetails {
  id: number;
  overview?: string;
  vote_average?: number;
  backdrop_path?: string | null;
  poster_path?: string | null;
  credits?: TmdbCredits;
  images?: { backdrops?: TmdbImage[] };
}
interface TmdbSeasonResponse {
  episodes?: Array<{ episode_number: number; still_path?: string | null }>;
}
interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official?: boolean;
}
interface TmdbVideosResponse {
  results?: TmdbVideo[];
}
interface TmdbDetailsWithVideos extends TmdbDetails {
  videos?: TmdbVideosResponse;
}

// Choisit la meilleure vidéo YouTube : bande-annonce officielle > teaser > clip.
function pickYoutube(vids: TmdbVideo[] | undefined): string | undefined {
  const yt = (vids ?? []).filter((v) => v.site === 'YouTube' && v.key);
  if (yt.length === 0) return undefined;
  const rank = (v: TmdbVideo) => {
    const t = v.type === 'Trailer' ? 0 : v.type === 'Teaser' ? 1 : v.type === 'Clip' ? 2 : 3;
    return t * 2 + (v.official ? 0 : 1);
  };
  return [...yt].sort((a, b) => rank(a) - rank(b))[0].key;
}
interface TmdbTrendingRaw {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
}
interface TmdbTrendingResponse {
  results?: TmdbTrendingRaw[];
}

function mapCast(credits: TmdbCredits | undefined): TmdbCastMember[] {
  const list = credits?.cast ?? [];
  return [...list]
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, MAX_CAST)
    .map((c) => ({
      name: c.name,
      character: c.character?.trim() || 'Acteur',
      profile: img(c.profile_path, PROFILE_SIZE),
    }));
}

const MAX_BACKDROPS = 12;

function mapBackdrops(d: TmdbDetails): string[] {
  const list = d.images?.backdrops ?? [];
  const ordered = [...list].sort((a, b) => {
    // Sans texte (iso_639_1 null) d'abord → plus cinématographique,
    // puis par note décroissante.
    const at = a.iso_639_1 === null ? 0 : 1;
    const bt = b.iso_639_1 === null ? 0 : 1;
    if (at !== bt) return at - bt;
    return (b.vote_average ?? 0) - (a.vote_average ?? 0);
  });
  const urls = ordered
    .map((b) => img(b.file_path, BACKDROP_SIZE))
    .filter((u): u is string => Boolean(u))
    .slice(0, MAX_BACKDROPS);
  // Repli : le backdrop principal des détails si la galerie est vide.
  if (urls.length === 0) {
    const main = img(d.backdrop_path, BACKDROP_SIZE);
    if (main) urls.push(main);
  }
  return urls;
}

function buildEnrichment(d: TmdbDetails): TmdbEnrichment {
  const backdrops = mapBackdrops(d);
  return {
    tmdbId: d.id,
    backdrop: backdrops[0],
    backdrops,
    poster: img(d.poster_path, POSTER_SIZE),
    rating: d.vote_average && d.vote_average > 0 ? Math.round(d.vote_average * 10) / 10 : undefined,
    overview: d.overview?.trim() || undefined,
    cast: mapCast(d.credits),
  };
}

async function enrich(
  kind: 'movie' | 'tv',
  title: string,
  year: string | undefined,
): Promise<TmdbEnrichment | null> {
  const q = title.trim();
  if (!active() || !q) return null;

  return cached(`enrich:${kind}:${q.toLowerCase()}:${year ?? ''}`, async () => {
    const yearParam = kind === 'movie' ? 'year' : 'first_air_date_year';
    const search = await tmdbGet<TmdbSearchResponse>(`/search/${kind}`, {
      query: q,
      language: 'fr-FR',
      include_adult: 'false',
      ...(year ? { [yearParam]: year } : {}),
    });
    let best = search?.results?.[0];
    // Réessai sans année si rien trouvé (année Xtream parfois erronée).
    if (!best && year) {
      const retry = await tmdbGet<TmdbSearchResponse>(`/search/${kind}`, {
        query: q,
        language: 'fr-FR',
        include_adult: 'false',
      });
      best = retry?.results?.[0];
    }
    if (!best) return null;

    const details = await tmdbGet<TmdbDetails>(`/${kind}/${best.id}`, {
      language: 'fr-FR',
      append_to_response: 'credits,images',
      include_image_language: 'fr,en,null',
    });
    if (!details) return null;

    const result = buildEnrichment(details);
    // Synopsis FR vide → repli sur la version anglaise.
    if (!result.overview) {
      const en = await tmdbGet<TmdbDetails>(`/${kind}/${best.id}`, { language: 'en-US' });
      if (en?.overview?.trim()) result.overview = en.overview.trim();
    }
    return result;
  });
}

export const tmdbService = {
  /** TMDB activable uniquement si une clé API est présente. */
  isEnabled(): boolean {
    return active();
  },

  /** Bascule Premium : coupe/active l'enrichissement à chaud. */
  setEnabled(v: boolean): void {
    enabled = v;
  },

  enrichMovie(title: string, year?: string): Promise<TmdbEnrichment | null> {
    return enrich('movie', title, year);
  },

  enrichSeries(title: string, year?: string): Promise<TmdbEnrichment | null> {
    return enrich('tv', title, year);
  },

  /**
   * Tendances de la semaine (films ou séries). Filtré aux entrées disposant
   * d'un backdrop (le hero a besoin d'une image paysage). `[]` si désactivé.
   */
  getTrending(kind: 'movie' | 'tv'): Promise<TmdbTrendingItem[]> {
    if (!active()) return Promise.resolve([]);
    return cached(`trending:${kind}`, async () => {
      const res = await tmdbGet<TmdbTrendingResponse>(`/trending/${kind}/week`, {
        language: 'fr-FR',
      });
      const out: TmdbTrendingItem[] = [];
      for (const r of res?.results ?? []) {
        const backdrop = img(r.backdrop_path, BACKDROP_SIZE);
        if (!backdrop) continue;
        const date = r.release_date || r.first_air_date;
        out.push({
          tmdbId: r.id,
          title: (r.title || r.name || '').trim(),
          year: date ? date.slice(0, 4) : undefined,
          backdrop,
          overview: r.overview?.trim() || undefined,
          rating: r.vote_average && r.vote_average > 0 ? Math.round(r.vote_average * 10) / 10 : undefined,
        });
      }
      return out;
    });
  },

  /**
   * Bande-annonce YouTube + synopsis, résolus à la demande (survol carte).
   * Strictement additif et non bloquant : clé absente / aucun trailer → null,
   * l'aperçu retombe sur le poster + synopsis Xtream. Mis en cache par titre.
   */
  getTrailer(
    kind: 'movie' | 'tv',
    title: string,
    year?: string,
  ): Promise<TmdbTrailer | null> {
    const q = title.trim();
    if (!active() || !q) return Promise.resolve(null);

    return cached(`trailer:${kind}:${q.toLowerCase()}:${year ?? ''}`, async () => {
      const yearParam = kind === 'movie' ? 'year' : 'first_air_date_year';
      const search = await tmdbGet<TmdbSearchResponse>(`/search/${kind}`, {
        query: q,
        language: 'fr-FR',
        include_adult: 'false',
        ...(year ? { [yearParam]: year } : {}),
      });
      let best = search?.results?.[0];
      if (!best && year) {
        const retry = await tmdbGet<TmdbSearchResponse>(`/search/${kind}`, {
          query: q,
          language: 'fr-FR',
          include_adult: 'false',
        });
        best = retry?.results?.[0];
      }
      if (!best) return null;

      const fr = await tmdbGet<TmdbDetailsWithVideos>(`/${kind}/${best.id}`, {
        language: 'fr-FR',
        append_to_response: 'videos',
      });
      let key = pickYoutube(fr?.videos?.results);
      // Beaucoup de titres n'ont pas de bande-annonce FR → repli vidéos EN.
      if (!key) {
        const en = await tmdbGet<TmdbVideosResponse>(`/${kind}/${best.id}/videos`, {
          language: 'en-US',
        });
        key = pickYoutube(en?.results);
      }
      if (!key) return null;

      let overview = fr?.overview?.trim() || undefined;
      if (!overview) {
        const en = await tmdbGet<TmdbDetails>(`/${kind}/${best.id}`, { language: 'en-US' });
        overview = en?.overview?.trim() || undefined;
      }
      return { youtubeKey: key, overview };
    });
  },

  /** Vignettes d'épisodes (still) d'une saison TMDB : `episode_num` → URL. */
  getEpisodeStills(tmdbId: number, seasonNumber: number): Promise<TmdbEpisodeStills> {
    if (!active()) return Promise.resolve({});
    return cached(`stills:${tmdbId}:${seasonNumber}`, async () => {
      const season = await tmdbGet<TmdbSeasonResponse>(
        `/tv/${tmdbId}/season/${seasonNumber}`,
        { language: 'fr-FR' },
      );
      const out: TmdbEpisodeStills = {};
      for (const ep of season?.episodes ?? []) {
        const url = img(ep.still_path, STILL_SIZE);
        if (url) out[ep.episode_number] = url;
      }
      return out;
    });
  },
};
