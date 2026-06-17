import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iptvax.app',
  appName: 'Iptvax',
  webDir: 'dist',
  server: {
    // La WebView sert l'app en http://localhost (et non https://). Raison :
    // les serveurs d'images IPTV (covers Xtream, picons) sont en HTTP simple.
    // En https://localhost ce sont des ressources « mixed content » → la WebView
    // Amazon (Fire TV) les BLOQUE malgré `allowMixedContent` (plus stricte que
    // la WebView Android standard). En http://localhost, les images http:// sont
    // au même schéma → plus aucun blocage. http://localhost reste un « secure
    // context » Chromium → Supabase PKCE / crypto.subtle fonctionnent.
    // Voir docs/native-port.md (Phase 2d — Fire TV).
    androidScheme: 'http',
  },
  android: {
    // Filet additionnel (WebView Android standard) : autorise le contenu mixte
    // résiduel. Le vrai correctif Fire TV est `androidScheme: 'http'` ci-dessus.
    allowMixedContent: true,
  },
};

export default config;
