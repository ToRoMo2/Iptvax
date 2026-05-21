import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import {
  LOCALES,
  type Locale,
  type TranslationKey,
  type TParams,
  translate,
  translatePlural,
  formatDate,
  LOCALE_STORAGE_KEY,
  storedLocale,
  detectBrowserLocale,
  detectCountryLocale,
} from '../i18n';

interface I18nContextValue {
  locale: Locale;
  locales: readonly Locale[];
  setLocale: (l: Locale) => void;
  /** Traduit une clé (interpolation `{var}` via `params`). */
  t: (key: TranslationKey, params?: TParams) => string;
  /** Pluriel : choisit `oneKey`/`otherKey` selon `count` (et la langue). */
  tc: (
    oneKey: TranslationKey,
    otherKey: TranslationKey,
    count: number,
    params?: TParams,
  ) => string;
  /** Date formatée selon la langue active. */
  fmtDate: (
    value: number | string | Date,
    opts?: Intl.DateTimeFormatOptions,
  ) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

const FALLBACK: Locale = 'en';

export function I18nProvider({ children }: { children: ReactNode }) {
  // Init synchrone : préférence stockée → langue navigateur → repli.
  // (le sous-tag région de `navigator.language` reflète déjà le pays).
  const [locale, setLocaleState] = useState<Locale>(
    () => storedLocale() ?? detectBrowserLocale() ?? FALLBACK,
  );

  // Auto-détection active tant que l'utilisateur n'a pas choisi explicitement
  // ET que le navigateur ne donne pas une langue supportée → la géo-IP affine.
  const [autoDetect] = useState(
    () => storedLocale() == null && detectBrowserLocale() == null,
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  // Affinage par pays (géo-IP) — uniquement si l'auto-détection n'a rien
  // donné. Strictement additif et NON bloquant : l'UI est déjà rendue dans
  // la langue de repli ; un échec est silencieux (philosophie TMDB, §IV).
  useEffect(() => {
    if (!autoDetect) return;
    let alive = true;
    detectCountryLocale().then((l) => {
      if (alive && l && storedLocale() == null) setLocaleState(l);
    });
    return () => {
      alive = false;
    };
  }, [autoDetect]);

  const setLocale = useCallback((l: Locale) => {
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, l);
    } catch {
      /* localStorage indisponible : la langue reste en mémoire pour la session */
    }
    setLocaleState(l);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      locales: LOCALES,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      tc: (oneKey, otherKey, count, params) =>
        translatePlural(locale, oneKey, otherKey, count, params),
      fmtDate: (v, opts) => formatDate(v, locale, opts),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n doit être utilisé dans I18nProvider');
  return ctx;
}
