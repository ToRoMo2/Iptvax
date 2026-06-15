/* ====================================================================
   IPTVAX · Composants transverses (cartes, rails, badges, sheets…)
   uS/uR/uE et W viennent de window (cf. data.jsx) — scopes Babel isolés.
   ==================================================================== */
const { uS, uR, uE, W } = window;

/* ── Étoiles ──────────────────────────────────────────────────────── */
function Stars({ value = 0, size = 14, onRate }) {
  const full = Math.floor(value), half = value - full >= 0.5;
  return (
    <span className="stars" style={{ fontSize: size }}>
      {[0,1,2,3,4].map(i => {
        const on = i < full, hf = i === full && half;
        return (
          <span key={i} className={on ? "" : "empty"} role={onRate ? "button" : undefined}
            onClick={onRate ? (e) => { e.stopPropagation(); onRate(i + 1); } : undefined}
            style={{ cursor: onRate ? "pointer" : "default", color: (on||hf) ? "var(--accent)" : "var(--t-4)" }}>
            {hf ? "★" : (on ? "★" : "☆")}
          </span>
        );
      })}
    </span>
  );
}

/* ── Badge note TMDB (vert) ───────────────────────────────────────── */
function TmdbBadge({ value }) {
  return <span className="tmdb-badge"><span className="tmdb-dot" />{value.toFixed(1)}</span>;
}

/* ── Placeholder affiche chaude (2:3) ─────────────────────────────── */
function PosterArt({ title, tag = "AFFICHE · 2:3", quality }) {
  const st = W.warmPoster(title);
  return (
    <div className="poster-art" style={st}>
      <span className="grain-layer" />
      <span className="poster-tag">{title}</span>
      {quality && <span className="pill pill-quality poster-q">{quality}</span>}
    </div>
  );
}

/* ── Carte poster 2:3 ─────────────────────────────────────────────── */
function PosterCard({ m, onClick, fav, onFav, quality, tmdb }) {
  return (
    <button className="poster-card bloom" onClick={onClick} title={m.title}>
      <div className="poster-frame">
        <PosterArt title={m.title} quality={quality} />
        <div className="poster-hover">
          <span className="poster-hover-play"><Icon.play size={18} fill /></span>
          <div className="poster-hover-meta">
            {tmdb != null && <TmdbBadge value={tmdb} />}
            <span className="poster-hover-yr">{m.year} · {m.runtime}</span>
          </div>
        </div>
        {onFav && (
          <span className={"poster-fav" + (fav ? " on" : "")} onClick={(e)=>{e.stopPropagation();onFav();}} role="button" aria-label="Favori">
            {fav ? <Icon.heartFill size={15}/> : <Icon.heart size={15}/>}
          </span>
        )}
      </div>
      <div className="poster-label">
        <span className="poster-name">{m.title}</span>
        <span className="poster-sub">{m.genre.split(" · ")[0]} · {m.year}</span>
      </div>
    </button>
  );
}

/* ── Carte large 16:9 (live / reprise / épisode) ──────────────────── */
function WideCard({ title, sub, code, live, progress, onClick, onRemove, locked, quality, channel }) {
  const st = W.warmPoster(title + (code||""));
  return (
    <button className="wide-card bloom" onClick={onClick} title={title}>
      <div className={"wide-art" + (channel ? " channel" : "")} style={st}>
        <span className="grain-layer" />
        {channel ? <span className="wide-code">{code}</span> : <span className="poster-tag sm">{title}</span>}
        {live && <span className="pill pill-live wide-live"><span className="dot" />LIVE</span>}
        {quality && <span className="pill pill-quality wide-q">{quality}</span>}
        {locked ? (
          <span className="wide-lock"><Icon.lock size={20}/><span>Premium</span></span>
        ) : (
          <span className="wide-play"><Icon.play size={18} fill/></span>
        )}
        {onRemove && !locked && <span className="wide-remove" role="button" onClick={(e)=>{e.stopPropagation();onRemove();}}><Icon.close size={12}/></span>}
        {progress != null && !locked && <span className="wide-progress"><span style={{width:progress+"%"}}/></span>}
      </div>
      <div className="wide-label">
        <span className="wide-name">{title}</span>
        {sub && <span className="wide-sub">{sub}</span>}
      </div>
    </button>
  );
}

