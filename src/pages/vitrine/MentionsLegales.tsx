import { Link } from 'react-router-dom';
import styles from './Legal.module.css';

export function MentionsLegales() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Mentions légales</h1>
        <p className={styles.sub}>Iptvax</p>
        <div className={styles.placeholder}>
          <strong>Page en cours de rédaction.</strong>
          <br />
          Les mentions légales détaillées (éditeur, hébergeur, contact,
          propriété intellectuelle) seront publiées prochainement.
        </div>
        <Link to="/" className={styles.back}>
          ← Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
