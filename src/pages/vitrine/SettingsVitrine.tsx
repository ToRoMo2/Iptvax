import { useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSupabaseAuth } from '../../contexts/SupabaseAuthContext';
import { useSubscription } from '../../contexts/SubscriptionContext';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { PREMIUM_ENABLED } from '../../config/monetization';

/**
 * Page « Mon compte » en mode vitrine (design Umbra). N'utilise QUE Supabase +
 * Subscription (pas Xtream, pas IptvProfile — ces providers ne sont pas montés
 * en vitrine). Sections : abonnement, identifiants, déconnexion. Classes
 * globales `.set-*` scopées sous `.vitrine`.
 */
export function SettingsVitrine() {
  const { user, signOut } = useSupabaseAuth();
  const { isPremium, subscription, loading } = useSubscription();
  const navigate = useNavigate();
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useScrollReveal(ref);

  if (!user) {
    return (
      <div className="set-page">
        <div className="set-container">
          <div className="set-head">
            <h1 className="set-title">Mon compte</h1>
            <p className="set-sub">Vous devez être connecté pour accéder à cette page.</p>
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
    <div className="set-page" ref={ref}>
      <div className="set-container">
        <div className="set-head" data-reveal="fade">
          <h1 className="set-title">Mon compte</h1>
          <p className="set-sub">Gérez votre abonnement et votre session.</p>
        </div>

        {/* ── Abonnement ─────────────────────────────────────────── */}
        {!PREMIUM_ENABLED ? (
          <section className="set-section" data-reveal>
            <div className="set-section-title">Abonnement</div>
            <div className="set-row">
              <div className="set-row-text">
                <span className="set-row-label">Toutes les fonctionnalités sont incluses</span>
                <div className="set-row-desc">
                  Umbra est gratuit : profils, sync, Mon ciné, Communauté et
                  téléchargements sont accessibles sans abonnement.
                </div>
              </div>
            </div>
          </section>
        ) : (
        <section className="set-section" data-reveal>
          <div className="set-section-title">Abonnement</div>
          <div className="set-row">
            <span className="set-row-label">Statut</span>
            <span className={`set-badge ${isPremium ? 'active' : 'free'}`}>
              {loading ? '…' : isPremium ? 'Premium' : 'Gratuit'}
            </span>
          </div>
          {isPremium && planLabel && (
            <div className="set-row">
              <span className="set-row-label">Formule</span>
              <span className="set-row-value">{planLabel}</span>
            </div>
          )}
          {isPremium && renewDate && (
            <div className="set-row">
              <span className="set-row-label">
                {subscription.cancelAtPeriodEnd ? 'Fin' : 'Renouvellement'}
              </span>
              <span className="set-row-value">{renewDate}</span>
            </div>
          )}
          <div className="set-row">
            <div className="set-row-text">
              <span className="set-row-label">
                {isPremium ? 'Gérer mon abonnement' : 'Passer à Premium'}
              </span>
              <div className="set-row-desc">
                {isPremium
                  ? 'Modifier ou annuler depuis le portail client.'
                  : 'Profils illimités, sync cloud, Mon ciné, Communauté.'}
              </div>
            </div>
            <button
              className={`set-action${isPremium ? '' : ' primary'}`}
              onClick={() => navigate('/premium')}
            >
              {isPremium ? 'Gérer' : 'Passer Premium'}
            </button>
          </div>
        </section>
        )}

        {/* ── Identifiants ───────────────────────────────────────── */}
        <section className="set-section" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
          <div className="set-section-title">Identifiants</div>
          <div className="set-row">
            <span className="set-row-label">Email</span>
            <span className="set-row-value mono">{user.email ?? '—'}</span>
          </div>
          <div className="set-row">
            <div className="set-row-text">
              <span className="set-row-label">Déconnexion</span>
              <div className="set-row-desc">Vous serez redirigé vers la page d'accueil.</div>
            </div>
            <button className="set-action" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? 'Déconnexion…' : 'Se déconnecter'}
            </button>
          </div>
        </section>

        <p className="set-note" data-reveal>
          Vos profils, favoris et historique se gèrent depuis l'app native.{' '}
          <Link to="/downloads">Téléchargez Umbra</Link> pour la plateforme de votre choix.
        </p>
      </div>
    </div>
  );
}