/* ── Rail horizontal (flèches + dégradés de bord) ─────────────────── */
function Rail({ children, gap = 14 }) {
  const ref = uR(null);
  const [edge, setEdge] = uS({ l: false, r: true });
  const upd = () => { const el = ref.current; if (!el) return; setEdge({ l: el.scrollLeft > 8, r: el.scrollLeft < el.scrollWidth - el.clientWidth - 8 }); };
  uE(() => { upd(); }, []);
  const nudge = (d) => { const el = ref.current; if (el) el.scrollBy({ left: d * el.clientWidth * 0.8, behavior: "smooth" }); };
  return (
    <div className="rail-wrap">
      {edge.l && <button className="rail-arrow l" onClick={()=>nudge(-1)} aria-label="Précédent"><Icon.chevL size={20}/></button>}
      {edge.r && <button className="rail-arrow r" onClick={()=>nudge(1)} aria-label="Suivant"><Icon.chevR size={20}/></button>}
      <div className={"rail-edge-l" + (edge.l ? " on" : "")} />
      <div className={"rail-edge-r" + (edge.r ? " on" : "")} />
      <div className="rail no-scrollbar" ref={ref} onScroll={upd} style={{ gap }}>{children}</div>
    </div>
  );
}

/* ── En-tête de rangée ────────────────────────────────────────────── */
function RowHeader({ title, count, action, onAction, premium }) {
  return (
    <div className="row-header">
      <div className="row-title-group">
        <span className="row-title">{title}</span>
        {count != null && <><span className="row-divider" /><span className="row-count">{count}</span></>}
      </div>
      {action && (
        <button className={"row-seeall" + (premium ? " prem" : "")} onClick={onAction}>
          {premium && <Icon.spark size={13}/>} {action} {!premium && <Icon.chevR size={13}/>}
        </button>
      )}
    </div>
  );
}

/* ── Bottom-sheet (mobile) / popover ancré (desktop) ──────────────── */
function Sheet({ open, onClose, title, children, anchored }) {
  const [show, setShow] = uS(open);
  uE(() => { if (open) setShow(true); }, [open]);
  if (!show && !open) return null;
  return (
    <div className={"sheet-scrim" + (open ? " open" : "") + (anchored ? " anchored" : "")}
      onClick={onClose} onAnimationEnd={()=>{ if(!open) setShow(false); }}>
      <div className={"sheet" + (open ? " open" : "")} onClick={(e)=>e.stopPropagation()}>
        <div className="sheet-grip" />
        {title && <div className="sheet-head"><span>{title}</span><button className="sheet-x" onClick={onClose}><Icon.close size={18}/></button></div>}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* ── Overlay verrou Premium ───────────────────────────────────────── */
function PremiumLock({ title, text, onClick, compact }) {
  return (
    <div className={"prem-lock" + (compact ? " compact" : "")} onClick={(e)=>{e.stopPropagation(); onClick&&onClick();}}>
      <span className="prem-lock-ic"><Icon.lock size={compact?18:24}/></span>
      {title && <span className="prem-lock-title">{title}</span>}
      {text && !compact && <span className="prem-lock-text">{text}</span>}
      <span className="prem-lock-cta"><Icon.spark size={13}/> Premium</span>
    </div>
  );
}

/* ── Skeleton ─────────────────────────────────────────────────────── */
function Sk({ variant }) {
  const cls = variant === "poster" ? "sk-poster" : variant === "wide" ? "sk-wide" : "sk-line";
  return <span className={"sk " + cls} />;
}

Object.assign(window, { Stars, TmdbBadge, PosterArt, PosterCard, WideCard, Rail, RowHeader, Sheet, PremiumLock, Sk });
