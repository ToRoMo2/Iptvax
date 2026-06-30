/**
 * Attribution TMDB — OBLIGATOIRE par les conditions d'utilisation de l'API
 * The Movie Database, que l'usage soit commercial ou non.
 *
 * TMDB impose d'afficher de façon visible la mention exacte (en anglais) :
 *   « This product uses the TMDB API but is not endorsed or certified by TMDB. »
 * accompagnée idéalement du logo TMDB.
 *
 * Affiché dans le footer de la vitrine (web) et l'onglet « À propos » des
 * réglages (app native / Electron) → couvre tous les shells.
 *
 * Pas de couleur hardcodée (§IV-7) : on hérite la couleur du parent et on
 * module via l'opacité. `compact` réduit la typo pour les pieds de page.
 *
 * TODO (suivi) : déposer le logo officiel TMDB (SVG/PNG, brand guidelines
 * https://www.themoviedb.org/about/logos-attribution) et l'afficher ici.
 */
export function TmdbAttribution({ compact = false }: { compact?: boolean }) {
  return (
    <p
      style={{
        fontSize: compact ? 11 : 12,
        opacity: 0.6,
        lineHeight: 1.5,
        margin: 0,
        maxWidth: '52ch',
      }}
    >
      This product uses the TMDB API but is not endorsed or certified by TMDB.
      Données et visuels enrichis fournis par{' '}
      <a
        href="https://www.themoviedb.org"
        target="_blank"
        rel="noreferrer noopener"
        style={{ color: 'inherit', textDecoration: 'underline' }}
      >
        The Movie Database (TMDB)
      </a>
      .
    </p>
  );
}
