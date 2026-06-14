import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { supabase } from '../lib/supabase';
import { useI18n } from '../contexts/I18nContext';
import { AppLogo } from '../components/AppLogo';
import { ACTIVE_PROFILE_KEY } from '../contexts/IptvProfileContext';
import { tvPairingService } from '../services/tvPairing.service';
import styles from './TvPairing.module.css';

// URL publique du site web (la page d'appairage `/tv-link` y est servie). En
// natif, `window.location.origin` vaut `https://localhost` → inutilisable dans
// un QR : VITE_WEB_URL doit être renseigné pour les builds TV. Voir .env.example.
const WEB_URL =
  (import.meta.env.VITE_WEB_URL as string | undefined)?.replace(/\/$/, '') ||
  window.location.origin;

// Filet : si le signal Realtime est manqué, on tente quand même le claim.
const POLL_MS = 6000;

/**
 * Écran d'accueil TV (Phase 2f) : affiché en mode natif TV à la place du
 * formulaire de connexion. La TV crée une session d'appairage, affiche un QR,
 * écoute (Realtime broadcast + poll), récupère la session du compte et la pose
 * via `setSession` → `onAuthStateChange` enchaîne sur le reste de l'app.
 * Voir docs/native-port.md §4.
 */
export function TvPairing() {
  const { t } = useI18n();
  const [qr, setQr] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [debugError, setDebugError] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);
  const claimingRef = useRef(false);

  // Tente de récupérer la session ; ne fait rien tant que le téléphone n'a
  // pas autorisé. Idempotent (garde `claimingRef` contre les appels croisés).
  const claim = useCallback(async () => {
    const code = codeRef.current;
    if (!code || claimingRef.current) return;
    claimingRef.current = true;
    try {
      const session = await tvPairingService.claim(code);
      if (session) {
        setLinking(true);
        // Pré-amorce le profil choisi sur le téléphone → l'app entre directement
        // dessus (IptvProfileProvider le restaure depuis localStorage).
        localStorage.setItem(ACTIVE_PROFILE_KEY, session.profileId);
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
        });
        if (sessionError) {
          // Tokens expirés ou invalides : on ne peut pas récupérer sans rescanner.
          console.error('[tv-pairing] setSession failed', sessionError);
          setLinking(false);
          setFailed(true);
          setDebugError(sessionError.message);
          return;
        }
        // onAuthStateChange (SupabaseAuthProvider) prend le relais normalement.
        // Filet webOS / Tizen : sur certains navigateurs embarqués l'event
        // n'est pas capté dans le même cycle React → reload forcé pour que
        // SupabaseAuthProvider.getSession() récupère la session depuis le storage.
        window.location.reload();
      }
    } catch (err) {
      // Transitoire (le poll / Realtime réessaiera), mais on trace pour debug.
      console.error('[tv-pairing] claim failed', err);
    } finally {
      claimingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;

    const teardown = () => {
      if (poll) clearInterval(poll);
      if (expiry) clearTimeout(expiry);
      unlisten?.();
      poll = expiry = undefined;
      unlisten = undefined;
    };

    // Crée une session d'appairage + son QR ; se replanifie à l'expiration.
    const boot = async () => {
      teardown();
      setFailed(false);
      setDebugError(null);
      setQr(null);
      try {
        const handle = await tvPairingService.create();
        if (cancelled) return;
        codeRef.current = handle.code;

        const url = `${WEB_URL}/tv-link?code=${encodeURIComponent(handle.code)}`;
        // `margin: 4` → la zone blanche de silence (quiet zone) requise pour
        // scanner est intégrée à l'image PNG elle-même (pas de fond CSS blanc).
        const dataUrl = await QRCode.toDataURL(url, {
          margin: 4,
          width: 512,
          color: { dark: '#000000', light: '#FFFFFF' },
        });
        if (cancelled) return;
        setQr(dataUrl);

        // Réveil instantané quand le téléphone autorise + poll de repli.
        unlisten = tvPairingService.listen(handle.code, () => void claim());
        poll = setInterval(() => void claim(), POLL_MS);

        // À l'expiration, on régénère un code (la TV n'est pas surveillée).
        const ttl = Math.max(0, handle.expiresAt - Date.now());
        expiry = setTimeout(() => void boot(), ttl);
      } catch (err) {
        console.error('[tv-pairing] boot failed', err);
        if (!cancelled) {
          setFailed(true);
          setDebugError(err instanceof Error ? err.message : String(err));
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
      teardown();
    };
  }, [claim]);

  return (
    <div className={styles.screen}>
      <div className={styles.brand}>
        <AppLogo size={30} />
        UMBRA
      </div>

      <div className={styles.card}>
        <h1 className={styles.title}>{t('tvPairing.title')}</h1>

        <div className={styles.body}>
          <div className={styles.left}>
            <ol className={styles.steps}>
              <li>
                <span className={styles.stepNum}>1</span>
                <span>{t('tvPairing.step1')}</span>
              </li>
              <li>
                <span className={styles.stepNum}>2</span>
                <span>{t('tvPairing.step2')}</span>
              </li>
            </ol>
            <div className={styles.status}>
              <AppLogo spin size={18} />
              <span>
                {linking ? t('tvPairing.linking') : t('tvPairing.waiting')}
              </span>
            </div>
          </div>

          <div className={styles.qrBox}>
            {failed ? (
              <div className={styles.qrError}>
                <p>{t('tvPairing.error')}</p>
                {debugError && <p className={styles.debug}>{debugError}</p>}
              </div>
            ) : qr ? (
              <img
                className={styles.qr}
                src={qr}
                alt={t('tvPairing.qrAlt')}
                width={280}
                height={280}
              />
            ) : (
              <div className={styles.qrLoading}>
                <AppLogo spin size={36} />
              </div>
            )}
          </div>
        </div>

        <p className={styles.hint}>{t('tvPairing.hint')}</p>
      </div>
    </div>
  );
}
