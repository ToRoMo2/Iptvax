import { Link } from 'react-router-dom';
import { LEGAL } from '../../config/legal';

/**
 * Conditions générales d'utilisation et de vente (CGU/CGV) — document combiné
 * (route unique `/cgv`). La partie « vente » ne s'applique que lorsqu'une offre
 * payante est proposée ; le service est actuellement gratuit.
 */
export function CGV() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1 className="legal-title">Conditions générales d'utilisation et de vente</h1>
        <p className="legal-sub">{LEGAL.brand}</p>
        <p className="legal-update">Dernière mise à jour : {LEGAL.lastUpdated}</p>

        <div className="legal-body">
          <h2>1. Objet</h2>
          <p>
            Les présentes conditions régissent l'utilisation du logiciel et du service
            « {LEGAL.brand} » (ci-après le « Service ») édité par {LEGAL.editorName}{' '}
            (ci-après l'« Éditeur »). Toute utilisation du Service implique l'acceptation
            pleine et entière des présentes conditions.
          </p>

          <h2>2. Description du Service</h2>
          <p>
            {LEGAL.brand} est un <strong>logiciel lecteur multimédia</strong>. Il permet à
            l'utilisateur de lire, sur ses appareils, des flux et contenus multimédias
            auxquels il accède au moyen de ses <strong>propres identifiants de services
            tiers</strong>, qu'il renseigne lui-même dans le logiciel.
          </p>
          <p>
            L'Éditeur agit comme simple fournisseur d'un <strong>outil technique
            neutre</strong>. Il <strong>ne fournit, n'héberge, ne distribue, ne référence
            ni ne commercialise aucun contenu</strong>, flux, chaîne, film, série, ni aucun
            abonnement ou accès à un service de diffusion. Le Service ne contient aucune
            liste, aucune source et aucun identifiant préconfigurés.
          </p>

          <h2>3. Responsabilité de l'utilisateur sur les contenus tiers</h2>
          <p>
            L'utilisateur est <strong>seul responsable</strong> des identifiants, services,
            sources et contenus qu'il configure, consulte et lit au moyen du Service. En
            utilisant le Service, l'utilisateur déclare et garantit :
          </p>
          <ul>
            <li>
              disposer de l'ensemble des <strong>droits, abonnements et autorisations
              nécessaires</strong> pour accéder aux contenus qu'il consulte ;
            </li>
            <li>
              que les services tiers qu'il utilise et les contenus auxquels il accède sont{' '}
              <strong>licites</strong> et n'enfreignent aucun droit de propriété
              intellectuelle ni aucune réglementation ;
            </li>
            <li>
              ne pas utiliser le Service pour accéder, reproduire ou diffuser des contenus{' '}
              <strong>contrefaisants ou illicites</strong>.
            </li>
          </ul>
          <p>
            L'Éditeur ne saurait être tenu responsable de l'usage que l'utilisateur fait du
            Service, ni des contenus tiers, ni de leur licéité, ni de la disponibilité ou
            de la qualité des services tiers auxquels l'utilisateur se connecte.
          </p>

          <h2>4. Compte et profils</h2>
          <p>
            L'accès à certaines fonctionnalités nécessite la création d'un compte
            (via une adresse email ou un fournisseur d'identité tiers tel que Google ou
            Apple). L'utilisateur est responsable de la confidentialité de ses identifiants
            et de toute activité réalisée depuis son compte. Un compte peut comporter
            plusieurs profils. Le traitement des données est décrit dans la{' '}
            <Link to="/confidentialite">politique de confidentialité</Link>.
          </p>

          <h2>5. Tarifs et conditions de vente</h2>
          <p>
            <strong>Le Service est actuellement fourni gratuitement</strong>, en l'état,
            sans publicité. <strong>Aucune offre payante n'est proposée à ce jour</strong>{' '}
            et aucun paiement n'est requis pour accéder aux fonctionnalités.
          </p>
          <p>
            Si une offre payante (abonnement « Premium ») venait à être proposée, des
            conditions de vente spécifiques seraient publiées et soumises à l'acceptation
            expresse de l'utilisateur <strong>avant tout paiement</strong>. Elles
            préciseraient notamment le prix toutes taxes comprises, la durée, les modalités
            de reconduction et de résiliation, ainsi que les conditions d'exercice du{' '}
            <strong>droit de rétractation de 14 jours</strong> prévu par le Code de la
            consommation pour les contrats conclus à distance (sous réserve, pour un contenu
            ou service numérique fourni immédiatement, de l'accord exprès du consommateur et
            de sa renonciation à ce droit).
          </p>

          <h2>6. Propriété intellectuelle</h2>
          <p>
            Le logiciel, son code, son interface et ses éléments graphiques sont la
            propriété de l'Éditeur. L'utilisateur bénéficie d'un droit d'usage personnel,
            non exclusif et non transférable. Toute reproduction, modification,
            décompilation ou redistribution non autorisée est interdite.
          </p>

          <h2>7. Disponibilité et limitation de responsabilité</h2>
          <p>
            Le Service est fourni « en l'état » et « selon disponibilité ». L'Éditeur ne
            garantit pas un fonctionnement ininterrompu ou exempt d'erreurs et peut faire
            évoluer, suspendre ou interrompre tout ou partie du Service. Dans les limites
            permises par la loi, la responsabilité de l'Éditeur ne saurait être engagée pour
            les dommages indirects résultant de l'utilisation ou de l'impossibilité
            d'utiliser le Service, ni pour les faits relevant des services tiers ou de
            l'utilisateur.
          </p>

          <h2>8. Suspension et résiliation</h2>
          <p>
            L'utilisateur peut cesser d'utiliser le Service et supprimer son compte à tout
            moment. L'Éditeur peut suspendre ou résilier l'accès d'un utilisateur en cas de
            manquement aux présentes conditions, notamment en cas d'usage du Service à des
            fins illicites.
          </p>

          <h2>9. Modification des conditions</h2>
          <p>
            L'Éditeur peut modifier les présentes conditions. La version applicable est
            celle en vigueur au moment de l'utilisation du Service ; la date de dernière
            mise à jour figure en tête du présent document.
          </p>

          <h2>10. Droit applicable et litiges</h2>
          <p>
            Les présentes conditions sont soumises au droit français. En cas de litige, et
            après tentative de résolution amiable, le consommateur peut recourir gratuitement
            à un médiateur de la consommation. À défaut de résolution amiable, les tribunaux
            français sont compétents dans les conditions prévues par la loi. Contact :{' '}
            {LEGAL.contactEmail}.
          </p>
        </div>

        <Link to="/" className="legal-back">← Retour à l'accueil</Link>
      </div>
    </div>
  );
}
