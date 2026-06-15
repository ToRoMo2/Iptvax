/* ====================================================================
   IPTVAX · Données mock + générateur d'affiches « dégradé chaud »
   ==================================================================== */

// Hash déterministe d'une chaîne → entier stable.
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return Math.abs(h); }

// Affiche abstraite « chaude » déterministe à partir d'un seed (titre).
// Reste dans la bande or/ambre/terracotta/rose/prune — jamais de bleu froid.
function warmPoster(seed) {
  const h = hashStr(seed);
  const warm = [28, 18, 40, 348, 12, 52, 332, 8];      // teintes chaudes
  const a = warm[h % warm.length];
  const b = warm[(h >> 3) % warm.length];
  const ang = 110 + (h % 60);
  const lx = 25 + (h % 50), ly = 18 + ((h >> 4) % 40);
  return {
    backgroundColor: `hsl(${a} 42% 11%)`,
    backgroundImage: [
      `radial-gradient(120% 90% at ${lx}% ${ly}%, hsl(${a} 70% 46% / .85), transparent 60%)`,
      `radial-gradient(90% 80% at ${100 - lx}% ${100 - ly}%, hsl(${b} 60% 30% / .7), transparent 55%)`,
      `linear-gradient(${ang}deg, hsl(${a} 55% 14%), hsl(${b} 45% 9%))`,
    ].join(","),
  };
}

const M = (title, year, genre, rating, runtime, plot, cast) => ({ title, year, genre, rating, runtime, plot, cast, id: hashStr(title) });

// ── Films par catégorie ──────────────────────────────────────────────
const MOVIE_CATS = [
  { name: "Action", items: [
    M("Lame de Fond", 2024, "Action · Thriller", 7.8, "2h08", "Un ancien plongeur de combat doit déjouer un sabotage en eaux profondes avant que la cité côtière ne sombre.", "I. Moreau, K. Adebayo, L. Ferrand"),
    M("Cendre Noire", 2023, "Action", 7.1, "1h54", "Une pompière d'élite traque un pyromane à travers une métropole en proie aux flammes.", "N. Costa, R. Vance"),
    M("Point de Rupture", 2025, "Action · Espionnage", 8.0, "2h17", "Deux agents que tout oppose s'allient le temps d'une nuit pour empêcher une fuite d'État.", "A. Okafor, S. Lindqvist"),
    M("Vélocité", 2022, "Action", 6.9, "1h48", "Un pilote de rallye reconverti livreur se retrouve mêlé à un braquage à grande vitesse.", "J. Park, M. Dubois"),
    M("Acier Trempé", 2024, "Action", 7.4, "2h02", "Le dernier forgeron d'une vallée isolée défend son village contre une milice armée.", "T. Bauer, E. Solano"),
    M("Onde de Choc", 2023, "Action · SF", 7.6, "2h11", "Après un séisme magnétique, une ingénieure tente de rétablir l'ordre dans une ville sans énergie.", "C. Nakamura, P. Roy"),
  ]},
  { name: "Comédie", items: [
    M("Tout Sauf Lundi", 2024, "Comédie", 7.0, "1h39", "Un employé modèle se réveille condamné à revivre le pire lundi de sa carrière.", "F. Lemaire, O. Diallo"),
    M("La Grande Traversée", 2023, "Comédie · Aventure", 6.8, "1h52", "Trois retraités volent un voilier pour réaliser le rêve abandonné de leur jeunesse.", "G. Petit, H. Mancini"),
    M("Voisins Très Proches", 2022, "Comédie", 6.5, "1h44", "Deux familles que tout sépare partagent par erreur la même maison de vacances.", "S. Bonnet, D. Achterberg"),
    M("Plan Foireux", 2025, "Comédie", 7.3, "1h47", "Un mariage tourne au chaos quand le témoin perd les alliances la veille du grand jour.", "V. Cardoso, A. Klein"),
    M("Café Serré", 2023, "Comédie", 6.9, "1h36", "Le quotidien tendre et absurde d'un bar de quartier menacé de fermeture.", "L. Bianchi, R. Haddad"),
  ]},
  { name: "Drame", items: [
    M("Les Heures Bleues", 2024, "Drame", 8.3, "2h06", "Une violoncelliste renoue avec sa mère le temps d'un dernier été au bord du lac.", "M. Renaud, I. Sorensen"),
    M("Sous la Pluie d'Or", 2023, "Drame", 8.0, "1h58", "Dans une ville minière en déclin, un père et son fils réapprennent à se parler.", "B. Tanaka, C. Mendez"),
    M("Le Poids des Vagues", 2022, "Drame", 7.7, "2h14", "Une famille de pêcheurs affronte la disparition mystérieuse de leur aîné.", "A. Lefèvre, K. Nyong"),
    M("Demain Peut-être", 2025, "Drame · Romance", 8.1, "2h03", "Deux inconnus se croisent chaque soir dans le même train de nuit.", "E. Garcia, T. Wolff"),
    M("Lignes de Fuite", 2024, "Drame", 7.9, "1h51", "Un architecte renommé remet sa vie en question après un accident.", "N. Rossi, P. Andersson"),
  ]},
  { name: "Science-fiction", items: [
    M("Orbite Basse", 2025, "Science-fiction", 8.2, "2h21", "L'équipage d'une station orbitale découvre un signal venu de la Terre, vieux de mille ans.", "S. Voss, A. Idrissi"),
    M("Le Dernier Jardin", 2024, "SF · Drame", 7.8, "2h09", "Sur une planète aride, une botaniste protège la dernière graine de l'humanité.", "L. Choi, M. Ferraro"),
    M("Écho 9", 2023, "SF · Thriller", 7.5, "1h57", "Une IA domestique commence à anticiper les désirs de sa famille un peu trop bien.", "D. Brandt, R. Sissoko"),
    M("Marée Solaire", 2022, "Science-fiction", 7.2, "2h04", "Quand le soleil entre en éruption, une colonie lunaire devient le dernier refuge.", "C. Pereira, J. Holm"),
  ]},
];

