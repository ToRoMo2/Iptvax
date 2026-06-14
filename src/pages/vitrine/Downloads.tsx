import { useMemo, useRef } from 'react';
import {
  DOWNLOADS,
  detectVisitorPlatform,
  type DownloadAsset,
  type DownloadId,
} from '../../config/vitrine';
import { GITHUB_REPO } from '../../config/vitrine';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import type { CSSProperties } from 'react';

const PLATFORM_LABELS: Record<DownloadId, string> = {
  android: 'Android',
  windows: 'Windows',
  webos: 'TV LG (webOS)',
  tizen: 'TV Samsung (Tizen)',
};

/** Astuce d'install courte (style commentaire mono dans la maquette). */
const PLATFORM_HINT: Record<DownloadId, { tag: string; text: string }> = {
  android: {
    tag: '# sources inconnues',
    text: "autorisez l'installation depuis sources inconnues puis ouvrez l'APK téléchargé.",
  },
  windows: {
    tag: '# smartscreen',
    text: 'Defender peut afficher un avertissement : « Plus d\'infos » puis « Exécuter quand même ».',
  },
  webos: {
    tag: '# developer mode',
    text: 'compte LG développeur (gratuit) + outil ares-install.',
  },
  tizen: {
    tag: '# tizen studio',
    text: 'Tizen Studio + l\'IP de votre TV en mode développeur.',
  },
};

export function Downloads() {
  const ref = useRef<HTMLDivElement>(null);
  const detected = useMemo(() => detectVisitorPlatform(), []);
  useScrollReveal(ref);

  // Carte détectée placée en tête (comme le `prepend` du design).
  const ordered = useMemo(() => {
    if (!detected) return DOWNLOADS;
    return [...DOWNLOADS].sort((a, b) =>
      a.id === detected ? -1 : b.id === detected ? 1 : 0,
    );
  }, [detected]);

  return (
    <div className="dl-page" ref={ref}>
      <header className="dl-head">
        <h1 className="dl-title" data-reveal>
          Téléchargez Umbra
        </h1>
        <p className="dl-sub" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
          Choisissez votre plateforme. Les binaires sont publiés sur GitHub&nbsp;Releases
          et signés.
        </p>
        {detected && (
          <div className="dl-detected" data-reveal style={{ '--rd': '140ms' } as CSSProperties}>
            <span className="live-dot" />
            Détecté : {PLATFORM_LABELS[detected]}
          </div>
        )}
      </header>

      <div className="dl-grid">
        {ordered.map((d, i) => (
          <DownloadCard
            key={d.id}
            asset={d}
            featured={detected === d.id}
            delay={`${i * 80}ms`}
          />
        ))}
      </div>

      <p className="dl-foot-note" data-reveal>
        // Les binaires sont open-source et publiés sur{' '}
        <a href={`https://github.com/${GITHUB_REPO}/releases`} target="_blank" rel="noreferrer noopener">
          GitHub Releases
        </a>
        . Aucun compte requis pour télécharger.
      </p>
    </div>
  );
}

function DownloadCard({
  asset,
  featured,
  delay,
}: {
  asset: DownloadAsset;
  featured: boolean;
  delay: string;
}) {
  const hint = PLATFORM_HINT[asset.id];
  return (
    <article
      className={`dl-card${featured ? ' featured' : ''}`}
      data-platform={asset.id}
      data-reveal
      style={{ '--rd': delay } as CSSProperties}
    >
      {featured && <span className="dl-badge">Recommandé pour vous</span>}

      <div className="dl-row">
        <div className="dl-icon">
          <PlatformIcon id={asset.id} />
        </div>
        <div className="dl-titleblock">
          <h3>{asset.label}</h3>
          <span className="dl-filename mono">{asset.filename}</span>
        </div>
      </div>

      <p className="dl-desc">{asset.description}</p>
      <p className="dl-hint">
        <b>{hint.tag}</b> — {hint.text}
      </p>

      <div className="dl-actions">
        <span className="magnetic" style={{ width: '100%' }}>
          <a
            className={`btn ${featured ? 'btn-primary' : 'btn-ghost'}`}
            style={{ width: '100%' }}
            href={asset.url}
            rel="noreferrer noopener"
          >
            Télécharger
          </a>
        </span>
      </div>
    </article>
  );
}

function PlatformIcon({ id }: { id: DownloadId }) {
  if (id === 'android') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.523 15.341a1.05 1.05 0 110-2.099 1.05 1.05 0 010 2.1zm-11.046 0a1.05 1.05 0 110-2.099 1.05 1.05 0 010 2.1zm11.422-6.106l2.097-3.63a.42.42 0 10-.728-.42l-2.122 3.677c-1.625-.74-3.45-1.155-5.378-1.155s-3.753.414-5.378 1.155L4.268 5.184a.42.42 0 10-.728.42l2.097 3.63C2.16 11.32 0 14.42 0 17.91h24c0-3.49-2.16-6.59-5.101-8.675z" />
      </svg>
    );
  }
  if (id === 'windows') {
    return (
      <svg viewBox="0 0 24 24" fill="currentColor">
        <path d="M0 3.45L9.91 2.1v9.51H0V3.45zm10.86-1.5L24 0v11.42H10.86V1.95zM0 12.59h9.91v9.51L0 20.75V12.59zm10.86 0H24V24l-13.14-1.83V12.59z" />
      </svg>
    );
  }
  if (id === 'webos') {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="13" rx="2" />
        <line x1="8" y1="21" x2="16" y2="21" />
        <line x1="12" y1="17" x2="12" y2="21" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  );
}
