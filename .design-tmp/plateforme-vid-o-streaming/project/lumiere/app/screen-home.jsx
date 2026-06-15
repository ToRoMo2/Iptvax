/* ====================================================================
   IPTVAX · Écran ACCUEIL — hero carrousel auto (7s) + rails
   nav(screen, payload) — signature unique partagée par tous les écrans.
   ==================================================================== */
const HERO_SLIDES = [
  { ...W.MOVIE_CATS[3].items[0], eyebrow: "À la une", src: "tmdb", kind: "movie" },
  { ...W.SERIES_CATS[0].items[1], eyebrow: "Tendance", src: "tmdb", kind: "series" },
  { ...W.MOVIE_CATS[2].items[0], eyebrow: "Nouveauté", src: "playlist", kind: "movie" },
];

function Hero({ nav }) {
  const [i, setI] = uS(0);
  const [paused, setPaused] = uS(false);
  uE(() => {
    if (paused) return;
    const t = setInterval(() => setI(p => (p + 1) % HERO_SLIDES.length), 7000);
    return () => clearInterval(t);
  }, [paused, i]);
  const go = (n) => setI((n + HERO_SLIDES.length) % HERO_SLIDES.length);
  const s = HERO_SLIDES[i];
  return (
    <section className="hero" onMouseEnter={()=>setPaused(true)} onMouseLeave={()=>setPaused(false)}>
      <div className="hero-stage">
        {HERO_SLIDES.map((sl, k) => (
          <div key={k} className={"hero-bg" + (k===i ? " on" : "")} style={W.warmPoster(sl.title+"hero")}>
            <span className="grain-layer" />
          </div>
        ))}
        <div className="hero-scrim" />
      </div>
      <div className="hero-content" key={i}>
        <div className="hero-eyebrow">
          <span className="he-spark"><Icon.spark size={12}/></span>{s.eyebrow}
          <span className="he-src">{s.src === "tmdb" ? "Reco TMDB" : "Playlist"}</span>
        </div>
        <h1 className="hero-title serif">{s.title}</h1>
        <div className="hero-meta">
          <span className="hm-rating"><Icon.starFill size={13}/> {s.rating.toFixed(1)}</span>
          <span className="hm-dot">·</span><span>{s.genre}</span>
          <span className="hm-dot">·</span><span className="pill pill-hd">HD</span>
          <span className="hm-dot">·</span><span>{s.year}</span>
        </div>
        <p className="hero-plot">{s.plot}</p>
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={()=>nav("player", { title: s.title, kind: s.kind })}><Icon.play size={18} fill/> Regarder</button>
          <button className="btn btn-secondary" onClick={()=>nav(s.kind==="series"?"series-detail":"movie-detail", s)}><Icon.info size={18}/> Plus d'infos</button>
        </div>
      </div>
      <div className="hero-nav">
        <button className="hero-arrow" onClick={()=>go(i-1)} aria-label="Précédent"><Icon.chevL size={20}/></button>
        <div className="hero-dots">
          {HERO_SLIDES.map((_, k) => (
            <button key={k} className={"hero-dot" + (k===i ? " on" : "")} onClick={()=>go(k)} aria-label={`Slide ${k+1}`}>
              <span className="hero-dot-fill" style={{ width: k<i ? "100%" : (k>i ? "0%" : undefined),
                animation: (k===i && !paused) ? "dot-fill 7s linear forwards" : "none" }} />
            </button>
          ))}
        </div>
        <button className="hero-arrow" onClick={()=>go(i+1)} aria-label="Suivant"><Icon.chevR size={20}/></button>
      </div>
    </section>
  );
}

