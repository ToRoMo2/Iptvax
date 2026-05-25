import { Link } from 'react-router-dom';
import styles from './Legal.module.css';

export function CGV() {
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.title}>Conditions générales de vente</h1>
        <p className={styles.sub}>Iptvax · Abonnement Premium</p>
        <div className={styles.placeholder}>
          <strong>Page en cours de rédaction.</strong>
          <br />
          Les CGV de l'abonnement Premium (tarifs, durée, renouvellement,
          résiliation, droit de rétractation) seront publiées prochainement.
        </div>
        <Link to="/" className={styles.back}>
          ← Retour à l'accueil
        </Link>
      </div>
    </div>
  );
}
