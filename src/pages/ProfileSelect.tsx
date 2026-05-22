import { useState, useEffect, type FormEvent, type CSSProperties } from 'react';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { useIptvProfile } from '../contexts/IptvProfileContext';
import { useSubscription } from '../contexts/SubscriptionContext';
import { useI18n } from '../contexts/I18nContext';
import { Premium } from './Premium';
import { AppLogo } from '../components/AppLogo';
import { Focusable } from '../components/Focusable';
import { isNative } from '../lib/platform';
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
  const { isPremium } = useSubscription();
  const { t } = useI18n();
  const [manage, setManage] = useState(false);
  const [editor, setEditor] = useState<EditorState>(null);
  const [upsell, setUpsell] = useState(false);

  // Aucun profil → ouvre directement le formulaire de création
  useEffect(() => {
    if (!loading && profiles.length === 0) setEditor({ mode: 'create' });
  }, [loading, profiles.length]);

  // Navigation D-pad (Android TV) : la grille de profils est rendue en
  // éléments `Focusable` (norigin). On empêche le scroll natif des flèches
  // et on ancre le focus télécommande sur le premier profil. Restreint au
  // mode natif — sinon le web desktop afficherait un halo/lift au chargement
  // sans interaction. Inactif aussi quand l'éditeur est ouvert (ses champs
  // texte ont besoin des flèches pour le curseur). Voir docs/native-port.md §4.
  useEffect(() => {
    if (!isNative || loading || editor || upsell) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' || e.key === 'ArrowRight'
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    const id = setTimeout(() => setFocus('pf-card-0'), 120);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(id);
    };
  }, [loading, editor, upsell]);

  // Tier gratuit : 1 seul profil. Au-delà → page Premium.
  const canAddProfile = isPremium || profiles.length === 0;
  const requestAdd = () => {
    if (canAddProfile) setEditor({ mode: 'create' });
    else setUpsell(true);
  };

  if (upsell) {
    return (
      <Premium
        lockedFeature={t('profileSelect.multiProfileFeature')}
        onBack={() => setUpsell(false)}
      />
    );
  }

  if (loading) {
    return (
      <div className={styles.screen}>
        <AppLogo spin size={44} />
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
        <AppLogo size={28} />
        IPTVAX
      </div>

      <h1 className={styles.title}>{t('profileSelect.who')}</h1>
      <p className={styles.sub}>{t('profileSelect.choose')}</p>

      <div className={styles.grid}>
        {profiles.map((p, i) => {
          const act = () =>
            manage ? setEditor({ mode: 'edit', profile: p }) : selectProfile(p);
          return (
            <div key={p.id} className={styles.cardWrap}>
              <Focusable
                focusKey={i === 0 ? 'pf-card-0' : undefined}
                className={`${styles.card} ${manage ? styles.cardManage : ''}`}
                focusedClassName={`rc-focused ${styles.cardFocused}`}
                title={p.name}
                onClick={act}
                onEnter={act}
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
              </Focusable>
            </div>
          );
        })}

        <div className={styles.cardWrap}>
          <Focusable
            className={styles.card}
            focusedClassName={`rc-focused ${styles.cardFocused}`}
            onClick={requestAdd}
            onEnter={requestAdd}
          >
            <span className={styles.addAvatar}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="34" height="34" strokeLinecap="round">
                <path d="M12 5v14M5 12h14"/>
              </svg>
            </span>
            <span className={styles.cardName}>{t('profileSelect.add')}</span>
          </Focusable>
        </div>
      </div>

      {profiles.length > 0 && (
        <Focusable
          className={`${styles.manageBtn} ${manage ? styles.manageBtnActive : ''}`}
          onClick={() => setManage((m) => !m)}
          onEnter={() => setManage((m) => !m)}
        >
          {manage ? t('profileSelect.done') : t('profileSelect.manage')}
        </Focusable>
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
  const { t } = useI18n();
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
        throw new Error('badCredentials');
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
        err instanceof Error && err.message === 'badCredentials'
          ? t('profileSelect.badCredentials')
          : t('profileSelect.connectFail'),
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
      setError(t('profileSelect.deleteFail'));
      setBusy(false);
    }
  };

  return (
    <div className={styles.screen}>
      <div className={styles.brand}>
        <AppLogo size={28} />
        IPTVAX
      </div>

      <div className={styles.editor}>
        <h1 className={styles.title}>
          {editing ? t('profileSelect.edit') : t('profileSelect.create')}
        </h1>

        <div className={styles.preview}>
          <span className={styles.avatarLg} style={avatarStyle(color)}>
            <span className={styles.avatarEmojiLg}>{avatar}</span>
          </span>
          <span className={styles.previewName}>{name.trim() || t('profileSelect.defaultName')}</span>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-name">{t('profileSelect.nameLabel')}</label>
            <input
              id="pf-name"
              type="text"
              placeholder={t('profileSelect.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              required
              autoFocus
            />
          </div>

          <div className={styles.pickerGroup}>
            <span className={styles.fieldLabel}>{t('profileSelect.avatar')}</span>
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
            <span className={styles.fieldLabel}>{t('profileSelect.color')}</span>
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
          <span className={styles.sectionLabel}>{t('profileSelect.iptvSource')}</span>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-server">{t('profileSelect.serverUrlLabel')}</label>
            <input
              id="pf-server"
              type="text"
              placeholder={t('profileSelect.serverUrlPlaceholder')}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-user">{t('profileSelect.usernameLabel')}</label>
            <input
              id="pf-user"
              type="text"
              placeholder={t('profileSelect.usernamePlaceholder')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="off"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="pf-pass">{t('profileSelect.passwordLabel')}</label>
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
                <><AppLogo spin size={18} />{t('profileSelect.verifying')}</>
              ) : editing ? (
                t('profileSelect.save')
              ) : (
                t('profileSelect.createBtn')
              )}
            </button>

            {editing && (
              <button type="button" className={styles.deleteBtn} onClick={() => void handleDelete()} disabled={busy}>
                {t('profileSelect.delete')}
              </button>
            )}

            {!editing && canCancel && (
              <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
