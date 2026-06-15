import { useEffect, useLayoutEffect, useState, lazy, Suspense } from 'react';
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { isWebOS, isTizen, isVitrine, isElectron } from './lib/platform';
import { I18nProvider, useI18n } from './contexts/I18nContext';
import { SupabaseAuthProvider, useSupabaseAuth } from './contexts/SupabaseAuthContext';
import { SubscriptionProvider } from './contexts/SubscriptionContext';
import { IptvProfileProvider, useIptvProfile } from './contexts/IptvProfileContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { DownloadsProvider, useDownloads } from './contexts/DownloadsContext';
import { RatingsProvider } from './contexts/RatingsContext';
import { SocialProvider } from './contexts/SocialContext';
import { PremiumOnly } from './components/PremiumOnly';
import { XtreamProvider, useXtream } from './context/XtreamContext';
import { TopNav } from './components/TopNav';
import { SearchOverlay } from './components/SearchOverlay';
import { PremiumTeaseBar } from './components/PremiumTeaseBar';
import { FavoriteLimitToast } from './components/FavoriteLimitToast';
import { RemoteControl } from './components/RemoteControl';
import { TitleBar } from './components/TitleBar';
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
const MyDownloads = lazy(() => import('./pages/MyDownloads').then((m) => ({ default: m.MyDownloads })));
// ── Vitrine (site web marketing, Phase 5) ─────────────────────────────────
const VitrineLayout = lazy(() => import('./components/vitrine/VitrineLayout').then((m) => ({ default: m.VitrineLayout })));
const HomeVitrine = lazy(() => import('./pages/vitrine/HomeVitrine').then((m) => ({ default: m.HomeVitrine })));
const Downloads = lazy(() => import('./pages/vitrine/Downloads').then((m) => ({ default: m.Downloads })));
const SettingsVitrine = lazy(() => import('./pages/vitrine/SettingsVitrine').then((m) => ({ default: m.SettingsVitrine })));
const MentionsLegales = lazy(() => import('./pages/vitrine/MentionsLegales').then((m) => ({ default: m.MentionsLegales })));
const CGV = lazy(() => import('./pages/vitrine/CGV').then((m) => ({ default: m.CGV })));
const Confidentialite = lazy(() => import('./pages/vitrine/Confidentialite').then((m) => ({ default: m.Confidentialite })));

