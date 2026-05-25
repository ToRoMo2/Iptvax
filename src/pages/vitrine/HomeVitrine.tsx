import { Link } from 'react-router-dom';
import { DeviceShowcase } from '../../components/vitrine/DeviceShowcase';
import styles from './HomeVitrine.module.css';

export function HomeVitrine() {
  return (
    <div className={styles.page}>
      {/* ── Hero ─────────────────────────────────────────────────── */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} />
        <div className={styles.heroInner}>
          <div className={styles.eyebrow}>
            <span className={styles.dot} />
            Disponible sur 5 plateformes
          </div>
          <h1 className={styles.title}>
            Votre IPTV,
            <br />
            <span className={styles.titleAccent}>partout où vous êtes.</span>
          </h1>
          <p className={styles.subtitle}>
            Une seule app, tous vos écrans. Téléphone, ordinateur, TV — Iptvax
            lit vos abonnements Xtream Codes sans publicité, avec vos favoris
            et votre historique synchronisés.
          </p>
          <div className={styles.heroCtas}>
            <Link to="/downloads" className="btn btn-primary">
              Télécharger l'app
            </Link>
            <Link to="/premium" className="btn btn-secondary">
              Découvrir Premium
            </Link>
          </div>
          <p className={styles.heroNote}>
            Gratuit pour démarrer · Premium à partir de 2,49 €/mois
          </p>
        </div>
      </section>

      {/* ── Showcase 3 devices ────────────────────────────────────── */}
      <section className={styles.section} style={{ paddingTop: 0 }}>
        <DeviceShowcase />
      </section>

      {/* ── Features ──────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          Conçu pour la télé d'aujourd'hui
        </h2>
        <p className={styles.sectionSub}>
          Tout ce qu'un client IPTV moderne doit faire — et rien de ce qu'il
          ne devrait pas.
        </p>
        <div className={styles.featureGrid}>
          <Feature
            icon={<IconDevices />}
            title="Multi-plateforme"
            desc="Android, Windows, LG webOS, Samsung Tizen, Android TV. Même expérience, même compte, partout."
          />
          <Feature
            icon={<IconUsers />}
            title="Profils multiples"
            desc="Style Netflix : un compte, plusieurs profils IPTV. Chacun ses favoris, son historique, ses serveurs."
          />
          <Feature
            icon={<IconCloud />}
            title="Sync cross-device"
            desc="Commencez un film sur votre téléphone, finissez-le sur la TV. Reprise à la seconde près."
          />
          <Feature
            icon={<IconStar />}
            title="Mon ciné"
            desc="Notez vos films, rédigez vos critiques. Filtrez par genre, acteur, réalisateur — votre mur personnel."
          />
          <Feature
            icon={<IconCommunity />}
            title="Communauté"
            desc="Suivez d'autres cinéphiles. Comparez vos notes. Découvrez via vos pairs, pas via un algorithme."
          />
          <Feature
            icon={<IconShield />}
            title="Sans pub"
            desc="Aucun tracker, aucune bannière. Vos abonnements ne servent pas à entraîner une IA."
          />
        </div>
      </section>

      {/* ── Pricing / Comparatif ──────────────────────────────────── */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Simple et transparent</h2>
        <p className={styles.sectionSub}>
          Démarrez gratuitement. Passez à Premium quand vous avez besoin de
          plusieurs profils et de la synchronisation cross-device.
        </p>
        <div className={styles.pricingGrid}>
          <article className={styles.planCard}>
            <div className={styles.planName}>Gratuit</div>
            <div className={styles.planPrice}>
              0 €<small> / toujours</small>
            </div>
            <p className={styles.planTagline}>
              Tout ce qu'il faut pour démarrer.
            </p>
            <ul className={styles.planList}>
              <li>1 profil IPTV</li>
              <li>Live, films et séries en illimité</li>
              <li>Favoris et historique locaux (cet appareil)</li>
              <li className={styles.locked}>Pas de sync cross-device</li>
              <li className={styles.locked}>Pas de Mon ciné ni Communauté</li>
            </ul>
            <Link to="/downloads" className="btn btn-secondary">
              Télécharger
            </Link>
          </article>

          <article className={`${styles.planCard} ${styles.planFeatured}`}>
            <span className={styles.planBadge}>Recommandé</span>
            <div className={styles.planName}>Premium</div>
            <div className={styles.planPrice}>
              2,49 €<small> / mois</small>
            </div>
            <p className={styles.planTagline}>
              ou 17,99 €/an (économisez 40 %).
            </p>
            <ul className={styles.planList}>
              <li>Profils IPTV illimités</li>
              <li>Sync cross-device (téléphone ↔ TV ↔ ordi)</li>
              <li>Mon ciné — notes, critiques, mur perso</li>
              <li>Communauté — suivez d'autres cinéphiles</li>
              <li>Métadonnées TMDB enrichies</li>
            </ul>
            <Link to="/premium" className="btn btn-primary">
              Passer Premium
            </Link>
          </article>
        </div>
      </section>

      {/* ── Final CTA ─────────────────────────────────────────────── */}
      <section className={styles.finalCta}>
        <h2>Prêt à reprendre le contrôle ?</h2>
        <p>
          Iptvax est libre, sans pub, sans tracker. Choisissez votre
          plateforme et commencez en 2 minutes.
        </p>
        <Link to="/downloads" className="btn btn-primary">
          Voir les téléchargements
        </Link>
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <article className={styles.featureCard}>
      <div className={styles.featureIcon}>{icon}</div>
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureDesc}>{desc}</p>
    </article>
  );
}

/* ── Icons (inline SVG) ─────────────────────────────────────────────── */
function IconDevices() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <rect x="2" y="3" width="13" height="11" rx="2" />
      <path d="M2 17h13M8 14v3" />
      <rect x="17" y="9" width="5" height="11" rx="1" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
function IconCloud() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="M17.5 19a4.5 4.5 0 1 0 0-9h-1.8A7 7 0 1 0 4 15.5" />
      <polyline points="8 17 12 13 16 17" />
      <line x1="12" y1="13" x2="12" y2="21" />
    </svg>
  );
}
function IconStar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}
function IconCommunity() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