// ── Séries par catégorie ─────────────────────────────────────────────
const SERIES_CATS = [
  { name: "Tendances", items: [
    M("Quartier Latin", 2024, "Série · Drame", 8.4, "3 saisons", "Le destin croisé des habitants d'un immeuble parisien sur trois décennies.", "Distribution d'ensemble"),
    M("Ligne de Nuit", 2025, "Série · Thriller", 8.6, "2 saisons", "Une standardiste des urgences se retrouve au cœur d'une affaire criminelle.", "H. Albrecht"),
    M("Maison Verre", 2023, "Série · Drame", 8.0, "4 saisons", "Une dynastie d'hôteliers se déchire pour le contrôle de l'empire familial.", "Distribution d'ensemble"),
    M("Saison des Pluies", 2024, "Série", 7.9, "1 saison", "Dans un village tropical, l'arrivée d'une médecin bouscule les équilibres.", "A. Sow"),
    M("Le Bureau des Ondes", 2022, "Série · Comédie", 7.6, "3 saisons", "Les coulisses désopilantes d'une radio locale au bord de la faillite.", "Distribution d'ensemble"),
  ]},
  { name: "Policier", items: [
    M("Sang d'Encre", 2024, "Policier", 8.2, "2 saisons", "Une romancière de polars aide la police... un peu trop bien.", "M. Delacroix"),
    M("Brigade 7", 2023, "Policier", 7.7, "5 saisons", "Le quotidien d'une brigade criminelle dans une ville portuaire.", "Distribution d'ensemble"),
    M("Faux Témoin", 2025, "Policier · Thriller", 8.1, "1 saison", "Un juré reconnaît l'accusé... d'un crime que personne ne connaît.", "R. Vidal"),
    M("Zone Blanche", 2022, "Policier", 7.5, "3 saisons", "Dans un village coupé du monde, les disparitions s'enchaînent.", "Distribution d'ensemble"),
  ]},
  { name: "Comédie", items: [
    M("Colocs & Cie", 2024, "Comédie", 7.4, "2 saisons", "Cinq trentenaires partagent un loft et beaucoup trop de secrets.", "Distribution d'ensemble"),
    M("Le Dernier Resto", 2023, "Comédie", 7.2, "3 saisons", "Un chef étoilé déchu reprend le boui-boui de son enfance.", "F. Marchetti"),
    M("Profs en Folie", 2025, "Comédie", 7.0, "1 saison", "Une salle des profs où chaque jour est une nouvelle catastrophe.", "Distribution d'ensemble"),
  ]},
];

// ── Épisodes (pour la fiche série) ───────────────────────────────────
const EPISODES = {
  1: [
    { n: 1, title: "Le Premier Étage", dur: "52 min", plot: "Les habitants emménagent ; un secret enfoui refait surface dès le premier soir." },
    { n: 2, title: "Voisinage", dur: "48 min", plot: "Une fête de pendaison de crémaillère révèle d'anciennes rancœurs." },
    { n: 3, title: "La Cage d'Escalier", dur: "55 min", plot: "Un incident technique force tout l'immeuble à cohabiter une nuit entière." },
    { n: 4, title: "Sous les Toits", dur: "50 min", plot: "La gardienne découvre un courrier qui n'aurait jamais dû exister." },
    { n: 5, title: "Le Grand Ménage", dur: "53 min", plot: "Le syndic annonce des travaux qui menacent l'équilibre fragile du lieu." },
    { n: 6, title: "Lumière de Palier", dur: "58 min", plot: "Finale de saison : tous les fils se rejoignent une nuit d'orage." },
  ],
  2: [
    { n: 1, title: "Retour de Vacances", dur: "49 min", plot: "L'immeuble rouvre ses portes ; rien n'est tout à fait comme avant." },
    { n: 2, title: "Nouveaux Locataires", dur: "51 min", plot: "Un couple énigmatique s'installe au quatrième." },
    { n: 3, title: "Fuite d'Eau", dur: "47 min", plot: "Un dégât des eaux révèle ce que les murs cachaient." },
  ],
  3: [
    { n: 1, title: "Dix Ans Après", dur: "56 min", plot: "Saut dans le temps : les enfants d'hier tiennent désormais les clés." },
    { n: 2, title: "Héritage", dur: "54 min", plot: "Un testament inattendu rebat toutes les cartes." },
  ],
};

