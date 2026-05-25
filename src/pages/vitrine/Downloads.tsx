import { useMemo } from 'react';
import {
  DOWNLOADS,
  detectVisitorPlatform,
  type DownloadAsset,
  type DownloadId,
} from '../../config/vitrine';
import styles from './Downloads.module.css';

const PLATFORM_LABELS: Record<DownloadId, string> = {
  android: 'Android',
  windows: 'Windows',
  webos: 'TV LG (webOS)',
  tizen: 'TV Samsung (Tizen)',
};

const PLATFORM_HINTS: Record<DownloadId, string> = {
  android:
    "Sur Android, autorisez l'installation depuis sources inconnues puis ouvrez l'APK téléchargé.",
  windows:
    'Sur Windows, lancez l\'installeur. Windows Defender peut afficher un avertissement Smart Screen — cliquez "Plus d\'infos" puis "Exécuter quand même".',
  webos:
    'Sur TV LG, le sideload nécessite le Developer Mode (compte LG développeur gratuit) et l\'outil ares-install.',
  tizen:
    'Sur TV Samsung, le sideload nécessite Tizen Studio et l\'IP de votre TV en mode développeur.',
};

export function Downloads() {
  const detected = useMemo(() => detectVisitorPlatform(), []);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Téléchargez Iptvax</h1>
        <p className={styles.subtitle}>
          Choisissez votre plateforme. Les binaires sont publiés sur GitHub
          Releases et signés.
        </p>
        {detected && (
          <div className={styles.detected}>
            <span className={styles.dot} />
            Détecté : {PLATFORM_LABELS[detected]}
          </div>
        )}
      </header>

      <div className={styles.grid}>
        {DOWNLOADS.map((d) => (
          <DownloadCard
            key={d.id}
            asset={d}
            featured={detected === d.id}
          />
        ))}
      </div>
    </div>
  );
}

function DownloadCard({
  asset,
  featured,
}: {
  asset: DownloadAsset;
  featured: boolean;
}) {
  return (
    <article className={`${styles.card} ${featured ? styles.cardFeatured : ''}`}>
      {featured && <span className={styles.badge}>Recommandé pour vous</span>}

      <div className={styles.row}>
        <div className={styles.icon}>
          <PlatformIcon id={asset.id} />
        </div>
        <div className={styles.titleBlock}>
          <h3>{asset.label}</h3>
          <span>{asset.filename}</span>
        </div>
      </div>

      <p className={styles.desc}>{asset.description}</p>

      <p className={styles.hint}>{PLATFORM_HINTS[asset.id]}</p>

      <div className={styles.actions}>
        <a
          className={`btn ${featured ? 'btn-primary' : 'btn-secondary'}`}
          href={asset.url}
          rel="noreferrer noopener"
        >
          Télécharger
        </a>
      </div>
    </article>
  );
}

function PlatformIcon({ id }: { id: DownloadId }) {
  if (id === 'android') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="26" height="26">
        <path d="M17.523 15.341a1.05 1.05 0 110-2.099 1.05 1.05 0 010 2.1zm-11.046 0a1.05 1.05 0 110-2.099 1.05 1.05 0 010 2.1zm11.422-6.106l2.097-3.63a.42.42 0 10-.728-.42l-2.122 3.677c-1.625-.74-3.45-1.155-5.378-1.155s-3.753.414-5.378 1.155L4.268 5.184a.42.42 0 10-.728.42l2.097 3.63C2.16 11.32.0 14.42 0 17.91h24c0-3.49-2.16-6.59-5.101-8.675z" />
      </svg>
    );
  }
  if (id === 'windows') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
        <path d="M0 3.45L9.91 2.1v9.51H0V3.45zm10.86-1.5L24 0v11.42H10.86V1.95zM0 12.59h9.91v9.51L0 20.75V12.59zm10.86 0H24V24l-13.14-1.83V12.59z" />
      </svg>
    );
  }
  if (id === 'webos') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
