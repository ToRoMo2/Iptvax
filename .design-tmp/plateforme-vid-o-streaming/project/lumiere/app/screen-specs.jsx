/* ====================================================================
   IPTVAX · Specs « Lumière / Halo doré » — design system documenté
   ==================================================================== */
const SWATCHES = [
  ["--bg", "#19120D", "Nuit chaude · fond global"],
  ["--bg-elev", "#211810", "Élévation 1"],
  ["--bg-card", "#271C13", "Surface carte"],
  ["--accent", "#F5A623", "Or ambré · signature"],
  ["--accent-2", "#E8C27E", "Champagne · dégradé"],
  ["--accent-deep", "#D98A12", "Or saturé · Premium"],
  ["--jade", "#5BD6A8", "Online / succès / connecté"],
  ["--live", "#FF5341", "Micro-pastille LIVE / REC"],
  ["--tmdb", "#21D07A", "Badge note TMDB"],
  ["--t-1", "#FDF8F2", "Texte primaire crème"],
  ["--t-2", "#CCBFB0", "Texte secondaire"],
  ["--t-3", "#978A7B", "Texte tertiaire / muted"],
];
const PROFILE_SW = [["--profile-1","#F5A623","Or"],["--profile-2","#E8825E","Terracotta"],["--profile-3","#D96A8B","Rose chaud"],["--profile-4","#A88BE0","Lilas chaud"],["--profile-5","#5BD6A8","Jade"],["--profile-6","#E8C27E","Champagne"]];

const TYPE_SCALE = [
  ["Display / Hero", "Instrument Serif", "clamp(40–78px)", "0.98", "Titres hero, fiches, Premium"],
  ["Titre H1", "Instrument Serif", "30–46px", "1.0", "En-têtes d'écran"],
  ["Titre de rangée", "Hanken Grotesk 700", "21px", "1.2", "« Films populaires »…"],
  ["Corps", "Hanken Grotesk 400", "15–16px", "1.6", "Synopsis, descriptions"],
  ["UI / libellé", "Hanken Grotesk 500–600", "13–14.5px", "1.4", "Boutons, nav, méta"],
  ["Légende", "Hanken Grotesk 500", "11–12px", "1.4", "Sous-titres de carte, badges"],
];

const MAPPING = [
  ["--bg", "#000000 (OLED)", "#19120D", "Noir pur → espresso chaud"],
  ["--bg-elev", "#0A0A0A", "#211810", "Élévation chaude"],
  ["--bg-card", "#121212", "#271C13", "Carte ambrée"],
  ["--line", "rgba(255,255,255,.08)", "rgba(253,246,235,.10)", "Hairline crème"],
  ["--accent", "#3DD6FF (cyan froid)", "#F5A623", "Cyan → or ambré"],
  ["--accent-glow", "rgba(61,214,255,.4)", "rgba(245,166,35,.40)", "Glow doré"],
  ["--t-1", "#FFFFFF", "#FDF8F2", "Blanc pur → crème"],
  ["--t-2", "#A0A0A0", "#CCBFB0", "Gris froid → taupe chaud"],
  ["--live", "#FF3B30", "#FF5341", "Conservé (micro-pastille)"],
  ["--r-card", "12px", "16px", "Coins plus doux"],
  ["+ --accent-grad", "—", "linear-gradient(118deg,#F5A623→#E8C27E)", "NOUVEAU · lumière"],
  ["+ --glass", "—", "rgba(252,244,233,.10)", "NOUVEAU · verre chaud"],
  ["+ --blur", "—", "22px", "NOUVEAU · frosted glass"],
  ["+ --grain", "—", "url(grain.svg)", "NOUVEAU · grain de film"],
];

