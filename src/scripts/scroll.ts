/**
 * Shared, dependency-free helpers. GSAP/Lenis live in motion.ts and are only loaded on "rich" devices;
 * everything here works with or without them (window.__lenis / window.__refreshScroll are set by motion.ts).
 */
declare global {
  interface Window {
    __lenis?: { scrollTo(t: HTMLElement | number, o?: Record<string, unknown>): void; stop(): void; start(): void; resize(): void };
    __refreshScroll?: () => void;
  }
}

const html = document.documentElement;
export const isMotion = () => html.classList.contains('motion');
export const isRich = () => html.classList.contains('rich');

export function navOffset(): number {
  const nav = document.querySelector<HTMLElement>('[data-nav]');
  return (nav?.offsetHeight || 68) + 12;
}

/** Scroll to an element or y, respecting the fixed nav. Uses Lenis when it is running. */
export function scrollToTarget(target: Element | number, immediate = false) {
  const offset = typeof target === 'number' ? 0 : -navOffset();
  if (window.__lenis) {
    window.__lenis.scrollTo(target as HTMLElement | number, { offset, immediate, duration: 1.15 });
    return;
  }
  const y = typeof target === 'number' ? target : target.getBoundingClientRect().top + window.scrollY + offset;
  window.scrollTo({ top: y, behavior: immediate || !isMotion() ? 'auto' : 'smooth' });
}

/** Call after the page height changes (filters, "show all"). */
export function refreshScroll() {
  window.__refreshScroll?.();
}
