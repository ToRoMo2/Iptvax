/* ====================================================================
   IPTVAX · Icônes (stroke 1.7, hérite currentColor)
   ==================================================================== */
function Svg({ d, fill, size = 22, sw = 1.7, vb = 24, children, ...p }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill || "none"}
      stroke={fill ? "none" : "currentColor"} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
      {d ? <path d={d}/> : children}
    </svg>
  );
}
const Icon = {
  home:   (p) => <Svg {...p} d="m3 11 9-8 9 8M5 10v10h5v-6h4v6h5V10"/>,
  tv:     (p) => <Svg {...p}><rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3"/></Svg>,
  film:   (p) => <Svg {...p}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 3v18M17 3v18M3 7.5h4M3 12h4M3 16.5h4M17 7.5h4M17 12h4M17 16.5h4"/></Svg>,
  series: (p) => <Svg {...p}><rect x="2" y="6" width="20" height="13" rx="2"/><path d="M7 3l5 3 5-3"/></Svg>,
  star:   (p) => <Svg {...p} d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>,
  starFill:(p)=> <Svg {...p} fill="currentColor" d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>,
  cine:   (p) => <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M17.5 14v7"/></Svg>,
  search: (p) => <Svg {...p} sw={2}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></Svg>,
  play:   (p) => <Svg {...p} fill="currentColor" d="M8 5v14l11-7z"/>,
  pause:  (p) => <Svg {...p} fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></Svg>,
  info:   (p) => <Svg {...p} sw={2}><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></Svg>,
  chevR:  (p) => <Svg {...p} sw={2.4} d="m9 18 6-6-6-6"/>,
  chevL:  (p) => <Svg {...p} sw={2.4} d="m15 18-6-6 6-6"/>,
  chevD:  (p) => <Svg {...p} sw={2.4} d="m6 9 6 6 6-6"/>,
  close:  (p) => <Svg {...p} sw={2.2} d="M18 6 6 18M6 6l12 12"/>,
  plus:   (p) => <Svg {...p} sw={2} d="M12 5v14M5 12h14"/>,
  check:  (p) => <Svg {...p} sw={2.2} d="M20 6 9 17l-5-5"/>,
  back10: (p) => <Svg {...p}><path d="M11 8 7 12l4 4"/><path d="M7 12h7a4 4 0 0 1 0 8h-1"/></Svg>,
  fwd10:  (p) => <Svg {...p}><path d="m13 8 4 4-4 4"/><path d="M17 12h-7a4 4 0 0 0 0 8h1"/></Svg>,
  skipN:  (p) => <Svg {...p} fill="currentColor"><path d="M5 5v14l9-7z"/><rect x="16" y="5" width="3" height="14" rx="1"/></Svg>,
  skipP:  (p) => <Svg {...p} fill="currentColor"><path d="M19 5v14l-9-7z"/><rect x="5" y="5" width="3" height="14" rx="1"/></Svg>,
  vol:    (p) => <Svg {...p}><path d="M11 5 6 9H2v6h4l5 4z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></Svg>,
  cc:     (p) => <Svg {...p}><rect x="2" y="5" width="20" height="14" rx="3"/><path d="M9 10.5a2.5 2.5 0 1 0 0 3M17 10.5a2.5 2.5 0 1 0 0 3"/></Svg>,
  audio:  (p) => <Svg {...p}><path d="M3 12a9 9 0 0 1 18 0M3 12v3a2 2 0 0 0 2 2h1v-6H5a2 2 0 0 0-2 2ZM21 12v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z"/></Svg>,
  hd:     (p) => <Svg {...p}><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10v4M9 10v4M6 12h3M13 10v4M13 10h2a2 2 0 0 1 0 4h-2"/></Svg>,
  full:   (p) => <Svg {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></Svg>,
  sun:    (p) => <Svg {...p}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></Svg>,
  heart:  (p) => <Svg {...p} d="M19 14c1.5-1.5 3-3.4 3-5.5A4.5 4.5 0 0 0 12 5 4.5 4.5 0 0 0 2 8.5c0 2.1 1.5 4 3 5.5l7 7Z"/>,
  heartFill:(p)=><Svg {...p} fill="currentColor" d="M19 14c1.5-1.5 3-3.4 3-5.5A4.5 4.5 0 0 0 12 5 4.5 4.5 0 0 0 2 8.5c0 2.1 1.5 4 3 5.5l7 7Z"/>,
  list:   (p) => <Svg {...p} d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>,
  grid:   (p) => <Svg {...p}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Svg>,
  spark:  (p) => <Svg {...p} fill="currentColor" d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>,
  filter: (p) => <Svg {...p} d="M3 5h18M6 12h12M10 19h4"/>,
  settings:(p)=> <Svg {...p}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 0 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 0 1 0-4h.1A1.6 1.6 0 0 0 2.6 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.6h.1A1.6 1.6 0 0 0 8 1a2 2 0 0 1 4 0v.1A1.6 1.6 0 0 0 15 2.6a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7h.1a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.4 1.1Z"/></Svg>,
  globe:  (p) => <Svg {...p}><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20 15 15 0 0 1 0-20Z"/></Svg>,
  user:   (p) => <Svg {...p}><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></Svg>,
  trash:  (p) => <Svg {...p} d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>,
  lock:   (p) => <Svg {...p}><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></Svg>,
  remote: (p) => <Svg {...p}><rect x="7" y="2" width="10" height="20" rx="4"/><circle cx="12" cy="7" r="1.6"/><path d="M12 12v4"/></Svg>,
  mail:   (p) => <Svg {...p}><rect x="2" y="4" width="20" height="16" rx="3"/><path d="m3 7 9 6 9-6"/></Svg>,
};
window.Icon = Icon;
window.Svg = Svg;