// ── Chaînes Live par catégorie ───────────────────────────────────────
const LIVE_CATS = [
  { name: "Généralistes", channels: [
    { name: "Aurora 1", code: "AUR", live: "Journal de 20h", quality: "FHD", variants: 3 },
    { name: "Méridien TV", code: "MER", live: "Grand Débat", quality: "HD" },
    { name: "Canal Soleil", code: "SOL", live: "Magazine du soir", quality: "FHD", variants: 2 },
    { name: "Lumière Info", code: "LUM", live: "Édition spéciale", quality: "4K" },
    { name: "Horizon", code: "HZN", live: "Documentaire", quality: "HD" },
  ]},
  { name: "Sport", channels: [
    { name: "Stade Or", code: "STA", live: "Ligue · 32e journée", quality: "4K", variants: 4 },
    { name: "Arena Live", code: "ARE", live: "Basket — Finale", quality: "FHD" },
    { name: "Vélodrome", code: "VEL", live: "Cyclisme — Étape 9", quality: "HD" },
    { name: "Tatami", code: "TAT", live: "Judo — Championnats", quality: "HD" },
  ]},
  { name: "Cinéma", channels: [
    { name: "Ciné Première", code: "CIN", live: "Soirée polar", quality: "FHD", variants: 2 },
    { name: "Classics", code: "CLA", live: "Cycle Nouvelle Vague", quality: "HD" },
    { name: "Frisson", code: "FRI", live: "Nuit fantastique", quality: "FHD" },
  ]},
  { name: "Documentaires", channels: [
    { name: "Planète Vie", code: "PLA", live: "Océans profonds", quality: "4K" },
    { name: "Mémoire", code: "MEM", live: "Grandes batailles", quality: "HD" },
    { name: "Savoirs", code: "SAV", live: "Le cerveau humain", quality: "FHD" },
  ]},
];

// ── EPG (programme de la chaîne en lecture) ──────────────────────────
const EPG = [
  { time: "18:30", title: "Magazine de l'après-midi", dur: "60 min", done: true },
  { time: "19:30", title: "Météo & Trafic", dur: "15 min", done: true },
  { time: "19:45", title: "Avant le Journal", dur: "15 min", done: true },
  { time: "20:00", title: "Journal de 20h", dur: "40 min", now: true, prog: 62 },
  { time: "20:40", title: "Grand Reportage : Les Veilleurs", dur: "55 min" },
  { time: "21:35", title: "Cinéma — Lame de Fond", dur: "2h08" },
  { time: "23:43", title: "Édition de la nuit", dur: "30 min" },
];

// ── Profils ──────────────────────────────────────────────────────────
const PROFILES = [
  { name: "Camille", avatar: "🎬", color: "profile-1" },
  { name: "Sacha",   avatar: "🌙", color: "profile-4" },
  { name: "Léa",     avatar: "🌟", color: "profile-3" },
  { name: "Enfants", avatar: "🦊", color: "profile-5" },
];

// ── Mur « Mon ciné » (visionnages notés) ─────────────────────────────
const WATCHED = [
  { title: "Les Heures Bleues", type: "Film", rating: 4.5, status: "Vu", note: "Une photographie sublime, un final qui reste longtemps en tête." },
  { title: "Ligne de Nuit", type: "Série", rating: 5, status: "Vu", note: "Le meilleur thriller de l'année, écriture chirurgicale." },
  { title: "Orbite Basse", type: "Film", rating: 4, status: "Vu", note: "SF contemplative, à voir sur grand écran." },
  { title: "Sang d'Encre", type: "Série", rating: 3.5, status: "En cours", note: "Concept malin, un peu inégal sur la longueur." },
  { title: "Point de Rupture", type: "Film", rating: 4, status: "Vu", note: "Tendu de bout en bout." },
  { title: "Quartier Latin", type: "Série", rating: 4.5, status: "Vu", note: "Choral et bouleversant." },
];

// ── Communauté ───────────────────────────────────────────────────────
const MEMBERS = [
  { name: "cinephile_42", avatar: "🍿", color: "profile-2", films: 312, rating: 4.2 },
  { name: "nuit_blanche", avatar: "🌙", color: "profile-4", films: 198, rating: 3.9 },
  { name: "popcorn.lea", avatar: "🎟️", color: "profile-3", films: 421, rating: 4.6 },
  { name: "mr.scope", avatar: "🎥", color: "profile-1", films: 156, rating: 4.0 },
];

window.IDATA = { warmPoster, hashStr, MOVIE_CATS, SERIES_CATS, EPISODES, LIVE_CATS, EPG, PROFILES, WATCHED, MEMBERS };
// Globals partagés entre tous les scripts Babel (scopes isolés → on passe par window)
window.W = window.IDATA;
window.uS = React.useState; window.uR = React.useRef; window.uE = React.useEffect;
window.uCb = React.useCallback; window.uMemo = React.useMemo;
