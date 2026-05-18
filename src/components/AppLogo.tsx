import styles from './AppLogo.module.css';

interface AppLogoProps {
  size?: number;
  spin?: boolean;
  className?: string;
}

export function AppLogo({ size = 32, spin = false, className }: AppLogoProps) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={`${styles.logo}${spin ? ` ${styles.spinning}` : ''}${className ? ` ${className}` : ''}`}
    />
  );
}
