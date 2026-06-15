/* ====================================================================
   IPTVAX · Sélection profil · Connexion · Réglages · Premium
   ==================================================================== */

function ScreenProfileSelect({ nav, setProfile, profiles }) {
  const [manage, setManage] = uS(false);
  return (
    <div className="screen-full profile-select">
      <div className="ps-spot" />
      <div className="ps-inner">
        <span className="ps-brand"><Wordmark variant={window.LOGO_VARIANT||"aube"} size={30}/></span>
        <h1 className="ps-title serif">Qui regarde&nbsp;?</h1>
        <div className="ps-grid">
          {profiles.map((p,k)=>(
            <button key={k} className={"ps-card"+(manage?" managing":"")} onClick={()=>{ if(!manage){ setProfile(p); nav("home"); } }}>
              <span className="ps-avatar" style={{background:`radial-gradient(circle at 35% 28%, color-mix(in oklab, var(--${p.color}) 72%, white 10%), var(--${p.color}))`}}>
                {p.avatar}{manage && <span className="ps-edit"><Icon.settings size={18}/></span>}
              </span>
              <span className="ps-name">{p.name}</span>
            </button>
          ))}
          <button className="ps-card ps-add" onClick={()=>{}}>
            <span className="ps-avatar add"><Icon.plus size={30}/></span>
            <span className="ps-name">Ajouter</span>
          </button>
        </div>
        <button className="btn btn-ghost ps-manage" onClick={()=>setManage(m=>!m)}>{manage ? "Terminé" : "Gérer les profils"}</button>
      </div>
    </div>
  );
}

function ScreenLogin({ nav }) {
  const [step, setStep] = uS("auth");   // auth | otp
  const [email, setEmail] = uS("");
  const [code, setCode] = uS(["","","","","",""]);
  const refs = uR([]);
  const setDigit = (i,v) => { if(!/^\d?$/.test(v)) return; const c=[...code]; c[i]=v; setCode(c); if(v && i<5) refs.current[i+1]?.focus(); };
  return (
    <div className="screen-full login">
      <div className="login-spot"/>
      <div className="login-card glass bloom">
        <span className="login-brand"><Wordmark variant={window.LOGO_VARIANT||"aube"} size={32}/></span>
        {step==="auth" ? (
          <>
            <h1 className="login-title serif">Bon retour</h1>
            <p className="login-sub">Connectez-vous pour retrouver vos profils et vos listes.</p>
            <div className="oauth-row">
              <button className="oauth-btn" onClick={()=>setStep("otp")}><span className="oa-g">G</span> Continuer avec Google</button>
              <button className="oauth-btn" onClick={()=>setStep("otp")}><span className="oa-a"></span> Continuer avec Apple</button>
            </div>
            <div className="login-or"><span>ou</span></div>
            <div className="login-field"><Icon.mail size={18}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="adresse e-mail"/></div>
            <button className="btn btn-primary login-submit" onClick={()=>setStep("otp")}>Recevoir un code</button>
          </>
        ) : (
          <>
            <h1 className="login-title serif">Vérification</h1>
            <p className="login-sub">Saisissez le code à 6 chiffres envoyé à<br/><b>{email||"vous@exemple.fr"}</b>.</p>
            <div className="otp-row">
              {code.map((d,i)=><input key={i} ref={el=>refs.current[i]=el} className={"otp-cell"+(d?" filled":"")} value={d} onChange={e=>setDigit(i,e.target.value)} inputMode="numeric" maxLength={1}/>)}
            </div>
            <button className="btn btn-primary login-submit" onClick={()=>nav("profile-select")}>Valider</button>
            <button className="login-back" onClick={()=>setStep("auth")}>Modifier l'adresse</button>
          </>
        )}
      </div>
    </div>
  );
}

