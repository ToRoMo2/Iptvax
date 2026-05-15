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
import { supabase } from '../lib/supabase';

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

interface XtreamProviderProps {
  children: ReactNode;
  userId: string;
}

export function XtreamProvider({ children, userId }: XtreamProviderProps) {
  const [credentials, setCredentials] = useState<XtreamCredentials | null>(null);
  const [userInfo, setUserInfo] = useState<XtreamUserInfo | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(true);
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur de connexion';
      setAuthError(msg);
      throw new Error(msg);
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  // Au démarrage : charge les credentials Xtream depuis le profil Supabase
  useEffect(() => {
    async function loadFromProfile() {
      const { data } = await supabase
        .from('profiles')
        .select('xtream_server_url, xtream_username, xtream_password')
        .eq('id', userId)
        .single();

      if (data?.xtream_server_url && data.xtream_username && data.xtream_password) {
        const creds: XtreamCredentials = {
          serverUrl: data.xtream_server_url as string,
          username: data.xtream_username as string,
          password: data.xtream_password as string,
        };
        await authenticate(creds).catch(() => {
          // Credentials invalides (abonnement expiré, serveur down…)
          setIsAuthenticating(false);
        });
      } else {
        setIsAuthenticating(false);
      }
    }

    void loadFromProfile();
  }, [userId, authenticate]);

  const login = useCallback(
    async (creds: XtreamCredentials) => {
      await authenticate(creds);
      // Sauvegarde dans le profil Supabase pour la reconnexion cross-device
      await supabase.from('profiles').update({
        xtream_server_url: creds.serverUrl,
        xtream_username: creds.username,
        xtream_password: creds.password,
      }).eq('id', userId);
    },
    [authenticate, userId],
  );

  const logout = useCallback(() => {
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
