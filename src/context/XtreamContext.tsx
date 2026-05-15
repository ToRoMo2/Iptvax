import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import type { XtreamCredentials, XtreamUserInfo } from '../types/xtream.types';
import type { IptvProfile } from '../types/profile.types';
import { xtreamService } from '../services/xtream.service';

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
  const credentials: XtreamCredentials = {
    serverUrl: profile.xtream_server_url,
    username: profile.xtream_username,
    password: profile.xtream_password,
  };

  const [userInfo, setUserInfo] = useState<XtreamUserInfo | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

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
          throw new Error('Identifiants incorrects');
        }
        setUserInfo(response.user_info);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAuthError(e instanceof Error ? e.message : 'Erreur de connexion');
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

  return (
    <XtreamContext.Provider
      value={{
        credentials,
        userInfo,
        isAuthenticated: !!userInfo,
        isAuthenticating,
        authError,
      }}
    >
      {children}
    </XtreamContext.Provider>
  );
}

export function useXtream(): XtreamContextValue {
  const ctx = useContext(XtreamContext);
  if (!ctx) throw new Error('useXtream doit être utilisé dans XtreamProvider');
  return ctx;
}
