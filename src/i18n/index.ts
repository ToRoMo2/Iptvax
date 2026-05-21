import fr from './locales/fr';
import en from './locales/en';
import es from './locales/es';

// ── Locales ──────────────────────────────────────────────────────────────────
export const LOCALES = ['fr', 'en', 'es'] as const;
export type Locale = (typeof LOCALES)[number];

/** Nom natif affiché dans le sélecteur de langue. */
export const LOCALE_NAMES: Record<Locale, string> = {
  fr: 'Français',
  en: 'English',
  es: 'Español',
};

/** Le français est la source de vérité : `en`/`es` sont typés sur sa forme,
 *  donc une clé manquante dans une traduction = erreur TypeScript (build). */
export type TranslationSchema = typeof fr;

const DICTIONARIES: Record<Locale, TranslationSchema> = { fr, en, es };

/** Chemins pointés vers les feuilles `string` du schéma (clés de `t()`).
 *  Profondeur capée à 4 pour éviter TS2589 (union template-literal explose
 *  rapidement avec ~400 clés + récursion non bornée). */
type Prev = [never, 0, 1, 2, 3, 4];
type Leaves<T, D extends number = 4> = [D] extends [never]
  ? never
  : {
      [K in keyof T]: T[K] extends string
        ? `${K & string}`
        : `${K & string}.${Leaves<T[K], Prev[D]> & string}`;
    }[keyof T];

export type TranslationKey = Leaves<TranslationSchema>;
export type TParams = Record<string, string | number>;

const FALLBACK: Locale = 'en';

function resolve(dict: TranslationSchema, key: string): string {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return '';
    }
  }
  return typeof cur === 'string' ? cur : '';
}

function interpolate(tpl: string, params?: TParams): string {
  if (!params) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) =>
    k in params ? String(params[k]) : m,
  );
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TParams,
): string {
  let raw = resolve(DICTIONARIES[locale] ?? DICTIONARIES[FALLBACK], key);
  if (!raw && locale !== FALLBACK) raw = resolve(DICTIONARIES[FALLBACK], key);
  if (!raw) raw = resolve(DICTIONARIES.fr, key);
  return interpolate(raw || key, params);
}

/** Le français garde le singulier pour 0 et 1 ; anglais/espagnol : pluriel
 *  dès que ≠ 1 (y compris 0). */
function isPlural(locale: Locale, count: number): boolean {
  return locale === 'fr' ? count > 1 : count !== 1;
}

export function translatePlural(
  locale: Locale,
  oneKey: TranslationKey,
  otherKey: TranslationKey,
  count: number,
  params?: TParams,
): string {
  const key = isPlural(locale, count) ? otherKey : oneKey;
  return translate(locale, key, { count, ...params });
}

const INTL_LOCALE: Record<Locale, string> = {
  fr: 'fr-FR',
  en: 'en-US',
  es: 'es-ES',
};

export function formatDate(
  value: number | string | Date,
  locale: Locale,
  opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  },
): string {
  return new Date(value).toLocaleDateString(INTL_LOCALE[locale], opts);
}

// ── Détection automatique ────────────────────────────────────────────────────
export const LOCALE_STORAGE_KEY = 'iptv:locale';

function asSupported(tag: string | undefined | null): Locale | null {
  if (!tag) return null;
  const base = tag.toLowerCase().split('-')[0];
  return (LOCALES as readonly string[]).includes(base)
    ? (base as Locale)
    : null;
}

export function storedLocale(): Locale | null {
  try {
    return asSupported(localStorage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Langue du navigateur/OS. Le sous-tag région (`fr-FR`, `es-MX`) reflète
 *  déjà le pays de l'utilisateur — détection instantanée, sans réseau. */
export function detectBrowserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  const langs =
    navigator.languages && navigator.languages.length
      ? navigator.languages
      : [navigator.language];
  for (const l of langs) {
    const m = asSupported(l);
    if (m) return m;
  }
  return null;
}

/** Pays → langue (repli quand la langue navigateur n'est pas supportée). */
const COUNTRY_LOCALE: Record<string, Locale> = {
  // Francophonie
  FR: 'fr', BE: 'fr', LU: 'fr', MC: 'fr', CH: 'fr',
  CI: 'fr', SN: 'fr', CM: 'fr', ML: 'fr', CD: 'fr',
  MG: 'fr', DZ: 'fr', MA: 'fr', TN: 'fr', BF: 'fr',
  // Hispanophonie
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es',
  PE: 'es', VE: 'es', EC: 'es', GT: 'es', CU: 'es',
  BO: 'es', DO: 'es', HN: 'es', PY: 'es', SV: 'es',
  NI: 'es', CR: 'es', PA: 'es', UY: 'es', PR: 'es',
};

/**
 * Géolocalisation IP — repli quand ni la préférence stockée ni la langue
 * navigateur ne donnent une langue supportée. Strictement additif et JAMAIS
 * bloquant (échec silencieux, l'UI est déjà rendue avec la langue détectée) —
 * même philosophie que l'enrichissement TMDB (CLAUDE.md §IV).
 */
export async function detectCountryLocale(): Promise<Locale | null> {
  try {
    const res = await fetch('https://get.geojs.io/v1/ip/country.json', {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { country?: string };
    const cc = data.country?.toUpperCase();
    return cc ? COUNTRY_LOCALE[cc] ?? null : null;
  } catch {
    return null;
  }
}