function ScreenSpecs({ setLogoVariant, logoVariant }) {
  return (
    <div className="screen screen-specs">
      <div className="specs-hero">
        <span className="grain-layer"/>
        <div className="specs-hero-in">
          <span className="prem-badge"><Icon.spark size={13}/> Système de design</span>
          <h1 className="specs-h1 serif">Lumière / Halo doré</h1>
          <p className="specs-lead">Une nuit chaude, jamais noire. Une seule lumière : l'or qui passe au champagne. Du verre crème translucide pour l'air, du grain de film pour la texture. Accueillant et cossu — façon salle de cinéma à l'heure dorée.</p>
        </div>
      </div>

      <div className="specs-body">
        {/* LOGO */}
        <section className="spec-sec">
          <h2 className="spec-h2">Logo — 3 pistes</h2>
          <p className="spec-note">Choisissez la direction : elle s'applique à toute l'app (nav, splash, lecteur, avatar fallback). Cliquez pour activer.</p>
          <div className="logo-options">
            {[["aube","Aube","Disque-soleil & croissant d'ombre, anneau-halo"],["faisceau","Faisceau","Source lumineuse projetant un cône — marquise"],["marquise","Marquise","Monogramme I sous un arc-halo lumineux"]].map(([v,name,desc])=>(
              <button key={v} className={"logo-opt"+(logoVariant===v?" on":"")} onClick={()=>setLogoVariant(v)}>
                <div className="logo-opt-mark">{React.createElement(window.LOGO_MARKS[v], { size: 56 })}</div>
                <Wordmark variant={v} size={26}/>
                <span className="logo-opt-name">{name}</span>
                <span className="logo-opt-desc">{desc}</span>
                {logoVariant===v && <span className="logo-opt-check"><Icon.check size={14}/> Actif</span>}
              </button>
            ))}
          </div>
          <div className="logo-decline">
            <span className="ld-lbl">Déclinaisons</span>
            <div className="ld-row">
              <span className="ld-item"><span className="ld-favicon">{React.createElement(window.LOGO_MARKS[logoVariant], { size: 26 })}</span>Favicon</span>
              <span className="ld-item"><span className="ld-avatar">{React.createElement(window.LOGO_MARKS[logoVariant], { size: 30 })}</span>Avatar fallback</span>
              <span className="ld-item"><span className="ld-pastille"><Wordmark variant={logoVariant} size={18}/></span>Pastille de marque</span>
            </div>
          </div>
        </section>

        {/* PALETTE */}
        <section className="spec-sec">
          <h2 className="spec-h2">Palette</h2>
          <div className="swatch-grid">
            {SWATCHES.map(([tok,hex,role])=>(
              <div className="swatch" key={tok}><span className="sw-chip" style={{background:hex}}/><span className="sw-tok">{tok}</span><span className="sw-hex">{hex}</span><span className="sw-role">{role}</span></div>
            ))}
          </div>
          <span className="spec-sub">Avatars de profil — modernisés « Lumière »</span>
          <div className="profile-sw">{PROFILE_SW.map(([t,h,r])=>(<div className="psw" key={t}><span className="psw-chip" style={{background:h}}/><span className="psw-r">{r}</span><span className="psw-h">{h}</span></div>))}</div>
          <div className="grad-demo"><span className="grad-bar"/><span className="grad-lbl">--accent-grad · employé comme une lumière (CTA, focus, halos, progression)</span></div>
        </section>

        {/* TYPO */}
        <section className="spec-sec">
          <h2 className="spec-h2">Typographie</h2>
          <p className="spec-note"><b>Instrument Serif</b> (display cinéma/éditorial) + <b>Hanken Grotesk</b> (texte neutre ultra-lisible). Fallback system-font. Lisible sur TV à 3 m comme sur mobile.</p>
          <div className="type-table">
            <div className="tt-head"><span>Rôle</span><span>Police</span><span>Taille</span><span>Interligne</span><span>Usage</span></div>
            {TYPE_SCALE.map((r,k)=><div className="tt-row" key={k}>{r.map((c,j)=><span key={j} className={j===0?"tt-role":""}>{c}</span>)}</div>)}
          </div>
        </section>

        {/* RAYONS / ÉLÉVATIONS / MOTION */}
        <section className="spec-sec spec-3col">
          <div>
            <h2 className="spec-h2">Rayons</h2>
            <div className="radii"><div><span className="r-box" style={{borderRadius:16}}/>--r-card · 16</div><div><span className="r-box" style={{borderRadius:11}}/>--r-ui · 11</div><div><span className="r-box pill" style={{borderRadius:99}}/>--r-pill</div></div>
          </div>
          <div>
            <h2 className="spec-h2">Élévations / glows</h2>
            <div className="elevs"><span className="elev" style={{boxShadow:"var(--glow-card)"}}>card</span><span className="elev warm" style={{boxShadow:"var(--glow-warm)"}}>warm</span><span className="elev focus">focus TV</span></div>
          </div>
          <div>
            <h2 className="spec-h2">Mouvement</h2>
            <ul className="motion-list"><li><b>--ease</b> cubic-bezier(.22,1,.36,1)</li><li><b>micro</b> 150 ms · <b>page</b> 320 ms</li><li>Bloom doré à l'apparition</li><li>Lift + halo chaud au focus</li><li>Warm-up projecteur au lecteur</li><li>Dégrade sous reduced-motion</li></ul>
          </div>
        </section>

        {/* MAPPING TABLE */}
        <section className="spec-sec">
          <h2 className="spec-h2">Table de mapping — ancien token → nouvelle valeur</h2>
          <p className="spec-note">Mêmes noms de tokens → tout le CSS hérite. Prête à coller dans <code>:root</code>. Les lignes <b>+</b> sont les nouveaux tokens à documenter.</p>
          <div className="map-table">
            <div className="mt-head"><span>Token</span><span>Avant (Vanta OLED)</span><span>Après (Lumière)</span><span>Note</span></div>
            {MAPPING.map((r,k)=><div className={"mt-row"+(r[0][0]==="+"?" new":"")} key={k}>{r.map((c,j)=><span key={j} className={j===0?"mt-tok":""}>{c}</span>)}</div>)}
          </div>
        </section>

        {/* IMPLÉMENTATION */}
        <section className="spec-sec">
          <h2 className="spec-h2">Note d'implémentation</h2>
          <div className="impl-note glass">
            <p>Le re-skin est <b>100 % CSS + tokens</b>. Aucune logique, aucun écran, aucune fonctionnalité n'est modifié — on réhabille <code>:root</code> dans <code>app.css</code> et on ajoute 4 tokens (<code>--accent-grad</code>, <code>--glass</code>, <code>--blur</code>, <code>--grain</code>).</p>
            <ul>
              <li><code>styles/app.css</code> — bloc <code>:root</code> remplacé par la table ci-dessus + media queries d'espacement.</li>
              <li><code>components/*.module.css</code> — héritent automatiquement (mêmes noms de variables).</li>
              <li>Nouveaux utilitaires : <code>.glass</code>, <code>.grain-layer</code>, halo de focus <code>.rc-focused</code> — purement présentationnels.</li>
              <li>Le flux de données React (routes, props, état) reste <b>strictement identique</b>.</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

Object.assign(window, { ScreenSpecs });
