import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSupabaseAuth } from '../contexts/SupabaseAuthContext';
import { useI18n } from '../contexts/I18nContext';
import { tvPairingService } from '../services/tvPairing.service';
import { Login } from './Login';
import { AppLogo } from '../components/AppLogo';
import type { IptvProfile, ProfileColor } from '../types/profile.types';
import styles from './TvLink.module.css';

// Le code de l'URL est persisté : un aller-retour OAuth perd la query string.
// Exporté car `AppGate` redirige vers `/tv-link` quand cette clé existe (filet
// si OAuth a retombé sur la Site URL au lieu de notre `redirectTo`).
export const TV_PAIRING_CODE_KEY = 'tv_pairing_code';
const CODE_STORAGE_KEY = TV_PAIRING_CODE_KEY;

type Phase = 'pick' | 'linking' | 'done' | 'error';

function avatarStyle(color: ProfileColor): CSSProperties {
  return { '--pf': `var(--${color})` } as CSSProperties;
}

/**
 * Page web d'appairage TV (Phase 2f) servie sur `/tv-link?code=…`. L'utilisateur
 * scanne le QR affiché sur sa TV, ouvre cette page sur son téléphone, se
 * connecte et choisit le profil à ouvrir sur le téléviseur. La session du
 * compte est déposée sur la ligne d'appairage ; la TV la récupère.
 *
 * Accessible sans compte ni profil → rendue en amont du gating (App.tsx).
 * Voir docs/native-port.md §4.
 */
export function TvLink() {
  const { user } = useSupabaseAuth();
  const { t } = useI18n();
  const [params] = useSearchParams();

  const [code] = useState<string | null>(() => {
    const fromUrl = params.get('code');
    if (fromUrl) {
      sessionStorage.setItem(CODE_STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return sessionStorage.getItem(CODE_STORAGE_KEY);
  });

  const [profiles, setProfiles] = useState<IptvProfile[] | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  // Charge les profils IPTV du compte une fois connecté.
  useEffect(() => {
    if (!user || !code) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('iptv_profiles')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });
      if (!cancelled) setProfiles((data ?? []) as IptvProfile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, code]);

  const link = useCallback(
    async (profileId: string) => {
      if (!code) return;
      setBusyId(profileId);
      setPhase('linking');
      try {
        // Tokens frais : évite que la rotation du refresh token ne les périme
        // avant que la TV ne les récupère.
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data.session) throw new Error(error?.message ?? 'session');
        await tvPairingService.authorize(
          code,
          profileId,
          data.session.access_token,
          data.session.refresh_token,
        );
      } catch (err) {
        console.error('[tv-link] authorize failed', err);
        const msg = err instanceof Error ? err.message : String(err);
        // La RPC `authorize_tv_pairing` lève « session d'appairage invalide
        // ou expirée » quand le code n'est plus pending (typique : la TV
        // a régénéré un code depuis le scan).
        const looksExpired = /expir|invalide|invalid/i.test(msg);
        setExpired(looksExpired);
        setErrorMsg(msg);
        setPhase('error');
        setBusyId(null);
        if (looksExpired) sessionStorage.removeItem(CODE_STORAGE_KEY);
        return;
      }

      // Au-delà d'ici la TV se débloquera (via son poll) même si la suite
      // échoue → on ne repasse plus en 'error'.
      try {
        await tvPairingService.notifyAuthorized(code);
      } catch (err) {
        console.warn('[tv-link] notify broadcast failed (poll TV fallback)', err);
      }
      sessionStorage.removeItem(CODE_STORAGE_KEY);
      // L'onglet web cesse d'utiliser le refresh token → la TV en est seule
      // détentrice (pas de conflit de rotation). Déconnexion locale uniquement.
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch (err) {
        console.warn('[tv-link] local signOut failed', err);
      }
      setPhase('done');
    },
    [code],
  );

  // Si l'utilisateur n'a qu'un seul profil, on déclenche l'appairage
  // automatiquement : pas la peine d'imposer un clic sur le téléphone.
  useEffect(() => {
    if (
      profiles &&
      profiles.length === 1 &&
      phase === 'pick' &&
      busyId === null
    ) {
      void link(profiles[0].id);
    }
  }, [profiles, phase, busyId, link]);

  const header = (
    <div className={styles.brand}>
      <AppLogo size={26} />
      IPTVAX
    </div>
  );

  /* ── Lien invalide ──────────────────────────────────────────────────── */
  if (!code) {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.card}>
          <h1 className={styles.title}>{t('tvLink.invalid')}</h1>
          <p className={styles.sub}>{t('tvLink.invalidSub')}</p>
        </div>
      </div>
    );
  }

  /* ── TV liée ────────────────────────────────────────────────────────── */
  // ⚠ Doit être AVANT le check `!user`. À la fin de `link()` on appelle
  // `signOut({scope:'local'})` → l'utilisateur courant devient null avant que
  // `setPhase('done')` ne re-render. Sans ce reordering, le succès retombe
  // sur l'écran de Login au lieu d'afficher la confirmation.
  if (phase === 'done') {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.card}>
          <div className={styles.checkmark}>✓</div>
          <h1 className={styles.title}>{t('tvLink.done')}</h1>
          <p className={styles.sub}>{t('tvLink.doneSub')}</p>
        </div>
      </div>
    );
  }

  /* ── Connexion requise ──────────────────────────────────────────────── */
  // On inclut le code dans le `redirectTo` : certains navigateurs mobiles
  // (iOS Safari notamment) vident `sessionStorage` pendant les redirections
  // OAuth externes → le filet `CODE_STORAGE_KEY` saute et la page retombe sur
  // "Lien QR incorrect" au retour. L'URL est la seule porteuse fiable.
  if (!user) {
    const back = `${window.location.origin}/tv-link?code=${encodeURIComponent(code)}`;
    return <Login redirectTo={back} />;
  }

  /* ── Code expiré : la TV en a généré un nouveau ───────────────────── */
  if (expired) {
    return (
      <div className={styles.screen}>
        {header}
        <div className={styles.card}>
          <h1 className={styles.title}>{t('tvLink.expired')}</h1>
          <p className={styles.sub}>{t('tvLink.expiredSub')}</p>
        </div>
      </div>
    );
  }

  /* ── Choix du profil ────────────────────────────────────────────────── */
  return (
    <div className={styles.screen}>
      {header}
      <div className={styles.card}>
        <div className={styles.eyebrow}>{t('tvLink.eyebrow')}</div>
        <h1 className={styles.title}>{t('tvLink.title')}</h1>
        <p className={styles.sub}>{t('tvLink.sub')}</p>

        {phase === 'error' && (
          <div className={styles.error}>
            <div>{t('tvLink.error')}</div>
            {errorMsg && <div className={styles.errorDebug}>{errorMsg}</div>}
          </div>
        )}

        {profiles === null ? (
          <div className={styles.loading}>
            <AppLogo spin size={28} />
            <span>{t('tvLink.loadingProfiles')}</span>
          </div>
        ) : profiles.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{t('tvLink.noProfiles')}</p>
            <p className={styles.emptySub}>{t('tvLink.noProfilesSub')}</p>
          </div>
        ) : (
          <div className={styles.list}>
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.profile}
                disabled={phase === 'linking'}
                onClick={() => void link(p.id)}
              >
                <span className={styles.avatar} style={avatarStyle(p.color)}>
                  {p.avatar}
                </span>
                <span className={styles.profileName}>{p.name}</span>
                {busyId === p.id && phase === 'linking' ? (
                  <AppLogo spin size={18} />
                ) : (
                  <span className={styles.chevron}>→</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
