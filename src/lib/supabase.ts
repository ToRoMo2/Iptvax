import { createClient } from '@supabase/supabase-js';
import { isNative, isElectron } from './platform';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// En natif (Capacitor) et en Electron, l'OAuth revient par un protocole
// custom traité manuellement (deep link `com.umbra.app://` en Android,
// protocole custom `umbra://` en Electron) → flux PKCE
// (`exchangeCodeForSession`) et pas de détection auto de session dans l'URL.
// Sur le site web, on garde la config par défaut (implicit flow) —
// comportement historique strictement inchangé. Voir docs/native-port.md.
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  isNative || isElectron ? { auth: { flowType: 'pkce', detectSessionInUrl: false } } : undefined,
);
