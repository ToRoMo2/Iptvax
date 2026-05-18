import { useState, type FormEvent } from 'react';
import { useSupabaseAuth } from '../contexts/SupabaseAuthContext';
import { AppLogo } from '../components/AppLogo';
import styles from './Login.module.css';

type Mode = 'signin' | 'signup' | 'confirm';

export function Login() {
  const { signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail, authError } = useSupabaseAuth();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleEmailSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setLoading(true);
    try {
      if (mode === 'signin') {
        await signInWithEmail(email, password);
      } else {
        await signUpWithEmail(email, password);
        setMode('confirm');
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Une erreur est survenue');
    } finally {
      setLoading(false);
    }
  };

  const error = formError ?? authError;

  if (mode === 'confirm') {
    return (
      <div className={styles.login}>
        <div className={styles.brand}>
          <AppLogo size={28} />
          IPTVAX
        </div>
        <div className={styles.card}>
          <div className={styles.eyebrow}>Inscription réussie</div>
          <h1 className={styles.title}>Vérifiez votre email</h1>
          <p className={styles.sub}>
            Un lien de confirmation a été envoyé à <strong>{email}</strong>. Cliquez dessus pour activer votre compte.
          </p>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setMode('signin')}>
            Retour à la connexion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.login}>
      <div className={styles.brand}>
        <span className={styles.brandMark} />
        IPTVAX
      </div>

      <div className={styles.card}>
        <div className={styles.eyebrow}>Votre compte</div>
        <h1 className={styles.title}>{mode === 'signin' ? 'Connexion' : 'Créer un compte'}</h1>
        <p className={styles.sub}>
          {mode === 'signin'
            ? 'Connectez-vous pour accéder à vos favoris et votre historique sur tous vos appareils.'
            : 'Créez un compte gratuit pour synchroniser vos données.'}
        </p>

        {/* Social login */}
        <div className={styles.socials}>
          <button className={styles.socialBtn} onClick={() => void signInWithGoogle()} type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continuer avec Google
          </button>

          <button className={styles.socialBtn} onClick={() => void signInWithApple()} type="button">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.39.07 2.35.74 3.15.8 1.19-.24 2.33-.93 3.6-.84 1.54.12 2.7.72 3.44 1.84-3.17 1.9-2.42 5.77.51 6.93-.6 1.48-1.38 2.95-2.7 4.15M12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25"/>
            </svg>
            Continuer avec Apple
          </button>
        </div>

        <div className={styles.divider}>
          <span>ou</span>
        </div>

        {/* Email / password form */}
        <form onSubmit={handleEmailSubmit}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="login-email">Adresse email</label>
            <input
              id="login-email"
              type="email"
              placeholder="vous@exemple.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="login-password">Mot de passe</label>
            <input
              id="login-password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
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

          <button
            className={`btn btn-primary ${styles.submit}`}
            type="submit"
            disabled={loading}
          >
            {loading ? (
              <><AppLogo spin size={18} />{mode === 'signin' ? 'Connexion…' : 'Création…'}</>
            ) : (
              mode === 'signin' ? 'Se connecter' : 'Créer mon compte'
            )}
          </button>
        </form>

        <div className={styles.toggle}>
          {mode === 'signin' ? (
            <>Pas encore de compte ?{' '}
              <button onClick={() => { setMode('signup'); setFormError(null); }}>S'inscrire</button>
            </>
          ) : (
            <>Déjà un compte ?{' '}
              <button onClick={() => { setMode('signin'); setFormError(null); }}>Se connecter</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
