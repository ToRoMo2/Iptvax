/* ====================================================================
   IPTVAX · Mon ciné · Communauté · Ciné d'un membre (Premium)
   ==================================================================== */
function CineFilters({ open, onToggle, mode }) {
  const groups = [
    { name: "Type", opts: ["Films", "Séries"] },
    { name: "Statut", opts: ["Vu", "En cours", "À voir"] },
    { name: "Genres", opts: ["Drame", "Action", "SF", "Policier", "Comédie"] },
    { name: "Réalisateurs", opts: ["M. Renaud", "S. Voss", "H. Albrecht"] },
    { name: "Acteurs", opts: ["I. Moreau", "A. Okafor", "L. Choi"] },
  ];
  const [openG, setOpenG] = uS({ Type: true, Statut: true });
  const [sel, setSel] = uS({});
  return (
    <aside className={"cine-filters" + (open ? " open" : "")}>
      <div className="cf-head"><Icon.filter size={17}/> Filtres {mode==="mobile" && <button className="cf-x" onClick={onToggle}><Icon.close size={18}/></button>}</div>
      {groups.map(g=>(
        <div className="cf-group" key={g.name}>
          <button className="cf-g-head" onClick={()=>setOpenG(o=>({...o,[g.name]:!o[g.name]}))}>{g.name}<Icon.chevD size={15} style={{transform:openG[g.name]?"rotate(180deg)":"none",transition:"transform .2s"}}/></button>
          {openG[g.name] && <div className="cf-opts">{g.opts.map(o=>(
            <button key={o} className={"cf-opt"+(sel[o]?" on":"")} onClick={()=>setSel(s=>({...s,[o]:!s[o]}))}><span className="cf-check">{sel[o] && <Icon.check size={12}/>}</span>{o}</button>
          ))}</div>}
        </div>
      ))}
    </aside>
  );
}

function CineStats({ data }) {
  const avg = (data.reduce((a,b)=>a+b.rating,0)/data.length).toFixed(1);
  const films = data.filter(d=>d.type==="Film").length;
  const series = data.filter(d=>d.type==="Série").length;
  return (
    <div className="cine-stats">
      <div className="cstat"><span className="cs-val au-gold">{avg}</span><span className="cs-lbl">Note moyenne</span></div>
      <div className="cstat"><span className="cs-val">{data.length}</span><span className="cs-lbl">Œuvres notées</span></div>
      <div className="cstat"><span className="cs-val">{films}</span><span className="cs-lbl">Films</span></div>
      <div className="cstat"><span className="cs-val">{series}</span><span className="cs-lbl">Séries</span></div>
    </div>
  );
}

