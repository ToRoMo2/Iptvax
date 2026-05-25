import styles from './DeviceShowcase.module.css';

/**
 * Maquette interactive 3 plateformes : téléphone (Android/iOS), laptop
 * (Windows/web) et TV (LG/Samsung/Android TV). Chaque mockup affiche un
 * placeholder représentant l'accueil de l'app.
 *
 * Pour intégrer de vrais screenshots plus tard : remplacer le composant
 * `<FakeHome variant=… />` dans chaque écran par `<img src="…" alt="…" />`.
 * Les frames (téléphone, laptop, TV) restent inchangées.
 */
export function DeviceShowcase() {
  return (
    <div className={styles.showcase} role="presentation">
      {/* Téléphone (portrait, gauche) */}
      <div className={styles.deviceWrap}>
        <div className={`${styles.device} ${styles.phone}`}>
          <div className={styles.phoneFrame}>
            <div className={styles.phoneScreen}>
              <div className={styles.phoneNotch} />
              <FakeHome variant="phone" />
            </div>
          </div>
        </div>
        <div className={styles.deviceLabel}>Android · iOS</div>
      </div>

      {/* Laptop (centre, plus grand) */}
      <div className={styles.deviceWrap}>
        <div className={`${styles.device} ${styles.laptop}`}>
          <div className={styles.laptopScreen}>
            <div className={styles.laptopInner}>
              <FakeHome variant="desktop" />
            </div>
          </div>
          <div className={styles.laptopBase} />
        </div>
        <div className={styles.deviceLabel}>Windows · Web</div>
      </div>

      {/* TV (paysage, droite) */}
      <div className={styles.deviceWrap}>
        <div className={`${styles.device} ${styles.tv}`}>
          <div className={styles.tvScreen}>
            <div className={styles.tvInner}>
              <FakeHome variant="tv" />
            </div>
          </div>
          <div className={styles.tvStand} />
          <div className={styles.tvBase} />
        </div>
        <div className={styles.deviceLabel}>LG · Samsung · Android TV</div>
      </div>
    </div>
  );
}

/** Placeholder qui imite l'accueil Iptvax (rangées de cartes). Remplaçable
 *  par un vrai screenshot quand disponible. */
function FakeHome({ variant }: { variant: 'phone' | 'desktop' | 'tv' }) {
  const cols = variant === 'phone' ? 2 : variant === 'desktop' ? 5 : 4;
  const rowCount = variant === 'phone' ? 2 : 2;

  return (
    <div className={styles.fakeScreen}>
      <div className={styles.fakeBar} style={{ width: '40%' }} />
      <div className={styles.fakeBarAccent} />
      <div
        className={`${styles.fakeRow} ${styles.fakeRow1}`}
        style={{ gridTemplateColumns: '1fr' }}
      >
        <div className={`${styles.fakeCard} ${styles.fakeCardWide} ${styles.fakeCardAccent}`} />
      </div>
      {Array.from({ length: rowCount }).map((_, rowIdx) => (
        <div key={rowIdx}>
          <div className={styles.fakeBar} style={{ width: '25%', marginBottom: 6 }} />
          <div
            className={styles.fakeRow}
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {Array.from({ length: cols }).map((_, i) => (
              <div key={i} className={styles.fakeCard} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
