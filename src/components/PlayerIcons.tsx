/**
 * Pictogrammes du lecteur — SVG line-style (inspiration Netflix), zéro emoji.
 *
 * Tous héritent de la couleur via `currentColor` (stroke + fill selon l'icône)
 * et acceptent une `size` (défaut 24). Conçus sur un viewBox 24×24.
 *
 * Utilisés par `TvPlayerOverlay` (lecteur TV). À terme, remplaceront aussi les
 * emojis de l'overlay souris/tactile (`VideoPlayer`) lors de la passe mobile.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function svgProps(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    className,
    'aria-hidden': true as const,
    focusable: false as const,
  };
}

export function IconPlay({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor">
      <path d="M7 4.5v15a1 1 0 0 0 1.52.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  );
}

export function IconPause({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor">
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" />
    </svg>
  );
}

export function IconBack10({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 6A6.5 6.5 0 1 0 18 12.5" />
      <polyline points="5 3.5 5 7.5 9 7.5" />
      <text x="12" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
    </svg>
  );
}

export function IconFwd10({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 6A6.5 6.5 0 1 1 6 12.5" />
      <polyline points="19 3.5 19 7.5 15 7.5" />
      <text x="12" y="15.5" fontSize="7.5" fontWeight="700" textAnchor="middle" fill="currentColor" stroke="none">10</text>
    </svg>
  );
}

export function IconPrev({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor">
      <path d="M18 5.5v13a1 1 0 0 1-1.55.83L8 13.66V18a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v4.34l8.45-5.67A1 1 0 0 1 18 5.5Z" />
    </svg>
  );
}

export function IconNext({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="currentColor">
      <path d="M6 5.5v13a1 1 0 0 0 1.55.83L16 13.66V18a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v4.34L7.55 4.67A1 1 0 0 0 6 5.5Z" />
    </svg>
  );
}

export function IconAudio({ size = 24, className }: IconProps) {
  // Micro (piste audio / langue) — demande utilisateur : pas un haut-parleur.
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2.5" width="6" height="11" rx="3" fill="currentColor" stroke="none" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <line x1="8.5" y1="21" x2="15.5" y2="21" />
    </svg>
  );
}

export function IconSubtitles({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <line x1="6.5" y1="11" x2="11" y2="11" />
      <line x1="13.5" y1="11" x2="17.5" y2="11" />
      <line x1="6.5" y1="15" x2="14" y2="15" />
    </svg>
  );
}

export function IconQuality({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.6" fill="currentColor" />
      <circle cx="15" cy="16" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function IconCheck({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="5 12.5 10 17.5 19 6.5" />
    </svg>
  );
}

export function IconBack({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="14.5 5 7.5 12 14.5 19" />
    </svg>
  );
}

export function IconVolumeMute({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5v14L7.5 14.5H4z" fill="currentColor" stroke="none" />
      <line x1="16.5" y1="9" x2="21.5" y2="15" />
      <line x1="21.5" y1="9" x2="16.5" y2="15" />
    </svg>
  );
}

export function IconVolumeLow({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5v14L7.5 14.5H4z" fill="currentColor" stroke="none" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
    </svg>
  );
}

export function IconVolumeHigh({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9.5h3.5L12 5v14L7.5 14.5H4z" fill="currentColor" stroke="none" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M18 7a7 7 0 0 1 0 10" />
    </svg>
  );
}

export function IconFullscreenEnter({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 9 4 4 9 4" />
      <polyline points="20 9 20 4 15 4" />
      <polyline points="4 15 4 20 9 20" />
      <polyline points="20 15 20 20 15 20" />
    </svg>
  );
}

export function IconFullscreenExit({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 4 9 9 4 9" />
      <polyline points="15 4 15 9 20 9" />
      <polyline points="9 20 9 15 4 15" />
      <polyline points="15 20 15 15 20 15" />
    </svg>
  );
}

export function IconSettings({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h0a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h0a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v0a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function IconAlert({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

export function IconClose({ size = 24, className }: IconProps) {
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function IconEpisodes({ size = 24, className }: IconProps) {
  // Stack de cartes / liste épisodes (pour Phase chantier 3).
  return (
    <svg {...svgProps(size, className)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="12" rx="2.2" />
      <line x1="6" y1="4.5" x2="18" y2="4.5" />
      <line x1="7.5" y1="6.5" x2="16.5" y2="6.5" />
      <line x1="7" y1="13" x2="13" y2="13" />
      <line x1="7" y1="16.5" x2="11" y2="16.5" />
    </svg>
  );
}
