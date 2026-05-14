import { useState, type FormEvent } from 'react';
import { useXtream } from '../context/XtreamContext';
import styles from './Auth.module.css';

export function Auth() {
  const { login, isAuthenticating, authError } = useXtream();
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!serverUrl.trim() || !username.trim() || !password.trim()) return;
    let url = serverUrl.trim().replace(/\/$/, '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) url = `http://${url}`;
    await login({ serverUrl: url, username: username.trim(), password: password.trim() }).catch(() => {});
  };

  return (
    <div className={styles.page}>
      {/* ── Left art panel ── */}
      <div className={styles.art}>
        <div className={styles.artContent}>
          {/* Brand */}
          <div className={styles.artBrand}>
            <div className={styles.artBrandMark}>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>
            </div>
            <span className={styles.artBrandName}>
              aurora<span className={styles.artBrandDot}>.</span>
            </span>
          </div>

          {/* Blurb */}
          <div className={styles.artBlurb}>
            <div className={styles.artEyebrow}>Premium IPTV · Self-hosted</div>
            <h2 className={styles.artHeadline}>
              Your channels.<br/>Cinematic, every screen.
            </h2>
            <p className={styles.artDesc}>
              One subscription, every device. 4K HDR with Dolby Vision and Atmos
              passthrough on supported TVs. Built for remote-control navigation,
              designed for the living room.
            </p>
            <div className={styles.artStats}>
              <div className={styles.artStat}><div className="n">240+</div><div className="l">Live channels</div></div>
              <div className={styles.artStat}><div className="n">14k</div><div className="l">Films · Séries</div></div>
              <div className={styles.artStat}><div className="n">4K</div><div className="l">Dolby Vision</div></div>
            </div>
          </div>
        </div>

        {/* Floating card 1 — channel */}
        <div className={`${styles.floatingCard} ${styles.fc1}`}>
          <div className={styles.fcThumb16}>
            <div className={styles.fcCode}>
              <span className={styles.fcStripe} />SAT
            </div>
            <div className={styles.livePill}>
              <span className={styles.liveDot} />LIVE
            </div>
          </div>
          <div className={styles.fcInfo}>
            <div className={styles.fcName}>Satori Drama</div>
            <div className={styles.fcSub}>Vermilion S2E6 · 14k watching</div>
          </div>
        </div>

        {/* Floating card 2 — poster */}
        <div className={`${styles.floatingCard} ${styles.fc2}`}>
          <div className={styles.fcThumb23}>
            <div className={styles.fcPosterTitle}>The Last<br/>Cartographer</div>
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className={styles.formWrap}>
        <div className={styles.formEyebrow}>Connectez-vous pour continuer</div>
        <h1 className={styles.formTitle}>Bienvenue.</h1>
        <p className={styles.formSub}>Entrez vos identifiants Xtream Codes. On s'occupe du reste.</p>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label}>URL du serveur</label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/></svg>
              </span>
              <input
                className={styles.input}
                type="text"
                placeholder="http://votre-serveur.com:8080"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                required
                autoFocus
                autoComplete="off"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Nom d'utilisateur</label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
              </span>
              <input
                className={styles.input}
                type="text"
                placeholder="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Mot de passe</label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
              </span>
              <input
                className={styles.input}
                type="password"
                placeholder="••••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
          </div>

          {authError && (
            <div className={styles.error}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              {authError}
            </div>
          )}

          <button className={styles.submitBtn} type="submit" disabled={isAuthenticating}>
            {isAuthenticating ? (
              <><span className={styles.spinner} />Connexion…</>
            ) : (
              <><svg viewBox="0 0 24 24" fill="currentColor" width="18" height="18"><path d="M8 5v14l11-7z"/></svg>Se connecter</>
            )}
          </button>
        </form>

        <div className={styles.formMeta}>
          <span>v2.4.0 · TLS sécurisé</span>
          <button type="button" className={styles.formMeta} style={{ background:'none',border:'none',color:'#a855f7',cursor:'pointer',fontSize:13 }}>
            Besoin d'aide ?
          </button>
        </div>
      </div>
    </div>
  );
}
