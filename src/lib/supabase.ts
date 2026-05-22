import { createClient } from '@supabase/supabase-js';
import { isNative } from './platform';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// En natif, l'OAuth revient par un deep link (com.iptvax.app://) traité
// manuellement → flux PKCE (`exchangeCodeForSession`) et pas de détection
// automatique de session dans l'URL du WebView. En web, on garde la config
// par défaut — comportement historique strictement inchangé.
// Voir docs/native-port.md.
export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  isNative ? { auth: { flowType: 'pkce', detectSessionInUrl: false } } : undefined,
);
