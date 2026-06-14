import { Link } from 'react-router-dom';

export function MentionsLegales() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1 className="legal-title">Mentions légales</h1>
        <p className="legal-sub">Umbra</p>
        <div className="legal-placeholder">
          <strong>Page en cours de rédaction.</strong>
          <br />
          Les mentions légales détaillées (éditeur, hébergeur, contact,
          propriété intellectuelle) seront publiées prochainement.
        </div>
        <Link to="/" className="legal-back">
          ← Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
