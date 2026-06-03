/**
 * Outils purs de normalisation de titres + regroupement de doublons.
 *
 * Les serveurs Xtream renvoient le même film/série en plusieurs entrées
 * distinctes (langues / qualités) :
 *   "Game of Thrones 4K", "Game of Thrones FR", "Game of Thrones VOSTFR"…
 * Ces helpers extraient un titre canonique pour :
 *   1. fusionner ces variantes en une seule carte (grille moins polluée) ;
 *   2. produire une requête propre pour l'enrichissement TMDB.
 *
 * Couche `utils/` → ZÉRO import (corset §VII / règles de couplage).
 */

// Tags de langue / version (token exact, insensible à la casse)
const LANG_TAGS = new Set([
  'fr', 'vf', 'vff', 'vfq', 'vfi', 'vof', 'vlf', 'truefrench', 'french', 'francais',
  'vostfr', 'vost', 'vosta', 'vo', 'subfrench', 'stfr',
  'multi', 'multilang',
  'en', 'eng', 'english', 'ang',
  'ar', 'arabic', 'arab', 'arabe',
  'tr', 'turkish', 'turk',
  'es', 'esp', 'spanish', 'lat', 'latino',
  'de', 'ger', 'german', 'allemand',
  'it', 'ita', 'italian',
  'pt', 'por', 'brazil', 'brazilian',
  'nl', 'dut', 'ru', 'rus', 'pl', 'hi', 'hindi',
]);

// Tags de qualité / source
const QUALITY_TAGS = new Set([
  '4k', 'uhd', '2160p', '2160', '1080p', '1080', 'fhd', '720p', '720',
  '480p', '360p', 'hd', 'sd', 'hq', 'lq',
  'hdr', 'hdr10', 'dv', 'dolby', 'atmos', 'remux',
  'bluray', 'blu-ray', 'brrip', 'bdrip', 'web', 'webrip', 'web-dl', 'webdl',
  'hdrip', 'hdlight', 'hdtv', 'dvdrip', 'x264', 'x265', 'hevc', 'h264',
  'h265', '10bit', '8bit', 'cam', 'ts', 'tc',
]);

const YEAR_RE = /^(?:19|20)\d{2}$/;

/** Supprime drapeaux emoji + symboles décoratifs fréquents dans les noms IPTV. */
function stripDecorations(s: string): string {
  return s
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '') // drapeaux régionaux
    .replace(/[\u{2600}-\u{27BF}\u{1F000}-\u{1FAFF}]/gu, '') // emoji divers
    .replace(/[|►▶•·»«★☆#]+/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ') // [ ... ]
    .replace(/\{[^}]*\}/g, ' ') // { ... }
    .replace(/\([^)]*\)/g, ' '); // ( ... )
}

function isTagToken(tokenLower: string): boolean {
  return LANG_TAGS.has(tokenLower) || QUALITY_TAGS.has(tokenLower);
}

/**
 * Titre lisible débarrassé des tags langue/qualité/année.
 * Conserve la ponctuation interne ("Spider-Man: No Way Home").
 */
export function cleanTitle(raw: string): string {
  if (!raw) return '';
  const tokens = stripDecorations(raw).split(/\s+/).filter(Boolean);

  const kept: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const norm = tok.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (!norm) continue;
    if (isTagToken(norm)) continue;
    // Année en fin de titre uniquement (évite de tuer "1917", "2012" titres réels)
    if (YEAR_RE.test(norm) && i === tokens.length - 1 && kept.length > 0) continue;
    if (/^s\d{1,2}(e\d{1,3})?$/i.test(norm)) continue; // S01 / S01E02
    kept.push(tok);
  }

  const out = kept.join(' ').replace(/\s{2,}/g, ' ').trim()
    .replace(/^[\s\-:·.]+|[\s\-:·.]+$/g, '')
    .trim();
  // Garde-fou : ne jamais renvoyer une chaîne vide (titre = que des tags)
  return out || raw.trim();
}

/** Clé canonique pour regrouper / dédupliquer (insensible casse + accents). */
export function titleKey(raw: string): string {
  return cleanTitle(raw)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritiques combinants
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Année à 4 chiffres détectée dans le nom (parenthèses ou fin), sinon undefined. */
export function extractYear(raw: string): string | undefined {
  if (!raw) return undefined;
  const all = raw.match(/\b(?:19|20)\d{2}\b/g);
  return all ? all[all.length - 1] : undefined;
}

const LANG_LABEL: Record<string, string> = {
  vostfr: 'VOSTFR', vost: 'VOSTFR', subfrench: 'VOSTFR', stfr: 'VOSTFR',
  vf: 'VF', vff: 'VF', vfq: 'VFQ', vfi: 'VF', vof: 'VF', vlf: 'VF',
  truefrench: 'VF', french: 'VF', francais: 'VF', fr: 'VF',
  multi: 'MULTI', multilang: 'MULTI', vo: 'VO',
  en: 'EN', eng: 'EN', english: 'EN', ang: 'EN',
  ar: 'AR', arabic: 'AR', arab: 'AR', arabe: 'AR',
  tr: 'TR', turkish: 'TR', turk: 'TR',
  es: 'ES', esp: 'ES', spanish: 'ES', lat: 'LAT', latino: 'LAT',
  de: 'DE', ger: 'DE', german: 'DE', it: 'IT', ita: 'IT', italian: 'IT',
};

const QUALITY_LABEL: Record<string, string> = {
  '4k': '4K', uhd: '4K', '2160p': '4K', '2160': '4K',
  '1080p': '1080p', '1080': '1080p', fhd: '1080p',
  '720p': '720p', '720': '720p', hd: 'HD', sd: 'SD',
  hdr: 'HDR', hdr10: 'HDR', dv: 'DV',
};

/**
 * Étiquette courte de variante pour le sélecteur de version, dérivée des tags
 * présents dans le nom brut : ex. "VF · 4K", "VOSTFR", "TR".
 */
export function versionLabel(raw: string, fallback: string): string {
  // ⚠ NE PAS passer par stripDecorations : il efface le contenu entre
  // parenthèses/crochets, or les tags de version y vivent souvent
  // ("Game of Thrones (VOSTFR)"). On découpe sur tout caractère non
  // alphanumérique pour récupérer ces tags, où qu'ils soient.
  const tokens = raw
    .replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '') // drapeaux régionaux
    .replace(/[\u{2600}-\u{27BF}\u{1F000}-\u{1FAFF}]/gu, '') // emoji
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  // Mots du titre canonique → écartés du scan (évite qu'un mot comme "It" ou
  // "Lat" du titre soit pris pour un tag de langue).
  const titleTokens = new Set(
    cleanTitle(raw).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean),
  );
  let lang: string | undefined;
  let quality: string | undefined;
  for (const tok of tokens) {
    const norm = tok.toLowerCase();
    if (titleTokens.has(norm)) continue;
    if (!lang && LANG_LABEL[norm]) lang = LANG_LABEL[norm];
    if (!quality && QUALITY_LABEL[norm]) quality = QUALITY_LABEL[norm];
  }
  const parts = [lang, quality].filter(Boolean);
  return parts.length ? parts.join(' · ') : fallback;
}

