/* ====================================================================
   IPTVAX · Films · Séries · Live TV · Ma Liste · Recherche
   3 modes même page : overview (rails) · catégorie (grille) · recherche
   ==================================================================== */

function SearchBar({ value, onChange, expanded, onToggle, placeholder }) {
  return (
    <div className={"searchbar" + (expanded ? " open" : "")}>
      <button className="sb-ic" onClick={onToggle}><Icon.search size={18}/></button>
      <input value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder||"Rechercher…"} />
      {value && <button className="sb-clear" onClick={()=>onChange("")}><Icon.close size={15}/></button>}
    </div>
  );
}

function CatHeader({ title, onBack }) {
  return (
    <div className="cat-header">
      <button className="cat-back" onClick={onBack}><Icon.chevL size={18}/> Retour</button>
      <h1 className="cat-title serif">{title}</h1>
    </div>
  );
}

/* ── Grille de posters (catégorie / recherche) ───────────────────── */
function PosterGrid({ items, nav, kind }) {
  return (
    <div className="poster-grid">
      {items.map((m,k)=><PosterCard key={k} m={m} tmdb={m.rating} onFav={()=>{}} onClick={()=>nav(kind==="series"?"series-detail":"movie-detail", m)}/>)}
    </div>
  );
}

/* ====================================================================
   FILMS / SÉRIES — overview | category | search dans la même page
   ==================================================================== */
