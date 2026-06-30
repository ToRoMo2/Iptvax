/**
 * Modèle économique — source de vérité unique.
 *
 * # Option 1 : l'application est actuellement 100 % GRATUITE.
 *
 * Décision (2026) : tant que la base d'utilisateurs ne justifie pas le coût
 * d'une licence commerciale TMDB (~149 $/mois, cf. discussion §X), l'app reste
 * entièrement gratuite. Cela permet :
 *   1. d'utiliser la clé TMDB « Developer » gratuite, réservée à l'usage
 *      NON commercial (aucun revenu direct ni indirect) ;
 *   2. de réduire fortement le risque juridique du modèle « lecteur neutre »
 *      (une app gratuite est une cible bien moindre pour les ayants droit et
 *      la modération des stores) ;
 *   3. de supprimer la contrainte de billing des stores (Google Play Billing).
 *
 * ## Réactivation du palier payant (plus tard)
 * Toute l'infrastructure Premium reste EN PLACE, en sommeil (Stripe, Edge
 * Functions, table `subscriptions`, RLS, `SubscriptionContext`, gating). Pour
 * repasser payant, il suffit de remettre `PREMIUM_ENABLED = true` ET de
 * souscrire la licence commerciale TMDB. Aucune logique de gating n'est à
 * réécrire — `useSubscription().isPremium` redevient simplement le vrai statut.
 *
 * ⚠ Quand `PREMIUM_ENABLED` est `false`, `isPremium` vaut TOUJOURS `true`
 * (toutes les fonctionnalités sont débloquées pour tout le monde) — c'est la
 * SEULE conséquence sur le gating. Les surfaces d'upsell (prix, « Passer
 * Premium », page /premium) doivent lire ce drapeau pour se masquer.
 */
export const PREMIUM_ENABLED = false;
