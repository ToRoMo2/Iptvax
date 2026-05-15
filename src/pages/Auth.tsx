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
    <div className={styles.login}>
      <div className={styles.brand}>
        <span className={styles.brandMark} />
        VANTA
      </div>

      <div className={styles.card}>
        <div className={styles.eyebrow}>Connexion au serveur</div>
        <h1 className={styles.title}>Xtream Codes</h1>
        <p className={styles.sub}>
          Entrez vos identifiants Xtream Codes. Votre compte reste sur cet appareil — on s'occupe du reste.
        </p>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="auth-server">URL du serveur</label>
            <input
              id="auth-server"
              type="text"
              placeholder="http://votre-serveur.com:8080"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              required
              autoFocus
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="auth-user">Nom d'utilisateur</label>
            <input
              id="auth-user"
              type="text"
              placeholder="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="auth-pass">Mot de passe</label>
            <input
              id="auth-pass"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </div>

          {authError && (
            <div className={styles.error}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              {authError}
            </div>
          )}

          <button
            className={`btn btn-primary ${styles.connect}`}
            type="submit"
            disabled={isAuthenticating}
          >
            {isAuthenticating ? (
              <><span className={styles.spinner} />Connexion…</>
            ) : (
              'Se connecter'
            )}
          </button>
        </form>

        <div className={styles.tip}>
          Connexion TLS sécurisée · v2.4.0
        </div>
      </div>
    </div>
  );
}
