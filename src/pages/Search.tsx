import styles from './Browse.module.css';

export function Search() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>Recherche</h1>
          <p className={styles.pageSub}>Live · Films · Séries</p>
        </div>
      </header>
      <p className={styles.empty}>La recherche globale (Live + Films + Séries) arrive bientôt.</p>
    </div>
  );
}
