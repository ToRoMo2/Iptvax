/**
 * Informations légales — source de vérité unique pour les pages Mentions
 * légales / CGU / CGV / Confidentialité.
 *
 * ⚠ À COMPLÉTER avant toute mise en ligne publique : les champs marqués
 * `[À COMPLÉTER …]` doivent être renseignés. Ces documents sont des modèles
 * sérieux mais doivent être relus par un avocat avant publication.
 *
 * # Mode éditeur
 * `editorType` détermine l'identité publiée :
 *  - `'individual'` (mode ACTUEL) : édité par un particulier, sans société.
 *    Légitime tant que le service est gratuit et sans revenu. Seuls `editorName`
 *    (+ hébergeur + contact) sont nécessaires.
 *  - `'company'` : une fois la société créée (SASU recommandée), passer à
 *    `'company'` et renseigner les champs société (SIREN, capital, etc.).
 *
 * Tant que `PREMIUM_ENABLED` est `false` (config/monetization.ts), le service
 * est fourni gratuitement : les CGV (vente) ne s'appliquent pas encore.
 */
export type EditorType = 'individual' | 'company';

export const LEGAL: {
  editorType: EditorType;
  brand: string;
  editorName: string;
  editorForm: string;
  editorCapital: string;
  editorSiren: string;
  editorVat: string;
  editorAddress: string;
  publicationDirector: string;
  contactEmail: string;
  hostingName: string;
  hostingAddress: string;
  lastUpdated: string;
} = {
  /** Mode actuel : éditeur particulier (pas de société, service gratuit). */
  editorType: 'individual',

  /** Nom commercial / marque. */
  brand: 'Umbra',

  // ── Éditeur particulier (mode ACTUEL) ─────────────────────────────────
  // Nom et prénom, ou pseudonyme. ⚠ Si vous publiez sous pseudonyme, votre
  // identité réelle doit être communiquée à l'hébergeur (LCEN art. 6 III).
  editorName: '[À COMPLÉTER : Prénom Nom — ou pseudonyme]',

  // ── Champs société (DORMANTS — remplir au passage editorType: 'company') ──
  editorForm: '[À COMPLÉTER : forme juridique, ex. SASU]',
  editorCapital: '[À COMPLÉTER : montant du capital social]',
  editorSiren: '[À COMPLÉTER : n° SIREN / RCS + ville d’immatriculation]',
  editorVat: '[À COMPLÉTER : n° TVA intracommunautaire]',
  editorAddress: '[À COMPLÉTER : adresse du siège social]',
  publicationDirector: '[À COMPLÉTER : nom du directeur de la publication]',

  /** Email de contact public (support + exercice des droits RGPD). */
  contactEmail: '[À COMPLÉTER : email de contact, ex. contact@umbra.app]',

  // ── Hébergeur du site (LCEN) ──────────────────────────────────────────
  hostingName: '[À COMPLÉTER : nom de l’hébergeur du site, ex. OVH / Hetzner / Vercel]',
  hostingAddress: '[À COMPLÉTER : adresse de l’hébergeur]',

  /** Date de dernière mise à jour affichée en tête de chaque document. */
  lastUpdated: '30 juin 2026',
};
