import { Link } from 'react-router-dom';
import styles from './Legal.module.css';

export function Confidentialite() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Politique de confidentialité</h1>
        <p className={styles.sub}>Umbra · Traitement des données</p>
        <div className={styles.placeholder}>
          <strong>Page en cours de rédaction.</strong>
          <br />
          La politique de confidentialité (données collectées, finalités, base
          légale RGPD, cookies, droits utilisateur) sera publiée prochainement.
        </div>
        <Link to="/" className={styles.back}>
          ← Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
