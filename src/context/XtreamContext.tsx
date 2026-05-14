import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import type { XtreamCredentials, XtreamUserInfo } from '../types/xtream.types';
import { xtreamService } from '../services/xtream.service';
import { storageService } from '../services/storage.service';

interface XtreamContextValue {
  credentials: XtreamCredentials | null;
  userInfo: XtreamUserInfo | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  login: (creds: XtreamCredentials) => Promise<void>;
  logout: () => void;
}

const XtreamContext = createContext<XtreamContextValue | null>(null);

export function XtreamProvider({ children }: { children: ReactNode }) {
  const savedCreds = storageService.getCredentials();

  const [credentials, setCredentials] = useState<XtreamCredentials | null>(savedCreds);
  const [userInfo, setUserInfo] = useState<XtreamUserInfo | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(!!savedCreds);
  const [authError, setAuthError] = useState<string | null>(null);

  const authenticate = useCallback(async (creds: XtreamCredentials): Promise<void> => {
    setIsAuthenticating(true);
    setAuthError(null);
    try {
      const response = await xtreamService.authenticate(creds);
      if (!response?.user_info || response.user_info.auth === 0) {
        throw new Error('Identifiants incorrects');
      }
      setUserInfo(response.user_info);
      setCredentials(creds);
      storageService.saveCredentials(creds);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur de connexion';
      setAuthError(msg);
      throw new Error(msg);
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  // Ré-authentification automatique au démarrage si credentials sauvegardés
  useEffect(() => {
    if (!savedCreds) return;
    authenticate(savedCreds).catch(() => {
      setCredentials(null);
      storageService.clearCredentials();
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    (creds: XtreamCredentials) => authenticate(creds),
    [authenticate],
  );

  const logout = useCallback(() => {
    storageService.clearCredentials();
    setCredentials(null);
    setUserInfo(null);
    setAuthError(null);
  }, []);

  return (
    <XtreamContext.Provider
      value={{
        credentials,
        userInfo,
        isAuthenticated: !!userInfo,
        isAuthenticating,
        authError,
        login,
        logout,
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
