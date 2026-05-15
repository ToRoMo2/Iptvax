import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { SupabaseAuthProvider, useSupabaseAuth } from './contexts/SupabaseAuthContext';
import { XtreamProvider, useXtream } from './context/XtreamContext';
import { TopNav } from './components/TopNav';
import { Login } from './pages/Login';
import { Auth } from './pages/Auth';
import { Home } from './pages/Home';
import { Live } from './pages/Live';
import { Movies } from './pages/Movies';
import { Series } from './pages/Series';
import { SeriesDetail } from './pages/SeriesDetail';
import { MovieDetail } from './pages/MovieDetail';
import { Player } from './pages/Player';
import { Search } from './pages/Search';
import { Favorites } from './pages/Favorites';
import { Settings } from './pages/Settings';
import './styles/app.css';

function AppContent() {
  const { isAuthenticated, isAuthenticating } = useXtream();

  if (isAuthenticating) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <span>Connexion en cours…</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Auth />;
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
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function AppGate() {
  const { user, loading } = useSupabaseAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner" />
        <span>Chargement…</span>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <XtreamProvider userId={user.id}>
      <AppContent />
    </XtreamProvider>
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
