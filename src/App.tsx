import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
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
import { RemoteControl } from './components/RemoteControl';
import { AppLogo } from './components/AppLogo';
import { Login } from './pages/Login';
import { TvPairing } from './pages/TvPairing';
import { TvLink, TV_PAIRING_CODE_KEY } from './pages/TvLink';
import { ProfileSelect } from './pages/ProfileSelect';
import { isTvDevice } from './native/tvDetect';
import { Home } from './pages/Home';
import { Live } from './pages/Live';
import { Movies } from './pages/Movies';
import { Series } from './pages/Series';
import { SeriesDetail } from './pages/SeriesDetail';
import { MovieDetail } from './pages/MovieDetail';
import { Player } from './pages/Player';
import { Search } from './pages/Search';
import { Favorites } from './pages/Favorites';
import { Watched } from './pages/Watched';
import { Community } from './pages/Community';
import { MemberCine } from './pages/MemberCine';
import { Settings } from './pages/Settings';
import { Premium } from './pages/Premium';
import './styles/app.css';

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen">
      <AppLogo spin size={44} />
      <span>{label}</span>
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, isAuthenticating, authError } = useXtream();
  const { activeProfile, clearActiveProfile } = useIptvProfile();
  const { t } = useI18n();

  if (isAuthenticating) {
    return <LoadingScreen label={t('app.connecting')} />;
  }

  if (!isAuthenticated) {
    return (
      <div className="loading-screen">
        <span>{t('app.profileConnectFail', { name: activeProfile?.name ?? '' })}</span>
        <span style={{ color: 'var(--t-3)', fontSize: 13 }}>
          {authError ?? t('app.checkCredentials')}
        </span>
        <button className="btn btn-primary" onClick={clearActiveProfile}>
          {t('app.changeProfile')}
        </button>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/player" element={<Player />} />
      <Route path="*" element={<Shell />} />
    </Routes>
  );
}

function Shell() {
  const { t } = useI18n();
  return (
    <div className="app-shell">
      <div className="layout">
        <RemoteControl />
        <TopNav />
        <main className="main-content">
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
        </main>
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

function App() {
  return (
    <BrowserRouter>
      <I18nProvider>
        <SupabaseAuthProvider>
          <AppGate />
        </SupabaseAuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}

export default App;
