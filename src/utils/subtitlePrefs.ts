// ── Préférences de sous-titres — source de vérité partagée ───────────────────
// Persistance + maps de style des sous-titres, partagées entre le lecteur
// (`VideoPlayer`) et la page Paramètres (personnalisation des sous-titres par
// défaut). Une SEULE clé localStorage → ce que l'utilisateur règle dans les
// Paramètres devient le défaut du lecteur, et vice-versa.
import type { SubSize, SubBg, SubColor } from '../components/TvPlayerOverlay';

export type { SubSize, SubBg, SubColor };

export const SUB_PREFS_KEY = 'iptv-subtitle-prefs';

export interface SubPrefs {
  size: SubSize;
  bg: SubBg;
  color: SubColor;
}

export const DEFAULT_SUB_PREFS: SubPrefs = { size: 'md', bg: 'none', color: 'white' };

export function loadSubPrefs(): SubPrefs {
  try {
    const raw = localStorage.getItem(SUB_PREFS_KEY);
    if (!raw) return DEFAULT_SUB_PREFS;
    return { ...DEFAULT_SUB_PREFS, ...(JSON.parse(raw) as Partial<SubPrefs>) };
  } catch { return DEFAULT_SUB_PREFS; }
}

export function saveSubPrefs(prefs: SubPrefs) {
  try { localStorage.setItem(SUB_PREFS_KEY, JSON.stringify(prefs)); } catch { /* */ }
}

// Maps de style pour l'aperçu live + les chips « Aa ». Tailles alignées sur les
// .subSm/Md/Lg/Xl du CSS pour que l'aperçu reflète EXACTEMENT le rendu final.
export const PREVIEW_PX: Record<SubSize, number> = { sm: 18, md: 26, lg: 36, xl: 48 };
export const CHIP_PX: Record<SubSize, number> = { sm: 11, md: 15, lg: 20, xl: 26 };
export const SUB_COLOR_HEX: Record<SubColor, string> = {
  white: '#ffffff', yellow: '#ffe066', cyan: 'var(--accent)', green: '#7eff7e',
};
export const SUB_BG_CSS: Record<SubBg, string> = {
  none: 'transparent', semi: 'rgba(0,0,0,0.6)', solid: 'rgba(0,0,0,0.92)',
};
export const SUB_OUTLINE = '-1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000, 0 0 6px rgba(0,0,0,0.55)';
export const SUB_SOFT_SHADOW = '0 1px 3px rgba(0,0,0,0.95), 0 0 8px rgba(0,0,0,0.6)';
