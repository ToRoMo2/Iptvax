import { Link } from 'react-router-dom';

export function CGV() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1 className="legal-title">Conditions générales de vente</h1>
        <p className="legal-sub">Umbra · Abonnement Premium</p>
        <div className="legal-placeholder">
          <strong>Page en cours de rédaction.</strong>
          <br />
          Les CGV de l'abonnement Premium (tarifs, durée, renouvellement,
          résiliation, droit de rétractation) seront publiées prochainement.
        </div>
        <Link to="/" className="legal-back">
          ← Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
