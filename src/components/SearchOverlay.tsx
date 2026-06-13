import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useXtream } from '../context/XtreamContext';
import { xtreamService } from '../services/xtream.service';
import { useI18n } from '../contexts/I18nContext';
import { Focusable } from './Focusable';
import { RemoteSearch } from './RemoteSearch';
import { useCatalogSearch } from '../hooks/useCatalogSearch';
import { safeImgUrl } from '../utils/image';
import type { LiveStream, PlayerState } from '../types/xtream.types';
import browse from '../pages/Browse.module.css';
import ov from './SearchOverlay.module.css';

// ── Carte résultat « paysage » (backdrop 16:9 + eyebrow + titre bas-gauche).
//    Repli sur une vignette « halo doré » (DA Lumière) quand aucune image. ──
function ResultCard({
  image,
  eyebrow,
  title,
  contain,
  onOpen,
}: {
  image?: string;
  eyebrow: ReactNode;
  title: string;
  contain?: boolean;
  onOpen: () => void;
}) {
  const img = safeImgUrl(image);
  return (
    <Focusable
      className={ov.card}
      focusedClassName={ov.cardFocused}
      onEnter={onOpen}
      onClick={onOpen}
      ariaLabel={title}
    >
      {img ? (
        <img
          src={img}
          alt=""
          loading="lazy"
          decoding="async"
          className={`${ov.cardImg} ${contain ? ov.cardImgContain : ''}`}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <span className={ov.cardPh} aria-hidden="true" />
      )}
      <span className={ov.cardShade} />
      <span className={ov.cardMeta}>
        <span className={ov.cardEyebrow}>{eyebrow}</span>
        <span className={ov.cardTitle}>{title}</span>
      </span>
    </Focusable>
  );
}

/**
 * Recherche globale SUPERPOSÉE (DA Lumière) — overlay translucide rendu
 * par-dessus la page courante (portal sur <body>), déclenché par la loupe du
 * `TopNav`. Grand champ centré + grille de cartes paysage : suggestions au
 * repos, résultats (Films / Séries / Chaînes) à la frappe. Logique de recherche
 * partagée avec la page `/search` via `useCatalogSearch`. Sur TV (D-pad), le
 * `TopNav` ouvre la page `/search` pleine page → cet overlay reste souris/tactile.
 */
export function SearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Échap ferme + verrou du scroll de fond (le `.main-content` est le scroller).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const main = document.querySelector<HTMLElement>('.main-content');
    const prevOverflow = main?.style.overflow ?? '';
    if (main) main.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      if (main) main.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(<SearchOverlayInner onClose={onClose} />, document.body);
}

