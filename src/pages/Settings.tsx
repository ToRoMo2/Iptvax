import { useState } from 'react';
import { useXtream } from '../context/XtreamContext';
import styles from './Settings.module.css';

type Tab = 'account' | 'playback' | 'about';

// ── Toggle switch component ────────────────────────────────────────────────────
function Toggle({ id, checked, onChange }: { id: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={styles.toggle}>
      <input
        id={id}
        type="checkbox"
        className={styles.toggleInput}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className={styles.toggleTrack} />
      <span className={styles.toggleThumb} />
    </label>
  );
}

// ── Row components ────────────────────────────────────────────────────────────
function InfoRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={`${styles.rowValue} ${muted ? styles.rowValueMuted : ''}`}>{value}</span>
    </div>
  );
}

function ToggleRow({ label, description, id, checked, onChange }: {
  label: string;
  description?: string;
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <div className={styles.rowLabel}>{label}</div>
        {description && <div className={styles.rowDesc}>{description}</div>}
      </div>
      <Toggle id={id} checked={checked} onChange={onChange} />
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconUser() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>;
}
function IconPlay() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><polygon points="5 3 19 12 5 21 5 3"/></svg>;
}
function IconInfo() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>;
}
function IconLogout() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="15" height="15"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>;
}

const TABS: { id: Tab; label: string; Icon: () => JSX.Element }[] = [
  { id: 'account',  label: 'Compte',    Icon: IconUser },
  { id: 'playback', label: 'Lecture',   Icon: IconPlay },
  { id: 'about',    label: 'À propos',  Icon: IconInfo },
];

export function Settings() {
  const { userInfo, credentials, logout } = useXtream();
  const [tab, setTab] = useState<Tab>('account');

  // Playback settings (stored in state — could persist to localStorage)
  const [autoPlay, setAutoPlay]     = useState(true);
  const [hwDecode, setHwDecode]     = useState(true);
  const [remembPos, setRemembPos]   = useState(true);

  // Expiry
  const expiryDate = userInfo?.exp_date
    ? new Date(parseInt(userInfo.exp_date) * 1000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  const isExpired = userInfo?.status === 'Expired';

  return (
    <div className={styles.screen}>
      <div className={styles.page}>
        {/* ── Header ── */}
        <header className={styles.header}>
          <h1 className={styles.title}>Paramètres</h1>
          <p className={styles.sub}>Compte, lecture et informations de l'application.</p>
        </header>

        {/* ── Tab bar ── */}
        <div className={styles.tabs}>
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`${styles.tab} ${tab === id ? styles.tabActive : ''}`}
              onClick={() => setTab(id)}
            >
              <Icon />
              {label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className={styles.content}>

          {/* ── Account tab ── */}
          {tab === 'account' && (
            <>
              {userInfo && (
                <section className={styles.section}>
                  <div className={styles.sectionLabel}>Informations du compte</div>
                  <InfoRow label="Utilisateur" value={userInfo.username} />
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>Statut</span>
                    <span className={`${styles.badge} ${isExpired ? styles.badgeExpired : styles.badgeActive}`}>
                      <span className={styles.badgePulse} />
                      {isExpired ? 'Expiré' : 'Actif'}
                    </span>
                  </div>
                  {expiryDate && <InfoRow label="Expiration" value={expiryDate} />}
                  <InfoRow label="Connexions max" value={userInfo.max_connections} />
                  <InfoRow label="Connexions actives" value={userInfo.active_cons} />
                </section>
              )}

              {credentials && (
                <section className={styles.section}>
                  <div className={styles.sectionLabel}>Serveur</div>
                  <InfoRow label="URL" value={credentials.serverUrl} />
                  <InfoRow label="Identifiant" value={credentials.username} />
                  <InfoRow label="Protocole" value={credentials.serverUrl.startsWith('https') ? 'HTTPS · Chiffré' : 'HTTP'} muted />
                </section>
              )}

              <section className={styles.section}>
                <div className={styles.sectionLabel}>Session</div>
                <div className={styles.row}>
                  <div className={styles.rowText}>
                    <div className={styles.rowLabel}>Se déconnecter</div>
                    <div className={styles.rowDesc}>Met fin à la session Xtream Codes en cours</div>
                  </div>
                  <button className={styles.logoutBtn} onClick={logout}>
                    <IconLogout />
                    Se déconnecter
                  </button>
                </div>
              </section>
            </>
          )}

          {/* ── Playback tab ── */}
          {tab === 'playback' && (
            <>
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Lecture automatique</div>
                <ToggleRow
                  id="autoplay"
                  label="Lecture automatique"
                  description="Démarre la vidéo dès qu'une chaîne est sélectionnée"
                  checked={autoPlay}
                  onChange={setAutoPlay}
                />
                <ToggleRow
                  id="remembpos"
                  label="Mémoriser la position"
                  description="Reprend depuis là où vous vous êtes arrêté"
                  checked={remembPos}
                  onChange={setRemembPos}
                />
              </section>

              <section className={styles.section}>
                <div className={styles.sectionLabel}>Performance</div>
                <ToggleRow
                  id="hwdecode"
                  label="Décodage matériel"
                  description="Utilise le GPU pour décoder H.264 / H.265 (recommandé)"
                  checked={hwDecode}
                  onChange={setHwDecode}
                />
              </section>

              <section className={styles.section}>
                <div className={styles.sectionLabel}>Format de flux</div>
                <InfoRow label="Live TV" value="MPEG-TS via proxy" muted />
                <InfoRow label="Films" value="HLS (.m3u8) · Fallback MP4" muted />
                <InfoRow label="Séries" value="HLS (.m3u8) · Fallback extension" muted />
              </section>
            </>
          )}

          {/* ── About tab ── */}
          {tab === 'about' && (
            <>
              <section className={styles.section}>
                <div className={styles.sectionLabel}>Aurora IPTV</div>
                <InfoRow label="Version" value="2.4.0" />
                <InfoRow label="Build" value="2026.05" muted />
                <InfoRow label="Framework" value="React 18 · Vite · TypeScript" muted />
                <InfoRow label="Rendu vidéo" value="HLS.js · Video.js" muted />
              </section>

              <section className={styles.section}>
                <div className={styles.sectionLabel}>Fonctionnalités</div>
                <InfoRow label="Live TV" value="✓ Supporté" />
                <InfoRow label="Films VOD" value="✓ Supporté" />
                <InfoRow label="Séries" value="✓ Supporté" />
                <InfoRow label="Favoris" value="✓ Supporté" />
                <InfoRow label="Recherche globale" value="✓ Supporté" />
                <InfoRow label="Historique de lecture" value="✓ Supporté" />
                <InfoRow label="4K · HDR" value="Selon le serveur" muted />
              </section>

              <div className={styles.versionChip}>
                <span>Aurora IPTV</span>
                <span className={styles.versionDot} />
                <span>v2.4.0</span>
                <span className={styles.versionDot} />
                <span>TLS sécurisé</span>
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
