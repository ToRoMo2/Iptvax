import { Link } from 'react-router-dom';
import { LEGAL } from '../../config/legal';

/**
 * Mentions légales (LCEN art. 6 III). Contenu rédigé depuis `config/legal.ts`
 * (champs `[À COMPLÉTER]` à renseigner une fois la société créée).
 */
export function MentionsLegales() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1 className="legal-title">Mentions légales</h1>
        <p className="legal-sub">{LEGAL.brand}</p>
        <p className="legal-update">Dernière mise à jour : {LEGAL.lastUpdated}</p>

        <div className="legal-body">
          <h2>1. Éditeur du service</h2>
          <p>
            Le service et l'application « {LEGAL.brand} » sont édités par :
          </p>
          {LEGAL.editorType === 'company' ? (
            <ul>
              <li><strong>Dénomination :</strong> {LEGAL.editorName}</li>
              <li><strong>Forme juridique :</strong> {LEGAL.editorForm}</li>
              <li><strong>Capital social :</strong> {LEGAL.editorCapital}</li>
              <li><strong>Immatriculation :</strong> {LEGAL.editorSiren}</li>
              <li><strong>N° TVA intracommunautaire :</strong> {LEGAL.editorVat}</li>
              <li><strong>Siège social :</strong> {LEGAL.editorAddress}</li>
              <li><strong>Contact :</strong> {LEGAL.contactEmail}</li>
              <li><strong>Directeur de la publication :</strong> {LEGAL.publicationDirector}</li>
            </ul>
          ) : (
            <ul>
              <li><strong>Éditeur :</strong> {LEGAL.editorName}</li>
              <li><strong>Statut :</strong> particulier (édition à titre non professionnel)</li>
              <li><strong>Contact :</strong> {LEGAL.contactEmail}</li>
              <li><strong>Directeur de la publication :</strong> {LEGAL.editorName}</li>
            </ul>
          )}

          <h2>2. Hébergement du site</h2>
          <p>Le site est hébergé par :</p>
          <ul>
            <li><strong>Hébergeur :</strong> {LEGAL.hostingName}</li>
            <li><strong>Adresse :</strong> {LEGAL.hostingAddress}</li>
          </ul>

          <h2>3. Nature du service</h2>
          <p>
            {LEGAL.brand} est un <strong>logiciel lecteur multimédia</strong> permettant
            à l'utilisateur de lire des flux et contenus multimédias auxquels il accède
            au moyen de ses <strong>propres identifiants de services tiers</strong>, qu'il
            renseigne lui-même. L'éditeur ne fournit, n'héberge, ne distribue et ne
            commercialise <strong>aucun contenu, flux, chaîne, film, série ou abonnement</strong> à
            un quelconque service de diffusion : le logiciel est un outil neutre. Le
            détail des conditions figure dans les{' '}
            <Link to="/cgv">conditions générales d'utilisation et de vente</Link>.
          </p>

          <h2>4. Propriété intellectuelle</h2>
          <p>
            La marque {LEGAL.brand}, le logiciel, son code, son interface, ses textes,
            logos et éléments graphiques sont protégés par le droit de la propriété
            intellectuelle et demeurent la propriété exclusive de l'éditeur. Toute
            reproduction ou représentation, totale ou partielle, sans autorisation
            préalable est interdite. Les marques, titres, visuels et contenus de tiers
            accessibles via le logiciel demeurent la propriété de leurs titulaires
            respectifs.
          </p>
          <p>
            Les métadonnées et visuels d'enrichissement sont fournis par The Movie
            Database (TMDB). <em>This product uses the TMDB API but is not endorsed or
            certified by TMDB.</em>
          </p>

          <h2>5. Contact</h2>
          <p>
            Pour toute question relative au service ou aux présentes mentions :{' '}
            {LEGAL.contactEmail}.
          </p>
        </div>

        <Link to="/" className="legal-back">← Retour à l'accueil</Link>
      </div>
    </div>
  );
}
