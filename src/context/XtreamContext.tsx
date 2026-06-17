import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from 'react';
import type { XtreamCredentials, XtreamUserInfo } from '../types/xtream.types';
import type { IptvProfile } from '../types/profile.types';
import { xtreamService } from '../services/xtream.service';
import { useI18n } from '../contexts/I18nContext';

interface XtreamContextValue {
  credentials: XtreamCredentials | null;
  userInfo: XtreamUserInfo | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  retryAuth: () => void;
}

const XtreamContext = createContext<XtreamContextValue | null>(null);

interface XtreamProviderProps {
  children: ReactNode;
  profile: IptvProfile;
}

export function XtreamProvider({ children, profile }: XtreamProviderProps) {
  // Identité stable : `credentials` est une dépendance de `useEffect` dans les
  // pages consommatrices (Movies, Series, Live…). Un nouvel objet à chaque
  // rendu du provider re-déclencherait inutilement leurs fetchs catalogue.
  const credentials: XtreamCredentials = useMemo(
    () => ({
      serverUrl: profile.xtream_server_url,
      username: profile.xtream_username,
      password: profile.xtream_password,
    }),
    [profile.xtream_server_url, profile.xtream_username, profile.xtream_password],
  );

  const [userInfo, setUserInfo] = useState<XtreamUserInfo | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // Incrémenté par retryAuth() → re-déclenche l'effet d'authentification.
  const [retryCount, setRetryCount] = useState(0);

  // `t` dans une ref : l'effet d'auth ne doit se relancer que sur changement
  // de profil, pas à chaque changement de langue.
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const retryAuth = useCallback(() => setRetryCount((n) => n + 1), []);

  // Authentifie le profil IPTV actif (le composant est remonté via `key`
  // dans App.tsx à chaque changement de profil → re-auth automatique).
  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    setIsAuthenticating(true);
    setAuthError(null);

    // Tentative d'authentification avec auto-retry unique pour les erreurs
    // transitoires (5xx serveur, réseau coupé). Les erreurs 4xx et le rejet
    // auth=0 ne sont PAS retentées (identifiants incorrects = pas transitoire).
    // Préchauffage catalogue : on lance les 3 gros fetchs catalogue EN PARALLÈLE
    // de l'authentification. L'auth Xtream est souvent le maillon lent (serveur
    // fournisseur surchargé/distant) ; le téléchargement du catalogue et l'auth
    // se RECOUVRENT alors au lieu de s'enchaîner. Quand l'auth aboutit et que
    // Home se monte, ces Promises sont déjà en vol / résolues et mises en cache
    // → les appels identiques de Home (get*Streams) tapent le cache au lieu de
    // relancer un aller-retour réseau après l'auth. Fire-and-forget : un échec
    // s'évince tout seul du cache (cf. cachedFetch) et les pages re-déclencheront
    // / afficheront l'erreur réelle. Idempotent : si le catalogue est déjà chaud
    // (re-montage), ces appels renvoient la Promise en cache sans requête.
    void xtreamService.getLiveStreams(credentials).catch(() => {});
    void xtreamService.getVodStreams(credentials).catch(() => {});
    void xtreamService.getSeries(credentials).catch(() => {});

    const attempt = (internalAttempt: number) => {
      xtreamService
        .authenticate(credentials)
        .then((response) => {
          if (cancelled) return;
          if (!response?.user_info || response.user_info.auth === 0) {
            // Marqueur stable — localisé uniquement à l'affichage.
            throw new Error('auth:rejected');
          }
          setUserInfo(response.user_info);
          setIsAuthenticating(false);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          const msg = e instanceof Error ? e.message : '';
          // HTTP 4xx ou rejet auth=0 → ne pas réessayer automatiquement.
          const isTransient = msg !== 'auth:rejected' && !/^HTTP [34]\d\d$/.test(msg);
          if (internalAttempt === 0 && isTransient) {
            // Auto-retry silencieux après 3 s — reste sur l'écran "Connexion…"
            retryTimer = setTimeout(() => {
              if (!cancelled) attempt(1);
            }, 3_000);
            return;
          }
          const display =
            msg === 'auth:rejected'
              ? tRef.current('profileSelect.badCredentials')
              : msg || tRef.current('profileSelect.connectFail');
          setAuthError(display);
          setUserInfo(null);
          setIsAuthenticating(false);
        });
    };

    attempt(0);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id, retryCount]);

  const value = useMemo(
    () => ({
      credentials,
      userInfo,
      isAuthenticated: !!userInfo,
      isAuthenticating,
      authError,
      retryAuth,
    }),
    [credentials, userInfo, isAuthenticating, authError, retryAuth],
  );

  return (
    <XtreamContext.Provider value={value}>
      {children}
    </XtreamContext.Provider>
  );
}

export function useXtream(): XtreamContextValue {
  const ctx = useContext(XtreamContext);
  if (!ctx) throw new Error('useXtream doit être utilisé dans XtreamProvider');
  return ctx;
}
