import styles from './Browse.module.css';

export function Favorites() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Favoris</h1>
          <p className={styles.pageSub}>Vos chaînes, films et séries marqués</p>
        </div>
      </header>
      <p className={styles.empty}>
        Vos favoris (chaînes, films, séries) marqués apparaîtront ici.
      </p>
    </div>
  );
}
