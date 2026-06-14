import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSupabaseAuth } from '../../contexts/SupabaseAuthContext';
import { useSubscription } from '../../contexts/SubscriptionContext';
import styles from './SettingsVitrine.module.css';

/**
 * Page « Mon compte » en mode vitrine. N'utilise QUE Supabase + Subscription
 * (pas Xtream, pas IptvProfile — ces providers ne sont pas montés en vitrine).
 *
 * Sections : abonnement, compte, déconnexion. Les vrais réglages (profils
 * IPTV, sous-titres, lecture) vivent dans l'app native, pas ici.
 */
export function SettingsVitrine() {
  const { user, signOut } = useSupabaseAuth();
  const { isPremium, subscription, loading } = useSubscription();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);

  if (!user) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <div className={styles.head}>
            <h1 className={styles.title}>Mon compte</h1>
            <p className={styles.sub}>
              Vous devez être connecté pour accéder à cette page.
            </p>
          </div>
          <Link to="/login" className="btn btn-primary">
            Se connecter
          </Link>
        </div>
      </div>
    );
  }

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      navigate('/', { replace: true });
    } finally {
      setSigningOut(false);
    }
  };

  const planLabel =
    subscription.plan === 'yearly'
      ? 'Annuel (17,99 €/an)'
      : subscription.plan === 'monthly'
        ? 'Mensuel (2,49 €/mois)'
        : null;

  const renewDate = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString('fr-FR')
    : null;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.head}>
          <h1 className={styles.title}>Mon compte</h1>
          <p className={styles.sub}>Gérez votre abonnement et votre session.</p>
        </div>

        {/* ── Abonnement ─────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Abonnement</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Statut</span>
            <span
              className={`${styles.badge} ${isPremium ? styles.badgeActive : styles.badgeFree}`}
            >
              {loading ? '…' : isPremium ? 'Premium' : 'Gratuit'}
            </span>
          </div>
          {isPremium && planLabel && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>Formule</span>
              <span className={styles.rowValue}>{planLabel}</span>
            </div>
          )}
          {isPremium && renewDate && (
            <div className={styles.row}>
              <span className={styles.rowLabel}>
                {subscription.cancelAtPeriodEnd ? 'Fin' : 'Renouvellement'}
              </span>
              <span className={styles.rowValue}>{renewDate}</span>
            </div>
          )}
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>
                {isPremium ? 'Gérer mon abonnement' : 'Passer à Premium'}
              </span>
              <div className={styles.rowDesc}>
                {isPremium
                  ? 'Modifier ou annuler depuis le portail client.'
                  : 'Profils illimités, sync cross-device, Mon ciné, communauté.'}
              </div>
            </div>
            <button
              className={styles.actionBtn}
              onClick={() => navigate('/premium')}
            >
              {isPremium ? 'Gérer' : 'Passer Premium'}
            </button>
          </div>
        </section>

        {/* ── Compte ─────────────────────────────────────────────── */}
        <section className={styles.section}>
          <div className={styles.sectionTitle}>Identifiants</div>
          <div className={styles.row}>
            <span className={styles.rowLabel}>Email</span>
            <span className={styles.rowValue}>{user.email ?? '—'}</span>
          </div>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Déconnexion</span>
              <div className={styles.rowDesc}>
                Vous serez redirigé vers la page d'accueil.
              </div>
            </div>
            <button
              className={styles.actionBtn}
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </button>
          </div>
        </section>

        {/* ── Note vitrine ───────────────────────────────────────── */}
        <p className={styles.note}>
          Vos profils IPTV, favoris et historique se gèrent depuis l'app
          native. <Link to="/downloads">Téléchargez Umbra</Link> pour la
          plateforme de votre choix.
        </p>
      </div>
    </div>
  );
}