function SearchOverlayInner({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { credentials } = useXtream();
  const {
    search,
    setSearch,
    query,
    isSearching,
    loading,
    error,
    liveResults,
    movieGroups,
    seriesGroups,
    totalResults,
    suggestions,
    suggestionsReady,
  } = useCatalogSearch();

  // Navigue vers une cible puis referme l'overlay (la page apparaît dessous).
  const go = (to: string, state?: unknown) => {
    onClose();
    navigate(to, state ? { state } : undefined);
  };

  const openChannel = (stream: LiveStream) => {
    if (!credentials) return;
    const liveChannels = liveResults.map((s) => ({
      stream_id: s.stream_id,
      name: s.name,
      stream_icon: s.stream_icon,
    }));
    const liveIndex = liveResults.findIndex((s) => s.stream_id === stream.stream_id);
    const state: PlayerState = {
      url: xtreamService.getLiveStreamUrl(credentials, stream.stream_id),
      fallbackUrl: xtreamService.getLiveStreamTsUrl(credentials, stream.stream_id),
      title: stream.name,
      type: 'live',
      poster: stream.stream_icon,
      liveChannels,
      liveIndex,
    };
    go('/player', state);
  };

  const filmKind = t('common.film').toUpperCase();
  const seriesKind = t('common.series').toUpperCase();

  const skeletonGrid = (
    <div className={ov.grid}>
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className={ov.skeleton} />
      ))}
    </div>
  );

  return (
    <div
      className={ov.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={t('search.title')}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={ov.panel}>
        <div className={ov.bar}>
          <RemoteSearch
            value={search}
            onChange={setSearch}
            placeholder={t('search.placeholder')}
            animatedPlaceholders={[
              t('search.placeholder'),
              t('movies.searchPlaceholder'),
              t('series.searchPlaceholder'),
              t('live.searchPlaceholder'),
            ]}
            autoFocus
            wrapperClassName={`${browse.searchWrapper} ${ov.searchBar}`}
            iconClassName={browse.searchIcon}
            inputClassName={browse.search}
            clearClassName={browse.searchClear}
          />
          <button className={ov.close} onClick={onClose} aria-label={t('common.close')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" width="20" height="20"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {error && <div className={browse.error}>⚠ {error}</div>}

        {/* ── État au repos : suggestions ──────────────────────────────── */}
        {!isSearching && !error && (
          <>
            <div className={ov.sectionLabel}>{t('common.popular')}</div>
            {suggestionsReady ? (
              <div className={ov.grid}>
                {suggestions.map((g) => (
                  <ResultCard
                    key={g.primary.stream_id}
                    image={g.primary.backdrop_path?.[0] ?? g.primary.stream_icon}
                    eyebrow={g.year ? `${filmKind} · ${g.year}` : filmKind}
                    title={g.title}
                    onOpen={() => go(`/movie/${g.primary.stream_id}`, { movie: g.primary, variants: g.variants })}
                  />
                ))}
              </div>
            ) : (
              skeletonGrid
            )}
          </>
        )}

        {/* ── Recherche en cours de chargement ─────────────────────────── */}
        {isSearching && loading && skeletonGrid}

        {/* ── Aucun résultat ───────────────────────────────────────────── */}
        {isSearching && !loading && totalResults === 0 && !error && (
          <p className={ov.hint}>{t('search.noResults', { query })}</p>
        )}

        {/* ── Résultats ────────────────────────────────────────────────── */}
        {isSearching && !loading && totalResults > 0 && (
          <>
            {movieGroups.length > 0 && (
              <section className={ov.section}>
                <div className={ov.sectionLabel}>
                  {t('search.movies')} <span className={ov.sectionCount}>{movieGroups.length}</span>
                </div>
                <div className={ov.grid}>
                  {movieGroups.map((g) => (
                    <ResultCard
                      key={g.primary.stream_id}
                      image={g.primary.backdrop_path?.[0] ?? g.primary.stream_icon}
                      eyebrow={g.year ? `${filmKind} · ${g.year}` : filmKind}
                      title={g.title}
                      onOpen={() => go(`/movie/${g.primary.stream_id}`, { movie: g.primary, variants: g.variants })}
                    />
                  ))}
                </div>
              </section>
            )}

            {seriesGroups.length > 0 && (
              <section className={ov.section}>
                <div className={ov.sectionLabel}>
                  {t('search.series')} <span className={ov.sectionCount}>{seriesGroups.length}</span>
                </div>
                <div className={ov.grid}>
                  {seriesGroups.map((g) => (
                    <ResultCard
                      key={g.primary.series_id}
                      image={g.primary.backdrop_path?.[0] ?? g.primary.cover}
                      eyebrow={g.year ? `${seriesKind} · ${g.year}` : seriesKind}
                      title={g.title}
                      onOpen={() => go(`/series/${g.primary.series_id}`, { series: g.primary, variants: g.variants })}
                    />
                  ))}
                </div>
              </section>
            )}

            {liveResults.length > 0 && (
              <section className={ov.section}>
                <div className={ov.sectionLabel}>
                  {t('search.channels')} <span className={ov.sectionCount}>{liveResults.length}</span>
                </div>
                <div className={ov.grid}>
                  {liveResults.map((stream) => (
                    <ResultCard
                      key={stream.stream_id}
                      image={stream.stream_icon}
                      contain
                      eyebrow={
                        <span className={ov.liveTag}>
                          <span className={ov.liveDot} /> LIVE
                        </span>
                      }
                      title={stream.name}
                      onOpen={() => openChannel(stream)}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
