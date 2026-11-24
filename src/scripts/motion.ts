/**
 * Rich motion — loaded only when <html> has class "rich" (desktop, fine pointer, no reduced motion):
 * Lenis smooth scroll, GSAP SplitText headings, scrubbed timeline line, 3D tilt, spotlight, magnetic buttons, hero intro.
 * Phones and reduced-motion users never download this module (see app.ts).
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { isRich } from './scroll';

gsap.registerPlugin(ScrollTrigger, SplitText);

let lenis: Lenis | null = null;
const cleanups: Array<() => void> = [];
const onCleanup = (fn: () => void) => cleanups.push(fn);

function ensureLenis() {
  if (lenis) return;
  lenis = new Lenis({ lerp: 0.11, smoothWheel: true, wheelMultiplier: 1, syncTouch: false });
  window.__lenis = lenis;
  window.__refreshScroll = () => {
    lenis?.resize();
    ScrollTrigger.refresh();
  };
  lenis.on('scroll', ScrollTrigger.update);
  gsap.ticker.add((time) => lenis?.raf(time * 1000));
  gsap.ticker.lagSmoothing(0);
}

/** Section headings: split into masked lines only when they approach the viewport (no upfront layout work). */
function initSplits() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target as HTMLElement;
        io.unobserve(el);
        const split = SplitText.create(el, {
          type: 'lines',
          mask: 'lines',
          linesClass: 'split-line',
          onSplit(self) {
            return gsap.from(self.lines, { yPercent: 108, duration: 1.15, ease: 'expo.out', stagger: 0.08 });
          },
        });
        onCleanup(() => split.revert());
      }
    },
    { rootMargin: '0px 0px -6% 0px' },
  );
  document.querySelectorAll<HTMLElement>('[data-split]').forEach((el) => io.observe(el));
  onCleanup(() => io.disconnect());
}

function initTimelineLine() {
  const tl = document.querySelector<HTMLElement>('[data-tl]');
  const fill = document.querySelector<HTMLElement>('[data-tl-fill]');
  if (!tl || !fill) return;
  const tween = gsap.fromTo(
    fill,
    { scaleY: 0 },
    { scaleY: 1, ease: 'none', scrollTrigger: { trigger: tl, start: 'top 72%', end: 'bottom 72%', scrub: 0.6 } },
  );
  onCleanup(() => {
    tween.scrollTrigger?.kill();
    tween.kill();
  });
}

function initPointerFx() {
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
    const max = el.dataset.tilt === 'soft' ? 4 : 7;
    gsap.set(el, { transformPerspective: 1000, transformStyle: 'preserve-3d' });
    const rx = gsap.quickTo(el, 'rotationX', { duration: 0.6, ease: 'power3.out' });
    const ry = gsap.quickTo(el, 'rotationY', { duration: 0.6, ease: 'power3.out' });
    let rect: DOMRect | null = null;
    const enter = () => (rect = el.getBoundingClientRect());
    const move = (e: PointerEvent) => {
      const r = rect ?? (rect = el.getBoundingClientRect());
      rx(-((e.clientY - r.top) / r.height - 0.5) * max);
      ry(((e.clientX - r.left) / r.width - 0.5) * max);
    };
    const leave = () => {
      rect = null;
      rx(0);
      ry(0);
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    onCleanup(() => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      gsap.set(el, { clearProps: 'transform,transformPerspective,transformStyle' });
    });
  });

  document.querySelectorAll<HTMLElement>('[data-spot]').forEach((el) => {
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    el.addEventListener('pointermove', move);
    onCleanup(() => el.removeEventListener('pointermove', move));
  });

  document.querySelectorAll<HTMLElement>('[data-magnetic]').forEach((el) => {
    const x = gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
    const y = gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      x((e.clientX - (r.left + r.width / 2)) * 0.18);
      y((e.clientY - (r.top + r.height / 2)) * 0.28);
    };
    const leave = () => {
      x(0);
      y(0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    onCleanup(() => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
    });
  });
}

/** Transform-only entrance so the LCP element (name / first photo) is painted on the first frame. */
function initHeroIntro() {
  if (!document.querySelector('.hero') || scrollY > 40) return;
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.from('[data-hero-name] > span', { yPercent: 16, duration: 1.4, stagger: 0.09 }, 0)
    .from('[data-hero-in]', { y: 20, duration: 1.1, stagger: 0.07 }, 0.1)
    .from('[data-hero-photo]', { y: 60, rotation: (i: number) => [6, -10, 14][i] ?? 0, duration: 1.6, stagger: 0.1 }, 0.05);
  onCleanup(() => tl.kill());
}

export function initMotion() {
  if (!isRich()) return;
  ensureLenis();
  lenis!.resize();
  lenis!.start();
  initHeroIntro();
  initSplits();
  initTimelineLine();
  initPointerFx();
  requestAnimationFrame(() => ScrollTrigger.refresh());
}

export function destroyMotion() {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* element already gone */
    }
  }
  ScrollTrigger.getAll().forEach((st) => st.kill());
}

/** New page: start at the top unless the URL targets an anchor. */
export function resetScroll() {
  if (!location.hash) lenis?.scrollTo(0, { immediate: true, force: true });
}
