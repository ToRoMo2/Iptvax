import { useEffect, useLayoutEffect, lazy, Suspense } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { isWebOS, isTizen, isVitrine } from './lib/platform';
import { I18nProvider, useI18n } from './contexts/I18nContext';
import { SupabaseAuthProvider, useSupabaseAuth } from './contexts/SupabaseAuthContext';
import { SubscriptionProvider } from './contexts/SubscriptionContext';
import { IptvProfileProvider, useIptvProfile } from './contexts/IptvProfileContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { RatingsProvider } from './contexts/RatingsContext';
import { SocialProvider } from './contexts/SocialContext';
import { PremiumOnly } from './components/PremiumOnly';
import { XtreamProvider, useXtream } from './context/XtreamContext';
import { TopNav } from './components/TopNav';
import { PremiumTeaseBar } from './components/PremiumTeaseBar';
import { FavoriteLimitToast } from './components/FavoriteLimitToast';
import { RemoteControl } from './components/RemoteControl';
import { AppLogo } from './components/AppLogo';
import { Login } from './pages/Login';
import { TvPairing } from './pages/TvPairing';
import { TvLink, TV_PAIRING_CODE_KEY } from './pages/TvLink';
import { ProfileSelect } from './pages/ProfileSelect';
import { isTvDevice } from './native/tvDetect';
// Navigation primaire chargée d'emblée (changement d'onglet instantané, pas de
// flash Suspense) — c'est le cœur de l'usage quotidien.
import { Home } from './pages/Home';
import { Live } from './pages/Live';
import { Movies } from './pages/Movies';
import { Series } from './pages/Series';
import './styles/app.css';

