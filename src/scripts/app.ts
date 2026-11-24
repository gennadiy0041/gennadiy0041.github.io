/**
 * Client entry. Astro's <ClientRouter /> keeps this module alive between pages,
 * so every feature is (re)initialised on 'astro:page-load' and torn down on 'astro:before-swap'.
 *
 * First paint never waits for JavaScript: the hero entrance is CSS. The page-load task only wires cheap
 * behaviour (nav, reveals, filters, search, lightbox). GSAP + Lenis (motion.ts) and the WebGL hero are fetched
 * on "rich" desktops only: motion on the visitor's first input or once the page has settled, the WebGL map on the
 * first mouse movement (a poster of its first frame stands in until then). Phones get CSS reveals.
 */
import { onFirstInput, onFirstPointer } from './idle';
import { destroyLight, initLight } from './reveal';
import { isRich } from './scroll';
import { destroyUi, initCopy, initDocuments, initHeroGL, initNav, initTimeline, initTyped } from './ui';

type Mod = { initPalette?: () => void; initLightbox?: () => void };
// Search palette and lightbox live in their own modules (bundled if present).
const optional = import.meta.glob<Mod>(['./palette.ts', './lightbox.ts'], { eager: true });

let motion: Promise<typeof import('./motion')> | null = null;
const loadMotion = () => (motion ??= import('./motion'));
/** Deferred starters of the current page; cancelled when the visitor navigates before they fire. */
let pending: Array<() => void> = [];

function pageLoad() {
  initNav();
  initLight();
  initTimeline();
  initDocuments();
  initCopy();
  initTyped();
  for (const m of Object.values(optional)) {
    m.initPalette?.();
    m.initLightbox?.();
  }
  if (isRich()) {
    // after a client-side navigation the module is already here: no reason to wait
    if (motion) void motion.then((m) => m.initMotion());
    else pending.push(onFirstInput(() => void loadMotion().then((m) => m.initMotion()), 1500));
    // the hero map reacts to the cursor, so it boots on the first mouse movement; until then the poster
    // (a still of the shader's first frame) shows exactly what the canvas will start from
    pending.push(onFirstPointer(initHeroGL));
  }
}

document.addEventListener('astro:page-load', pageLoad);
document.addEventListener('astro:before-swap', () => {
  pending.forEach((cancel) => cancel());
  pending = [];
  destroyUi();
  destroyLight();
  if (motion) motion.then((m) => m.destroyMotion());
});
document.addEventListener('astro:after-swap', () => {
  if (motion) motion.then((m) => m.resetScroll());
  else if (!location.hash) window.scrollTo(0, 0);
});
