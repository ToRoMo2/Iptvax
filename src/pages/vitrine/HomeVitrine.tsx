import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DeviceShowcase } from '../../components/vitrine/DeviceShowcase';
import { useScrollReveal } from '../../hooks/useScrollReveal';
import { useHomeFx } from '../../hooks/useHomeFx';
import { PREMIUM_ENABLED } from '../../config/monetization';

type Period = 'monthly' | 'annual';

const PRICES: Record<Period, { prem: string; unit: string; tag: string }> = {
  monthly: { prem: '2,49', unit: '/ mois', tag: 'Facturé mensuellement, sans engagement.' },
  annual: { prem: '17,99', unit: '/ an', tag: 'Soit 1,50 €/mois — économisez 40 %.' },
};

/**
 * Home vitrine — design « Umbra » (cinéma, nuit, or). Sections alternant
 * espresso très sombre / plus clair (bandes) pour rythmer le scroll : hero à
 * poussière dorée (canvas), showcase 3 appareils, bande de stats, sticky
 * storytelling, bento de fonctionnalités, pricing à odometer, CTA final. Toute
 * l'animation passe par useHomeFx / useScrollReveal.
 */
export function HomeVitrine() {
  const ref = useRef<HTMLDivElement>(null);
  const [period, setPeriod] = useState<Period>('monthly');

  useScrollReveal(ref);
  useHomeFx(ref);

  return (
    <div ref={ref}>
      {/* ── HERO ──────────────────────────────────────────────────── */}
      <section className="hero band-deep">
        <canvas className="hero-canvas" aria-hidden="true" />
        <div className="hero-beam" />
        <div className="hero-scan" />

        <div className="hero-inner">
          <span className="hero-badge">
            <span className="live-dot" />
            <b>Disponible sur 5&nbsp;plateformes</b> · Sans publicité
          </span>

          <h1 className="hero-title">
            <span className="mask-line">
              <span style={{ '--md': '60ms' } as CSSProperties}>Vos contenus.</span>
            </span>
            <span className="mask-line">
              <em style={{ '--md': '200ms' } as CSSProperties}>Tous vos écrans.</em>
            </span>
          </h1>

          <p className="hero-sub">
            Une seule app pour tous vos abonnements de streaming. Favoris,
            historique et reprise synchronisés à la seconde, d'un écran à l'autre.
          </p>

          <div className="hero-ctas">
            <span className="magnetic">
              <Link to="/downloads" className="btn btn-primary">
                Télécharger
              </Link>
            </span>
            <span className="magnetic">
              <a href={PREMIUM_ENABLED ? '#pricing' : '#features'} className="btn btn-secondary">
                {PREMIUM_ENABLED ? 'Découvrir Premium' : 'Découvrir les fonctionnalités'}
              </a>
            </span>
          </div>

          <p className="hero-note">
            {PREMIUM_ENABLED
              ? '// gratuit pour démarrer · premium à partir de 2,49 €/mois'
              : '// 100 % gratuit · sans publicité · sans tracker'}
          </p>
        </div>

        <div className="scroll-hint">Défiler</div>
      </section>

      {/* ── DEVICE SHOWCASE ───────────────────────────────────────── */}
      <div className="band band-lit band-edge">
        <section className="section" style={{ paddingTop: 96 }}>
          <div className="section-head">
            <span className="eyebrow" data-reveal="fade">
              Un flux, tous vos écrans
            </span>
            <h2 className="s-title" data-reveal>
              La même séance, <em>d'un écran à l'autre.</em>
            </h2>
            <p className="s-sub" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
              Commencez un film sur le téléphone, continuez sur l'ordinateur,
              terminez sur la TV. Le contenu vous suit — à la seconde exacte.
            </p>
          </div>
          <DeviceShowcase />
        </section>
      </div>

      {/* ── STATS ─────────────────────────────────────────────────── */}
      <div className="band band-deep band-edge">
        <div className="stats-grid">
          <div className="stat" data-reveal>
            <div className="num">
              <span data-count="5" />
            </div>
            <div className="lbl">Plateformes</div>
          </div>
          <div className="stat" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
            <div className="num">
              <span data-count="0" />
              <span className="suffix">+</span>
            </div>
            <div className="lbl">Publicité</div>
          </div>
          <div className="stat" data-reveal style={{ '--rd': '160ms' } as CSSProperties}>
            <div className="num">
              <span data-count="100" />
              <span className="suffix">%</span>
            </div>
            <div className="lbl">Sans tracker</div>
          </div>
          <div className="stat" data-reveal style={{ '--rd': '240ms' } as CSSProperties}>
            <div className="num">
              <span className="suffix">∞</span>
            </div>
            <div className="lbl">{PREMIUM_ENABLED ? 'Profils Premium' : 'Profils'}</div>
          </div>
        </div>
      </div>

      {/* ── STICKY STORY ──────────────────────────────────────────── */}
      <div className="band band-lit band-edge">
        <section className="section" style={{ maxWidth: 'none', paddingLeft: 0, paddingRight: 0 }}>
          <div className="story">
            <div className="story-grid">
              <div className="story-sticky">
                <div
                  className="section-head"
                  style={{ textAlign: 'left', alignItems: 'flex-start', marginBottom: 28 }}
                >
                  <span className="eyebrow" data-reveal="fade">
                    La promesse
                  </span>
                  <h2 className="s-title" data-reveal>
                    Un compte,
                    <br />
                    <em>tous vos écrans.</em>
                  </h2>
                </div>
                <div className="story-visual" data-reveal="fade">
                  <span className="ring spin" style={{ width: 320, height: 320 }} />
                  <span className="ring" style={{ width: 240, height: 240 }} />
                  <span className="ring" style={{ width: 160, height: 160 }} />
                  <div className="acct-core">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                  <div className="story-node" style={{ top: '17%', left: '13%' }}>
                    <span className="chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5" y="2" width="14" height="20" rx="2.5" />
                      </svg>
                    </span>
                    Téléphone
                  </div>
                  <div className="story-node" style={{ top: '50%', right: '7%', transform: 'translateY(-50%)' }}>
                    <span className="chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="20" height="13" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                    </span>
                    Ordinateur
                  </div>
                  <div className="story-node" style={{ bottom: '13%', left: '19%' }}>
                    <span className="chip">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="20" height="14" rx="2" />
                        <path d="M8 21h8M12 17v4" />
                      </svg>
                    </span>
                    Télévision
                  </div>
                </div>
              </div>

              <div className="story-steps">
                <article className="story-step" data-step="0" data-reveal>
                  <div className="idx">01 · Connexion</div>
                  <h3>Un seul compte Umbra</h3>
                  <p>
                    Connectez-vous une fois. Tous vos abonnements de streaming, vos
                    profils et vos préférences vivent dans votre compte — pas sur un
                    appareil.
                  </p>
                </article>
                <article className="story-step" data-step="1" data-reveal>
                  <div className="idx">02 · Profils</div>
                  <h3>Plusieurs profils par compte</h3>
                  <p>
                    Chacun ses favoris, son historique, ses chaînes. Un profil pour
                    vous, un pour les enfants, un pour les invités — comme à la maison.
                  </p>
                </article>
                <article className="story-step" data-step="2" data-reveal>
                  <div className="idx">03 · Synchronisation</div>
                  <h3>La reprise vous suit partout</h3>
                  <p>
                    Mettez en pause sur le téléphone dans le métro, reprenez sur la TV à
                    la maison — exactement à la seconde où vous vous êtes arrêté.
                  </p>
                </article>
              </div>
            </div>
          </div>
        </section>
      </div>

      {/* ── BENTO FEATURES ────────────────────────────────────────── */}
      <div className="band band-deep band-edge" id="features">
        <section className="section">
          <div className="section-head">
            <span className="eyebrow" data-reveal="fade">
              Fonctionnalités
            </span>
            <h2 className="s-title" data-reveal>
              Pensé pour le <em>cinéma à la maison.</em>
            </h2>
            <p className="s-sub" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
              Tout ce qu'un client de streaming moderne doit faire — et rien de ce
              qu'il ne devrait pas.
            </p>
          </div>

          <div className="bento">
            <article className="bento-card b-2x2" data-reveal="scale">
              <div className="b-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 15.5" />
                  <polyline points="8 17 12 13 16 17" />
                  <line x1="12" y1="13" x2="12" y2="21" />
                </svg>
              </div>
              <h3>Sync cross-device</h3>
              <p>
                Commencez un film sur votre téléphone, finissez-le sur la TV. Reprise à
                la seconde près, sur tous vos appareils.
              </p>
              <div className="spacer" />
              <div className="sync-demo" aria-hidden="true">
                <div className="sync-track" />
                <div className="sync-head" />
                <div className="sync-dev s1">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="5" y="2" width="14" height="20" rx="2.5" />
                  </svg>
                  Phone
                </div>
                <div className="sync-dev">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="4" width="20" height="13" rx="2" />
                    <path d="M8 21h8" />
                  </svg>
                  Ordi
                </div>
                <div className="sync-dev">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <path d="M8 21h8" />
                  </svg>
                  TV
                </div>
              </div>
            </article>

            <article className="bento-card b-2x1" data-reveal="scale" style={{ '--rd': '80ms' } as CSSProperties}>
              <div className="b-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="3" width="13" height="11" rx="2" />
                  <path d="M2 17h13M8 14v3" />
                  <rect x="17" y="9" width="5" height="11" rx="1" />
                </svg>
              </div>
              <h3>Multi-plateforme</h3>
              <p>
                Android · Windows · LG webOS · Samsung Tizen · Android TV. Même
                expérience, même compte, partout.
              </p>
            </article>

            <article className="bento-card" data-reveal="scale" style={{ '--rd': '160ms' } as CSSProperties}>
              <div className="b-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                </svg>
              </div>
              <h3>Profils multiples</h3>
              <p>1 compte, plusieurs expériences séparées.</p>
            </article>

            <article className="bento-card" data-reveal="scale" style={{ '--rd': '200ms' } as CSSProperties}>
              {PREMIUM_ENABLED && <span className="b-premium">Premium</span>}
              <div className="b-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
              <h3>Mon ciné</h3>
              <p>Notez, filtrez, retrouvez vos visionnages.</p>
            </article>

            <article className="bento-card b-2x1" data-reveal="scale" style={{ '--rd': '120ms' } as CSSProperties}>
              {PREMIUM_ENABLED && <span className="b-premium">Premium</span>}
              <div className="b-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                </svg>
              </div>
              <h3>Communauté</h3>
              <p>
                Suivez des cinéphiles, comparez les avis. Découvrez par vos pairs, pas
                par un algorithme.
              </p>
            </article>

            <article className="bento-card b-2x1" data-reveal="scale" style={{ '--rd': '160ms' } as CSSProperties}>
              <div className="b-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </div>
              <h3>Confidentialité</h3>
              <p>
                Pas de pub, pas de tracking, pas de collecte de données. Vos contenus ne
                servent à entraîner aucune IA.
              </p>
            </article>
          </div>
        </section>
      </div>

      {/* ── PRICING ───────────────────────────────────────────────── */}
      <div className="band band-lit band-edge" id="pricing">
        <section className="section">
          {PREMIUM_ENABLED ? (
            <>
              <div className="section-head">
                <span className="eyebrow" data-reveal="fade">
                  Tarifs
                </span>
                <h2 className="s-title" data-reveal>
                  Simple et <em>transparent.</em>
                </h2>
                <p className="s-sub" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
                  Démarrez gratuitement. Passez à Premium pour les profils illimités et la
                  synchronisation cloud cross-device.
                </p>
              </div>

              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <div className="price-toggle" data-reveal="fade" role="group" aria-label="Période de facturation">
                  <button className={period === 'monthly' ? 'active' : ''} onClick={() => setPeriod('monthly')}>
                    Mensuel
                  </button>
                  <button className={period === 'annual' ? 'active' : ''} onClick={() => setPeriod('annual')}>
                    Annuel <span className="save">−40 %</span>
                  </button>
                </div>
              </div>

              <div className="pricing-grid">
                <article className="plan" data-reveal>
                  <div className="plan-name">Gratuit</div>
                  <div className="plan-price">
                    0<span className="cur">€</span>
                    <small>/ toujours</small>
                  </div>
                  <p className="plan-tag">Tout ce qu'il faut pour démarrer.</p>
                  <ul className="plan-list">
                    <Tick>1 profil</Tick>
                    <Tick delay="60ms">Live, films et séries</Tick>
                    <Tick delay="120ms">Favoris &amp; historique locaux</Tick>
                    <Tick delay="180ms" locked>
                      Pas de sync cloud cross-device
                    </Tick>
                    <Tick delay="240ms" locked>
                      Pas de Mon ciné ni Communauté
                    </Tick>
                  </ul>
                  <span className="magnetic" style={{ width: '100%' }}>
                    <Link to="/downloads" className="btn btn-ghost" style={{ width: '100%' }}>
                      Télécharger
                    </Link>
                  </span>
                </article>

                <article className="plan plan-featured" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
                  <span className="plan-badge">Recommandé</span>
                  <div className="plan-name">Premium</div>
                  <div className="plan-price">
                    <PriceOdometer value={PRICES[period].prem} />
                    <span className="cur">€</span>
                    <small>{PRICES[period].unit}</small>
                  </div>
                  <p className="plan-tag">{PRICES[period].tag}</p>
                  <ul className="plan-list">
                    <Tick>Profils illimités</Tick>
                    <Tick delay="60ms">Sync cloud (téléphone ↔ TV ↔ ordi)</Tick>
                    <Tick delay="120ms">Mon ciné — mur de visionnage &amp; notes</Tick>
                    <Tick delay="180ms">Communauté — suivez des cinéphiles</Tick>
                    <Tick delay="240ms">Métadonnées enrichies</Tick>
                  </ul>
                  <span className="magnetic" style={{ width: '100%' }}>
                    <Link to="/premium" className="btn btn-primary" style={{ width: '100%' }}>
                      Passer Premium
                    </Link>
                  </span>
                </article>
              </div>
            </>
          ) : (
            <>
              <div className="section-head">
                <span className="eyebrow" data-reveal="fade">
                  Tarifs
                </span>
                <h2 className="s-title" data-reveal>
                  Gratuit. <em>Tout simplement.</em>
                </h2>
                <p className="s-sub" data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
                  Toutes les fonctionnalités sont incluses, sans abonnement. Sans
                  publicité, sans tracker — pour tout le monde.
                </p>
              </div>

              <div className="pricing-grid">
                <article className="plan plan-featured" data-reveal>
                  <span className="plan-badge">Tout inclus</span>
                  <div className="plan-name">Gratuit</div>
                  <div className="plan-price">
                    0<span className="cur">€</span>
                    <small>/ toujours</small>
                  </div>
                  <p className="plan-tag">Aucune fonctionnalité réservée.</p>
                  <ul className="plan-list">
                    <Tick>Profils illimités</Tick>
                    <Tick delay="60ms">Sync cloud (téléphone ↔ TV ↔ ordi)</Tick>
                    <Tick delay="120ms">Mon ciné — mur de visionnage &amp; notes</Tick>
                    <Tick delay="180ms">Communauté — suivez des cinéphiles</Tick>
                    <Tick delay="240ms">Métadonnées enrichies &amp; téléchargements</Tick>
                  </ul>
                  <span className="magnetic" style={{ width: '100%' }}>
                    <Link to="/downloads" className="btn btn-primary" style={{ width: '100%' }}>
                      Télécharger
                    </Link>
                  </span>
                </article>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ── FINAL CTA ─────────────────────────────────────────────── */}
      <div className="band band-deep band-edge">
        <section className="final">
          <div className="final-inner">
            <h2 data-reveal>
              Prêt à reprendre <em>le contrôle ?</em>
            </h2>
            <p data-reveal style={{ '--rd': '80ms' } as CSSProperties}>
              Umbra est gratuit, sans pub, sans tracker. Choisissez votre plateforme et
              commencez en 2&nbsp;minutes.
            </p>
            <div data-reveal style={{ '--rd': '160ms' } as CSSProperties}>
              <span className="magnetic">
                <Link to="/downloads" className="btn btn-primary">
                  Voir les téléchargements
                </Link>
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** Item de liste tarifaire avec coche (✓) ou croix (✗ pour `locked`). */
function Tick({
  children,
  delay,
  locked,
}: {
  children: ReactNode;
  delay?: string;
  locked?: boolean;
}) {
  return (
    <li className={locked ? 'locked' : undefined}>
      <span className="tick" style={delay ? ({ '--td': delay } as CSSProperties) : undefined}>
        {locked ? (
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="3.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </span>
      {children}
    </li>
  );
}

/** Prix « odometer » : chaque chiffre roule depuis 0 vers sa valeur cible. */
function PriceOdometer({ value }: { value: string }) {
  const [rolled, setRolled] = useState(false);
  useEffect(() => {
    setRolled(false);
    const t = window.setTimeout(() => setRolled(true), 40);
    return () => window.clearTimeout(t);
  }, [value]);

  return (
    <span>
      {value.split('').map((ch, i) => {
        if (!/\d/.test(ch)) {
          return (
            <span key={i} style={{ padding: '0 1px' }}>
              {ch}
            </span>
          );
        }
        const d = Number(ch);
        return (
          <span className="odo" key={i}>
            <span className="reel" style={{ transform: `translateY(${rolled ? -d : 0}em)` }}>
              {Array.from({ length: 10 }).map((_, n) => (
                <span key={n}>{n}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}
