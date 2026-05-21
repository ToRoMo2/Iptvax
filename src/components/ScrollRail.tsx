import { useEffect, useRef, useState, useCallback, type ReactNode } from 'react';
import { useI18n } from '../contexts/I18nContext';
import styles from './ScrollRail.module.css';

function ChevLeft() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function ChevRight() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

interface Props {
  children: ReactNode;
  railClassName?: string;
}

export function ScrollRail({ children, railClassName }: Props) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, [sync]);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.75, behavior: 'smooth' });
  };

  return (
    <div className={styles.wrapper}>
      <button
        className={`${styles.arrow} ${styles.arrowLeft} ${canLeft ? styles.arrowVisible : ''}`}
        onClick={() => scroll(-1)}
        aria-label={t('categoryBar.scrollLeft')}
        tabIndex={-1}
      >
        <ChevLeft />
      </button>

      <div ref={ref} className={railClassName}>
        {children}
      </div>

      <button
        className={`${styles.arrow} ${styles.arrowRight} ${canRight ? styles.arrowVisible : ''}`}
        onClick={() => scroll(1)}
        aria-label={t('categoryBar.scrollRight')}
        tabIndex={-1}
      >
        <ChevRight />
      </button>
    </div>
  );
}
