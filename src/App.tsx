import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SupabaseAuthProvider, useSupabaseAuth } from './contexts/SupabaseAuthContext';
import { IptvProfileProvider, useIptvProfile } from './contexts/IptvProfileContext';
import { LibraryProvider } from './contexts/LibraryContext';
import { RatingsProvider } from './contexts/RatingsContext';
import { SocialProvider } from './contexts/SocialContext';
import { XtreamProvider, useXtream } from './context/XtreamContext';
import { TopNav } from './components/TopNav';
import { RemoteControl } from './components/RemoteControl';
import { Login } from './pages/Login';
import { ProfileSelect } from './pages/ProfileSelect';
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
import './styles/app.css';

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="loading-screen">
      <div className="spinner" />
      <span>{label}</span>
    </div>
  );
}

function AppContent() {
  const { isAuthenticated, isAuthenticating, authError } = useXtream();
  const { activeProfile, clearActiveProfile } = useIptvProfile();

  if (isAuthenticating) {
    return <LoadingScreen label="Connexion en cours…" />;
  }

  if (!isAuthenticated) {
    return (
      <div className="loading-screen">
        <span>Impossible de se connecter au profil « {activeProfile?.name} ».</span>
        <span style={{ color: 'var(--t-3)', fontSize: 13 }}>
          {authError ?? 'Vérifiez les identifiants IPTV de ce profil.'}
        </span>
        <button className="btn btn-primary" onClick={clearActiveProfile}>
          Changer de profil
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
            <Route path="/journal" element={<Watched />} />
            <Route path="/communaute" element={<Community />} />
            <Route path="/communaute/:id" element={<MemberCine />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function ProfileGate() {
  const { activeProfile, loading } = useIptvProfile();

  if (loading) {
    return <LoadingScreen label="Chargement des profils…" />;
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

  if (loading) {
    return <LoadingScreen label="Chargement…" />;
  }

  if (!user) return <Login />;

  return (
    <IptvProfileProvider>
      <ProfileGate />
    </IptvProfileProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <SupabaseAuthProvider>
        <AppGate />
      </SupabaseAuthProvider>
    </BrowserRouter>
  );
}

export default App;
