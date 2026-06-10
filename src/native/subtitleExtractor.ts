import { registerPlugin } from '@capacitor/core';

/**
 * Plugin natif `SubtitleExtractor` — extraction ON-DEVICE des sous-titres TEXTE
 * d'un flux (MKV/MP4) via `android.media.MediaExtractor` (API plateforme, zéro
 * dépendance). Permet de rendre les sous-titres dans l'overlay React (comme le
 * lecteur web) plutôt que par le moteur libVLC → restyle taille/couleur/fond
 * INSTANTANÉ, sans rechargement.
 *
 * Pendant inverse de `/api/subtitle` (web/ffmpeg) : extraction FENÊTRÉE pour ne
 * pas télécharger tout le fichier ni monopoliser la connexion fournisseur
 * (même garde-fou que §IV-1). Les sous-titres IMAGE (PGS/DVB/VobSub) ne sont
 * PAS exposés ici (pas de texte) → restent rendus par libVLC.
 *
 * ⚠ Best-effort : si MediaExtractor ne sait pas lire les pistes sous-titres de
 * ce fichier/appareil, `probe` renvoie une liste vide → la couche JS retombe
 * sur le rendu natif libVLC (comportement historique, jamais de régression).
 */

/** Piste sous-titre TEXTE telle qu'exposée par MediaExtractor. */
export interface ExtractedSubtitleTrack {
  /** Index de la piste dans le conteneur (à repasser à `extract`). */
  trackIndex: number;
  /** Code langue ISO (KEY_LANGUAGE) — '' si absent. */
  language: string;
  /** MIME de la piste (application/x-subrip, text/x-ssa, text/vtt…). */
  mime: string;
}

/** Cue extraite — timestamps ABSOLUS (timeline fichier) en millisecondes. */
export interface ExtractedCue {
  start: number;
  end: number;
  text: string;
}

export interface SubtitleExtractorPlugin {
  /** Liste les pistes sous-titres TEXTE du flux. Vide si non lisible. */
  probe(options: { url: string }): Promise<{ tracks: ExtractedSubtitleTrack[] }>;
  /**
   * Extrait les cues de `trackIndex` sur la fenêtre [startMs, startMs+durationMs].
   * Timestamps absolus (alignés sur la position libVLC). Liste vide si rien.
   */
  extract(options: {
    url: string;
    trackIndex: number;
    startMs: number;
    durationMs: number;
  }): Promise<{ cues: ExtractedCue[] }>;
  /** Libère l'extracteur mis en cache (changement de piste / démontage). */
  release(): Promise<void>;
}

export const SubtitleExtractor = registerPlugin<SubtitleExtractorPlugin>('SubtitleExtractor');