/* ── Rangée « Reprendre » (cartes 16:9 + progression + ✕ + Tout vider) ── */
function ResumeRow({ nav, isPremium }) {
  const base = [
    { ...W.MOVIE_CATS[0].items[2], progress: 64 },
    { ...W.SERIES_CATS[0].items[0], progress: 28, ep: "S1 · É3" },
    { ...W.MOVIE_CATS[2].items[3], progress: 81 },
    { ...W.MOVIE_CATS[1].items[1], progress: 12 },
  ];
  const [items, setItems] = uS(base);
  if (!items.length) return null;
  return (
    <section className="row">
      <RowHeader title="Reprendre" action={isPremium ? "Tout vider" : null} onAction={()=>setItems([])} />
      <div className={"resume-wrap" + (isPremium ? "" : " locked")}>
        <Rail>
          {items.map((m, k) => (
            <WideCard key={k} title={m.title} sub={m.ep || m.genre.split(" · ")[0]} progress={m.progress}
              onClick={()=>nav("player", { title: m.title })} onRemove={()=>setItems(items.filter((_,j)=>j!==k))} />
          ))}
        </Rail>
        {!isPremium && <div className="resume-lock"><PremiumLock title="Reprenez où vous étiez" text="L'historique de lecture est réservé aux abonnés Premium." onClick={()=>nav("premium")} /></div>}
      </div>
    </section>
  );
}

function ScreenHome({ nav, isPremium, loading }) {
  if (loading) return <HomeSkeleton />;
  return (
    <div className="screen screen-home">
      <Hero nav={nav} />
      <div className="home-rails">
        <ResumeRow nav={nav} isPremium={isPremium} />

        <section className="row">
          <RowHeader title="En direct" action="Voir tout" onAction={()=>nav("live")} />
          <Rail>
            {W.LIVE_CATS[0].channels.concat(W.LIVE_CATS[1].channels.slice(0,2)).map((c,k)=>(
              <WideCard key={k} title={c.name} sub={c.live} code={c.code} channel live quality={c.quality}
                onClick={()=>nav("player", { title: c.name, live: true })} />
            ))}
          </Rail>
        </section>

        {/* Bandeau source des recommandations + upsell */}
        <section className="reco-band" style={{ marginLeft: "var(--pad-edge)", marginRight: "var(--pad-edge)" }}>
          <div className="reco-left">
            <span className="reco-ic"><Icon.spark size={18}/></span>
            <div>
              <span className="reco-title">{isPremium ? "Recommandations TMDB activées" : "Recommandations basées sur votre playlist"}</span>
              <span className="reco-sub">{isPremium ? "Vos suggestions s'affinent avec la base TMDB." : "Passez Premium pour des reco enrichies par TMDB."}</span>
            </div>
          </div>
          {!isPremium && <button className="btn btn-primary reco-cta" onClick={()=>nav("premium")}><Icon.spark size={15}/> Découvrir Premium</button>}
        </section>

        <section className="row">
          <RowHeader title="Films populaires" action="Voir tout" onAction={()=>nav("movies")} />
          <Rail>
            {W.MOVIE_CATS[0].items.concat(W.MOVIE_CATS[2].items.slice(0,2)).map((m,k)=>(
              <PosterCard key={k} m={m} tmdb={m.rating} onClick={()=>nav("movie-detail", m)} />
            ))}
          </Rail>
        </section>

        <section className="row">
          <RowHeader title="Séries tendances" action="Voir tout" onAction={()=>nav("series")} />
          <Rail>
            {W.SERIES_CATS[0].items.map((m,k)=>(
              <PosterCard key={k} m={m} tmdb={m.rating} onClick={()=>nav("series-detail", m)} />
            ))}
          </Rail>
        </section>
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="screen screen-home">
      <div className="hero hero-sk"><div className="hero-content">
        <Sk /><div style={{height:14}}/><span className="sk" style={{height:46,width:"70%",borderRadius:10}}/>
        <div style={{height:12}}/><span className="sk" style={{height:14,width:"50%",borderRadius:6}}/>
      </div></div>
      {[0,1,2].map(r=>(
        <section className="row" key={r}>
          <div className="row-header"><span className="sk" style={{height:20,width:160,borderRadius:6}}/></div>
          <div className="rail no-scrollbar">{[0,1,2,3,4].map(i=><Sk key={i} variant={r===0?"wide":"poster"}/>)}</div>
        </section>
      ))}
    </div>
  );
}

Object.assign(window, { ScreenHome });