function ScreenSettings({ nav, isPremium, setPremium, profile }) {
  const [subSize, setSubSize] = uS(1);
  const [subColor, setSubColor] = uS("#FDF8F2");
  const [subBg, setSubBg] = uS(1);
  const [pubCine, setPubCine] = uS(true);
  const sizes=[13,17,22,28]; const bgs=["transparent","rgba(16,11,7,.62)","#100B07"];
  return (
    <div className="screen screen-settings">
      <div className="catalog-top"><h1 className="catalog-h serif">Réglages</h1></div>
      <div className="settings-body">
        {/* Compte */}
        <section className="set-block">
          <span className="set-block-h">Compte</span>
          <div className="set-card glass">
            <div className="set-row"><span className="set-av" style={{background:`var(--${profile.color})`}}>{profile.avatar}</span>
              <div className="set-who"><span className="set-name">{profile.name}</span><span className="set-mail">camille@exemple.fr</span></div>
              <span className={"set-plan"+(isPremium?" prem":"")}>{isPremium?"Premium":"Gratuit"}</span></div>
            <button className="set-line" onClick={()=>nav("profile-select")}><Icon.user size={18}/> Changer de profil <Icon.chevR size={16} className="sl-chev"/></button>
            <button className="set-line"><Icon.tv size={18}/> Profil IPTV · playlist <Icon.chevR size={16} className="sl-chev"/></button>
          </div>
        </section>

        {/* Sous-titres avec aperçu */}
        <section className="set-block">
          <span className="set-block-h">Préférences de sous-titres</span>
          <div className="set-card glass">
            <div className="sub-preview small"><span className="sub-cue" style={{fontSize:sizes[subSize]+"px",color:subColor,background:bgs[subBg],padding:subBg?"4px 12px":"0",textShadow:subBg?"none":"0 1px 4px #000"}}>Aperçu des sous-titres</span></div>
            <div className="sub-ctl"><span className="sub-ctl-lbl">Taille</span><div className="seg">{["S","M","L","XL"].map((s,k)=><button key={k} className={subSize===k?"on":""} onClick={()=>setSubSize(k)}>{s}</button>)}</div></div>
            <div className="sub-ctl"><span className="sub-ctl-lbl">Couleur</span><div className="sub-colors">{["#FDF8F2","#F5A623","#5BD6A8","#FFE08A"].map(c=><button key={c} className={"sub-color"+(subColor===c?" on":"")} style={{background:c}} onClick={()=>setSubColor(c)}/>)}</div></div>
            <div className="sub-ctl"><span className="sub-ctl-lbl">Fond</span><div className="seg">{["Aucun","Translucide","Opaque"].map((s,k)=><button key={k} className={subBg===k?"on":""} onClick={()=>setSubBg(k)}>{s}</button>)}</div></div>
          </div>
        </section>

        {/* Communauté + langue */}
        <section className="set-block">
          <span className="set-block-h">Confidentialité & langue</span>
          <div className="set-card glass">
            <div className="set-toggle"><div><span className="st-title">Ciné public</span><span className="st-sub">Rendre votre mur visible par la communauté</span></div>
              <button className={"toggle"+(pubCine?" on":"")} onClick={()=>setPubCine(p=>!p)}><span/></button></div>
            <button className="set-line"><Icon.globe size={18}/> Langue de l'interface <span className="sl-val">Français</span><Icon.chevR size={16} className="sl-chev"/></button>
          </div>
        </section>

        <section className="set-block">
          <span className="set-block-h">Abonnement</span>
          <div className="set-card glass">
            <div className="set-toggle"><div><span className="st-title">Mode démo : {isPremium?"Premium":"Gratuit"}</span><span className="st-sub">Basculer pour explorer les états verrouillés du prototype</span></div>
              <button className={"toggle"+(isPremium?" on":"")} onClick={()=>setPremium(p=>!p)}><span/></button></div>
            {!isPremium && <button className="set-line prem" onClick={()=>nav("premium")}><Icon.spark size={18}/> Passer Premium <Icon.chevR size={16} className="sl-chev"/></button>}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScreenPremium({ nav, setPremium }) {
  const [plan, setPlan] = uS("year");
  const feats = ["Recommandations TMDB enrichies","Historique & reprise de lecture","Mon ciné : mur, notes & statistiques","Communauté & profils publics","Qualité 4K · UHD","Billboard & sélections éditoriales"];
  return (
    <div className="screen screen-premium">
      <div className="prem-spot"/>
      <button className="cat-back floating" onClick={()=>nav("back")}><Icon.chevL size={18}/> Retour</button>
      <div className="prem-inner">
        <span className="prem-badge"><Icon.spark size={14}/> Iptvax Premium</span>
        <h1 className="prem-title serif">Toute la lumière,<br/>sans limites.</h1>
        <p className="prem-sub">L'expérience complète : 4K, recommandations TMDB, votre ciné et la communauté.</p>

        <div className="prem-plans">
          <button className={"plan-card"+(plan==="month"?" on":"")} onClick={()=>setPlan("month")}>
            <span className="pc-name">Mensuel</span><span className="pc-price">8,99 €<span>/mois</span></span><span className="pc-note">Sans engagement</span>
          </button>
          <button className={"plan-card best"+(plan==="year"?" on":"")} onClick={()=>setPlan("year")}>
            <span className="pc-ribbon">−30 %</span>
            <span className="pc-name">Annuel</span><span className="pc-price">74,90 €<span>/an</span></span><span className="pc-note">Soit 6,24 €/mois</span>
          </button>
        </div>

        <div className="prem-feats">
          {feats.map((f,k)=><div className="pf-row" key={k}><span className="pf-check"><Icon.check size={13}/></span>{f}</div>)}
        </div>

        <div className="prem-pay">
          <button className="btn btn-primary prem-cta" onClick={()=>{setPremium(true);nav("home");}}><Icon.spark size={17}/> S'abonner — {plan==="year"?"74,90 €/an":"8,99 €/mois"}</button>
          <div className="prem-qr">
            <div className="qr-box">{Array.from({length:144}).map((_,i)=><span key={i} style={{background: (W.hashStr("qr"+i)%10>4)?"#1A130D":"transparent"}}/>)}</div>
            <span className="qr-lbl">Scannez pour payer<br/>sur mobile</span>
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenProfileSelect, ScreenLogin, ScreenSettings, ScreenPremium });
