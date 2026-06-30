import { Link } from 'react-router-dom';
import { AppLogo } from '../AppLogo';
import { TmdbAttribution } from '../TmdbAttribution';
import { GITHUB_REPO } from '../../config/vitrine';

/**
 * Footer vitrine (design Umbra) : 4 colonnes, hairline dorée, watermark
 * « Umbra » géant en outline et fondu vers le fond espresso. Classes globales
 * scopées sous `.vitrine`.
 */
export function FooterVitrine() {
  const year = new Date().getFullYear();
  return (
    <footer className="ftr">
      <div className="ftr-inner">
        <div className="ftr-cols">
          <div className="ftr-col ftr-brand">
            <div className="brand-line">
              <AppLogo size={24} className="logo-mark" />
              <span className="wordmark">Umbra</span>
            </div>
            <p className="ftr-tagline">
              Le streaming, à la lumière du cinéma. Vos contenus sur tous vos
              écrans — sans publicité, sans compromis.
            </p>
          </div>
          <div className="ftr-col">
            <h4>Produit</h4>
            <div className="links">
              <Link to="/downloads">Téléchargements</Link>
              <a href="/#pricing">Premium</a>
              <a href="/#features">Fonctionnalités</a>
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
        <span>© {year} Umbra. Tous droits réservés.</span>
        <span className="mono">Fait avec ❤ en France.</span>
      </div>
      <div className="ftr-inner" style={{ paddingTop: 0, paddingBottom: 24 }}>
        <TmdbAttribution compact />
      </div>
      <div className="ftr-watermark" aria-hidden="true">
        Umbra
      </div>
    </footer>
  );
}
