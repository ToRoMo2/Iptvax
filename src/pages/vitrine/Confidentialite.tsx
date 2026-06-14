import { Link } from 'react-router-dom';

export function Confidentialite() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1 className="legal-title">Politique de confidentialité</h1>
        <p className="legal-sub">Umbra · Traitement des données</p>
        <div className="legal-placeholder">
          <strong>Page en cours de rédaction.</strong>
          <br />
          La politique de confidentialité (données collectées, finalités, base
          légale RGPD, cookies, droits utilisateur) sera publiée prochainement.
        </div>
        <Link to="/" className="legal-back">
          ← Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
