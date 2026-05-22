import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.iptvax.app',
  appName: 'Iptvax',
  webDir: 'dist',
  android: {
    // Le WebView sert l'app en https://localhost. Les serveurs d'images IPTV
    // (covers Xtream) sont souvent en HTTP simple → sans ça, ces images sont
    // bloquées comme « contenu mixte ». Voir docs/native-port.md.
    allowMixedContent: true,
  },
};

export default config;
