import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import type { User } from '@supabase/supabase-js';
import type { PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { supabase } from '../lib/supabase';
import { isNative, isElectron } from '../lib/platform';

interface SupabaseAuthContextValue {
  user: User | null;
  loading: boolean;
  /** `redirectTo` : retour OAuth web personnalisé (défaut = origin courant) —
   *  utilisé par la page d'appairage TV `/tv-link`. Ignoré en natif. */
  signInWithGoogle: (redirectTo?: string) => Promise<void>;
  signInWithApple: (redirectTo?: string) => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  authError: string | null;
}

const SupabaseAuthContext = createContext<SupabaseAuthContextValue | null>(null);

// Deep link de retour OAuth en mode natif : Supabase y renvoie après la
// connexion Google/Apple ; l'app l'intercepte via @capacitor/app (intent
// filter `com.iptvax.app` dans AndroidManifest.xml), puis échange le code
// d'autorisation contre une session. Voir docs/native-port.md.
const NATIVE_OAUTH_REDIRECT = 'com.iptvax.app://auth-callback';

// Protocole custom Electron — enregistré au niveau OS par `electron/main.cjs`
// (`app.setAsDefaultProtocolClient`). Même rôle que le deep link Android.
const ELECTRON_OAUTH_REDIRECT = 'iptvax://auth-callback';

// Lance l'OAuth en mode natif : Supabase renvoie l'URL d'autorisation (flux
// PKCE, sans redirection navigateur automatique) qu'on ouvre dans un onglet
// système. Retourne un message d'erreur, ou null si tout va bien.
async function startNativeOAuth(provider: 'google' | 'apple'): Promise<string | null> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: NATIVE_OAUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) return error.message;
  if (data?.url) await Browser.open({ url: data.url });
  return null;
}

// Variante Electron : on ouvre l'URL OAuth dans le NAVIGATEUR SYSTÈME (cookies
// Chrome/Edge, sélecteur de compte Google natif → UX cohérente avec les autres
// apps desktop). Le retour `iptvax://auth-callback?code=…` est capté par le
// main process Electron (protocole custom + single-instance lock) et forwardé
// au renderer via le pont preload (`window.electron.onAuthCallback`).
async function startElectronOAuth(provider: 'google' | 'apple'): Promise<string | null> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: ELECTRON_OAUTH_REDIRECT, skipBrowserRedirect: true },
  });
  if (error) return error.message;
  if (data?.url && window.electron) {
    const r = await window.electron.openExternal(data.url);
    if (!r.ok) return r.error ?? 'Impossible d’ouvrir le navigateur';
  }
  return null;
}

export function SupabaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Retour OAuth natif : l'app est rouverte via le deep link com.iptvax.app://
  // après la connexion Google/Apple. On extrait le code d'autorisation et on
  // l'échange contre une session (flux PKCE) → `onAuthStateChange` ci-dessus
  // prend alors le relais. Voir docs/native-port.md.
  useEffect(() => {
    if (!isNative) return;
    let handle: PluginListenerHandle | undefined;
    App.addListener('appUrlOpen', async ({ url }) => {
      if (!url.startsWith('com.iptvax.app://')) return;
      try {
        const params = new URL(url).searchParams;
        const code = params.get('code');
        const errDesc = params.get('error_description');
        if (errDesc) {
          setAuthError(errDesc);
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) setAuthError(error.message);
        }
      } catch {
        setAuthError('Échec du retour de connexion.');
      }
      Browser.close().catch(() => {/* onglet déjà fermé */});
    }).then((h) => { handle = h; });
    return () => { handle?.remove(); };
  }, []);

  // Retour OAuth Electron : le main process capte `iptvax://auth-callback?…`
  // (protocole custom + single-instance lock) et nous le relaie via le pont
  // preload. Même logique que le deep link natif Android : extraire le code,
  // l'échanger contre une session, `onAuthStateChange` prend le relais.
  useEffect(() => {
    if (!isElectron || !window.electron) return;
    const unsubscribe = window.electron.onAuthCallback(async (url) => {
      try {
        const params = new URL(url).searchParams;
        const code = params.get('code');
        const errDesc = params.get('error_description');
        if (errDesc) {
          setAuthError(errDesc);
        } else if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) setAuthError(error.message);
        }
      } catch {
        setAuthError('Échec du retour de connexion.');
      }
    });
    return unsubscribe;
  }, []);

  const signInWithGoogle = useCallback(async (redirectTo?: string) => {
    setAuthError(null);
    if (isNative) {
      const err = await startNativeOAuth('google');
      if (err) setAuthError(err);
      return;
    }
    if (isElectron) {
      const err = await startElectronOAuth('google');
      if (err) setAuthError(err);
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirectTo ?? window.location.origin },
    });
    if (error) setAuthError(error.message);
  }, []);

  const signInWithApple = useCallback(async (redirectTo?: string) => {
    setAuthError(null);
    if (isNative) {
      const err = await startNativeOAuth('apple');
      if (err) setAuthError(err);
      return;
    }
    if (isElectron) {
      const err = await startElectronOAuth('apple');
      if (err) setAuthError(err);
      return;
    }
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: redirectTo ?? window.location.origin },
    });
    if (error) setAuthError(error.message);
  }, []);

  const signInWithEmail = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  }, []);

  const signUpWithEmail = useCallback(async (email: string, password: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({ user, loading, signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail, signOut, authError }),
    [user, loading, signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail, signOut, authError],
  );

  return (
    <SupabaseAuthContext.Provider value={value}>
      {children}
    </SupabaseAuthContext.Provider>
  );
}

export function useSupabaseAuth(): SupabaseAuthContextValue {
  const ctx = useContext(SupabaseAuthContext);
  if (!ctx) throw new Error('useSupabaseAuth doit être utilisé dans SupabaseAuthProvider');
  return ctx;
}
