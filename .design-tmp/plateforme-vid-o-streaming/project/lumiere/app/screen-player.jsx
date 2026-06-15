/* ====================================================================
   IPTVAX · LECTEUR VIDÉO — overlay tactile/souris transparent
   scrubber animé · audio/CC/qualité (sheets) · Live (Chaînes/EPG) ·
   épisodes · perso sous-titres (aperçu live) · carte de buffering.
   ==================================================================== */
function fmt(s) { const m = Math.floor(s/60), ss = Math.floor(s%60); return `${m}:${ss<10?"0":""}${ss}`; }

function ScreenPlayer({ payload, nav, mode }) {
  const p = payload || {};
  const live = !!p.live;
  const total = 8160; // 2h16
  const [t, setT] = uS(p.resume ? 3120 : 1);
  const [playing, setPlaying] = uS(true);
  const [buffering, setBuffering] = uS(true);
  const [ui, setUi] = uS(true);
  const [sheet, setSheet] = uS(null);     // audio | cc | quality | subs
  const [bar, setBar] = uS("channels");   // live: channels | epg
  const [vol, setVol] = uS(72);
  const [bright, setBright] = uS(60);
  const [subStyle, setSubStyle] = uS({ size: 2, color: "#FDF8F2", bg: 1 });
  const [epOpen, setEpOpen] = uS(false);
  const hideRef = uR(null);

  // warm-up projecteur : buffering ~1.4s
  uE(() => { const x = setTimeout(()=>setBuffering(false), 1400); return ()=>clearTimeout(x); }, []);
  // progression
  uE(() => {
    if (!playing || buffering || live) return;
    const x = setInterval(()=>setT(v=>Math.min(total, v+1)), 1000);
    return ()=>clearInterval(x);
  }, [playing, buffering, live]);
  // auto-hide UI
  const poke = () => { setUi(true); clearTimeout(hideRef.current); hideRef.current = setTimeout(()=>{ if(playing) setUi(false); }, 3800); };
  uE(() => { poke(); return ()=>clearTimeout(hideRef.current); }, [playing]);

  const seek = (e) => { const r = e.currentTarget.getBoundingClientRect(); setT(Math.round((e.clientX-r.left)/r.width*total)); };
  const pct = (t/total)*100;
  const subSizes = [13,17,22,28]; const subBgs = ["transparent","rgba(16,11,7,.62)","#100B07"];

  return (
    <div className={"player" + (ui?" ui-on":" ui-off")} onMouseMove={poke} onClick={poke}>
      {/* vidéo simulée (en natif: WebView transparente par-dessus la vidéo) */}
      <div className="player-video" style={W.warmPoster((p.title||"Lecture")+"player")}>
        <span className="grain-layer" style={{opacity:.08}}/>
        <div className="player-video-glow" />
      </div>
      {/* filtre luminosité (mobile sliders) */}
      <div className="player-bright" style={{ opacity: (100-bright)/170 }} />

      {/* sous-titres (aperçu live de la perso) */}
      <div className="player-subs" style={{ bottom: ui ? "22%" : "10%" }}>
        <span className="sub-cue" style={{ fontSize: subSizes[subStyle.size]+"px", color: subStyle.color,
          background: subBgs[subStyle.bg], padding: subStyle.bg? "4px 12px":"0",
          textShadow: subStyle.bg? "none" : "0 1px 4px #000, 0 0 2px #000" }}>
          — On ne revient jamais vraiment d'une nuit comme celle-ci.
        </span>
      </div>

      {/* CARTE DE BUFFERING (verre dépoli, logo animé, AUCUN play) */}
      {buffering && (
        <div className="buffer-card glass">
          <span className="buffer-logo"><Wordmark variant={window.LOGO_VARIANT||"aube"} size={26}/></span>
          <span className="buffer-spin" />
          <span className="buffer-txt">Préparation du flux…</span>
        </div>
      )}

      {/* ---- OVERLAY ---- */}
      <div className="player-overlay">
        {/* top bar */}
        <div className="pl-top">
          <button className="pl-back" onClick={()=>nav("back")}><Icon.close size={20}/></button>
          <div className="pl-title-wrap">
            <span className="pl-title">{p.title || "Lame de Fond"}</span>
            <span className="pl-sub">{live ? <><span className="pill pill-live"><span className="dot"/>LIVE</span> Journal de 20h</> : (p.kind==="series" ? "Saison 1 · Épisode 3" : "Film · VF · FHD")}</span>
          </div>
          {!live && p.kind==="series" && <button className="pl-eptoggle" onClick={()=>setEpOpen(true)}><Icon.grid size={17}/> Épisodes</button>}
        </div>

        {/* center controls */}
        <div className="pl-center">
          <button className="pl-c-side" onClick={()=>setT(v=>Math.max(0,v-10))}><Icon.back10 size={mode==="mobile"?30:34}/><span>10</span></button>
          <button className="pl-c-main" onClick={()=>setPlaying(p=>!p)}>{playing ? <Icon.pause size={34} fill/> : <Icon.play size={34} fill/>}</button>
          <button className="pl-c-side" onClick={()=>setT(v=>Math.min(total,v+10))}><Icon.fwd10 size={mode==="mobile"?30:34}/><span>10</span></button>
        </div>

        {/* sliders latéraux (mobile) */}
        <div className="pl-vside left"><Icon.sun size={16}/><input type="range" min="0" max="100" value={bright} onChange={e=>setBright(+e.target.value)} className="vslider" orient="vertical"/></div>
        <div className="pl-vside right"><Icon.vol size={16}/><input type="range" min="0" max="100" value={vol} onChange={e=>setVol(+e.target.value)} className="vslider"/></div>

        {/* bottom controls */}
        <div className="pl-bottom">
          {!live && (
            <div className="pl-scrub">
              <span className="pl-time">{fmt(t)}</span>
              <div className="pl-track" onClick={seek}>
                <div className="pl-track-fill" style={{ width: pct+"%" }} />
                <div className="pl-track-buf" style={{ width: Math.min(100,pct+14)+"%" }} />
                <div className="pl-knob" style={{ left: pct+"%" }} />
              </div>
              <span className="pl-time">-{fmt(total-t)}</span>
            </div>
          )}
          <div className="pl-controls">
            <div className="pl-ctl-left">
              {!live && <><button className="pl-ic" onClick={()=>setPlaying(p=>!p)}>{playing?<Icon.pause size={20} fill/>:<Icon.play size={20} fill/>}</button>
              <button className="pl-ic" title="Précédent"><Icon.skipP size={19}/></button>
              <button className="pl-ic" title="Suivant"><Icon.skipN size={19}/></button></>}
              <div className="pl-vol-inline"><Icon.vol size={19}/><div className="pl-vol-track"><span style={{width:vol+"%"}}/></div></div>
            </div>
            <div className="pl-ctl-right">
              <button className="pl-ic txt" onClick={()=>setSheet("audio")}><Icon.audio size={19}/><span>Audio</span></button>
              <button className="pl-ic txt" onClick={()=>setSheet("cc")}><Icon.cc size={19}/><span>Sous-titres</span></button>
              <button className="pl-ic txt" onClick={()=>setSheet("quality")}><Icon.hd size={19}/><span>FHD</span></button>
              <button className="pl-ic" title="Plein écran"><Icon.full size={19}/></button>
            </div>
          </div>

          {/* bande Live : Chaînes / Programme */}
          {live && (
            <div className="live-bar">
              <div className="live-bar-tabs">
                <button className={"lb-tab"+(bar==="channels"?" on":"")} onClick={()=>setBar("channels")}>Chaînes</button>
                <button className={"lb-tab"+(bar==="epg"?" on":"")} onClick={()=>setBar("epg")}>Programme</button>
              </div>
              {bar==="channels" ? (
                <div className="lb-channels no-scrollbar">
                  {W.LIVE_CATS[0].channels.map((c,k)=>(
                    <button key={k} className={"lb-chan"+(k===0?" on":"")}><span className="lb-chan-box" style={W.warmPoster(c.name)}>{c.code}</span><span className="lb-chan-name">{c.name}</span></button>
                  ))}
                </div>
              ) : (
                <div className="lb-epg no-scrollbar">
                  {W.EPG.map((e,k)=>(
                    <div key={k} className={"epg-row"+(e.now?" now":"")+(e.done?" done":"")}>
                      <span className="epg-time">{e.time}</span>
                      <div className="epg-main"><span className="epg-title">{e.title}</span><span className="epg-dur">{e.dur}</span>
                        {e.now && <span className="epg-prog"><span style={{width:e.prog+"%"}}/></span>}</div>
                      {e.now && <span className="pill pill-live"><span className="dot"/>LIVE</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* SHEETS audio / cc / quality / subs */}
      <Sheet open={sheet==="audio"} onClose={()=>setSheet(null)} title="Piste audio" anchored={mode!=="mobile"}>
        <TrackList items={["Français (VF) · 5.1","Français · Stéréo","Anglais (VO) · 5.1","Audiodescription"]} def={0}/>
      </Sheet>
      <Sheet open={sheet==="cc"} onClose={()=>setSheet(null)} title="Sous-titres" anchored={mode!=="mobile"}>
        <TrackList items={["Désactivés","Français","Français (malentendants)","Anglais"]} def={1}/>
        <button className="subs-custom" onClick={()=>setSheet("subs")}><Icon.settings size={16}/> Personnaliser l'apparence</button>
      </Sheet>
      <Sheet open={sheet==="quality"} onClose={()=>setSheet(null)} title="Qualité" anchored={mode!=="mobile"}>
        <TrackList items={["Auto (recommandé)","4K · UHD","FHD · 1080p","HD · 720p","SD · 480p"]} def={2} prem={[1]}/>
      </Sheet>
      <Sheet open={sheet==="subs"} onClose={()=>setSheet("cc")} title="Apparence des sous-titres" anchored={mode!=="mobile"}>
        <SubCustomizer style={subStyle} setStyle={setSubStyle} sizes={subSizes}/>
      </Sheet>

      {/* Panneau Épisodes */}
      {epOpen && (
        <div className="ep-panel-scrim" onClick={()=>setEpOpen(false)}>
          <div className="ep-panel glass" onClick={e=>e.stopPropagation()}>
            <div className="ep-panel-head"><span>Épisodes · Saison 1</span><button className="sheet-x" onClick={()=>setEpOpen(false)}><Icon.close size={18}/></button></div>
            <div className="ep-panel-grid">
              {W.EPISODES[1].map(ep=>(
                <button key={ep.n} className={"ep-card"+(ep.n===3?" on":"")} onClick={()=>setEpOpen(false)}>
                  <div className="ep-card-thumb" style={W.warmPoster("ep"+ep.n)}><span className="ep-num">{ep.n}</span>{ep.n===3 && <span className="wide-progress"><span style={{width:"28%"}}/></span>}</div>
                  <span className="ep-card-title">{ep.title}</span><span className="ep-card-dur">{ep.dur}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrackList({ items, def=0, prem=[] }) {
  const [sel, setSel] = uS(def);
  return <div className="track-list">{items.map((it,k)=>(
    <button key={k} className={"track-row"+(sel===k?" on":"")} onClick={()=>setSel(k)}>
      <span>{it}</span>
      <span className="track-right">{prem.includes(k) && <span className="ver-prem"><Icon.spark size={11}/> Premium</span>}{sel===k && <Icon.check size={17}/>}</span>
    </button>))}</div>;
}

function SubCustomizer({ style, setStyle, sizes }) {
  const colors = ["#FDF8F2","#F5A623","#5BD6A8","#FFFFFF","#FFE08A"];
  return (
    <div className="sub-cust">
      <div className="sub-preview"><span className="sub-cue" style={{ fontSize: sizes[style.size]+"px", color: style.color,
        background: ["transparent","rgba(16,11,7,.62)","#100B07"][style.bg], padding: style.bg?"4px 12px":"0",
        textShadow: style.bg?"none":"0 1px 4px #000" }}>Aperçu des sous-titres</span></div>
      <div className="sub-ctl"><span className="sub-ctl-lbl">Taille</span><div className="seg">{["S","M","L","XL"].map((s,k)=><button key={k} className={style.size===k?"on":""} onClick={()=>setStyle({...style,size:k})}>{s}</button>)}</div></div>
      <div className="sub-ctl"><span className="sub-ctl-lbl">Couleur</span><div className="sub-colors">{colors.map(c=><button key={c} className={"sub-color"+(style.color===c?" on":"")} style={{background:c}} onClick={()=>setStyle({...style,color:c})}/>)}</div></div>
      <div className="sub-ctl"><span className="sub-ctl-lbl">Fond</span><div className="seg">{["Aucun","Translucide","Opaque"].map((s,k)=><button key={k} className={style.bg===k?"on":""} onClick={()=>setStyle({...style,bg:k})}>{s}</button>)}</div></div>
    </div>
  );
}

Object.assign(window, { ScreenPlayer });
