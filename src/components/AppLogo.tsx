import styles from './AppLogo.module.css';
// Import Vite : indispensable pour les builds natifs (.ipk webOS, .wgt Tizen)
// où le `pathname` racine n'est pas `/` → un `src="/logo.png"` ne résout pas.
// Vite transforme cet import en chemin relatif inclus dans le bundle.
import logoUrl from '/logo.png?url';

interface AppLogoProps {
  size?: number;
  spin?: boolean;
  className?: string;
}

// `BASE_URL` est substitué au build par Vite (= `base` dans vite.config.ts).
// Web : `/` → `/logo.png` ; Tizen/webOS : `./` → `./logo.png` (relatif à
// l'index.html servi depuis `file://` dans l'app .wgt/.ipk).
const LOGO_URL = `${import.meta.env.BASE_URL}logo.png`;

export function AppLogo({ size = 32, spin = false, className }: AppLogoProps) {
  return (
    <img
      src={LOGO_URL}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`${styles.logo}${spin ? ` ${styles.spinning}` : ''}${className ? ` ${className}` : ''}`}
    />
  );
}
