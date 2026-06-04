/**
 * Pictogrammes de la page Premium — SVG line-style (cohérents avec
 * `PlayerIcons`), zéro emoji. Tous héritent de la couleur via `currentColor`
 * et acceptent une `size` (défaut 24). ViewBox 24×24.
 */
interface IconProps {
  size?: number;
  className?: string;
}

function base(size: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true as const,
    focusable: false as const,
  };
}

export function IconCheckCircle({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.4 2.4 4.6-4.8" />
    </svg>
  );
}

export function IconAlert({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5" />
      <path d="M12 16.2h.01" />
    </svg>
  );
}

export function IconLock({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function IconShield({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M12 3 5 5.6V11c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V5.6L12 3Z" />
      <path d="m9 11.8 2 2 4-4.2" />
    </svg>
  );
}

export function IconUsers({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6" />
      <path d="M17.5 14.2A5.5 5.5 0 0 1 20.5 19" />
    </svg>
  );
}

export function IconCloud({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M7 18a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 9.5a3.5 3.5 0 0 1 .5 8.5H7Z" />
      <path d="M12 8.5v6" />
      <path d="m9.5 12 2.5 2.5 2.5-2.5" />
    </svg>
  );
}

export function IconFilm({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <path d="M8 4.5v15M16 4.5v15M3.5 9.5h4.5M3.5 14.5h4.5M16 9.5h4.5M16 14.5h4.5" />
    </svg>
  );
}

export function IconGlobe({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 12h17" />
      <path d="M12 3c2.5 2.4 3.8 5.6 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.6-3.8-9S9.5 5.4 12 3Z" />
    </svg>
  );
}

export function IconImage({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="m4 17 4.5-4.5L13 17" />
      <path d="m11 15 3-3 6 5" />
    </svg>
  );
}

export function IconBolt({ size = 24, className }: IconProps) {
  return (
    <svg {...base(size, className)}>
      <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />
    </svg>
  );
}
