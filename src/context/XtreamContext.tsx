import {
  createContext,
  useContext,
  useMemo,
  useState,
  useEffect,
  useRef,
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

  // `t` dans une ref : l'effet d'auth ne doit se relancer que sur changement
  // de profil, pas à chaque changement de langue.
  const { t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  // Authentifie le profil IPTV actif (le composant est remonté via `key`
  // dans App.tsx à chaque changement de profil → re-auth automatique).
  useEffect(() => {
    let cancelled = false;
    setIsAuthenticating(true);
    setAuthError(null);

    xtreamService
      .authenticate(credentials)
      .then((response) => {
        if (cancelled) return;
        if (!response?.user_info || response.user_info.auth === 0) {
          throw new Error(tRef.current('profileSelect.badCredentials'));
        }
        setUserInfo(response.user_info);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAuthError(e instanceof Error ? e.message : tRef.current('profileSelect.connectFail'));
        setUserInfo(null);
      })
      .finally(() => {
        if (!cancelled) setIsAuthenticating(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const value = useMemo(
    () => ({
      credentials,
      userInfo,
      isAuthenticated: !!userInfo,
      isAuthenticating,
      authError,
    }),
    [credentials, userInfo, isAuthenticating, authError],
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
