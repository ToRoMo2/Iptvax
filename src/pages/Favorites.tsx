import styles from './Browse.module.css';

export function Favorites() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>★ Favoris</h1>
      </header>
      <p className={styles.empty}>
        Vos favoris (chaînes, films, séries) marqués avec ★ apparaîtront ici.
      </p>
    </div>
  );
}
