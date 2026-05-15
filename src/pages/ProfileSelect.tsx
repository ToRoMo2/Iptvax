import { useState, useEffect, type FormEvent, type CSSProperties } from 'react';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { xtreamService } from '../services/xtream.service';
import {
  PROFILE_AVATARS,
  PROFILE_COLORS,
  type IptvProfile,
  type ProfileColor,
} from '../types/profile.types';
import styles from './ProfileSelect.module.css';

type EditorState =
  | { mode: 'create' }
  | { mode: 'edit'; profile: IptvProfile }
  | null;

function avatarStyle(color: ProfileColor): CSSProperties {
  return { '--pf': `var(--${color})` } as CSSProperties;
}

export function ProfileSelect() {
  const { profiles, loading, selectProfile } = useIptvProfile();
  const [manage, setManage] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);

  // Aucun profil → ouvre directement le formulaire de création
  useEffect(() => {
    if (!loading && profiles.length === 0) setEditor({ mode: 'create' });
  }, [loading, profiles.length]);

  if (loading) {
    return (
      <div className={styles.screen}>
        <div className="spinner" />
      </div>
    );
  }

  if (editor) {
    return (
      <ProfileEditor
        state={editor}
        onClose={() => setEditor(null)}
        canCancel={profiles.length > 0}
      />
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.brand}>
        <span className={styles.brandMark} />
        VANTA
      </div>

      <h1 className={styles.title}>Qui regarde&nbsp;?</h1>
      <p className={styles.sub}>Choisissez un profil pour accéder à son contenu.</p>

      <div className={styles.grid}>
        {profiles.map((p) => (
          <div key={p.id} className={styles.cardWrap}>
            <button
              className={`${styles.card} ${manage ? styles.cardManage : ''}`}
              onClick={() => (manage ? setEditor({ mode: 'edit', profile: p }) : selectProfile(p))}
              title={p.name}
            >
              <span className={styles.avatar} style={avatarStyle(p.color)}>
                <span className={styles.avatarEmoji}>{p.avatar}</span>
                {manage && (
                  <span className={styles.editOverlay}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="22" height="22" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </span>
                )}
              </span>
              <span className={styles.cardName}>{p.name}</span>
            </button>
          </div>
        ))}

        <div className={styles.cardWrap}>
          <button className={styles.card} onClick={() => setEditor({ mode: 'create' })}>
            <span className={styles.addAvatar}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="34" height="34" strokeLinecap="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </span>
            <span className={styles.cardName}>Ajouter un profil</span>
          </button>
        </div>
      </div>

      {profiles.length > 0 && (
        <button
          className={`${styles.manageBtn} ${manage ? styles.manageBtnActive : ''}`}
          onClick={() => setManage((m) => !m)}
        >
          {manage ? 'Terminé' : 'Gérer les profils'}
        </button>
      )}
    </div>
  );
}

/* ── Éditeur (création / modification) ─────────────────────────────────────── */

interface EditorProps {
  state: NonNullable<EditorState>;
  onClose: () => void;
  canCancel: boolean;
}

function ProfileEditor({ state, onClose, canCancel }: EditorProps) {
  const { createProfile, updateProfile, deleteProfile, selectProfile } = useIptvProfile();
  const editing = state.mode === 'edit' ? state.profile : null;

  const [name, setName] = useState(editing?.name ?? '');
  const [avatar, setAvatar] = useState(editing?.avatar ?? PROFILE_AVATARS[0]);
  const [color, setColor] = useState<ProfileColor>(editing?.color ?? PROFILE_COLORS[0]);
  const [serverUrl, setServerUrl] = useState(editing?.xtream_server_url ?? '');
  const [username, setUsername] = useState(editing?.xtream_username ?? '');
  const [password, setPassword] = useState(editing?.xtream_password ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !serverUrl.trim() || !username.trim() || !password.trim()) return;

    let url = serverUrl.trim().replace(/\/$/, '');
    if (!/^https?:\/\//.test(url)) url = `http://${url}`;
    const creds = { serverUrl: url, username: username.trim(), password: password.trim() };

    setBusy(true);
    setError(null);
    try {
      const res = await xtreamService.authenticate(creds);
      if (!res?.user_info || res.user_info.auth === 0) {
        throw new Error('Identifiants incorrects');
      }

      const payload = {
        name: name.trim(),
        avatar,
        color,
        xtream_server_url: url,
        xtream_username: creds.username,
        xtream_password: creds.password,
      };

      if (editing) {
        await updateProfile(editing.id, payload);
        onClose();
      } else {
        const created = await createProfile(payload);
        selectProfile(created);
      }
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'Identifiants incorrects'
          ? 'Identifiants incorrects'
          : 'Connexion au serveur impossible. Vérifiez l\'URL et les identifiants.',
      );
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await deleteProfile(editing.id);
      onClose();
    } catch {
      setError('Suppression impossible');
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.brand}>
        <span className={styles.brandMark} />
        VANTA
      </div>

      <div className={styles.editor}>
        <h1 className={styles.title}>
          {editing ? 'Modifier le profil' : 'Nouveau profil'}
        </h1>

        <div className={styles.preview}>
          <span className={styles.avatarLg} style={avatarStyle(color)}>
            <span className={styles.avatarEmojiLg}>{avatar}</span>
          </span>
          <span className={styles.previewName}>{name.trim() || 'Profil'}</span>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-name">Nom du profil</label>
            <input
              id="pf-name"
              type="text"
              placeholder="Ex : Salon, Enfants, Papa…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              required
              autoFocus
            />
          </div>

          <div className={styles.pickerGroup}>
            <span className={styles.fieldLabel}>Avatar</span>
            <div className={styles.emojiGrid}>
              {PROFILE_AVATARS.map((e) => (
                <button
                  type="button"
                  key={e}
                  className={`${styles.emojiBtn} ${avatar === e ? styles.emojiBtnActive : ''}`}
                  onClick={() => setAvatar(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.pickerGroup}>
            <span className={styles.fieldLabel}>Couleur</span>
            <div className={styles.colorRow}>
              {PROFILE_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  className={`${styles.colorBtn} ${color === c ? styles.colorBtnActive : ''}`}
                  style={{ '--pf': `var(--${c})` } as CSSProperties}
                  onClick={() => setColor(c)}
                  aria-label={c}
                />
              ))}
            </div>
          </div>

          <div className={styles.divider} />
          <span className={styles.sectionLabel}>Source IPTV</span>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-server">URL du serveur</label>
            <input
              id="pf-server"
              type="text"
              placeholder="http://votre-serveur.com:8080"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-user">Nom d'utilisateur</label>
            <input
              id="pf-user"
              type="text"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-pass">Mot de passe</label>
            <input
              id="pf-pass"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          {error && (
            <div className={styles.error}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
              </svg>
              {error}
            </div>
          )}

          <div className={styles.actions}>
            <button className={`btn btn-primary ${styles.save}`} type="submit" disabled={busy}>
              {busy ? (
                <><span className={styles.spinner} />Vérification…</>
              ) : editing ? (
                'Enregistrer'
              ) : (
                'Créer le profil'
              )}
            </button>

            {editing && (
              <button type="button" className={styles.deleteBtn} onClick={() => void handleDelete()} disabled={busy}>
                Supprimer ce profil
              </button>
            )}

            {!editing && canCancel && (
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
                Annuler
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