// ── Code splitting des routes secondaires ─────────────────────────────────
// Sorties du bundle initial → chargées à la demande. Gain majeur : le lecteur
// (`Player`) embarque hls.js + mpegts.js (plusieurs centaines de Ko) qui ne
// servent qu'à la lecture ; les fiches détail, le compte, la communauté et
// tout le sous-arbre vitrine ne sont pas sur le chemin de démarrage. Sur natif
// (Capacitor) les chunks sont locaux → chargement quasi instantané ; sur web,
// le bundle initial fond nettement. Les exports étant nommés, chaque `import()`
// remappe l'export voulu sur `default` (typage exact préservé → props OK).
const Player = lazy(() => import('./pages/Player').then((m) => ({ default: m.Player })));
const SeriesDetail = lazy(() => import('./pages/SeriesDetail').then((m) => ({ default: m.SeriesDetail })));
const MovieDetail = lazy(() => import('./pages/MovieDetail').then((m) => ({ default: m.MovieDetail })));
const Search = lazy(() => import('./pages/Search').then((m) => ({ default: m.Search })));
const Favorites = lazy(() => import('./pages/Favorites').then((m) => ({ default: m.Favorites })));
const Community = lazy(() => import('./pages/Community').then((m) => ({ default: m.Community })));
const MemberCine = lazy(() => import('./pages/MemberCine').then((m) => ({ default: m.MemberCine })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const Premium = lazy(() => import('./pages/Premium').then((m) => ({ default: m.Premium })));
const Watched = lazy(() => import('./pages/Watched').then((m) => ({ default: m.Watched })));
// ── Vitrine (site web marketing, Phase 5) ─────────────────────────────────
const VitrineLayout = lazy(() => import('./components/vitrine/VitrineLayout').then((m) => ({ default: m.VitrineLayout })));
const HomeVitrine = lazy(() => import('./pages/vitrine/HomeVitrine').then((m) => ({ default: m.HomeVitrine })));
const Downloads = lazy(() => import('./pages/vitrine/Downloads').then((m) => ({ default: m.Downloads })));
const SettingsVitrine = lazy(() => import('./pages/vitrine/SettingsVitrine').then((m) => ({ default: m.SettingsVitrine })));
const MentionsLegales = lazy(() => import('./pages/vitrine/MentionsLegales').then((m) => ({ default: m.MentionsLegales })));
const CGV = lazy(() => import('./pages/vitrine/CGV').then((m) => ({ default: m.CGV })));
const Confidentialite = lazy(() => import('./pages/vitrine/Confidentialite').then((m) => ({ default: m.Confidentialite })));

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen">
      <AppLogo spin size={44} />
      <span>{label}</span>
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, isAuthenticating, authError, retryAuth } = useXtream();
  const { activeProfile, clearActiveProfile } = useIptvProfile();
  const { t } = useI18n();

  // Préchauffage du lecteur pendant l'inactivité : le chunk Player (avec
  // hls.js + mpegts.js, ~225 Ko gzip) est exclu du bundle initial (§lazy).
  // On le charge en arrière-plan une fois l'app interactive → quand
  // l'utilisateur lance une lecture, le code est déjà en cache (démarrage
  // instantané) sans avoir alourdi le démarrage de l'app.
  useEffect(() => {
    if (!isAuthenticated) return;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const warm = () => { void import('./pages/Player'); };
    let idleId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    if (w.requestIdleCallback) idleId = w.requestIdleCallback(warm, { timeout: 4000 });
    else timerId = setTimeout(warm, 2500);
    return () => {
      if (idleId && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      if (timerId) clearTimeout(timerId);
    };
  }, [isAuthenticated]);

  if (isAuthenticating) {
    return <LoadingScreen label={t('app.connecting')} />;
  }

  if (!isAuthenticated) {
    // HTTP 5xx → message "serveur temporairement indisponible" (pas une faute
    // d'identifiants). Autre erreur → message brut ou invite à vérifier les creds.
    const errorMsg = /^HTTP 5\d\d$/.test(authError ?? '')
      ? t('app.serverTemporaryError')
      : (authError ?? t('app.checkCredentials'));

    return (
      <div className="loading-screen">
        <span>{t('app.profileConnectFail', { name: activeProfile?.name ?? '' })}</span>
        <span style={{ color: 'var(--t-3)', fontSize: 13 }}>
          {errorMsg}
        </span>
        <button className="btn btn-primary" onClick={retryAuth}>
          {t('common.retry')}
        </button>
        <button className="btn" style={{ marginTop: 8 }} onClick={clearActiveProfile}>
          {t('app.changeProfile')}
        </button>
      </div>
    );
  }

  return (
    <Suspense fallback={<LoadingScreen label={t('app.loading')} />}>
      <Routes>
        <Route path="/player" element={<Player />} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </Suspense>
  );
}

// Remet .main-content en haut à chaque changement de route (pathname ou
// searchParams). Utilise useLayoutEffect pour agir avant le premier paint
// et éviter le flash d'une nouvelle page déjà scrollée.
function ScrollToTop() {
  const { pathname } = useLocation();
  useLayoutEffect(() => {
    document.querySelector<HTMLElement>('.main-content')
      ?.scrollTo({ top: 0, behavior: 'instant' });
  }, [pathname]);
  return null;
}

function Shell() {
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <div className="layout">
        <RemoteControl />
        <TopNav />
        <ScrollToTop />
        <main className="main-content">
          <Suspense fallback={<LoadingScreen label={t('app.loading')} />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/live" element={<Live />} />
            <Route path="/movies" element={<Movies />} />
            <Route path="/series" element={<Series />} />
            <Route path="/series/:id" element={<SeriesDetail />} />
            <Route path="/movie/:id" element={<MovieDetail />} />
            <Route path="/search" element={<Search />} />
            <Route path="/favorites" element={<Favorites />} />
            <Route
              path="/journal"
              element={<PremiumOnly feature={t('nav.myCine')}><Watched /></PremiumOnly>}
            />
            <Route
              path="/communaute"
              element={<PremiumOnly feature={t('community.title')}><Community /></PremiumOnly>}
            />
            <Route
              path="/communaute/:id"
              element={<PremiumOnly feature={t('community.title')}><MemberCine /></PremiumOnly>}
            />
            <Route path="/settings" element={<Settings />} />
            <Route path="/premium" element={<Premium />} />
          </Routes>
          </Suspense>
        </main>
        {/* Upsell ancré (tier gratuit uniquement, auto-masqués si Premium) */}
        <PremiumTeaseBar />
        <FavoriteLimitToast />
      </div>
    </div>
  );
}

function ProfileGate() {
  const { activeProfile, loading } = useIptvProfile();
  const { t } = useI18n();

  if (loading) {
    return <LoadingScreen label={t('app.loadingProfiles')} />;
  }

  if (!activeProfile) {
    return <ProfileSelect />;
  }

  return (
    <XtreamProvider key={activeProfile.id} profile={activeProfile}>
      <LibraryProvider>
        <RatingsProvider>
          <SocialProvider>
            <AppContent />
          </SocialProvider>
        </RatingsProvider>
      </LibraryProvider>
    </XtreamProvider>
  );
}

function AppGate() {
  const { user, loading } = useSupabaseAuth();
  const { t } = useI18n();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  // Filet pour l'appairage TV (Phase 2f) : si l'utilisateur s'est connecté
  // depuis le QR mais que l'OAuth a retombé sur la Site URL au lieu de
  // `/tv-link` (mauvaise config des Redirect URLs côté Supabase), on
  // remet l'utilisateur sur la page d'appairage tant que le code est
  // encore en sessionStorage. Sans cela il atterrirait sur l'app normale
  // et la TV resterait bloquée sur le QR sans qu'il sache pourquoi.
  useEffect(() => {
    if (
      user &&
      pathname !== '/tv-link' &&
      sessionStorage.getItem(TV_PAIRING_CODE_KEY)
    ) {
      navigate('/tv-link', { replace: true });
    }
  }, [user, pathname, navigate]);

  // Page web d'appairage TV (Phase 2f) — accessible sans compte ni profil,
  // donc rendue en amont du gating compte/profil. Voir docs/native-port.md §4.
  if (pathname === '/tv-link') return <TvLink />;

  if (loading) {
    return <LoadingScreen label={t('app.loading')} />;
  }

  // Sur une box Android TV, la saisie à la télécommande est pénible : on
  // affiche l'écran d'appairage QR au lieu du formulaire de connexion.
  if (!user) return isTvDevice() ? <TvPairing /> : <Login />;

  return (
    <SubscriptionProvider>
      <IptvProfileProvider>
        <ProfileGate />
      </IptvProfileProvider>
    </SubscriptionProvider>
  );
}

/**
 * Sous-arbre du SITE VITRINE (Phase 5). Monté uniquement quand `isVitrine`
 * (web pur, hors Electron, hors natif). Pas de IptvProfile/Xtream/Library/etc.
 * — uniquement marketing + compte + Stripe + appairage TV + téléchargements.
 *
 * Le filet de redirection vers `/tv-link` (présent dans `AppGate` pour le cas
 * où l'OAuth atterrit sur la Site URL) est répliqué ici pour la même raison
 * — si quelqu'un scanne un QR depuis sa TV et finit sur le site vitrine, on
 * le renvoie sur la page d'appairage.
 */
function VitrineGate() {
  const { user } = useSupabaseAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (
      user &&
      pathname !== '/tv-link' &&
      sessionStorage.getItem(TV_PAIRING_CODE_KEY)
    ) {
      navigate('/tv-link', { replace: true });
    }
  }, [user, pathname, navigate]);

  // Page d'appairage TV : standalone, sans le chrome marketing (header/footer).
  if (pathname === '/tv-link') return <TvLink />;

  return (
    <SubscriptionProvider>
      <Suspense fallback={<LoadingScreen label="" />}>
      <VitrineLayout>
        <Routes>
          <Route path="/" element={<HomeVitrine />} />
          <Route path="/downloads" element={<Downloads />} />
          <Route path="/premium" element={<Premium />} />
          <Route path="/login" element={<Login hideBrand />} />
          <Route path="/settings" element={<SettingsVitrine />} />
          <Route path="/mentions-legales" element={<MentionsLegales />} />
          <Route path="/cgv" element={<CGV />} />
          <Route path="/confidentialite" element={<Confidentialite />} />
          {/* Toute URL d'app (live/movies/series/player/etc.) redirige vers
              la page de téléchargements — explicite et SEO-safe. */}
          <Route path="*" element={<Navigate to="/downloads" replace />} />
        </Routes>
      </VitrineLayout>
      </Suspense>
    </SubscriptionProvider>
  );
}

function App() {
  // webOS (.ipk) et Tizen (.wgt) sont servis depuis file:// ou une URL interne
  // dont le pathname n'est pas '/'. BrowserRouter casserait le routing (path="/"
  // ne correspond pas à '/usr/palm/.../index.html'). HashRouter utilise
  // window.location.hash — invariant par rapport au pathname de base.
  // BrowserRouter reste inchangé sur web/Capacitor (https://localhost/ → ok).
  const Router = (isWebOS || isTizen) ? HashRouter : BrowserRouter;
  return (
    <Router>
      <I18nProvider>
        <SupabaseAuthProvider>
          {isVitrine ? <VitrineGate /> : <AppGate />}
        </SupabaseAuthProvider>
      </I18nProvider>
    </Router>
  );
}

export default App;
