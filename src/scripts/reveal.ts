/**
 * Light motion for every device that allows motion (phones included): CSS reveal-on-scroll and number counters.
 * No animation library — an IntersectionObserver and requestAnimationFrame only.
 */
import { isMotion, scrollToTarget } from './scroll';

const cleanups: Array<() => void> = [];

function initReveals() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (!isMotion()) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
        }
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.06 },
  );
  els.forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());
}

const easeOutExpo = (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));

function initCounters() {
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-count]'));
  if (!isMotion() || !els.length) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target as HTMLElement;
        io.unobserve(el);
        const to = Number(el.dataset.count) || 0;
        const dur = Math.min(2200, 1000 + to * 25);
        const t0 = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - t0) / dur);
          el.textContent = String(Math.round(to * easeOutExpo(p)));
          if (p < 1) requestAnimationFrame(tick);
        };
        el.textContent = '0';
        requestAnimationFrame(tick);
      }
    },
    { threshold: 0.6 },
  );
  // the real number stays in the HTML for crawlers and no-JS; it is zeroed only right before counting
  els.forEach((el) => io.observe(el));
  cleanups.push(() => io.disconnect());
}

/** Same-page anchor links → smooth scroll with nav offset (Lenis-aware). Bound once. */
let anchorsBound = false;
function bindAnchors() {
  if (anchorsBound) return;
  anchorsBound = true;
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href*="#"]') as HTMLAnchorElement | null;
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const url = new URL(a.href, location.href);
    const same = url.origin === location.origin && url.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '');
    if (!same) return;
    const id = decodeURIComponent(url.hash.slice(1));
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    e.preventDefault();
    if (id.startsWith('a-')) document.dispatchEvent(new CustomEvent('timeline:reveal', { detail: { id: id.slice(2) } }));
    scrollToTarget(el);
    history.pushState(null, '', `#${id}`);
  });
}

export function initLight() {
  bindAnchors();
  initReveals();
  initCounters();
  // arriving with a hash (e.g. from a project page to /#projects)
  if (location.hash) {
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) requestAnimationFrame(() => scrollToTarget(el, true));
  }
}

export function destroyLight() {
  while (cleanups.length) cleanups.pop()!();
}
