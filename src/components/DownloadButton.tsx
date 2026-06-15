import { useNavigate } from 'react-router-dom';
import { useDownloads } from '../contexts/DownloadsContext';
import { useI18n } from '../contexts/I18nContext';
import { downloadPercent } from '../utils/downloads';
import type { DownloadRequest } from '../types/download.types';
import styles from './DownloadButton.module.css';

interface Props {
  /** Descripteur complet (sans `profileId`, injecté par le contexte). */
  request: Omit<DownloadRequest, 'profileId'>;
  /** Variante icône seule (fiches compactes / listes d'épisodes). */
  compact?: boolean;
  className?: string;
  /**
   * Intercepte le DÉMARRAGE d'un nouveau téléchargement (premier clic, pas de
   * transfert en cours) : si fourni, le bouton appelle ce callback AU LIEU de
   * lancer `download(request)` directement. Sert au choix de version (films à
   * plusieurs sources) : le parent ouvre la popup « Choisir une version » et
   * déclenche lui-même le téléchargement de la version retenue. Les autres
   * états (pause/reprise/terminé/erreur) restent gérés par le bouton sur
   * `request`.
   */
  onRequestDownload?: () => void;
}

function IconDownload() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
    </svg>
  );
}
function IconCheck() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
function IconPause() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
  );
}
function IconResume() {
  return <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z" /></svg>;
}
function IconRetry() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  );
}
function IconLock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function DownloadButton({ request, compact, className, onRequestDownload }: Props) {
  const { available, allowed, byId, download, pause, resume, remove } = useDownloads();
  const { t } = useI18n();
  const navigate = useNavigate();

  // Plateforme sans téléchargement (web vitrine / TV) → rien.
  if (!available) return null;

  const item = byId(request.id);
  const status = item?.status;
  const pct = item ? downloadPercent(item) : 0;

  const handleClick = () => {
    // Gating Premium : redirige vers l'offre au lieu de télécharger.
    if (!allowed) {
      navigate('/premium');
      return;
    }
    if (!item || status === 'error') {
      // Premier démarrage avec choix de version : laisse le parent ouvrir la
      // popup et lancer le téléchargement de la version retenue.
      if (onRequestDownload && !item) {
        onRequestDownload();
        return;
      }
      void download(request);
      return;
    }
    if (status === 'downloading' || status === 'queued') {
      pause(item.id);
      return;
    }
    if (status === 'paused') {
      resume(item.id);
      return;
    }
    if (status === 'done') {
      if (window.confirm(t('downloads.confirmRemove'))) remove(item.id);
    }
  };

  let icon = <IconDownload />;
  let label = t('downloads.download');
  let cls = styles.btn;
  if (!allowed) {
    icon = <IconLock />;
    label = t('downloads.download');
  } else if (status === 'done') {
    icon = <IconCheck />;
    label = t('downloads.downloaded');
    cls = `${styles.btn} ${styles.done}`;
  } else if (status === 'downloading' || status === 'queued') {
    icon = <IconPause />;
    label = status === 'queued' ? t('downloads.queued') : `${pct}%`;
    cls = `${styles.btn} ${styles.active}`;
  } else if (status === 'paused') {
    icon = <IconResume />;
    label = t('downloads.paused');
    cls = `${styles.btn} ${styles.active}`;
  } else if (status === 'error') {
    icon = <IconRetry />;
    label = t('downloads.retry');
    cls = `${styles.btn} ${styles.error}`;
  }

  return (
    <button
      type="button"
      className={`${cls} ${compact ? styles.compact : ''} ${className ?? ''}`}
      onClick={handleClick}
      aria-label={label}
      title={label}
    >
      {/* Anneau de progression (téléchargement en cours). */}
      {(status === 'downloading') && (
        <span className={styles.ring} style={{ ['--pct' as string]: `${pct}%` }} aria-hidden="true" />
      )}
      <span className={styles.icon}>{icon}</span>
      {!compact && <span className={styles.label}>{label}</span>}
    </button>
  );
}
