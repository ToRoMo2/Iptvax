// Preload Electron — intentionnellement vide.
//
// L'app reste 100 % web : elle parle au proxy local via fetch normal sur
// http://127.0.0.1:<port>/api/*. Aucun pont natif n'est nécessaire pour la
// Phase 3 (cf. docs/native-port.md). `contextIsolation: true` est tout de
// même activé — préférer un preload présent (même vide) à `nodeIntegration`.