function LoadingScreen({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="loading-screen">
      <AppLogo spin size={44} />
      <span>{label}</span>
      {children}
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, isAuthenticating, authError, retryAuth } = useXtream();
  const { activeProfile, clearActiveProfile } = useIptvProfile();
  const { available: dlAvailable, items: downloads } = useDownloads();
  const { t } = useI18n();

  // Échappatoire hors-ligne : si le serveur Xtream est injoignable (chargement
  // interminable / erreur) mais que l'appareil a des téléchargements, on permet
  // d'accéder directement à l'onglet « Téléchargements » + au lecteur de
  // fichiers locaux SANS attendre l'authentification du catalogue. Le lecteur
  // (`/player`) lit le fichier `file://` local — pas besoin de réseau ni du
  // catalogue. Disponible uniquement sur les plateformes téléchargeables.
  const [offlineMode, setOfflineMode] = useState(false);
  const hasOffline = dlAvailable && downloads.length > 0;
  const offlineHatch = hasOffline ? (
    <button className="btn" style={{ marginTop: 12 }} onClick={() => setOfflineMode(true)}>
      {t('downloads.accessOffline')}
    </button>
  ) : null;

  // Préchauffage des routes lazy pendant l'inactivité. Les chunks secondaires
  // (Player, fiches détail, recherche, favoris) sont exclus du bundle initial
  // (§lazy) → au PREMIER clic, le navigateur doit télécharger + parser le chunk,
  // d'où le délai « plusieurs secondes » ressenti sur l'onglet Recherche et à
  // l'ouverture d'une fiche. On les précharge en arrière-plan une fois l'app
  // interactive : quand l'utilisateur y arrive, le code est déjà en cache
  // (navigation instantanée) sans avoir alourdi le démarrage de l'app. Les
  // données catalogue, elles, sont déjà chaudes (Home fetch live/vod/series).
  //
  // Ordre = priorité d'usage : le lecteur d'abord (hls.js + mpegts.js, le plus
  // lourd et sur le chemin critique d'une lecture), puis les fiches détail et la
  // recherche. On les charge séquentiellement (un `import()` lance sa propre
  // requête réseau) pour ne pas saturer la file de chargement d'un coup.
  useEffect(() => {
    if (!isAuthenticated) return;
    const w = window as typeof window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    // Importeurs paresseux des routes à préchauffer, par priorité décroissante.
    const warmers: Array<() => Promise<unknown>> = [
      () => import('./pages/Player'),
      () => import('./pages/MovieDetail'),
      () => import('./pages/SeriesDetail'),
      () => import('./pages/Search'),
      () => import('./pages/Favorites'),
    ];
    let idleId = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // Charge le chunk i puis enchaîne le suivant quand le navigateur est de
    // nouveau inactif → préchauffage furtif qui ne dispute jamais le CPU/réseau
    // au rendu en cours.
    const warmFrom = (i: number) => {
      if (cancelled || i >= warmers.length) return;
      warmers[i]().catch(() => {}).finally(() => {
        if (cancelled) return;
        if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => warmFrom(i + 1), { timeout: 4000 });
        else timerId = setTimeout(() => warmFrom(i + 1), 600);
      });
    };

    if (w.requestIdleCallback) idleId = w.requestIdleCallback(() => warmFrom(0), { timeout: 4000 });
    else timerId = setTimeout(() => warmFrom(0), 2500);
    return () => {
      cancelled = true;
      if (idleId && w.cancelIdleCallback) w.cancelIdleCallback(idleId);
      if (timerId) clearTimeout(timerId);
    };
  }, [isAuthenticated]);

  // Mode hors-ligne : court-circuite l'attente d'authentification Xtream et
  // monte directement les téléchargements + le lecteur de fichiers locaux.
  // Placé APRÈS tous les hooks (rules-of-hooks) — c'est un rendu conditionnel.
  if (offlineMode) {
    return (
      <Suspense fallback={<LoadingScreen label={t('app.loading')} />}>
        <Routes>
          <Route path="/player" element={<Player />} />
          <Route
            path="*"
            element={
              <MyDownloads
                offline
                onExitOffline={() => {
                  setOfflineMode(false);
                  retryAuth();
                }}
              />
            }
          />
        </Routes>
      </Suspense>
    );
  }

  if (isAuthenticating) {
    return <LoadingScreen label={t('app.connecting')}>{offlineHatch}</LoadingScreen>;
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
        {offlineHatch}
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
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);

  // Recherche : overlay translucide superposé (souris/tactile) ; sur TV la
  // saisie/navigation à la télécommande reste plus simple sur la page /search
  // pleine page → on y redirige au lieu d'ouvrir l'overlay.
  const openSearch = () => {
    if (isTvDevice()) navigate('/search');
    else setSearchOpen(true);
  };

  return (
    <div className="app-shell">
      <div className="layout">
        <RemoteControl />
        <TopNav onSearch={openSearch} />
        <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
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
            <Route path="/telechargements" element={<MyDownloads />} />
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
        <DownloadsProvider>
          <RatingsProvider>
            <SocialProvider>
              <AppContent />
            </SocialProvider>
          </RatingsProvider>
        </DownloadsProvider>
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
    <>
      {/* Barre de titre maison (fenêtre Electron frameless — cf. TitleBar.tsx). */}
      {isElectron && <TitleBar />}
      <Router>
        <I18nProvider>
          <SupabaseAuthProvider>
            {isVitrine ? <VitrineGate /> : <AppGate />}
          </SupabaseAuthProvider>
        </I18nProvider>
      </Router>
    </>
  );
}

export default App;
