import { useEffect, type RefObject } from 'react';

/**
 * Tous les effets propres à la home vitrine (design Umbra) : hero `.in` +
 * poussière dorée (canvas cinéma), power-on / tilt / parallaxe / hop du
 * showcase, compteurs animés, étape de story active, spotlight + révélation des
 * coches du pricing. Tout dégrade sous `prefers-reduced-motion`.
 */
export function useHomeFx(rootRef: RefObject<HTMLElement>) {
  const reduce =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine =
    typeof window !== 'undefined' &&
    window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ── Effets DOM (montés une fois) ───────────────────────────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const $ = <T extends Element>(s: string) => root.querySelector<T>(s);
    const $$ = <T extends Element>(s: string) => Array.from(root.querySelectorAll<T>(s));
    const cleanups: Array<() => void> = [];

    // ── Hero reveal (déclenche l'entrée échelonnée + slide des titres) ─
    const hero = $<HTMLElement>('.hero');
    if (hero) {
      const t = window.setTimeout(() => hero.classList.add('in'), 80);
      const onLoad = () => hero.classList.add('in');
      window.addEventListener('load', onLoad);
      cleanups.push(() => {
        window.clearTimeout(t);
        window.removeEventListener('load', onLoad);
      });
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

    // ── Pricing : révélation des coches ─────────────────────────────
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

    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef]);

  // ── Poussière dorée dans le faisceau (canvas cinéma) ───────────────
  useEffect(() => {
    const root = rootRef.current;
    if (!root || reduce) return;
    const canvas = root.querySelector<HTMLCanvasElement>('.hero-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const COUNT = 70;
    let w = 0;
    let h = 0;
    let raf = 0;
    let t = 0;

    const seed = () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.8 + 0.4,
      vy: -(Math.random() * 0.00035 + 0.00012),
      vx: (Math.random() - 0.5) * 0.0002,
      a: Math.random() * 0.5 + 0.15,
      tw: Math.random() * Math.PI * 2,
    });
    const motes = Array.from({ length: COUNT }, seed);

    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * DPR;
      canvas.height = h * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const draw = () => {
      t += 1;
      ctx.clearRect(0, 0, w, h);
      for (const m of motes) {
        m.x += m.vx;
        m.y += m.vy;
        if (m.y < -0.05) {
          m.y = 1.05;
          m.x = Math.random();
        }
        const tw = 0.6 + 0.4 * Math.sin(t * 0.02 + m.tw);
        const px = m.x * w;
        const py = m.y * h;
        const beam = 1 - Math.min(1, Math.abs(m.x - 0.5) * 1.6);
        ctx.beginPath();
        ctx.arc(px, py, m.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(245, 182, 88, ${m.a * tw * (0.35 + beam * 0.65)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootRef]);
}
