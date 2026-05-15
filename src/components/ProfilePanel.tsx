import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { useSupabaseAuth } from '../contexts/SupabaseAuthContext';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useXtream } from '../context/XtreamContext';
import styles from './ProfilePanel.module.css';

interface Props {
  onClose: () => void;
}

export function ProfilePanel({ onClose }: Props) {
  const { user, signOut } = useSupabaseAuth();
  const { activeProfile, clearActiveProfile, updateProfile } = useIptvProfile();
  const { userInfo } = useXtream();

  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const profileName = activeProfile?.name ?? 'Profil';
  const email = user?.email ?? '';

  const expDate = userInfo?.exp_date
    ? new Date(parseInt(userInfo.exp_date) * 1000).toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  const startEditing = () => {
    setNameInput(profileName);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 40);
  };

  const saveName = async () => {
    const trimmed = nameInput.trim();
    if (activeProfile && trimmed && trimmed !== profileName) {
      await updateProfile(activeProfile.id, { name: trimmed });
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void saveName();
    if (e.key === 'Escape') setEditing(false);
  };

  const handleSignOut = async () => {
    onClose();
    await signOut();
  };

  const handleSwitchProfile = () => {
    onClose();
    clearActiveProfile();
  };

  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const avatarVar = {
    '--pf': `var(--${activeProfile?.color ?? 'profile-1'})`,
  } as CSSProperties;

  return (
    <div className={styles.panel} ref={panelRef}>
      {/* ── Header : profil IPTV actif ─────────────────────────────── */}
      <div className={styles.header}>
        <div className={styles.avatar} style={avatarVar}>
          <span className={styles.avatarEmoji}>{activeProfile?.avatar ?? '🎬'}</span>
        </div>

        <div className={styles.identity}>
          {editing ? (
            <input
              ref={inputRef}
              className={styles.nameInput}
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => void saveName()}
              onKeyDown={handleKeyDown}
              maxLength={32}
            />
          ) : (
            <button className={styles.nameBtn} onClick={startEditing} title="Renommer le profil">
              <span className={styles.displayName}>{profileName}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" width="11" height="11" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          )}
          <span className={styles.email}>{email}</span>
        </div>
      </div>

      {/* ── Infos serveur IPTV ─────────────────────────────────────── */}
      {activeProfile && (
        <>
          <div className={styles.divider} />
          <div className={styles.section}>
            <div className={styles.sectionLabel}>Serveur IPTV</div>
            <div className={styles.serverUrl}>
              {activeProfile.xtream_server_url.replace(/^https?:\/\//, '')}
            </div>
            <div className={styles.serverMeta}>
              <span className={styles.metaChip}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                {activeProfile.xtream_username}
              </span>
              {expDate && (
                <span className={styles.metaChip}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                  {expDate}
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {/* ── Actions ────────────────────────────────────────────────── */}
      <div className={styles.divider} />
      <button className={styles.actionBtn} onClick={handleSwitchProfile}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7"/>
        </svg>
        Changer de profil
      </button>
      <button className={`${styles.actionBtn} ${styles.signOut}`} onClick={() => void handleSignOut()}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/>
          <line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
        Se déconnecter du compte
      </button>
    </div>
  );
}