/**
 * Étiquette de qualité orientée chaîne Live (préserve la nomenclature IPTV
 * familière : 4K / FHD / HD / SD / HEVC / HDR plutôt que les résolutions
 * brutes). Retourne `fallback` si aucun tag qualité n'est détecté.
 */
const CHANNEL_QUALITY_LABEL: Record<string, string> = {
  '4k': '4K', uhd: '4K', '2160p': '4K', '2160': '4K',
  fhd: 'FHD', '1080p': 'FHD', '1080': 'FHD',
  hd: 'HD', '720p': 'HD', '720': 'HD',
  sd: 'SD', '480p': 'SD', '360p': 'SD',
  hevc: 'HEVC', h265: 'HEVC', x265: 'HEVC',
  hdr: 'HDR', hdr10: 'HDR', dv: 'DV',
};

// Rang décroissant pour trier les qualités d'une même chaîne (meilleure en
// premier → devient la variante `primary`).
const QUALITY_RANK: Record<string, number> = {
  '4K': 6, FHD: 5, HD: 4, HEVC: 3, HDR: 5, DV: 5, SD: 2,
};

export function qualityLabel(raw: string, fallback: string): string {
  const tokens = stripDecorations(raw).split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const norm = tok.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (CHANNEL_QUALITY_LABEL[norm]) return CHANNEL_QUALITY_LABEL[norm];
  }
  return fallback;
}

/** Score qualité d'une chaîne (sert à choisir la meilleure variante + trier). */
export function qualityRank(raw: string): number {
  return QUALITY_RANK[qualityLabel(raw, '')] ?? 1;
}

/**
 * Étiquette « ★ X.X » de la note /5 d'un item, ou `null` si absente/nulle.
 *
 * ⚠ `rating_5based` est typé `number` mais les serveurs Xtream le renvoient
 * fréquemment en **string** ("8.5"). `valeur > 0` laisse passer une string non
 * vide puis `.toFixed()` lève `TypeError` → crash de rendu (et sans
 * ErrorBoundary, tout l'arbre React démonte → écran noir). On coerce donc
 * systématiquement avant le formatage.
 */
export function star5Label(value: unknown): string | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? `★ ${n.toFixed(1)}` : null;
}

export interface TitleGroup<T> {
  /** Clé de regroupement (titre canonique + année). */
  key: string;
  /** Titre nettoyé, lisible, pour l'affichage de la carte. */
  title: string;
  year?: string;
  /** Toutes les entrées partageant ce titre, meilleure en premier. */
  variants: T[];
  /** Entrée représentative (meilleur `rank`). */
  primary: T;
}

/**
 * Regroupe une liste d'items par titre canonique. Générique → aucun import de
 * type (corset). Préserve l'ordre de première apparition (Map insertion order).
 *
 * @param rank score décroissant : plus haut = meilleure variante (devient `primary`).
 */
export function groupByTitle<T>(
  items: T[],
  getName: (t: T) => string,
  rank: (t: T) => number,
): TitleGroup<T>[] {
  // Clé = titre canonique SEUL (sans l'année). Le tagging d'année est
  // incohérent d'une variante IPTV à l'autre ("Film [2021] 4K" vs "Film FR")
  // → l'inclure dans la clé fracturerait le même film en plusieurs cartes,
  // exactement ce qu'on veut éviter. Les remakes au titre strictement
  // identique (rares dans un catalogue IPTV) deviennent juste des variantes.
  const map = new Map<string, T[]>();
  for (const it of items) {
    const name = getName(it);
    // Repli sur le nom brut si le titre canonique est vide (titre = symboles)
    // pour ne JAMAIS faire disparaître un item du catalogue.
    const key = titleKey(name) || name.trim().toLowerCase();
    const bucket = map.get(key);
    if (bucket) bucket.push(it);
    else map.set(key, [it]);
  }

  const groups: TitleGroup<T>[] = [];
  for (const [key, variants] of map) {
    const sorted = variants.length > 1
      ? [...variants].sort((a, b) => rank(b) - rank(a))
      : variants;
    const primary = sorted[0];
    const primaryName = getName(primary);
    groups.push({
      key,
      title: cleanTitle(primaryName),
      year: extractYear(primaryName),
      variants: sorted,
      primary,
    });
  }
  return groups;
}
