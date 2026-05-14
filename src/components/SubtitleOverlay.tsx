import styles from './SubtitleOverlay.module.css';

export type SubSize = 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
export type SubBg = 'none' | 'semi' | 'solid';
export type SubColor = 'white' | 'yellow' | 'cyan' | 'green' | 'red' | 'pink';

interface Props {
  text: string;
  size: SubSize;
  bg: SubBg;
  color: SubColor;
}

const SIZE_CLASS: Record<SubSize, string> = {
  sm: styles.sizeSm,
  md: styles.sizeMd,
  lg: styles.sizeLg,
  xl: styles.sizeXl,
  xxl: styles.sizeXxl,
};

const BG_CLASS: Record<SubBg, string> = {
  none: styles.bgNone,
  semi: styles.bgSemi,
  solid: styles.bgSolid,
};

const COLOR_CLASS: Record<SubColor, string> = {
  white: styles.colorWhite,
  yellow: styles.colorYellow,
  cyan: styles.colorCyan,
  green: styles.colorGreen,
  red: styles.colorRed,
  pink: styles.colorPink,
};

export function SubtitleOverlay({ text, size, bg, color }: Props) {
  if (!text) return null;
  const lines = text.split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return null;

  return (
    <div
      className={`${styles.overlay} ${SIZE_CLASS[size]} ${BG_CLASS[bg]} ${COLOR_CLASS[color]}`}
    >
      {lines.map((line, i) => (
        <span key={i} className={styles.line}>{line}</span>
      ))}
    </div>
  );
}
