/* ====================================================================
   IPTVAX · Chrome — capsule top (desktop/TV) + bottom-nav (mobile)
   + brand fixe, recherche, Premium, panneau profil. Source unique des liens.
   ==================================================================== */
const NAV_LINKS = [
  { key: "home",   label: "Accueil",  icon: Icon.home },
  { key: "live",   label: "Live TV",  icon: Icon.tv },
  { key: "movies", label: "Films",    icon: Icon.film },
  { key: "series", label: "Séries",   icon: Icon.series },
  { key: "list",   label: "Ma Liste", icon: Icon.star },
  { key: "cine",   label: "Mon ciné", icon: Icon.cine },
];

function ProfilePanel({ profile, isPremium, onClose, nav, onSwitch }) {
  return (
    <div className="profile-panel glass bloom" onClick={(e)=>e.stopPropagation()}>
      <div className="pp-head">
        <span className="pp-avatar" style={{ "--pf": `var(--${profile.color})` }}>{profile.avatar}</span>
        <div className="pp-who">
          <span className="pp-name">{profile.name}</span>
          <span className="pp-plan">{isPremium ? "Abonné Premium" : "Profil IPTV · Gratuit"}</span>
        </div>
      </div>
      <div className="pp-list">
        <button className="pp-row" onClick={()=>{onSwitch();onClose();}}><Icon.user size={18}/> Changer de profil</button>
        <button className="pp-row" onClick={()=>{nav("settings");onClose();}}><Icon.settings size={18}/> Réglages</button>
        <button className="pp-row" onClick={()=>{nav("community");onClose();}}><Icon.globe size={18}/> Communauté</button>
        {!isPremium && <button className="pp-row prem" onClick={()=>{nav("premium");onClose();}}><Icon.spark size={18}/> Passer Premium</button>}
      </div>
    </div>
  );
}

function TopChrome({ screen, nav, profile, isPremium, onSwitch, mode }) {
  const [panel, setPanel] = uS(false);
  const active = NAV_LINKS.find(l => l.key === screen)?.key
    || ({ "movie-detail":"movies","series-detail":"series","player":"home","search":"home" }[screen]) || screen;
  return (
    <>
      {/* Brand */}
      <button className="brand-fixed" onClick={()=>nav("home")} title="Iptvax">
        <Wordmark variant={window.LOGO_VARIANT || "aube"} size={mode==="mobile"?22:25}/>
      </button>

      {/* Capsule centrée (desktop / TV) */}
      <header className="topnav glass">
        <nav className="topnav-links">
          {NAV_LINKS.map(l => (
            <button key={l.key} className={"tn-link" + (active===l.key ? " active" : "")} onClick={()=>nav(l.key)} title={l.label}>
              <span className="tn-ic"><l.icon size={19}/></span>
              <span className="tn-lbl">{l.label}</span>
            </button>
          ))}
        </nav>
        <span className="tn-sep" />
        <button className="tn-icon" onClick={()=>nav("search")} title="Recherche"><Icon.search size={18}/></button>
        <span className="tn-sep" />
        {isPremium ? (
          <span className="tn-prem badge"><Icon.spark size={13}/> Premium</span>
        ) : (
          <button className="tn-prem cta" onClick={()=>nav("premium")}><Icon.spark size={13}/> Premium</button>
        )}
      </header>

      {/* Recherche mobile + Premium (haut droite) */}
      <button className="search-fixed" onClick={()=>nav("search")} title="Recherche"><Icon.search size={19}/></button>
      {isPremium ? (
        <span className="premium-fixed badge" title="Premium actif"><Icon.spark size={13}/> <span className="pf-lbl">Premium</span></span>
      ) : (
        <button className="premium-fixed cta" onClick={()=>nav("premium")}><Icon.spark size={13}/> <span className="pf-lbl">Premium</span></button>
      )}

      {/* Profil (haut droite) */}
      <div className="profile-fixed">
        <button className="profile-btn" onClick={()=>setPanel(p=>!p)} title={profile.name}>
          <span className="profile-av" style={{ "--pf": `var(--${profile.color})` }}>
            {profile.avatar}
            {isPremium && <span className="profile-crown"><Icon.spark size={9}/></span>}
          </span>
          <span className="profile-who">
            <span className="profile-name">{profile.name}</span>
            <span className="profile-sub">Profil IPTV</span>
          </span>
        </button>
        {panel && <><div className="panel-scrim" onClick={()=>setPanel(false)} /><ProfilePanel profile={profile} isPremium={isPremium} onClose={()=>setPanel(false)} nav={nav} onSwitch={onSwitch}/></>}
      </div>

      {/* Bottom-nav mobile */}
      <nav className="bottomnav glass">
        {NAV_LINKS.map(l => (
          <button key={l.key} className={"bn-tab" + (active===l.key ? " active" : "")} onClick={()=>nav(l.key)}>
            <span className="bn-ic"><l.icon size={21}/></span>
            <span className="bn-lbl">{l.label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}

Object.assign(window, { TopChrome, ProfilePanel, NAV_LINKS });
