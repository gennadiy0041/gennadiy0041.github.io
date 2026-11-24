/**
 * Client entry. Astro's <ClientRouter /> keeps this module alive between pages,
 * so every feature is (re)initialised on 'astro:page-load' and torn down on 'astro:before-swap'.
 * GSAP + Lenis (motion.ts) are fetched only on "rich" desktops; phones get CSS reveals.
 */
import { destroyLight, initLight } from './reveal';
import { isRich } from './scroll';
import { destroyUi, initCopy, initDocuments, initHeroGL, initNav, initTimeline, initTyped } from './ui';

type Mod = { initPalette?: () => void; initLightbox?: () => void };
// Search palette and lightbox live in their own modules (bundled if present).
const optional = import.meta.glob<Mod>(['./palette.ts', './lightbox.ts'], { eager: true });

let motion: Promise<typeof import('./motion')> | null = null;
const loadMotion = () => (motion ??= import('./motion'));

function pageLoad() {
  initNav();
  initLight();
  initTimeline();
  initDocuments();
  initCopy();
  initTyped();
  initHeroGL();
  for (const m of Object.values(optional)) {
    m.initPalette?.();
    m.initLightbox?.();
  }
  if (isRich()) loadMotion().then((m) => m.initMotion());
}

document.addEventListener('astro:page-load', pageLoad);
document.addEventListener('astro:before-swap', () => {
  destroyUi();
  destroyLight();
  if (motion) motion.then((m) => m.destroyMotion());
});
document.addEventListener('astro:after-swap', () => {
  if (motion) motion.then((m) => m.resetScroll());
  else if (!location.hash) window.scrollTo(0, 0);
});
