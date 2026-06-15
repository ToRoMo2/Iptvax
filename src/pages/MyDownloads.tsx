import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDownloads } from '../contexts/DownloadsContext';
import { useI18n } from '../contexts/I18nContext';
import { safeImgUrl } from '../utils/image';
import { formatBytes, downloadPercent, localPlayerState } from '../utils/downloads';
import type { DownloadItem } from '../types/download.types';
import styles from './MyDownloads.module.css';

interface Props {
  /** Rendu autonome (mode hors-ligne) : header + bandeau + bouton retour. */
  offline?: boolean;
  /** Quitte le mode hors-ligne (retente la connexion au serveur). */
  onExitOffline?: () => void;
}

export function MyDownloads({ offline, onExitOffline }: Props) {
  const { available, items, pause, resume, cancel, remove } = useDownloads();
  const { t } = useI18n();
  const navigate = useNavigate();

  const { movies, series } = useMemo(() => {
    const sorted = [...items].sort((a, b) => b.addedAt - a.addedAt);
    return {
      movies: sorted.filter((d) => d.type === 'movie'),
      series: sorted.filter((d) => d.type === 'episode'),
    };
  }, [items]);

  const play = (item: DownloadItem) => {
    const state = localPlayerState(item);
    if (state) navigate('/player', { state });
  };

  const renderItem = (item: DownloadItem) => {
    const pct = downloadPercent(item);
    const poster = safeImgUrl(item.posterLocalPath ?? item.poster);
    const done = item.status === 'done';
    return (
      <div key={item.id} className={styles.card}>
        <button
          type="button"
          className={styles.thumb}
          onClick={() => done && play(item)}
          disabled={!done}
          aria-label={t('downloads.playOffline')}
        >
          {poster ? <img src={poster} alt="" decoding="async" /> : <div className={styles.thumbPh} />}
          {done && (
            <span className={styles.playOverlay}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22"><path d="M8 5v14l11-7z" /></svg>
            </span>
          )}
        </button>

        <div className={styles.meta}>
          <div className={styles.title}>{item.title}</div>
          <div className={styles.sub}>{item.subtitle}</div>

          {!done && (
            <div className={styles.progressRow}>
              <div className={styles.bar}>
                <div className={styles.barFill} style={{ width: `${pct}%` }} />
              </div>
              <span className={styles.status}>
                {item.status === 'downloading' && `${pct}% · ${formatBytes(item.bytesDownloaded)}`}
                {item.status === 'queued' && t('downloads.queued')}
                {item.status === 'paused' && t('downloads.paused')}
                {item.status === 'error' && (item.error || t('downloads.failed'))}
              </span>
            </div>
          )}
          {done && <div className={styles.sizeLine}>{formatBytes(item.bytesTotal)}</div>}
        </div>

        <div className={styles.actions}>
          {item.status === 'downloading' || item.status === 'queued' ? (
            <button type="button" className={styles.action} onClick={() => pause(item.id)}>
              {t('downloads.pause')}
            </button>
          ) : item.status === 'paused' || item.status === 'error' ? (
            <button type="button" className={styles.action} onClick={() => resume(item.id)}>
              {t('downloads.resume')}
            </button>
          ) : null}
          <button
            type="button"
            className={`${styles.action} ${styles.danger}`}
            onClick={() => {
              if (window.confirm(t('downloads.confirmRemove'))) {
                if (done) remove(item.id);
                else cancel(item.id);
              }
            }}
          >
            {t('downloads.remove')}
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className={`${styles.page} ${offline ? styles.offlinePage : ''}`}>
      {offline && (
        <div className={styles.offlineBar}>
          <span>{t('downloads.offlineMode')}</span>
          {onExitOffline && (
            <button type="button" className={styles.retryBtn} onClick={onExitOffline}>
              {t('common.retry')}
            </button>
          )}
        </div>
      )}

      <h1 className={styles.heading}>{t('downloads.title')}</h1>

      {!available && <p className={styles.empty}>{t('downloads.unavailable')}</p>}

      {available && items.length === 0 && (
        <div className={styles.emptyWrap}>
          <p className={styles.empty}>{t('downloads.empty')}</p>
          <p className={styles.emptyHint}>{t('downloads.emptyHint')}</p>
        </div>
      )}

      {movies.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('downloads.movies')}</h2>
          <div className={styles.list}>{movies.map(renderItem)}</div>
        </section>
      )}
      {series.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>{t('downloads.series')}</h2>
          <div className={styles.list}>{series.map(renderItem)}</div>
        </section>
      )}
    </div>
  );
}
