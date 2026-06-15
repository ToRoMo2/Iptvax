/* ====================================================================
   IPTVAX · App Shell — router + frames (9:16 / 16:9) + toolbar + TV focus
   ==================================================================== */
const { useState: aS, useEffect: aE, useRef: aR, useCallback: aC } = React;

const SCREEN_MAP = {
  "home": ScreenHome, "live": ScreenLive, "movies": ScreenMovies, "series": ScreenSeries,
  "list": ScreenList, "cine": ScreenCine, "search": ScreenSearch,
  "movie-detail": ScreenMovieDetail, "series-detail": ScreenSeriesDetail, "player": ScreenPlayer,
  "community": ScreenCommunity, "member-cine": ScreenMemberCine,
  "profile-select": ScreenProfileSelect, "login": ScreenLogin,
  "settings": ScreenSettings, "premium": ScreenPremium, "specs": ScreenSpecs,
};
const FULLBLEED = new Set(["player","profile-select","login"]);   // pas de chrome nav
const LAUNCHER = [
  { g: "Système", items: [["specs","Design system"]] },
  { g: "Entrée", items: [["profile-select","Sélection profil"],["login","Connexion"]] },
  { g: "Navigation principale", items: [["home","Accueil"],["live","Live TV"],["movies","Films"],["series","Séries"],["list","Ma Liste"],["cine","Mon ciné"]] },
  { g: "Détail & lecture", items: [["movie-detail","Fiche film"],["series-detail","Fiche série"],["player","Lecteur"],["search","Recherche"]] },
  { g: "Premium", items: [["premium","Premium"],["community","Communauté"],["member-cine","Ciné d'un membre"],["settings","Réglages"]] },
];

function App() {
  const [format, setFormat] = aS(() => localStorage.getItem("ix_format") || "mobile"); // mobile | tv
  const [tvFocus, setTvFocus] = aS(false);
  const [screen, setScreen] = aS(() => localStorage.getItem("ix_screen") || "home");
  const [payload, setPayload] = aS(null);
  const [stack, setStack] = aS([]);
  const [profile, setProfile] = aS(W.PROFILES[0]);
  const [isPremium, setPremium] = aS(true);
  const [logoVariant, setLogoVariant] = aS(() => localStorage.getItem("ix_logo") || "aube");
  const [loading, setLoading] = aS(false);
  const [launcher, setLauncher] = aS(false);
  const scrollRef = aR(null);

  window.LOGO_VARIANT = logoVariant;
  aE(()=>{ localStorage.setItem("ix_logo", logoVariant); window.LOGO_VARIANT = logoVariant; }, [logoVariant]);
  aE(()=>{ localStorage.setItem("ix_format", format); }, [format]);
  aE(()=>{ localStorage.setItem("ix_screen", screen); }, [screen]);

  const nav = aC((to, pl) => {
    if (to === "back") { setStack(s=>{ const n=[...s]; const prev=n.pop(); if(prev){ setScreen(prev.screen); setPayload(prev.payload);} else { setScreen("home"); setPayload(null);} return n; }); return; }
    setStack(s=>[...s, { screen, payload }]);
    setScreen(to); setPayload(pl||null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    // simulate loading on heavy catalog screens
    if (["home","movies","series","live"].includes(to)) { setLoading(true); setTimeout(()=>setLoading(false), 520); }
  }, [screen, payload]);

  const go = (to) => { setStack([]); setScreen(to); setPayload(null); setLauncher(false); if(scrollRef.current) scrollRef.current.scrollTop=0; };

  const Comp = SCREEN_MAP[screen] || ScreenHome;
  const fullbleed = FULLBLEED.has(screen);
  const mode = format === "mobile" ? "mobile" : "desktop";

  return (
    <div className={"shell shell-"+format+(tvFocus?" tv-focus-mode":"")}>
      {/* ── Toolbar ── */}
      <div className="toolbar">
        <div className="tb-brand"><Wordmark variant={logoVariant} size={22}/><span className="tb-tag">prototype · Lumière</span></div>
        <div className="tb-center">
          <div className="format-toggle">
            <button className={format==="mobile"?"on":""} onClick={()=>setFormat("mobile")}>Mobile 9:16</button>
            <button className={format==="tv"?"on":""} onClick={()=>setFormat("tv")}>Desktop / TV 16:9</button>
          </div>
          {format==="tv" && <button className={"tb-tv-focus"+(tvFocus?" on":"")} onClick={()=>setTvFocus(f=>!f)}><Icon.remote size={15}/> Focus télécommande</button>}
        </div>
        <div className="tb-right">
          <button className={"tb-prem-toggle"+(isPremium?" on":"")} onClick={()=>setPremium(p=>!p)}>{isPremium?"Premium":"Gratuit"}</button>
          <button className="tb-launch" onClick={()=>setLauncher(l=>!l)}><Icon.grid size={16}/> Écrans</button>
        </div>
      </div>

      {/* ── Launcher ── */}
      {launcher && (
        <div className="launcher-scrim" onClick={()=>setLauncher(false)}>
          <div className="launcher" onClick={e=>e.stopPropagation()}>
            <div className="launcher-head"><span>Tous les écrans</span><button onClick={()=>setLauncher(false)}><Icon.close size={18}/></button></div>
            <div className="launcher-groups">
              {LAUNCHER.map(grp=>(
                <div className="lg" key={grp.g}><span className="lg-title">{grp.g}</span>
                  <div className="lg-items">{grp.items.map(([k,l])=>(
                    <button key={k} className={"lg-item"+(screen===k?" on":"")} onClick={()=>go(k)}>{l}</button>
                  ))}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Device stage ── */}
      <div className="stage">
        <DeviceFrame format={format}>
          <div className={"app-root"+(tvFocus?" tv":"")}>
            <div className="app-scroll no-scrollbar" ref={scrollRef}>
              <Comp
                nav={nav} payload={payload} isPremium={isPremium} setPremium={setPremium}
                loading={loading} mode={mode}
                profile={profile} setProfile={setProfile} profiles={W.PROFILES}
                setLogoVariant={setLogoVariant} logoVariant={logoVariant}
              />
            </div>
            {!fullbleed && screen!=="specs" && <TopChrome screen={screen} nav={go} profile={profile} isPremium={isPremium} onSwitch={()=>go("profile-select")} mode={mode}/>}
          </div>
        </DeviceFrame>
      </div>
    </div>
  );
}

/* ── Frame qui scale pour tenir dans le stage ─────────────────────── */
function DeviceFrame({ format, children }) {
  const wrapRef = aR(null);
  const [scale, setScale] = aS(1);
  const W_ = format==="mobile" ? 412 : 1280;
  const H_ = format==="mobile" ? 892 : 720;
  aE(() => {
    const fit = () => { const el = wrapRef.current; if(!el) return; const r = el.getBoundingClientRect();
      setScale(Math.min(r.width/W_, r.height/H_, format==="mobile"?1.05:1)); };
    fit(); const ro = new ResizeObserver(fit); if(wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener("resize", fit); return ()=>{ ro.disconnect(); window.removeEventListener("resize", fit); };
  }, [format]);
  return (
    <div className="frame-fit" ref={wrapRef}>
      <div className={"device device-"+format} style={{ width:W_, height:H_, transform:`translate(-50%,-50%) scale(${scale})` }}>
        <div className="device-screen">{children}</div>
        {format==="mobile" && <div className="device-notch"/>}
        {format==="mobile" && <div className="device-home"/>}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
