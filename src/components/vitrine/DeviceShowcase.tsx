/**
 * Maquette 3 appareils (design Vanta) : téléphone, laptop, TV. Les écrans
 * « s'allument » au scroll (power-on cyan), un faisceau lumineux relie les
 * trois et une vignette de contenu « saute » d'un écran à l'autre — toute
 * l'animation est pilotée par `useHomeFx` (classes `.lit`, `.hop`).
 *
 * Les écrans affichent des placeholders CSS (`.fake`) avec une note
 * `// screenshot …`. Pour intégrer de vrais screenshots : remplacer le bloc
 * `<Fake …/>` de chaque `.screen-content` par `<img src="…" alt="…" />`.
 */
export function DeviceShowcase() {
  return (
    <div className="showcase-wrap" data-reveal="fade">
      <div className="beam" />

      {/* vignette de contenu qui saute d'un écran à l'autre */}
      <div className="hop" id="hop">
        <div className="fake" style={{ padding: 6, gap: 3 }}>
          <div className="tile hot" style={{ aspectRatio: '2 / 3' }} />
        </div>
        <span className="hop-tag">▸ 01:24:18</span>
      </div>

      <div className="showcase">
        {/* phone */}
        <div className="dev-wrap">
          <div className="device phone">
            <div className="phone-frame">
              <div className="screen-content">
                <div className="phone-notch" />
                <div className="fake">
                  <div className="bar" style={{ width: '42%' }} />
                  <div className="accent-bar" />
                  <div className="grid-row" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="tile wide hot" />
                  </div>
                  <div className="bar" style={{ width: '28%', height: 7 }} />
                  <div className="grid-row" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
                    <div className="tile" />
                    <div className="tile" />
                  </div>
                  <div className="bar" style={{ width: '34%', height: 7 }} />
                  <div className="grid-row" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
                    <div className="tile" />
                    <div className="tile" />
                  </div>
                  <span className="ph-note">// screenshot mobile</span>
                </div>
              </div>
            </div>
          </div>
          <span className="dev-label">Android · iOS</span>
        </div>

        {/* laptop */}
        <div className="dev-wrap">
          <div className="device laptop">
            <div className="laptop-screen">
              <div className="screen-content">
                <div className="fake">
                  <div className="bar" style={{ width: '30%' }} />
                  <div className="accent-bar" />
                  <div className="grid-row" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="tile wide hot" />
                  </div>
                  <div className="bar" style={{ width: '20%', height: 7 }} />
                  <div className="grid-row" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
                    <div className="tile" />
                    <div className="tile" />
                    <div className="tile" />
                    <div className="tile" />
                    <div className="tile" />
                  </div>
                  <span className="ph-note">// screenshot desktop / web</span>
                </div>
              </div>
            </div>
            <div className="laptop-base" />
          </div>
          <span className="dev-label">Windows · Web</span>
        </div>

        {/* tv */}
        <div className="dev-wrap">
          <div className="device tv">
            <div className="tv-screen">
              <div className="screen-content">
                <div className="fake">
                  <div className="bar" style={{ width: '38%' }} />
                  <div className="accent-bar" />
                  <div className="grid-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                    <div className="tile hot" />
                    <div className="tile" />
                    <div className="tile" />
                    <div className="tile" />
                  </div>
                  <span className="ph-note">// screenshot TV</span>
                </div>
              </div>
            </div>
            <div className="tv-stand" />
            <div className="tv-base" />
          </div>
          <span className="dev-label">LG · Samsung · Android TV</span>
        </div>
      </div>
    </div>
  );
}
