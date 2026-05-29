import { useEffect, type RefObject } from 'react';

type HeroVariant = 'waves' | 'mesh' | 'scan';

/**
 * Tous les effets propres à la home vitrine (portage du moteur vanilla du
 * design, sections 4-10) : hero `.in` + glow curseur, ondes broadcast canvas,
 * power-on / tilt / parallaxe / hop du showcase, compteurs animés, étape de
 * story active, spotlight + révélation des coches du pricing.
 *
 * `variant` pilote le fond animé du hero — l'effet canvas est relancé à chaque
 * changement. Tout dégrade sous `prefers-reduced-motion`.
 */
export function useHomeFx(rootRef: RefObject<HTMLElement>, variant: HeroVariant) {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ── Effets indépendants du variant (montés une fois) ───────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const $ = <T extends Element>(s: string) => root.querySelector<T>(s);
    const $$ = <T extends Element>(s: string) => Array.from(root.querySelectorAll<T>(s));
    const cleanups: Array<() => void> = [];

    // ── Hero reveal + glow curseur ──────────────────────────────────
    const hero = $<HTMLElement>('.hero');
    if (hero) {
      const t = window.setTimeout(() => hero.classList.add('in'), 80);
      const onLoad = () => hero.classList.add('in');
      window.addEventListener('load', onLoad);
      cleanups.push(() => {
        window.clearTimeout(t);
        window.removeEventListener('load', onLoad);
      });

      const glow = hero.querySelector<HTMLElement>('.hero-cursor-glow');
      if (glow && fine && !reduce) {
        const onMove = (e: MouseEvent) => {
          const r = hero.getBoundingClientRect();
          glow.style.setProperty('--mx', `${e.clientX - r.left}px`);
          glow.style.setProperty('--my', `${e.clientY - r.top}px`);
        };
        hero.addEventListener('mousemove', onMove);
        cleanups.push(() => hero.removeEventListener('mousemove', onMove));
      }
    }

    // ── Showcase : power-on + tilt + parallaxe + hop ────────────────
    const wrap = $<HTMLElement>('.showcase-wrap');
    if (wrap) {
      const devices = Array.from(wrap.querySelectorAll<HTMLElement>('.device'));
      const litIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              wrap.classList.add('lit');
              devices.forEach((d, i) =>
                window.setTimeout(() => d.classList.add('lit'), reduce ? 0 : i * 240),
              );
              litIO.disconnect();
            }
          });
        },
        { threshold: 0.35 },
      );
      litIO.observe(wrap);
      cleanups.push(() => litIO.disconnect());

      // vignette de contenu qui « saute » d'un écran à l'autre
      const hop = wrap.querySelector<HTMLElement>('.hop');
      if (hop) {
        const screens = [
          wrap.querySelector<HTMLElement>('.phone .screen-content'),
          wrap.querySelector<HTMLElement>('.laptop .screen-content'),
          wrap.querySelector<HTMLElement>('.tv .screen-content'),
        ].filter(Boolean) as HTMLElement[];
        let idx = 0;
        let interval = 0;
        const place = () => {
          const wr = wrap.getBoundingClientRect();
          const s = screens[idx].getBoundingClientRect();
          hop.style.left = `${s.left - wr.left + s.width * (idx === 0 ? 0.5 : 0.18)}px`;
          hop.style.top = `${s.top - wr.top + s.height * (idx === 0 ? 0.22 : 0.42)}px`;
        };
        const tick = () => {
          idx = (idx + 1) % screens.length;
          place();
        };
        const startHop = () => {
          place();
          if (!reduce) interval = window.setInterval(tick, 2200);
        };
        let startTimer = 0;
        const hi = new IntersectionObserver(
          (e) => {
            if (e[0].isIntersecting) {
              startTimer = window.setTimeout(startHop, 900);
              hi.disconnect();
            }
          },
          { threshold: 0.35 },
        );
        hi.observe(wrap);
        window.addEventListener('resize', place);
        cleanups.push(() => {
          hi.disconnect();
          window.clearInterval(interval);
          window.clearTimeout(startTimer);
          window.removeEventListener('resize', place);
        });
      }

      if (!reduce) {
        if (fine) {
          const onMove = (e: MouseEvent) => {
            const r = wrap.getBoundingClientRect();
            const px = (e.clientX - r.left) / r.width - 0.5;
            const py = (e.clientY - r.top) / r.height - 0.5;
            (['.phone', '.laptop', '.tv'] as const).forEach((sel) => {
              const d = wrap.querySelector<HTMLElement>(sel);
              if (d) d.style.transform = `translateZ(0) rotateY(${px * 10}deg) rotateX(${-py * 8}deg)`;
            });
          };
          const onLeave = () => {
            (['.phone', '.laptop', '.tv'] as const).forEach((sel) => {
              const d = wrap.querySelector<HTMLElement>(sel);
              if (d) d.style.transform = '';
            });
          };
          wrap.addEventListener('mousemove', onMove);
          wrap.addEventListener('mouseleave', onLeave);
          cleanups.push(() => {
            wrap.removeEventListener('mousemove', onMove);
            wrap.removeEventListener('mouseleave', onLeave);
          });
        }
        const onScroll = () => {
          const r = wrap.getBoundingClientRect();
          const c = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
          const ph = wrap.querySelector<HTMLElement>('.phone');
          const tv = wrap.querySelector<HTMLElement>('.tv');
          if (ph) ph.style.marginTop = `${c * -28}px`;
          if (tv) tv.style.marginTop = `${c * 22}px`;
        };
        onScroll();
        window.addEventListener('scroll', onScroll, { passive: true });
        cleanups.push(() => window.removeEventListener('scroll', onScroll));
      }
    }

    // ── Compteurs animés ────────────────────────────────────────────
    const nums = $$<HTMLElement>('[data-count]');
    const runCount = (el: HTMLElement) => {
      const target = parseFloat(el.dataset.count || '0');
      const dur = reduce ? 0 : 1400;
      const t0 = performance.now();
      const dec = target % 1 !== 0 ? 1 : 0;
      if (!el.firstChild || el.firstChild.nodeType !== 3) {
        el.insertBefore(document.createTextNode('0'), el.firstChild);
      }
      const step = (t: number) => {
        const k = dur ? Math.min((t - t0) / dur, 1) : 1;
        const e = 1 - Math.pow(1 - k, 3);
        el.firstChild!.nodeValue = (target * e).toFixed(dec);
        if (k < 1) requestAnimationFrame(step);
        else el.firstChild!.nodeValue = target.toFixed(dec);
      };
      requestAnimationFrame(step);
    };
    if (nums.length) {
      const countIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting) {
              runCount(en.target as HTMLElement);
              countIO.unobserve(en.target);
            }
          });
        },
        { threshold: 0.5 },
      );
      nums.forEach((n) => countIO.observe(n));
      const safety = window.setTimeout(() => {
        nums.forEach((el) => {
          if (!el.firstChild || el.firstChild.nodeType !== 3) {
            el.textContent = el.dataset.count || '';
          }
        });
      }, 1600);
      cleanups.push(() => {
        countIO.disconnect();
        window.clearTimeout(safety);
      });
    }

    // ── Sticky story : active l'étape visible ───────────────────────
    const steps = $$<HTMLElement>('.story-step');
    const nodes = $$<HTMLElement>('.story-node');
    if (steps.length) {
      const storyIO = new IntersectionObserver(
        (entries) => {
          entries.forEach((en) => {
            if (en.isIntersecting && en.intersectionRatio > 0.5) {
              steps.forEach((s) => s.classList.remove('active'));
              en.target.classList.add('active');
              const i = Number((en.target as HTMLElement).dataset.step);
              nodes.forEach((n, k) => n.classList.toggle('on', k <= i));
            }
          });
        },
        { threshold: [0.5, 0.75], rootMargin: '-30% 0px -30% 0px' },
      );
      steps.forEach((s) => storyIO.observe(s));
      steps[0]?.classList.add('active');
      nodes[0]?.classList.add('on');
      cleanups.push(() => storyIO.disconnect());
    }

    // ── Pricing : spotlight + révélation des coches ─────────────────
    $$<HTMLElement>('.plan').forEach((p) => {
      const planIO = new IntersectionObserver(
        (en) => {
          if (en[0].isIntersecting) {
            p.classList.add('in');
            planIO.disconnect();
          }
        },
        { threshold: 0.3 },
      );
      planIO.observe(p);
      cleanups.push(() => planIO.disconnect());
    });
    const feat = $<HTMLElement>('.plan-featured');
    const spot = $<HTMLElement>('.spotlight');
    if (feat && spot && fine && !reduce) {
      const onMove = (e: MouseEvent) => {
        const r = feat.getBoundingClientRect();
        spot.style.setProperty('--sx', `${e.clientX - r.left}px`);
        spot.style.setProperty('--sy', `${e.clientY - r.top}px`);
      };
      feat.addEventListener('mousemove', onMove);
      cleanups.push(() => feat.removeEventListener('mousemove', onMove));
    }

    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef]);

  // ── Ondes broadcast (canvas) — relancées à chaque variant ──────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduce) return;
    const cv = root.querySelector<HTMLCanvasElement>('.layer-waves');
    const hero = root.querySelector<HTMLElement>('.hero');
    if (!cv || !hero) return;
    if (variant !== 'waves') return; // canvas inactif sur mesh/scan

    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 0;
    let H = 0;
    const origin = { x: 0.5, y: 0.45 };

    const size = () => {
      const r = cv.getBoundingClientRect();
      W = cv.width = r.width * dpr;
      H = cv.height = r.height * dpr;
    };
    size();
    window.addEventListener('resize', size);

    const onMove = (e: MouseEvent) => {
      const r = hero.getBoundingClientRect();
      origin.x = (e.clientX - r.left) / r.width;
      origin.y = (e.clientY - r.top) / r.height;
    };
    if (fine) hero.addEventListener('mousemove', onMove);

    const N = 7;
    const period = 5200;
    let raf = 0;
    const frame = (t: number) => {
      ctx.clearRect(0, 0, W, H);
      const ox = origin.x * W;
      const oy = origin.y * H;
      const maxR = Math.hypot(W, H) * 0.62;
      for (let i = 0; i < N; i++) {
        const phase = ((t / period) + i / N) % 1;
        const r = phase * maxR;
        const alpha = (1 - phase) * 0.28;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,212,255,${alpha})`;
        ctx.lineWidth = (1 - phase) * 2.2 * dpr + 0.3;
        ctx.stroke();
      }
      const sweep = ((t / 7000) % 1) * Math.PI * 2;
      const grad = ctx.createRadialGradient(ox, oy, 0, ox, oy, maxR);
      grad.addColorStop(0, 'rgba(0,212,255,0.05)');
      grad.addColorStop(Math.min(0.99, Math.max(0.01, 0.5 + 0.3 * Math.sin(sweep))), 'rgba(0,212,255,0.02)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', size);
      if (fine) hero.removeEventListener('mousemove', onMove);
      ctx.clearRect(0, 0, cv.width, cv.height);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef, variant]);
}