function WatchedWall({ data, nav, member }) {
  return (
    <div className="watched-wall">
      {data.map((w,k)=>(
        <article className="watched-card bloom" key={k} onClick={()=>nav(w.type==="Série"?"series-detail":"movie-detail", {title:w.title,year:2024,genre:w.type,rating:w.rating,runtime:"2h",plot:w.note,cast:"—"})}>
          <div className="wc-poster" style={W.warmPoster(w.title)}><span className="grain-layer"/>
            <span className={"wc-status "+(w.status==="Vu"?"seen":w.status==="En cours"?"prog":"")}>{w.status}</span>
          </div>
          <div className="wc-body">
            <div className="wc-top"><span className="wc-title">{w.title}</span><span className="wc-type">{w.type}</span></div>
            <Stars value={w.rating} size={15}/>
            <p className="wc-note">{member ? "« " : ""}{w.note}{member ? " »" : ""}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function ScreenCine({ nav, isPremium, mode }) {
  const [fOpen, setFOpen] = uS(false);
  if (!isPremium) return <PremiumGate nav={nav} title="Mon ciné" text="Votre mur de visionnages notés, vos critiques et vos statistiques personnelles sont réservés à Premium."/>;
  return (
    <div className="screen screen-cine">
      <div className="cine-top">
        <h1 className="catalog-h serif">Mon ciné</h1>
        <button className="chip filter-toggle" onClick={()=>setFOpen(o=>!o)}><Icon.filter size={15}/> Filtres</button>
      </div>
      <CineStats data={W.WATCHED}/>
      <div className="cine-layout">
        <CineFilters open={fOpen} onToggle={()=>setFOpen(false)} mode={mode}/>
        {fOpen && mode==="mobile" && <div className="cf-scrim" onClick={()=>setFOpen(false)}/>}
        <WatchedWall data={W.WATCHED} nav={nav}/>
      </div>
    </div>
  );
}

function ScreenCommunity({ nav, isPremium }) {
  const [following, setFollowing] = uS({ "popcorn.lea": true });
  if (!isPremium) return <PremiumGate nav={nav} title="Communauté" text="Suivez d'autres cinéphiles, découvrez leurs murs et partagez vos notes. Réservé à Premium."/>;
  return (
    <div className="screen screen-cine">
      <div className="cine-top"><h1 className="catalog-h serif">Communauté</h1></div>
      <p className="comm-intro">Suivez des cinéphiles, découvrez leurs coups de cœur, comparez vos notes.</p>
      <section className="row"><div className="row-header"><span className="row-title">Membres suivis</span></div>
        <div className="member-grid">
          {W.MEMBERS.map((m,k)=>(
            <article className="member-card bloom" key={k}>
              <button className="mc-main" onClick={()=>nav("member-cine", m)}>
                <span className="mc-av" style={{background:`radial-gradient(circle at 35% 30%, color-mix(in oklab, var(--${m.color}) 70%, white 8%), var(--${m.color}))`}}>{m.avatar}</span>
                <span className="mc-name">@{m.name}</span>
                <span className="mc-meta">{m.films} œuvres · <Icon.starFill size={11}/> {m.rating}/5</span>
              </button>
              <button className={"mc-follow"+(following[m.name]?" on":"")} onClick={()=>setFollowing(f=>({...f,[m.name]:!f[m.name]}))}>{following[m.name]?<><Icon.check size={14}/> Suivi</>:<><Icon.plus size={14}/> Suivre</>}</button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function ScreenMemberCine({ payload, nav, mode }) {
  const m = payload || W.MEMBERS[0];
  const [fOpen, setFOpen] = uS(false);
  return (
    <div className="screen screen-cine">
      <button className="cat-back" onClick={()=>nav("back")} style={{margin:"0 var(--pad-edge)"}}><Icon.chevL size={18}/> Retour</button>
      <div className="member-hero">
        <span className="mh-av" style={{background:`radial-gradient(circle at 35% 30%, color-mix(in oklab, var(--${m.color}) 70%, white 8%), var(--${m.color}))`}}>{m.avatar}</span>
        <div><h1 className="mh-name serif">@{m.name}</h1><span className="mh-meta">{m.films} œuvres notées · Note moyenne {m.rating}/5</span></div>
        <button className="chip filter-toggle" onClick={()=>setFOpen(o=>!o)} style={{marginLeft:"auto"}}><Icon.filter size={15}/> Filtres</button>
      </div>
      <div className="cine-layout">
        <CineFilters open={fOpen} onToggle={()=>setFOpen(false)} mode={mode}/>
        {fOpen && mode==="mobile" && <div className="cf-scrim" onClick={()=>setFOpen(false)}/>}
        <WatchedWall data={W.WATCHED.slice().reverse()} nav={nav} member/>
      </div>
    </div>
  );
}

function PremiumGate({ nav, title, text }) {
  return (
    <div className="screen screen-cine">
      <div className="cine-top"><h1 className="catalog-h serif">{title}</h1></div>
      <div className="premium-gate">
        <span className="pg-ic"><Icon.lock size={30}/></span>
        <h2 className="pg-title serif">Fonctionnalité Premium</h2>
        <p className="pg-text">{text}</p>
        <button className="btn btn-primary" onClick={()=>nav("premium")}><Icon.spark size={16}/> Découvrir Premium</button>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenCine, ScreenCommunity, ScreenMemberCine, PremiumGate });
