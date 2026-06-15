/* ====================================================================
   IPTVAX · LOGO — 3 pistes « Lumière / Halo doré »
   Chaque mark est déclinable : favicon, avatar fallback, pastille, splash.
   ==================================================================== */
const { useId } = React;

/* ── Piste A — « Aube » : disque-soleil dégradé or, croissant d'ombre,
   anneau-halo fin. Évoque le lever du jour + l'objectif du projecteur. ── */
function MarkAube({ size = 48 }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`au-${id}`} x1="10" y1="8" x2="40" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5A623"/><stop offset="0.5" stopColor="#F3B658"/><stop offset="1" stopColor="#E8C27E"/>
        </linearGradient>
        <radialGradient id={`gl-${id}`} cx="24" cy="24" r="22" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5A623" stopOpacity="0.55"/><stop offset="1" stopColor="#F5A623" stopOpacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill={`url(#gl-${id})`}/>
      <circle cx="24" cy="24" r="13.5" fill={`url(#au-${id})`}/>
      <circle cx="28.5" cy="20" r="11.5" fill="#19120D"/>
      <circle cx="24" cy="24" r="18.5" stroke="#E8C27E" strokeOpacity="0.5" strokeWidth="1.3"/>
    </svg>
  );
}

/* ── Piste B — « Faisceau » : point lumineux émettant un cône de
   projection (marquise de cinéma). Géométrique, signature forte. ── */
function MarkFaisceau({ size = 48 }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`fb-${id}`} x1="24" y1="6" x2="24" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5A623"/><stop offset="1" stopColor="#E8C27E" stopOpacity="0.18"/>
        </linearGradient>
        <radialGradient id={`fp-${id}`} cx="24" cy="11" r="9" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFE6B0"/><stop offset="0.4" stopColor="#F5A623"/><stop offset="1" stopColor="#F5A623" stopOpacity="0"/>
        </radialGradient>
      </defs>
      {/* cône de lumière */}
      <path d="M24 11 L40 41 H8 Z" fill={`url(#fb-${id})`} opacity="0.92"/>
      <path d="M24 11 L31 41 H17 Z" fill="#FFE6B0" opacity="0.30"/>
      {/* source lumineuse */}
      <circle cx="24" cy="11" r="9" fill={`url(#fp-${id})`}/>
      <circle cx="24" cy="11" r="4.4" fill="#FFF3D8"/>
    </svg>
  );
}

/* ── Piste C — « Marquise » : monogramme I dans un arc-halo, façon
   enseigne lumineuse. Lettre crème, halo doré. ── */
function MarkMarquise({ size = 48 }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`mq-${id}`} x1="8" y1="10" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#F5A623"/><stop offset="1" stopColor="#E8C27E"/>
        </linearGradient>
      </defs>
      {/* arc-halo supérieur */}
      <path d="M9 22 A15 15 0 0 1 39 22" stroke={`url(#mq-${id})`} strokeWidth="3" strokeLinecap="round"/>
      <path d="M14 20.5 A10 10 0 0 1 34 20.5" stroke="#E8C27E" strokeOpacity="0.4" strokeWidth="1.6" strokeLinecap="round"/>
      {/* fût du I + empattements */}
      <rect x="21.5" y="20" width="5" height="18" rx="2.5" fill="#FDF8F2"/>
      <rect x="16" y="36" width="16" height="4.5" rx="2.25" fill="#FDF8F2"/>
      <circle cx="24" cy="13.5" r="3.2" fill={`url(#mq-${id})`}/>
    </svg>
  );
}

const MARKS = { aube: MarkAube, faisceau: MarkFaisceau, marquise: MarkMarquise };

/* ── Wordmark complet : mark + IPTVAX ─────────────────────────────── */
function Wordmark({ variant = "aube", size = 32, color = "var(--t-1)" }) {
  const Mark = MARKS[variant] || MarkAube;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.34 }}>
      <Mark size={size} />
      <span style={{
        fontFamily: "var(--font-display)", fontSize: size * 0.92, lineHeight: 1,
        letterSpacing: "0.02em", color, fontWeight: 400,
      }}>
        iptv<span className="au-gold">ax</span>
      </span>
    </span>
  );
}

Object.assign(window, { MarkAube, MarkFaisceau, MarkMarquise, Wordmark, LOGO_MARKS: MARKS });
