import { Link } from 'react-router-dom';
import { AppLogo } from '../AppLogo';
import { GITHUB_REPO } from '../../config/vitrine';

/**
 * Footer vitrine (design Vanta) : 4 colonnes, hairline cyan, logotype géant en
 * filigrane (outline) et fondu vers le noir absolu. Classes globales scopées
 * sous `.vitrine`.
 */
export function FooterVitrine() {
  const year = new Date().getFullYear();
  return (
    <footer className="ftr">
      <div className="ftr-inner">
        <div className="ftr-cols">
          <div className="ftr-col ftr-brand">
            <div className="brand-line">
              <AppLogo size={24} />
              <span>Iptvax</span>
            </div>
            <p className="ftr-tagline">
              Votre client IPTV moderne, multi-plateforme. Sans publicité, sans
              compromis.
            </p>
          </div>
          <div className="ftr-col">
            <h4>Produit</h4>
            <div className="links">
              <Link to="/downloads">Téléchargements</Link>
              <a href="/#pricing">Premium</a>
              <Link to="/tv-link">Appairage TV</Link>
            </div>
          </div>
          <div className="ftr-col">
            <h4>Compte</h4>
            <div className="links">
              <Link to="/login">Se connecter</Link>
              <Link to="/settings">Mon compte</Link>
            </div>
          </div>
          <div className="ftr-col">
            <h4>Légal</h4>
            <div className="links">
              <Link to="/mentions-legales">Mentions légales</Link>
              <Link to="/cgv">CGV</Link>
              <Link to="/confidentialite">Confidentialité</Link>
              <a href={`https://github.com/${GITHUB_REPO}`} target="_blank" rel="noreferrer noopener">
                GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
      <div className="ftr-bottom">
        <span>© {year} Iptvax. Tous droits réservés.</span>
        <span className="mono">Fait avec ❤ en France.</span>
      </div>
      <div className="ftr-watermark" aria-hidden="true">
        Iptvax
      </div>
    </footer>
  );
}
