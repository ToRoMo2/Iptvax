/**
 * Informations légales — source de vérité unique pour les pages Mentions
 * légales / CGU / CGV / Confidentialité.
 *
 * ⚠ À COMPLÉTER avant toute mise en ligne publique : les champs marqués
 * `[À COMPLÉTER …]` doivent être renseignés une fois la société créée (SASU
 * recommandée) et le nom de domaine acquis. Ces documents sont des modèles
 * sérieux mais doivent être relus par un avocat avant publication.
 *
 * Tant que `PREMIUM_ENABLED` est `false` (config/monetization.ts), le service
 * est fourni gratuitement : les CGV (vente) ne s'appliquent pas encore.
 */
export const LEGAL = {
  /** Nom commercial / marque. */
  brand: 'Umbra',

  // ── Éditeur (LCEN art. 6 III) ─────────────────────────────────────────
  editorName: '[À COMPLÉTER : raison sociale, ex. Umbra SASU]',
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
} as const;
