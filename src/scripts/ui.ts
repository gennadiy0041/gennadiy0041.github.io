/**
 * Small page behaviours: nav state, mobile menu, timeline filters, documents toggle, copy buttons, typed line, hero WebGL.
 * Every init* is safe to call on each 'astro:page-load'; per-page listeners are removed in destroyUi().
 */
import { isMotion, isRich, refreshScroll, scrollToTarget } from './scroll';

const html = document.documentElement;
const cleanups: Array<() => void> = [];
const onCleanup = (fn: () => void) => cleanups.push(fn);

/* ------------------------------------------------------------------ Nav */
let navBound = false;
let lastY = 0;
function navScroll() {
  const y = window.scrollY;
  html.toggleAttribute('data-scrolled', y > 8);
  const menuOpen = !document.querySelector<HTMLElement>('[data-menu]')?.hidden;
  const hide = y > 480 && y > lastY + 4 && !menuOpen;
  const show = y < lastY - 4 || y <= 480;
  if (hide) html.setAttribute('data-nav-hidden', '');
  else if (show) html.removeAttribute('data-nav-hidden');
  lastY = y;
}

export function initNav() {
  if (!navBound) {
    navBound = true;
    window.addEventListener('scroll', navScroll, { passive: true });
    // Mac users see ⌘ instead of Ctrl
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });
    document.addEventListener('click', (e) => {
      const t = e.target as Element;
      if (t.closest('[data-menu-open]')) openMenu();
      else if (t.closest('[data-menu-close]') || t.closest('[data-menu-link]')) closeMenu();
    });
  }
  navScroll();
  if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) {
    document.querySelectorAll('[data-mod-key]').forEach((k) => (k.textContent = '⌘'));
  }
  // active section highlight
  const links = new Map<string, HTMLElement>();
  document.querySelectorAll<HTMLElement>('[data-nav-link]').forEach((a) => links.set(a.dataset.navLink!, a));
  // observe every section (also ones without a nav link, e.g. the hero) so the highlight clears there
  const sections = Array.from(document.querySelectorAll<HTMLElement>('section[data-section][id]'));
  links.forEach((a) => a.removeAttribute('aria-current'));
  if (!sections.some((s) => links.has(s.id))) return;
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (en.isIntersecting) {
          links.forEach((a, id) => (id === en.target.id ? a.setAttribute('aria-current', 'true') : a.removeAttribute('aria-current')));
        }
      }
    },
    { rootMargin: '-45% 0px -50% 0px' },
  );
  sections.forEach((s) => io.observe(s));
  onCleanup(() => io.disconnect());
}

function openMenu() {
  const m = document.querySelector<HTMLElement>('[data-menu]');
  const btn = document.querySelector<HTMLElement>('[data-menu-open]');
  if (!m) return;
  m.hidden = false;
  btn?.setAttribute('aria-expanded', 'true');
  window.__lenis?.stop();
  html.style.overflow = 'hidden';
  m.querySelector<HTMLElement>('[data-menu-close]')?.focus();
}
function closeMenu() {
  const m = document.querySelector<HTMLElement>('[data-menu]');
  if (!m || m.hidden) return;
  m.hidden = true;
  document.querySelector<HTMLElement>('[data-menu-open]')?.setAttribute('aria-expanded', 'false');
  window.__lenis?.start();
  html.style.overflow = '';
}

/* ------------------------------------------------------------- Timeline */
export function initTimeline() {
  const root = document.querySelector<HTMLElement>('[data-tl]');
  const filters = document.querySelector<HTMLElement>('[data-tl-filters]');
  if (!root || !filters) return;
  const items = Array.from(root.querySelectorAll<HTMLElement>('.tl-item'));
  const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-tl-year]'));
  const countEl = filters.querySelector<HTMLElement>('[data-tl-count]');
  const empty = root.querySelector<HTMLElement>('[data-tl-empty]');
  const state = { year: 'all', group: 'all', podium: false };

  const apply = () => {
    let shown = 0;
    for (const it of items) {
      const ok =
        (state.year === 'all' || it.dataset.year === state.year) &&
        (state.group === 'all' || it.dataset.group === state.group) &&
        (!state.podium || it.dataset.podium === '1');
      it.hidden = !ok;
      if (ok) {
        shown++;
        it.classList.add('is-in');
      }
    }
    for (const b of blocks) b.hidden = !b.querySelector('.tl-item:not([hidden])');
    if (countEl) countEl.textContent = String(shown);
    if (empty) empty.hidden = shown > 0;
    filters.querySelectorAll<HTMLElement>('[data-f-year]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fYear === state.year)));
    filters.querySelectorAll<HTMLElement>('[data-f-group]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fGroup === state.group)));
    filters.querySelector<HTMLElement>('[data-f-podium]')?.setAttribute('aria-pressed', String(state.podium));
    refreshScroll();
  };

  const onClick = (e: Event) => {
    const b = (e.target as Element).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.fYear) state.year = b.dataset.fYear;
    else if (b.dataset.fGroup) state.group = b.dataset.fGroup;
    else if (b.hasAttribute('data-f-podium')) state.podium = !state.podium;
    else return;
    apply();
  };
  filters.addEventListener('click', onClick);

  // the Ctrl+K palette / anchor links ask to show an item that a filter may hide
  const onReveal = (e: Event) => {
    const id = (e as CustomEvent<{ id: string }>).detail?.id;
    const el = id ? document.getElementById(`a-${id}`) : null;
    if (el && el.hidden) {
      state.year = 'all';
      state.group = 'all';
      state.podium = false;
      apply();
    }
    el?.classList.add('is-in');
  };
  document.addEventListener('timeline:reveal', onReveal);
  onCleanup(() => {
    filters.removeEventListener('click', onClick);
    document.removeEventListener('timeline:reveal', onReveal);
  });
}