function BrowseCatalog({ kind, cats, nav, isPremium, loading }) {
  const [mode, setMode] = uS("overview");   // overview | category | search
  const [cat, setCat] = uS(null);
  const [q, setQ] = uS("");
  const [exp, setExp] = uS(false);
  const detail = kind==="series" ? "series-detail" : "movie-detail";
  const allItems = cats.flatMap(c=>c.items);
  const results = q.length>=3 ? allItems.filter(m=>m.title.toLowerCase().includes(q.toLowerCase())) : [];
  const showSearch = exp && q.length>=3;

  if (loading) return <CatalogSkeleton/>;

  return (
    <div className="screen screen-catalog">
      <div className="catalog-top">
        <h1 className="catalog-h serif">{kind==="series" ? "Séries" : "Films"}</h1>
        <SearchBar value={q} onChange={v=>{setQ(v);}} expanded={exp} onToggle={()=>setExp(e=>!e)} placeholder={`Rechercher un ${kind==="series"?"série":"film"}…`}/>
      </div>

      {showSearch ? (
        <div className="catalog-body">
          <div className="row-header"><span className="row-title">Résultats</span><span className="row-count">{results.length}</span></div>
          {results.length ? <PosterGrid items={results} nav={nav} kind={kind}/> : <EmptyState icon="search" title="Aucun résultat" text={`Rien ne correspond à « ${q} ».`}/>}
        </div>
      ) : mode==="category" ? (
        <div className="catalog-body">
          <CatHeader title={cat.name} onBack={()=>setMode("overview")}/>
          <PosterGrid items={cat.items} nav={nav} kind={kind}/>
        </div>
      ) : (
        <div className="catalog-body rails">
          {/* Billboard Populaires (Premium only) */}
          <section className="billboard-section">
            <div className={"billboard" + (isPremium ? "" : " locked")} style={W.warmPoster(cats[0].items[0].title+"bb")}>
              <span className="grain-layer"/>
              <div className="bb-scrim"/>
              <div className="bb-content">
                <span className="bb-eyebrow"><Icon.spark size={13}/> Populaire cette semaine</span>
                <h2 className="bb-title serif">{cats[0].items[0].title}</h2>
                <div className="hero-meta"><span className="hm-rating"><Icon.starFill size={12}/> {cats[0].items[0].rating}</span><span className="hm-dot">·</span><span>{cats[0].items[0].genre}</span></div>
                <div className="bb-actions">
                  <button className="btn btn-primary" onClick={()=>nav("player",{title:cats[0].items[0].title,kind})}><Icon.play size={17} fill/> Regarder</button>
                  <button className="btn btn-secondary" onClick={()=>nav(detail,cats[0].items[0])}><Icon.info size={17}/> Plus d'infos</button>
                </div>
              </div>
              {!isPremium && <PremiumLock title="Sélection Populaires" text="La sélection éditoriale est réservée à Premium." onClick={()=>nav("premium")}/>}
            </div>
          </section>

          {/* Ma Liste */}
          <section className="row">
            <RowHeader title="Ma Liste" action="Voir tout" onAction={()=>nav("list")}/>
            <Rail>{cats[0].items.slice(0,4).map((m,k)=><PosterCard key={k} m={m} tmdb={m.rating} onClick={()=>nav(detail,m)}/>)}</Rail>
          </section>

          {/* Un rail par catégorie */}
          {cats.map((c,ci)=>(
            <section className="row" key={ci}>
              <RowHeader title={c.name} count={c.items.length} action="Voir tout" onAction={()=>{setCat(c);setMode("category");}}/>
              <Rail>{c.items.slice(0,12).map((m,k)=><PosterCard key={k} m={m} tmdb={m.rating} onClick={()=>nav(detail,m)}/>)}
                <button className="seeall-card" onClick={()=>{setCat(c);setMode("category");}}><span className="sa-plus"><Icon.chevR size={22}/></span><span>Voir tout</span></button>
              </Rail>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ScreenMovies(props){ return <BrowseCatalog kind="movie" cats={W.MOVIE_CATS} {...props}/>; }
function ScreenSeries(props){ return <BrowseCatalog kind="series" cats={W.SERIES_CATS} {...props}/>; }

/* ====================================================================
   LIVE TV — un rail par catégorie | catégorie complète | recherche
   ==================================================================== */
function ScreenLive({ nav, loading }) {
  const [mode, setMode] = uS("overview");
  const [cat, setCat] = uS(null);
  const [q, setQ] = uS("");
  const [exp, setExp] = uS(false);
  const [sheet, setSheet] = uS(null);
  const allCh = W.LIVE_CATS.flatMap(c=>c.channels);
  const results = q.length>=2 ? allCh.filter(c=>c.name.toLowerCase().includes(q.toLowerCase())) : [];

  if (loading) return <CatalogSkeleton wide/>;

  const ChannelCell = ({ c }) => (
    <button className="wide-card bloom" onClick={()=> c.variants ? setSheet(c) : nav("player",{title:c.name,live:true})}>
      <div className="wide-art channel" style={W.warmPoster(c.name)}>
        <span className="grain-layer"/><span className="wide-code">{c.code}</span>
        <span className="pill pill-live wide-live"><span className="dot"/>LIVE</span>
        <span className="pill pill-quality wide-q">{c.quality}{c.variants?` +${c.variants}`:""}</span>
        <span className="wide-play"><Icon.play size={18} fill/></span>
      </div>
      <div className="wide-label"><span className="wide-name">{c.name}</span><span className="wide-sub">{c.live}</span></div>
    </button>
  );

  return (
    <div className="screen screen-catalog">
      <div className="catalog-top">
        <h1 className="catalog-h serif">Live TV</h1>
        <SearchBar value={q} onChange={setQ} expanded={exp} onToggle={()=>setExp(e=>!e)} placeholder="Rechercher une chaîne…"/>
      </div>

      {exp && q.length>=2 ? (
        <div className="catalog-body">
          <div className="row-header"><span className="row-title">Résultats</span><span className="row-count">{results.length}</span></div>
          {results.length ? <div className="channel-grid">{results.map((c,k)=><ChannelCell key={k} c={c}/>)}</div> : <EmptyState icon="search" title="Aucune chaîne" text={`Rien ne correspond à « ${q} ».`}/>}
        </div>
      ) : mode==="category" ? (
        <div className="catalog-body">
          <CatHeader title={cat.name} onBack={()=>setMode("overview")}/>
          <div className="channel-grid">{cat.channels.map((c,k)=><ChannelCell key={k} c={c}/>)}</div>
        </div>
      ) : (
        <div className="catalog-body rails">
          {W.LIVE_CATS.map((c,ci)=>(
            <section className="row" key={ci}>
              <RowHeader title={c.name} count={c.channels.length} action="Voir tout" onAction={()=>{setCat(c);setMode("category");}}/>
              <Rail><div style={{display:"flex",gap:14}}>{c.channels.map((ch,k)=><ChannelCell key={k} c={ch}/>)}
                <button className="seeall-card wide" onClick={()=>{setCat(c);setMode("category");}}><span className="sa-plus"><Icon.chevR size={22}/></span><span>Voir tout</span></button></div></Rail>
            </section>
          ))}
        </div>
      )}

      <Sheet open={!!sheet} onClose={()=>setSheet(null)} title={sheet ? `${sheet.name} · Qualités` : ""} anchored={false}>
        {sheet && <div className="track-list">
          {["FHD · 1080p","HD · 720p","SD · 480p","4K · UHD"].slice(0,(sheet.variants||0)+1).map((v,k)=>(
            <button key={k} className={"track-row"+(k===0?" on":"")} onClick={()=>{setSheet(null);nav("player",{title:sheet.name,live:true});}}>
              <span>{v}</span><span className="track-right">{v.includes("4K") && <span className="ver-prem"><Icon.spark size={11}/> Premium</span>}{k===0 && <Icon.check size={16}/>}</span>
            </button>
          ))}
        </div>}
      </Sheet>
    </div>
  );
}

/* ── Ma Liste ─────────────────────────────────────────────────────── */
function ScreenList({ nav }) {
  const films = W.MOVIE_CATS[0].items.slice(0,4).concat(W.MOVIE_CATS[2].items.slice(0,2));
  const series = W.SERIES_CATS[0].items.slice(0,3);
  const channels = W.LIVE_CATS[1].channels.slice(0,2);
  const [filter, setFilter] = uS("all");
  const empty = false;
  return (
    <div className="screen screen-catalog">
      <div className="catalog-top"><h1 className="catalog-h serif">Ma Liste</h1></div>
      <div className="list-filters">
        {[["all","Tout"],["movie","Films"],["series","Séries"],["live","Chaînes"]].map(([k,l])=>(
          <button key={k} className={"chip"+(filter===k?" on":"")} onClick={()=>setFilter(k)}>{l}</button>
        ))}
      </div>
      <div className="catalog-body">
        {empty ? <EmptyState icon="heart" title="Votre liste est vide" text="Ajoutez films, séries et chaînes en favori pour les retrouver ici."/> : (
          <div className="poster-grid">
            {(filter==="all"||filter==="movie") && films.map((m,k)=><PosterCard key={"f"+k} m={m} tmdb={m.rating} fav onFav={()=>{}} onClick={()=>nav("movie-detail",m)}/>)}
            {(filter==="all"||filter==="series") && series.map((m,k)=><PosterCard key={"s"+k} m={m} tmdb={m.rating} fav onFav={()=>{}} onClick={()=>nav("series-detail",m)}/>)}
            {(filter==="all"||filter==="live") && channels.map((c,k)=>(
              <button key={"c"+k} className="poster-card bloom" onClick={()=>nav("player",{title:c.name,live:true})}>
                <div className="poster-frame"><div className="wide-art channel" style={{...W.warmPoster(c.name),aspectRatio:"2/3"}}><span className="grain-layer"/><span className="wide-code">{c.code}</span><span className="pill pill-live wide-live"><span className="dot"/>LIVE</span></div></div>
                <div className="poster-label"><span className="poster-name">{c.name}</span><span className="poster-sub">Chaîne · {c.quality}</span></div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Recherche globale multi-domaines ─────────────────────────────── */
function ScreenSearch({ nav }) {
  const [q, setQ] = uS("");
  const allM = W.MOVIE_CATS.flatMap(c=>c.items.map(i=>({...i,kind:"movie"})));
  const allS = W.SERIES_CATS.flatMap(c=>c.items.map(i=>({...i,kind:"series"})));
  const allC = W.LIVE_CATS.flatMap(c=>c.channels);
  const ql = q.toLowerCase();
  const has = q.length>=2;
  const mr = has ? allM.filter(m=>m.title.toLowerCase().includes(ql)) : [];
  const sr = has ? allS.filter(m=>m.title.toLowerCase().includes(ql)) : [];
  const cr = has ? allC.filter(c=>c.name.toLowerCase().includes(ql)) : [];
  const trending = ["Lame de Fond","Ligne de Nuit","Orbite Basse","Stade Or","Les Heures Bleues","Quartier Latin"];
  return (
    <div className="screen screen-search">
      <div className="search-hero">
        <div className="search-big">
          <Icon.search size={24}/>
          <input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Films, séries, chaînes…"/>
          {q && <button onClick={()=>setQ("")}><Icon.close size={20}/></button>}
        </div>
      </div>
      <div className="catalog-body">
        {!has ? (
          <div className="search-suggest">
            <span className="ss-lbl">Tendances de recherche</span>
            <div className="ss-chips">{trending.map((t,k)=><button key={k} className="chip" onClick={()=>setQ(t)}><Icon.spark size={13}/> {t}</button>)}</div>
          </div>
        ) : (mr.length+sr.length+cr.length===0) ? (
          <EmptyState icon="search" title="Aucun résultat" text={`Rien ne correspond à « ${q} ».`}/>
        ) : (
          <div className="search-results">
            {mr.length>0 && <section className="row"><RowHeader title="Films" count={mr.length}/><div className="poster-grid">{mr.map((m,k)=><PosterCard key={k} m={m} tmdb={m.rating} onClick={()=>nav("movie-detail",m)}/>)}</div></section>}
            {sr.length>0 && <section className="row"><RowHeader title="Séries" count={sr.length}/><div className="poster-grid">{sr.map((m,k)=><PosterCard key={k} m={m} tmdb={m.rating} onClick={()=>nav("series-detail",m)}/>)}</div></section>}
            {cr.length>0 && <section className="row"><RowHeader title="Chaînes" count={cr.length}/><div className="channel-grid">{cr.map((c,k)=>(
              <button key={k} className="wide-card bloom" onClick={()=>nav("player",{title:c.name,live:true})}><div className="wide-art channel" style={W.warmPoster(c.name)}><span className="grain-layer"/><span className="wide-code">{c.code}</span><span className="pill pill-live wide-live"><span className="dot"/>LIVE</span></div><div className="wide-label"><span className="wide-name">{c.name}</span></div></button>
            ))}</div></section>}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, text }) {
  const I = Icon[icon] || Icon.info;
  return <div className="empty-state"><span className="es-ic"><I size={28}/></span><span className="es-title">{title}</span><span className="es-text">{text}</span></div>;
}
function CatalogSkeleton({ wide }) {
  return <div className="screen screen-catalog"><div className="catalog-top"><span className="sk" style={{height:34,width:200,borderRadius:8}}/></div>
    <div className="catalog-body rails">{[0,1,2].map(r=><section className="row" key={r}><div className="row-header"><span className="sk" style={{height:20,width:150,borderRadius:6}}/></div><div className="rail no-scrollbar">{[0,1,2,3,4,5].map(i=><Sk key={i} variant={wide?"wide":"poster"}/>)}</div></section>)}</div></div>;
}

Object.assign(window, { ScreenMovies, ScreenSeries, ScreenLive, ScreenList, ScreenSearch, EmptyState });
