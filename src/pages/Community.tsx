import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useSocial } from '../contexts/SocialContext';
import { socialService } from '../services/social.service';
import { Focusable } from '../components/Focusable';
import type { PublicProfileStats, DirectorySort } from '../types/social.types';
import browse from './Browse.module.css';
import styles from './Community.module.css';

const SORTS: { v: DirectorySort; label: string }[] = [
  { v: 'active', label: 'Actifs' },
  { v: 'top-members', label: 'Mieux notés' },
  { v: 'recent', label: 'Récents' },
  { v: 'most-watched', label: 'Plus gros catalogue' },
];

const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1).replace('.', ','));

export function Community() {
  const navigate = useNavigate();
  const { activeProfile } = useIptvProfile();
  const { isFollowing, toggleFollow } = useSocial();

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
          <h1 className={browse.title}>Communauté</h1>
          <p className={browse.pageSub}>
            {loading
              ? 'Chargement…'
              : `${list.length} membre${list.length !== 1 ? 's' : ''} au ciné public`}
          </p>
        </div>
        <Focusable
          className={styles.backCine}
          onEnter={() => navigate('/journal')}
          onClick={() => navigate('/journal')}
        >
          ← Mon ciné
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
            {s.label}
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
        <p className={browse.empty}>
          Aucun membre public pour l'instant. Activez « Rendre mon ciné public »
          dans les paramètres pour ouvrir la voie !
        </p>
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
                    {isMe && <span className={styles.youTag}>vous</span>}
                  </span>
                  <span className={styles.stats}>
                    {m.ratedCount} noté{m.ratedCount !== 1 ? 's' : ''} · ★{' '}
                    {fmt(m.avgRating)} · {m.followers} abonné
                    {m.followers !== 1 ? 's' : ''} · réput. ★{' '}
                    {fmt(m.memberAvg)} ({m.memberVotes})
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
                    {isFollowing(m.id) ? '✓ Suivi' : '+ Suivre'}
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