/* ------------------------------------------------------- Documents grid */
export function initDocuments() {
  const btn = document.querySelector<HTMLButtonElement>('[data-docs-toggle]');
  const grid = document.querySelector<HTMLElement>('[data-docs]');
  if (!btn || !grid) return;
  const label = btn.querySelector<HTMLElement>('[data-docs-label]');
  const onClick = () => {
    const collapsed = grid.hasAttribute('data-collapsed');
    grid.toggleAttribute('data-collapsed', !collapsed);
    btn.setAttribute('aria-expanded', String(collapsed));
    if (label) label.textContent = collapsed ? btn.dataset.less! : btn.dataset.more!;
    grid.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
    if (!collapsed) scrollToTarget(grid, true);
    refreshScroll();
  };
  btn.addEventListener('click', onClick);
  onCleanup(() => btn.removeEventListener('click', onClick));
}

/* ------------------------------------------------------------ Copy buttons */
export function initCopy() {
  document.querySelectorAll<HTMLButtonElement>('[data-copy]').forEach((b) => {
    const onClick = async () => {
      try {
        await navigator.clipboard.writeText(b.dataset.copy!);
        const prev = b.getAttribute('aria-label') ?? '';
        b.setAttribute('aria-label', b.dataset.copiedLabel ?? 'Copied');
        b.classList.add('text-[var(--accent)]');
        setTimeout(() => {
          b.setAttribute('aria-label', prev);
          b.classList.remove('text-[var(--accent)]');
        }, 1600);
      } catch {
        /* clipboard blocked: the link itself still works */
      }
    };
    b.addEventListener('click', onClick);
    onCleanup(() => b.removeEventListener('click', onClick));
  });
}

/* ------------------------------------------------------------ Typed line */
export function initTyped() {
  const el = document.querySelector<HTMLElement>('[data-typed]');
  if (!el) return;
  let phrases: string[] = [];
  try {
    phrases = JSON.parse(el.dataset.typed || '[]');
  } catch {
    return;
  }
  if (!isMotion() || phrases.length < 2) return;
  let i = 0;
  let pos = phrases[0].length;
  let deleting = true;
  let timer = 0;
  let alive = true;
  const step = () => {
    if (!alive) return;
    if (document.hidden) {
      timer = window.setTimeout(step, 500);
      return;
    }
    const word = phrases[i];
    if (deleting) {
      pos--;
      el.textContent = word.slice(0, pos);
      if (pos <= 0) {
        deleting = false;
        i = (i + 1) % phrases.length;
        timer = window.setTimeout(step, 320);
        return;
      }
      timer = window.setTimeout(step, 28);
    } else {
      const next = phrases[i];
      pos++;
      el.textContent = next.slice(0, pos);
      if (pos >= next.length) {
        deleting = true;
        timer = window.setTimeout(step, 2300);
        return;
      }
      timer = window.setTimeout(step, 55 + Math.random() * 45);
    }
  };
  timer = window.setTimeout(step, 2600);
  onCleanup(() => {
    alive = false;
    clearTimeout(timer);
  });
}

/* --------------------------------------------------------------- Hero GL */
const glModules = import.meta.glob<{ mountHeroGL: (c: HTMLCanvasElement) => Promise<{ destroy(): void }> }>('./hero-gl.ts');
/**
 * Called by app.ts on the first mouse movement, never inside the page-load task. The canvas fades in over the
 * poster once the module marks it data-hero-gl="ready" (Hero.astro); on software GL the module does nothing.
 */
export function initHeroGL() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-hero-gl]');
  const load = glModules['./hero-gl.ts'];
  if (!canvas || !load || !isRich() || canvas.dataset.heroGl) return;
  let handle: { destroy(): void } | null = null;
  let cancelled = false;
  load()
    .then((m) => (cancelled ? null : m.mountHeroGL(canvas)))
    .then((mounted) => {
      if (!mounted) return;
      if (cancelled) mounted.destroy();
      else handle = mounted;
    })
    .catch(() => {
      /* WebGL unavailable: the static poster stays */
    });
  onCleanup(() => {
    cancelled = true;
    handle?.destroy();
  });
}

export function destroyUi() {
  while (cleanups.length) {
    try {
      cleanups.pop()!();
    } catch {
      /* noop */
    }
  }
}
