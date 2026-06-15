/* ====================================================================
   IPTVAX · Fiche détail Film + Série
   ==================================================================== */

function VersionPicker({ open, onClose, anchored }) {
  const versions = [
    { lang: "VF", q: "FHD", size: "4.2 Go", def: true },
    { lang: "VF", q: "HD", size: "2.1 Go" },
    { lang: "VOSTFR", q: "4K", size: "8.6 Go", prem: true },
    { lang: "VOSTFR", q: "HD", size: "2.0 Go" },
    { lang: "VO", q: "SD", size: "0.9 Go" },
  ];
  const [sel, setSel] = uS(0);
  return (
    <Sheet open={open} onClose={onClose} title="Choisir la version" anchored={anchored}>
      <div className="ver-list">
        {versions.map((v,k)=>(
          <button key={k} className={"ver-row" + (sel===k?" on":"")} onClick={()=>{setSel(k);}}>
            <span className="ver-main"><span className="ver-lang">{v.lang}</span><span className="pill pill-quality">{v.q}</span>{v.prem && <span className="ver-prem"><Icon.spark size={11}/> Premium</span>}</span>
            <span className="ver-size">{v.size}</span>
            {sel===k && <span className="ver-check"><Icon.check size={16}/></span>}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function DetailHero({ m, kind, nav, mode }) {
  const [fav, setFav] = uS(false);
  const [ver, setVer] = uS(false);
  return (
    <div className="detail-hero">
      <div className="dh-backdrop" style={W.warmPoster(m.title+"hero")}><span className="grain-layer"/><div className="dh-scrim"/></div>
      <div className="dh-body">
        <div className="dh-poster"><PosterArt title={m.title}/></div>
        <div className="dh-info">
          <div className="dh-eyebrow">{kind==="series" ? "Série" : "Film"}{m.src && <span className="he-src">Reco TMDB</span>}</div>
          <h1 className="dh-title serif">{m.title}</h1>
          <div className="dh-meta">
            <TmdbBadge value={m.rating}/>
            <span className="hm-dot">·</span><span>{m.year}</span>
            <span className="hm-dot">·</span><span>{m.genre}</span>
            <span className="hm-dot">·</span><span className="pill pill-hd">{m.runtime}</span>
          </div>
          <p className="dh-plot">{m.plot}</p>
          <div className="dh-cast"><span className="dh-cast-lbl">Avec</span> {m.cast}</div>
          <div className="dh-actions">
            <button className="btn btn-primary" onClick={()=>nav("player", { title:m.title, kind })}><Icon.play size={18} fill/> Regarder</button>
            <button className="btn btn-secondary" onClick={()=>nav("player", { title:m.title, kind, resume:true })}><Icon.back10 size={18}/> Reprendre</button>
            <button className={"icon-btn-lg" + (fav?" on":"")} onClick={()=>setFav(f=>!f)} title="Favori">{fav?<Icon.heartFill size={20}/>:<Icon.heart size={20}/>}</button>
            <button className="dh-version" onClick={()=>setVer(true)}><span className="dv-lbl">Version</span><span className="dv-val">VF · FHD</span><Icon.chevD size={15}/></button>
          </div>
        </div>
      </div>
      <VersionPicker open={ver} onClose={()=>setVer(false)} anchored={mode!=="mobile"}/>
    </div>
  );
}

function ScreenMovieDetail({ payload, nav, mode }) {
  const m = payload || W.MOVIE_CATS[0].items[0];
  const sims = W.MOVIE_CATS[0].items.filter(x=>x.title!==m.title).slice(0,6);
  return (
    <div className="screen screen-detail">
      <button className="detail-back" onClick={()=>nav("back")}><Icon.chevL size={18}/> Retour</button>
      <DetailHero m={m} kind="movie" nav={nav} mode={mode}/>
      <section className="row" style={{marginTop:"var(--row-gap)"}}>
        <RowHeader title="Dans le même genre"/>
        <Rail>{sims.map((x,k)=><PosterCard key={k} m={x} tmdb={x.rating} onClick={()=>nav("movie-detail", x)}/>)}</Rail>
      </section>
    </div>
  );
}

function ScreenSeriesDetail({ payload, nav, mode }) {
  const m = payload || W.SERIES_CATS[0].items[0];
  const [season, setSeason] = uS(1);
  const [seasonOpen, setSeasonOpen] = uS(false);
  const seasons = [1,2,3];
  const eps = W.EPISODES[season] || [];
  return (
    <div className="screen screen-detail">
      <button className="detail-back" onClick={()=>nav("back")}><Icon.chevL size={18}/> Retour</button>
      <DetailHero m={m} kind="series" nav={nav} mode={mode}/>
      <section className="ep-section">
        <div className="ep-head">
          <span className="row-title">Épisodes</span>
          <div className="season-pick">
            <button className="season-btn" onClick={()=>setSeasonOpen(o=>!o)}>Saison {season} <Icon.chevD size={15}/></button>
            {seasonOpen && (
              <div className="season-menu glass">
                {seasons.map(s=>(
                  <button key={s} className={"season-opt"+(s===season?" on":"")} onClick={()=>{setSeason(s);setSeasonOpen(false);}}>Saison {s}{s===season && <Icon.check size={15}/>}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="ep-list">
          {eps.map(ep=>(
            <button key={ep.n} className="ep-row" onClick={()=>nav("player", { title:`${m.title} — É${ep.n}`, kind:"series" })}>
              <div className="ep-thumb" style={W.warmPoster(m.title+ep.n)}><span className="grain-layer"/><span className="ep-play"><Icon.play size={16} fill/></span><span className="ep-num">{ep.n}</span></div>
              <div className="ep-info">
                <div className="ep-title-row"><span className="ep-title">{ep.n}. {ep.title}</span><span className="ep-dur">{ep.dur}</span></div>
                <p className="ep-plot">{ep.plot}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

Object.assign(window, { ScreenMovieDetail, ScreenSeriesDetail });
