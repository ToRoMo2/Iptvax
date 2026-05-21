import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useSocial } from '../contexts/SocialContext';
import { useI18n } from '../contexts/I18nContext';
import type { TranslationKey } from '../i18n';
import { socialService } from '../services/social.service';
import { Focusable } from '../components/Focusable';
import type { PublicProfileStats, DirectorySort } from '../types/social.types';
import browse from './Browse.module.css';
import styles from './Community.module.css';

const SORTS: { v: DirectorySort; labelKey: TranslationKey }[] = [
  { v: 'active', labelKey: 'community.sortActive' },
  { v: 'top-members', labelKey: 'community.sortTop' },
  { v: 'recent', labelKey: 'community.sortRecent' },
  { v: 'most-watched', labelKey: 'community.sortMostWatched' },
];

const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

export function Community() {
  const navigate = useNavigate();
  const { activeProfile } = useIptvProfile();
  const { isFollowing, toggleFollow } = useSocial();
  const { t, tc } = useI18n();

  const [sort, setSort] = useState<DirectorySort>('active');
  const [list, setList] = useState<PublicProfileStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    socialService.listDirectory(sort).then((rows) => {
      if (cancelled) return;
      setList(rows);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [sort]);

  return (
    <div className={browse.page}>
      <header className={browse.header}>
        <div className={browse.titleBlock}>
          <h1 className={browse.title}>{t('community.title')}</h1>
          <p className={browse.pageSub}>
            {loading
              ? t('common.loading')
              : tc('community.countOne', 'community.countOther', list.length)}
          </p>
        </div>
        <Focusable
          className={styles.backCine}
          onEnter={() => navigate('/journal')}
          onClick={() => navigate('/journal')}
        >
          {t('community.backCine')}
        </Focusable>
      </header>

      <div className={styles.sortRow}>
        {SORTS.map((s) => (
          <Focusable
            key={s.v}
            className={`${styles.sortPill} ${
              sort === s.v ? styles.sortActive : ''
            }`}
            onEnter={() => setSort(s.v)}
            onClick={() => setSort(s.v)}
          >
            {t(s.labelKey)}
          </Focusable>
        ))}
      </div>

      {loading && (
        <div className={styles.list}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className={`${browse.skeleton} ${styles.rowSkeleton}`} />
          ))}
        </div>
      )}

      {!loading && list.length === 0 && (
        <p className={browse.empty}>{t('community.empty')}</p>
      )}

      {!loading && list.length > 0 && (
        <div className={styles.list}>
          {list.map((m) => {
            const isMe = m.id === activeProfile?.id;
            const handle = m.discriminator
              ? `${m.name}#${m.discriminator}`
              : m.name;
            return (
              <Focusable
                key={m.id}
                className={styles.member}
                onEnter={() => navigate(`/communaute/${m.id}`)}
                onClick={() => navigate(`/communaute/${m.id}`)}
                ariaLabel={handle}
              >
                <span
                  className={styles.avatar}
                  style={{ background: `var(--${m.color})` }}
                >
                  {m.avatar}
                </span>
                <div className={styles.ident}>
                  <span className={styles.handle}>
                    {m.name}
                    {m.discriminator && (
                      <span className={styles.disc}>#{m.discriminator}</span>
                    )}
                    {isMe && <span className={styles.youTag}>{t('community.you')}</span>}
                  </span>
                  <span className={styles.stats}>
                    {tc('community.ratedOne', 'community.ratedOther', m.ratedCount)} · ★{' '}
                    {fmt(m.avgRating)} ·{' '}
                    {tc('community.followersOne', 'community.followersOther', m.followers)} ·{' '}
                    {t('community.reput')} {fmt(m.memberAvg)} ({m.memberVotes})
                  </span>
                </div>
                {!isMe && (
                  <button
                    className={`${styles.followBtn} ${
                      isFollowing(m.id) ? styles.following : ''
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFollow(m.id);
                    }}
                  >
                    {isFollowing(m.id) ? t('community.following') : t('community.follow')}
                  </button>
                )}
              </Focusable>
            );
          })}
        </div>
      )}
    </div>
  );
}
