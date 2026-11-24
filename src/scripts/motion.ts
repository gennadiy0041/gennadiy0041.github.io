/**
 * Rich motion — loaded only when <html> has class "rich" (desktop, fine pointer, no reduced motion), on the
 * visitor's first input or once the page has settled (see app.ts): Lenis smooth scroll, GSAP SplitText headings,
 * scrubbed timeline line, 3D tilt, spotlight, magnetic buttons. The hero entrance is CSS (Hero.astro), so first
 * paint never waits for this module. Phones and reduced-motion users never download it.
 */
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { nextTask, whenIdle } from './idle';
import { isRich } from './scroll';

gsap.registerPlugin(ScrollTrigger, SplitText);

let lenis: Lenis | null = null;
/** Bumped by destroyMotion(): an init still in progress for the previous page stops at its next step. */
let generation = 0;
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

/** Tilt / magnetic tweens are created on the first hover of each element: no upfront style work. */
function initPointerFx() {
  document.querySelectorAll<HTMLElement>('[data-tilt]').forEach((el) => {
    const max = el.dataset.tilt === 'soft' ? 4 : 7;
    let rx: gsap.QuickToFunc | null = null;
    let ry: gsap.QuickToFunc | null = null;
    let rect: DOMRect | null = null;
    const setup = () => {
      if (rx) return;
      gsap.set(el, { transformPerspective: 1000, transformStyle: 'preserve-3d' });
      rx = gsap.quickTo(el, 'rotationX', { duration: 0.6, ease: 'power3.out' });
      ry = gsap.quickTo(el, 'rotationY', { duration: 0.6, ease: 'power3.out' });
    };
    const enter = () => {
      setup();
      rect = el.getBoundingClientRect();
    };
    const move = (e: PointerEvent) => {
      setup();
      const r = rect ?? (rect = el.getBoundingClientRect());
      rx!(-((e.clientY - r.top) / r.height - 0.5) * max);
      ry!(((e.clientX - r.left) / r.width - 0.5) * max);
    };
    const leave = () => {
      rect = null;
      rx?.(0);
      ry?.(0);
    };
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    onCleanup(() => {
      el.removeEventListener('pointerenter', enter);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      if (rx) gsap.set(el, { clearProps: 'transform,transformPerspective,transformStyle' });
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
    let x: gsap.QuickToFunc | null = null;
    let y: gsap.QuickToFunc | null = null;
    const move = (e: PointerEvent) => {
      x ??= gsap.quickTo(el, 'x', { duration: 0.5, ease: 'power3.out' });
      y ??= gsap.quickTo(el, 'y', { duration: 0.5, ease: 'power3.out' });
      const r = el.getBoundingClientRect();
      x((e.clientX - (r.left + r.width / 2)) * 0.18);
      y((e.clientY - (r.top + r.height / 2)) * 0.28);
    };
    const leave = () => {
      x?.(0);
      y?.(0);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', leave);
    onCleanup(() => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerleave', leave);
      if (x) gsap.set(el, { clearProps: 'x,y' });
    });
  });
}

/** Each step runs in its own task, so starting motion never blocks input for long. */
export async function initMotion() {
  if (!isRich()) return;
  const gen = generation;
  ensureLenis();
  lenis!.resize();
  lenis!.start();
  await nextTask();
  if (gen !== generation) return;
  initSplits();
  initTimelineLine();
  await nextTask();
  if (gen !== generation) return;
  initPointerFx();
  whenIdle(() => gen === generation && ScrollTrigger.refresh());
}

export function destroyMotion() {
  generation++;
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
