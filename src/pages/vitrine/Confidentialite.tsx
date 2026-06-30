import { Link } from 'react-router-dom';
import { LEGAL } from '../../config/legal';

/**
 * Politique de confidentialité (RGPD). Décrit les traitements réels du Service :
 * compte Supabase, profils, bibliothèque, identifiants de services tiers saisis
 * par l'utilisateur, enrichissement TMDB. À relire par un juriste avant mise en
 * ligne ; champs éditeur dans `config/legal.ts`.
 */
export function Confidentialite() {
  return (
    <div className="legal-page">
      <div className="legal-container">
        <h1 className="legal-title">Politique de confidentialité</h1>
        <p className="legal-sub">{LEGAL.brand}</p>
        <p className="legal-update">Dernière mise à jour : {LEGAL.lastUpdated}</p>

        <div className="legal-body">
          <h2>1. Responsable du traitement</h2>
          <p>
            Le responsable du traitement des données est {LEGAL.editorName}
            {LEGAL.editorType === 'company' ? `, dont le siège est situé ${LEGAL.editorAddress}` : ''}.
            Pour toute question relative à vos données ou l'exercice de vos droits :{' '}
            <strong>{LEGAL.contactEmail}</strong>.
          </p>

          <h2>2. Données collectées</h2>
          <p>Dans le cadre de l'utilisation du Service, nous traitons :</p>
          <ul>
            <li>
              <strong>Données de compte :</strong> adresse email, et selon le mode de
              connexion, l'identifiant fourni par votre fournisseur d'identité (Google,
              Apple). Aucun mot de passe n'est conservé en clair.
            </li>
            <li>
              <strong>Profils :</strong> nom de profil, avatar, préférences.
            </li>
            <li>
              <strong>Bibliothèque :</strong> favoris, historique de lecture et position de
              reprise, et, le cas échéant, vos notes et critiques personnelles.
            </li>
            <li>
              <strong>Identifiants de services tiers :</strong> les identifiants de
              connexion aux services tiers que <strong>vous renseignez vous-même</strong>{' '}
              sont stockés de façon sécurisée, à seule fin de vous permettre d'utiliser le
              logiciel sur vos appareils. Ils ne sont ni revendus, ni partagés, ni exploités
              à d'autres fins.
            </li>
            <li>
              <strong>Données techniques :</strong> données strictement nécessaires au
              fonctionnement et à la sécurité (session d'authentification, journaux
              techniques).
            </li>
          </ul>

          <h2>3. Finalités et bases légales</h2>
          <ul>
            <li>
              <strong>Fourniture du Service</strong> (compte, profils, synchronisation,
              lecture) — exécution du contrat (art. 6.1.b RGPD).
            </li>
            <li>
              <strong>Fonctionnalités communautaires</strong> (profil rendu public,
              partage de notes) — votre <strong>consentement</strong>, activées uniquement
              si vous les activez (opt-in) et révocables à tout moment (art. 6.1.a).
            </li>
            <li>
              <strong>Sécurité et prévention des abus</strong> — intérêt légitime
              (art. 6.1.f).
            </li>
          </ul>

          <h2>4. Destinataires et sous-traitants</h2>
          <p>
            Nous faisons appel à des prestataires agissant en qualité de sous-traitants ou
            de destinataires :
          </p>
          <ul>
            <li>
              <strong>Supabase</strong> — authentification et hébergement de la base de
              données (compte, profils, bibliothèque).
            </li>
            <li>
              <strong>Google / Apple</strong> — uniquement si vous choisissez la connexion
              via ces fournisseurs d'identité.
            </li>
            <li>
              <strong>The Movie Database (TMDB)</strong> — enrichissement des métadonnées et
              visuels. Lors de l'enrichissement, l'application interroge directement TMDB
              depuis votre appareil (titres recherchés) ; TMDB peut à cette occasion
              recevoir votre adresse IP.
            </li>
            <li>
              <strong>Hébergeur du site</strong> — {LEGAL.hostingName}.
            </li>
          </ul>
          <p>
            Aucune donnée n'est vendue. Aucun cookie publicitaire ni traceur tiers à des
            fins de profilage n'est utilisé.
          </p>

          <h2>5. Transferts hors Union européenne</h2>
          <p>
            Certains prestataires peuvent traiter des données en dehors de l'Union
            européenne. Le cas échéant, ces transferts sont encadrés par les garanties
            appropriées prévues par le RGPD (notamment les clauses contractuelles types de
            la Commission européenne).
          </p>

          <h2>6. Durée de conservation</h2>
          <p>
            Les données de compte et de bibliothèque sont conservées tant que votre compte
            est actif. Elles sont supprimées à la suppression de votre compte, sous réserve
            des durées de conservation imposées par la loi. Les journaux techniques sont
            conservés pour une durée limitée à des fins de sécurité.
          </p>

          <h2>7. Vos droits</h2>
          <p>
            Conformément au RGPD, vous disposez des droits d'accès, de rectification,
            d'effacement, de limitation, d'opposition et de portabilité de vos données,
            ainsi que du droit de retirer votre consentement à tout moment. Vous pouvez les
            exercer en écrivant à {LEGAL.contactEmail}. Vous avez également le droit
            d'introduire une réclamation auprès de la <strong>CNIL</strong> (
            <a href="https://www.cnil.fr" target="_blank" rel="noreferrer noopener">www.cnil.fr</a>
            ).
          </p>

          <h2>8. Cookies et stockage local</h2>
          <p>
            Le Service utilise uniquement les éléments de stockage strictement nécessaires à
            son fonctionnement (maintien de votre session de connexion, préférences locales
            telles que le profil actif ou les réglages de lecture). Ces éléments ne servent
            pas au suivi publicitaire.
          </p>

          <h2>9. Contact</h2>
          <p>
            Pour toute question relative à la présente politique ou à vos données :{' '}
            {LEGAL.contactEmail}. Voir aussi les{' '}
            <Link to="/mentions-legales">mentions légales</Link> et les{' '}
            <Link to="/cgv">conditions générales</Link>.
          </p>
        </div>

        <Link to="/" className="legal-back">← Retour à l'accueil</Link>
      </div>
    </div>
  );
}
