/**
 * Lightbox for [data-lb] triggers, plus the modal-layer helpers shared with the palette.
 *
 * Trigger attributes (put them on a <button> or on an <a href="large.jpg"> for a no-JS fallback):
 *   data-lb                  marks a trigger
 *   data-lb-group="name"     gallery: every visible trigger of the group, in DOM order
 *   data-lb-id="id"          stable id, used by the `lightbox:open` event and to de-duplicate a gallery
 *   data-lb-src="url"        large image (falls back to the anchor href, then to the inner <img>)
 *   data-lb-srcset="…"       optional srcset with w descriptors
 *   data-lb-w / data-lb-h    intrinsic pixel size of the large image (reserves the box: no layout shift)
 *   data-lb-caption="…"      caption, also the dialog's accessible name
 *   data-lb-sub="…"          secondary line, e.g. "date · issuer"
 *
 * Events: document `lightbox:open` with detail { group, id } opens that item.
 *
 * `initLightbox()` is idempotent: global listeners are bound once, the #lightbox
 * root is re-read after every Astro page swap.
 */
import type Lenis from 'lenis';

/* ------------------------------------------------------------------ */
/* Modal layers (palette, lightbox): scroll lock, inert page, focus    */
/* ------------------------------------------------------------------ */

type LenisLike = Pick<Lenis, 'start' | 'stop' | 'scrollTo' | 'resize' | 'isStopped'>;

/** The smooth-scroll instance, when the page created one. */
export function getLenis(): LenisLike | undefined {
  return (window as Window & { __lenis?: LenisLike }).__lenis;
}

/** `html.motion` is set before first paint (Base.astro); it is absent for prefers-reduced-motion. */
export function motionAllowed(): boolean {
  return document.documentElement.classList.contains('motion');
}

const layers: HTMLElement[] = [];
let inerted: Element[] = [];
/** What the page looked like before the first layer locked it (another widget may have locked it already). */
let unlocked: { overflow: string; gutter: string; lenisStopped: boolean } | null = null;

function syncInert(): void {
  for (const el of inerted) el.removeAttribute('inert');
  inerted = [];
  const top = layers[layers.length - 1];
  if (!top) return;
  for (const el of document.body.children) {
    if (el.contains(top) || el.hasAttribute('inert') || el.matches('script, style, template')) continue;
    el.setAttribute('inert', '');
    inerted.push(el);
  }
}

function lockPage(): void {
  const html = document.documentElement;
  const lenis = getLenis();
  const scrollbar = window.innerWidth - html.clientWidth;
  unlocked = { overflow: html.style.overflow, gutter: html.style.scrollbarGutter, lenisStopped: Boolean(lenis?.isStopped) };
  lenis?.stop();
  // Inline styles win over Lenis' `overflow: clip`, and the reserved gutter keeps the page from shifting sideways.
  html.style.overflow = 'hidden';
  if (scrollbar > 0) html.style.scrollbarGutter = 'stable';
}

function unlockPage(): void {
  const html = document.documentElement;
  html.style.overflow = unlocked?.overflow ?? '';
  html.style.scrollbarGutter = unlocked?.gutter ?? '';
  if (!html.getAttribute('style')) html.removeAttribute('style');
  if (!unlocked?.lenisStopped) getLenis()?.start();
  unlocked = null;
}

/** Put a modal on top: the first layer locks page scroll; everything outside the top layer turns inert. */
export function pushLayer(root: HTMLElement): void {
  if (layers.includes(root)) return;
  layers.push(root);
  if (layers.length === 1) lockPage();
  syncInert();
}

export function popLayer(root: HTMLElement): void {
  const i = layers.indexOf(root);
  if (i < 0) return;
  layers.splice(i, 1);
  syncInert();
  if (!layers.length) unlockPage();
}

export function isTopLayer(root: HTMLElement): boolean {
  return layers[layers.length - 1] === root;
}

export function hasOpenLayer(): boolean {
  return layers.length > 0;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Keep Tab / Shift+Tab cycling inside `root`. Call from a keydown handler for the Tab key. */
export function trapFocus(e: KeyboardEvent, root: HTMLElement): void {
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.matches(':disabled') && el.getClientRects().length > 0,
  );
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last) {
    e.preventDefault();
  } else if (e.shiftKey && (active === first || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/** Resolves when every animation has settled (finished or cancelled). */
export function settled(anims: Animation[]): Promise<void> {
  return Promise.allSettled(anims.map((a) => a.finished)).then(() => undefined);
}

/* ------------------------------------------------------------------ */
/* Lightbox                                                           */
/* ------------------------------------------------------------------ */

interface Slide {
  el: HTMLElement;
  id: string;
  src: string;
  srcset: string;
  /** Intrinsic size; 0 until known (data attributes or the loaded image). */
  w: number;
  h: number;
  caption: string;
  sub: string;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Ui {
  root: HTMLElement;
  backdrop: HTMLElement;
  stage: HTMLElement;
  frame: HTMLElement;
  ph: HTMLImageElement;
  img: HTMLImageElement;
  spinner: HTMLElement;
  top: HTMLElement;
  count: HTMLElement;
  zoom: HTMLButtonElement;
  close: HTMLButtonElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  bar: HTMLElement;
  title: HTMLElement;
  sub: HTMLElement;
  status: HTMLElement;
  /** Accessible name used when a slide has no caption. */
  label: string;
}

type Gesture = 'idle' | 'pending' | 'pan' | 'swipe' | 'dismiss' | 'pinch';

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN_OUT = 'cubic-bezier(0.65, 0, 0.35, 1)';
const RADIUS = 10;
const MAX_ZOOM = 4;
const TAP_SLOP_TOUCH = 10;
const TAP_SLOP_MOUSE = 4;

let ui: Ui | null = null;
let bound = false;
let isOpen = false;
let generation = 0;
let slides: Slide[] = [];
let current = 0;
let trigger: HTMLElement | null = null;
let fit: Rect = { x: 0, y: 0, w: 0, h: 0 };
let scale = 1;
let tx = 0;
let ty = 0;
let loadToken = 0;
let spinnerTimer = 0;
let resizeFrame = 0;
const preloaded = new Map<string, HTMLImageElement>();

const pointers = new Map<number, { x: number; y: number }>();
const g = {
  mode: 'idle' as Gesture,
  x0: 0,
  y0: 0,
  tx0: 0,
  ty0: 0,
  onImage: false,
  touch: false,
  lastX: 0,
  lastY: 0,
  lastT: 0,
  vx: 0,
  vy: 0,
  dist0: 1,
  scale0: 1,
  mx0: 0,
  my0: 0,
};

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function part<T extends HTMLElement>(root: HTMLElement, name: string): T | null {
  return root.querySelector<T>(`[data-part="${name}"]`);
}

function collectUi(root: HTMLElement): Ui | null {
  const p = {
    backdrop: part(root, 'backdrop'),
    stage: part(root, 'stage'),
    frame: part(root, 'frame'),
    ph: part<HTMLImageElement>(root, 'ph'),
    img: part<HTMLImageElement>(root, 'img'),
    spinner: part(root, 'spinner'),
    top: part(root, 'top'),
    count: part(root, 'count'),
    zoom: part<HTMLButtonElement>(root, 'zoom'),
    close: part<HTMLButtonElement>(root, 'close'),
    prev: part<HTMLButtonElement>(root, 'prev'),
    next: part<HTMLButtonElement>(root, 'next'),
    bar: part(root, 'bar'),
    title: part(root, 'title'),
    sub: part(root, 'sub'),
    status: part(root, 'status'),
  };
  for (const el of Object.values(p)) if (!el) return null;
  return { root, label: root.dataset.label ?? '', ...(p as { [K in keyof typeof p]: NonNullable<(typeof p)[K]> }) };
}

/** Trigger visible on the page? Filtered-out timeline rows are display:none or inside [hidden]. */
function isShown(el: HTMLElement): boolean {
  return typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0;
}

function thumbOf(el: HTMLElement): HTMLImageElement | null {
  return el instanceof HTMLImageElement ? el : el.querySelector('img');
}

function readSlide(el: HTMLElement): Slide | null {
  const d = el.dataset;
  const img = thumbOf(el);
  const src = d.lbSrc || (el instanceof HTMLAnchorElement ? el.href : '') || img?.currentSrc || img?.src || '';
  if (!src) return null;
  return {
    el,
    id: d.lbId ?? '',
    src,
    srcset: d.lbSrcset ?? '',
    w: Number(d.lbW) || 0,
    h: Number(d.lbH) || 0,
    caption: d.lbCaption ?? img?.alt ?? '',
    sub: d.lbSub ?? '',
  };
}

/** Gallery for a trigger: visible members of its group, de-duplicated by id (the trigger wins). */
function galleryFor(el: HTMLElement): Slide[] {
  const group = el.dataset.lbGroup;
  const members = group
    ? [...document.querySelectorAll<HTMLElement>(`[data-lb][data-lb-group="${CSS.escape(group)}"]`)]
    : [el];
  const list: Slide[] = [];
  const byId = new Map<string, number>();
  for (const m of members) {
    if (m !== el && !isShown(m)) continue;
    const slide = readSlide(m);
    if (!slide) continue;
    const dup = slide.id ? byId.get(slide.id) : undefined;
    if (dup !== undefined) {
      if (m === el) list[dup] = slide;
      continue;
    }
    if (slide.id) byId.set(slide.id, list.length);
    list.push(slide);
  }
  return list;
}

/** Box (in viewport px) the slide gets at zoom 1: fit between the top bar and the caption. */
function fitFor(slide: Slide): Rect {
  const u = ui!;
  const thumb = thumbOf(slide.el);
  const known = slide.w > 0 && slide.h > 0;
  // Before the size is known, borrow the thumbnail's aspect ratio (or 4:3) without the no-upscale cap.
  const w = known ? slide.w : thumb?.naturalWidth || 4;
  const h = known ? slide.h : thumb?.naturalHeight || 3;
  const vw = u.root.clientWidth;
  const vh = u.root.clientHeight;
  const top = u.top.offsetHeight;
  const bottom = u.bar.offsetHeight;
  const padX = vw < 768 ? 12 : 96;
  const availW = Math.max(64, vw - padX * 2);
  const availH = Math.max(64, vh - top - bottom - 16);
  const k = Math.min(availW / w, availH / h, known ? 1 : Infinity);
  const fw = Math.round(w * k);
  const fh = Math.round(h * k);
  return { x: Math.round((vw - fw) / 2), y: Math.round(top + 8 + (availH - fh) / 2), w: fw, h: fh };
}

function sizesFor(width: number): string {
  return `${Math.max(1, Math.round(width))}px`;
}

function layout(): void {
  const u = ui;
  const slide = slides[current];
  if (!u || !slide) return;
  fit = fitFor(slide);
  Object.assign(u.frame.style, {
    left: `${fit.x}px`,
    top: `${fit.y}px`,
    width: `${fit.w}px`,
    height: `${fit.h}px`,
  });
  clampPan();
  applyTransform(false);
}

/** Keep a zoomed image covering the viewport on any axis where it is larger than the viewport. */
function clampPan(): void {
  const u = ui!;
  const vw = u.root.clientWidth;
  const vh = u.root.clientHeight;
  const w = fit.w * scale;
  const h = fit.h * scale;
  const cx = fit.x + fit.w / 2;
  const cy = fit.y + fit.h / 2;
  tx = w <= vw ? 0 : clamp(tx, vw - cx - w / 2, w / 2 - cx);
  ty = h <= vh ? 0 : clamp(ty, vh - cy - h / 2, h / 2 - cy);
}

function applyTransform(animate: boolean): void {
  const u = ui!;
  u.frame.classList.toggle('is-animating', animate && motionAllowed());
  u.frame.style.transform = scale === 1 && !tx && !ty ? '' : `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
  u.frame.classList.toggle('is-zoomed', scale > 1);
  u.zoom.setAttribute('aria-pressed', String(scale > 1));
}

/** Ask srcset for a sharper candidate once a zoom gesture settles. */
function refreshSizes(): void {
  ui?.img.setAttribute('sizes', sizesFor(fit.w * scale));
}

/** Zoom to `next` keeping the point (px, py) under the pointer. */
function zoomAt(next: number, px: number, py: number, animate: boolean): void {
  const cx = fit.x + fit.w / 2;
  const cy = fit.y + fit.h / 2;
  const lx = (px - cx - tx) / scale;
  const ly = (py - cy - ty) / scale;
  scale = next;
  tx = px - cx - lx * scale;
  ty = py - cy - ly * scale;
  clampPan();
  applyTransform(animate);
}

function toggleZoom(px = fit.x + fit.w / 2, py = fit.y + fit.h / 2): void {
  if (!isOpen) return;
  if (scale > 1) {
    scale = 1;
    tx = ty = 0;
    applyTransform(true);
  } else {
    zoomAt(2, px, py, true);
  }
  refreshSizes();
}

function resetZoom(): void {
  scale = 1;
  tx = ty = 0;
  if (ui) applyTransform(false);
}

/** Elements that fade with the overlay (bars and arrows). */
function chrome(u: Ui): HTMLElement[] {
  return [u.top, u.bar, u.prev, u.next];
}

function preloadAround(): void {
  if (slides.length < 2) return;
  for (const step of [1, -1]) {
    const s = slides[(current + step + slides.length) % slides.length];
    if (preloaded.has(s.src)) continue;
    const im = new Image();
    im.decoding = 'async';
    if (s.srcset) {
      im.sizes = sizesFor(fitFor(s).w);
      im.srcset = s.srcset;
    }
    im.src = s.src;
    preloaded.set(s.src, im);
    if (preloaded.size > 12) preloaded.delete(preloaded.keys().next().value!);
  }
}

function load(slide: Slide): void {
  const u = ui!;
  const token = ++loadToken;
  const done = (ok: boolean) => {
    if (token !== loadToken) return;
    window.clearTimeout(spinnerTimer);
    u.spinner.hidden = true;
    u.frame.classList.toggle('is-loaded', ok);
    u.frame.classList.toggle('is-error', !ok);
    if (!ok) return;
    if (!slide.w || !slide.h) {
      slide.w = u.img.naturalWidth;
      slide.h = u.img.naturalHeight;
      layout();
    }
    preloadAround();
  };
  u.frame.classList.remove('is-loaded', 'is-error');
  window.clearTimeout(spinnerTimer);
  // Only show the spinner when loading is actually slow, to avoid a flicker on cached images.
  spinnerTimer = window.setTimeout(() => {
    if (token === loadToken) u.spinner.hidden = false;
  }, 160);
  u.img.sizes = sizesFor(fit.w);
  if (slide.srcset) u.img.srcset = slide.srcset;
  else u.img.removeAttribute('srcset');
  u.img.src = slide.src;
  // decode() also rejects when a newer slide replaced the source mid-flight; the token filters that out.
  u.img.decode().then(
    () => done(true),
    () => done(u.img.complete && u.img.naturalWidth > 0),
  );
}

function show(index: number, dir: -1 | 0 | 1): void {
  const u = ui;
  if (!u || !slides.length) return;
  const n = slides.length;
  current = ((index % n) + n) % n;
  const slide = slides[current];
  u.frame.getAnimations().forEach((a) => a.cancel());
  resetDrag();
  resetZoom();

  u.count.replaceChildren(Object.assign(document.createElement('b'), { textContent: String(current + 1) }), ` / ${n}`);
  u.status.textContent = n > 1 ? `${current + 1} / ${n}` : '';
  u.title.textContent = slide.caption;
  u.sub.textContent = slide.sub;
  u.sub.hidden = !slide.sub;
  u.root.setAttribute('aria-label', slide.caption || u.label);
  u.img.alt = slide.caption;

  // The trigger's own thumbnail is already decoded: show it (soft) while the large image loads.
  const thumb = thumbOf(slide.el);
  const placeholder = thumb?.complete && thumb.naturalWidth ? thumb.currentSrc || thumb.src : '';
  if (placeholder) u.ph.src = placeholder;
  else u.ph.removeAttribute('src');
  u.ph.hidden = !placeholder;

  layout();
  load(slide);
  if (dir && motionAllowed()) {
    u.frame.animate(
      [
        { transform: `translate3d(${dir * 56}px, 0, 0)`, opacity: 0 },
        { transform: 'translate3d(0, 0, 0)', opacity: 1 },
      ],
      { duration: 280, easing: EASE_OUT },
    );
  }
}

function go(dir: -1 | 1): void {
  if (isOpen && slides.length > 1) show(current + dir, dir);
}

/** FLIP start state: the frame scaled and clipped onto the trigger's thumbnail. */
function flipFrom(el: HTMLElement): Keyframe | null {
  const thumb = thumbOf(el);
  if (!thumb || !fit.w || !fit.h) return null;
  const box = thumb.getBoundingClientRect();
  const visible = box.width > 0 && box.bottom > 0 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth;
  if (!visible) return null;
  const style = getComputedStyle(thumb);
  const k = (style.objectFit === 'contain' ? Math.min : Math.max)(box.width / fit.w, box.height / fit.h);
  const dx = box.left + box.width / 2 - (fit.x + fit.w / 2);
  const dy = box.top + box.height / 2 - (fit.y + fit.h / 2);
  // clip-path is applied before the transform, so the inset is in unscaled frame pixels
  const ix = Math.max(0, (fit.w - box.width / k) / 2);
  const iy = Math.max(0, (fit.h - box.height / k) / 2);
  const radius = (parseFloat(style.borderTopLeftRadius) || parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0) / k;
  return {
    transform: `translate3d(${dx}px, ${dy}px, 0) scale(${k})`,
    clipPath: `inset(${iy}px ${ix}px round ${radius}px)`,
  };
}

const RESTING: Keyframe = { transform: 'translate3d(0, 0, 0) scale(1)', clipPath: `inset(0px 0px round ${RADIUS}px)` };

function animateIn(el: HTMLElement): void {
  const u = ui!;
  const motion = motionAllowed();
  u.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motion ? 320 : 160, easing: 'ease-out' });
  for (const c of chrome(u)) {
    c.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: motion ? 260 : 160,
      delay: motion ? 140 : 0,
      easing: 'ease-out',
      fill: 'backwards',
    });
  }
  const from = motion ? flipFrom(el) : null;
  if (from) u.frame.animate([from, RESTING], { duration: 520, easing: EASE_OUT });
  else
    u.frame.animate(
      [
        { opacity: 0, transform: 'scale(0.96)' },
        { opacity: 1, transform: 'scale(1)' },
      ],
      { duration: motion ? 280 : 160, easing: EASE_OUT },
    );
}

function animateOut(dragY: number | undefined): Animation[] {
  const u = ui!;
  const motion = motionAllowed();
  const opacity = getComputedStyle(u.backdrop).opacity;
  const frameNow = u.frame.style.transform || 'translate3d(0, 0, 0)';
  u.frame.getAnimations().forEach((a) => a.cancel());
  const anims = [
    u.backdrop.animate([{ opacity }, { opacity: 0 }], { duration: motion ? 280 : 140, easing: 'ease-out', fill: 'forwards' }),
    ...chrome(u).map((c) => c.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, fill: 'forwards' })),
  ];
  const slide = slides[current];
  const to = motion && scale === 1 && dragY === undefined && slide ? flipFrom(slide.el) : null;
  if (to) {
    anims.push(u.frame.animate([RESTING, to], { duration: 420, easing: EASE_IN_OUT, fill: 'forwards' }));
  } else if (dragY !== undefined) {
    const away = Math.sign(dragY || 1) * window.innerHeight * 0.6;
    anims.push(
      u.frame.animate(
        [
          { transform: frameNow, opacity: 1 },
          { transform: `translate3d(0, ${away}px, 0)`, opacity: 0 },
        ],
        { duration: 240, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' },
      ),
    );
  } else {
    anims.push(
      u.frame.animate(
        [
          { transform: frameNow, opacity: 1 },
          { transform: `${frameNow} scale(0.96)`, opacity: 0 },
        ],
        { duration: motion ? 200 : 140, easing: 'ease-in', fill: 'forwards' },
      ),
    );
  }
  return anims;
}

function open(index: number, el: HTMLElement): void {
  const u = ui!;
  generation++;
  u.root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  isOpen = true;
  trigger = el;
  u.root.hidden = false;
  u.root.classList.toggle('is-single', slides.length < 2);
  pushLayer(u.root);
  show(index, 0);
  animateIn(el);
  u.close.focus({ preventScroll: true });
}

/** Open the lightbox on a trigger element (its gallery is collected from the DOM). */
export function openLightbox(el: HTMLElement): void {
  if (!ui) return;
  const list = galleryFor(el);
  const index = list.findIndex((s) => s.el === el);
  if (index < 0) return;
  slides = list;
  if (isOpen) {
    ui.root.classList.toggle('is-single', slides.length < 2);
    show(index, 0);
  } else {
    open(index, el);
  }
}

interface CloseOptions {
  /** Skip the animation (page swap, re-init). */
  instant?: boolean;
  /** Return focus to the element that opened the lightbox (default true). */
  restoreFocus?: boolean;
  /** Vertical drag distance when closed by a swipe. */
  dragY?: number;
}

export function closeLightbox({ instant = false, restoreFocus = true, dragY }: CloseOptions = {}): void {
  const u = ui;
  if (!u || !isOpen) return;
  isOpen = false;
  const gen = ++generation;
  const focusTarget = restoreFocus ? trigger : null;
  trigger = null;
  pointers.clear();
  g.mode = 'idle';
  window.clearTimeout(spinnerTimer);
  const finish = () => {
    if (gen !== generation) return;
    u.root.hidden = true;
    u.root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    resetDrag();
    resetZoom();
    u.frame.classList.remove('is-loaded', 'is-error');
    u.img.removeAttribute('src');
    u.img.removeAttribute('srcset');
    loadToken++;
    popLayer(u.root);
    if (focusTarget?.isConnected) focusTarget.focus({ preventScroll: true });
  };
  if (instant) finish();
  else void settled(animateOut(dragY)).then(finish);
}

/* ---------------- pointer gestures: tap, pan, swipe, pinch ---------------- */

/** Translate the frame while a swipe/dismiss drag is in progress. */
function setDrag(x: number, y: number): void {
  const u = ui!;
  u.frame.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  if (y) {
    const fade = 1 - Math.min(0.85, Math.abs(y) / (window.innerHeight * 0.55));
    u.backdrop.style.opacity = String(fade);
    for (const c of chrome(u)) c.style.opacity = String(fade);
  }
}

function resetDrag(): void {
  const u = ui;
  if (!u) return;
  u.frame.classList.remove('is-dragging');
  u.backdrop.style.removeProperty('opacity');
  for (const c of chrome(u)) c.style.removeProperty('opacity');
}

/** Animate a released swipe/dismiss drag back to rest. */
function snapBack(): void {
  const u = ui!;
  const from = u.frame.style.transform;
  const opacity = u.backdrop.style.opacity || '1';
  u.frame.style.transform = '';
  resetDrag();
  if (!motionAllowed() || !from) return;
  u.frame.animate([{ transform: from }, { transform: 'translate3d(0, 0, 0)' }], { duration: 320, easing: EASE_OUT });
  u.backdrop.animate([{ opacity }, { opacity: 1 }], { duration: 320, easing: EASE_OUT });
}

/** A tap that closes the lightbox must not "click through" to the page underneath. */
function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener('click', stop, { capture: true, once: true });
  window.setTimeout(() => document.removeEventListener('click', stop, { capture: true }), 400);
}

function pinchPoints(): [{ x: number; y: number }, { x: number; y: number }] {
  const [a, b] = [...pointers.values()];
  return [a, b];
}

function startPinch(): void {
  const [a, b] = pinchPoints();
  if (g.mode === 'swipe' || g.mode === 'dismiss') {
    ui!.frame.style.transform = '';
    resetDrag();
  }
  g.mode = 'pinch';
  g.dist0 = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  g.scale0 = scale;
  g.mx0 = (a.x + b.x) / 2;
  g.my0 = (a.y + b.y) / 2;
  g.tx0 = tx;
  g.ty0 = ty;
  ui!.frame.classList.add('is-dragging');
}

function updatePinch(): void {
  const [a, b] = pinchPoints();
  const next = clamp((g.scale0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.dist0, 0.8, MAX_ZOOM);
  const cx = fit.x + fit.w / 2;
  const cy = fit.y + fit.h / 2;
  // keep the point that was under the fingers' midpoint under the (moving) midpoint
  const lx = (g.mx0 - cx - g.tx0) / g.scale0;
  const ly = (g.my0 - cy - g.ty0) / g.scale0;
  scale = next;
  tx = (a.x + b.x) / 2 - cx - lx * next;
  ty = (a.y + b.y) / 2 - cy - ly * next;
  applyTransform(false);
}

function endPinch(): void {
  ui!.frame.classList.remove('is-dragging');
  if (scale <= 1.02) {
    scale = 1;
    tx = ty = 0;
  } else {
    clampPan();
  }
  applyTransform(true);
  refreshSizes();
}

function onPointerDown(e: PointerEvent): void {
  const u = ui;
  if (!u || !isOpen || (e.pointerType === 'mouse' && e.button !== 0)) return;
  // No native image drag or text selection while we handle the gesture.
  e.preventDefault();
  u.stage.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    startPinch();
    return;
  }
  if (pointers.size > 2) return;
  Object.assign(g, {
    mode: 'pending',
    x0: e.clientX,
    y0: e.clientY,
    tx0: tx,
    ty0: ty,
    onImage: u.frame.contains(e.target as Node),
    touch: e.pointerType !== 'mouse',
    lastX: e.clientX,
    lastY: e.clientY,
    lastT: e.timeStamp,
    vx: 0,
    vy: 0,
  });
}

function onPointerMove(e: PointerEvent): void {
  const p = pointers.get(e.pointerId);
  if (!p || !ui) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (g.mode === 'pinch') {
    if (pointers.size >= 2) updatePinch();
    return;
  }
  const dt = e.timeStamp - g.lastT;
  if (dt > 0) {
    // smoothed release velocity in px/ms
    g.vx = 0.7 * ((e.clientX - g.lastX) / dt) + 0.3 * g.vx;
    g.vy = 0.7 * ((e.clientY - g.lastY) / dt) + 0.3 * g.vy;
  }
  g.lastX = e.clientX;
  g.lastY = e.clientY;
  g.lastT = e.timeStamp;
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;
  if (g.mode === 'pending') {
    if (Math.hypot(dx, dy) < (g.touch ? TAP_SLOP_TOUCH : TAP_SLOP_MOUSE)) return;
    if (scale > 1) g.mode = 'pan';
    else if (!g.touch) g.mode = 'idle'; // mouse drags at zoom 1 do nothing
    else g.mode = Math.abs(dx) > Math.abs(dy) ? 'swipe' : 'dismiss';
    if (g.mode !== 'idle') ui.frame.classList.add('is-dragging');
  }
  if (g.mode === 'pan') {
    tx = g.tx0 + dx;
    ty = g.ty0 + dy;
    clampPan();
    applyTransform(false);
  } else if (g.mode === 'swipe') {
    setDrag(slides.length > 1 ? dx : dx * 0.25, 0);
  } else if (g.mode === 'dismiss') {
    setDrag(dx * 0.15, dy);
  }
}

function onPointerUp(e: PointerEvent): void {
  if (!pointers.delete(e.pointerId) || !ui) return;
  const u = ui;
  if (g.mode === 'pinch') {
    if (pointers.size === 1) {
      // one finger left: continue as a pan from where it is now
      const [rest] = [...pointers.values()];
      Object.assign(g, { mode: scale > 1 ? 'pan' : 'idle', x0: rest.x, y0: rest.y, tx0: tx, ty0: ty });
    } else if (!pointers.size) {
      g.mode = 'idle';
      endPinch();
    }
    return;
  }
  if (pointers.size) return;
  const mode = g.mode;
  g.mode = 'idle';
  const dx = e.clientX - g.x0;
  const dy = e.clientY - g.y0;
  const cancelled = e.type === 'pointercancel';
  if (mode === 'pending' && !cancelled) {
    if (g.onImage) {
      toggleZoom(e.clientX, e.clientY);
    } else {
      if (g.touch) swallowNextClick();
      closeLightbox();
    }
  } else if (mode === 'pan') {
    u.frame.classList.remove('is-dragging');
    refreshSizes();
  } else if (mode === 'swipe') {
    const far = Math.abs(dx) > Math.min(110, window.innerWidth * 0.22);
    const flick = Math.abs(g.vx) > 0.45 && Math.sign(g.vx) === Math.sign(dx);
    if (!cancelled && slides.length > 1 && (far || flick)) go(dx < 0 ? 1 : -1);
    else snapBack();
  } else if (mode === 'dismiss') {
    const far = Math.abs(dy) > Math.min(160, window.innerHeight * 0.2);
    const flick = Math.abs(g.vy) > 0.5 && Math.sign(g.vy) === Math.sign(dy);
    if (!cancelled && (far || flick)) closeLightbox({ dragY: dy });
    else snapBack();
  }
}

function onWheel(e: WheelEvent): void {
  if (!isOpen) return;
  e.preventDefault();
  const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1;
  if (e.ctrlKey) {
    // trackpad pinch (and Ctrl+wheel) zooms around the cursor
    zoomAt(clamp(scale * Math.exp(-e.deltaY * unit * 0.01), 1, MAX_ZOOM), e.clientX, e.clientY, false);
    refreshSizes();
  } else if (scale > 1) {
    tx -= e.deltaX * unit;
    ty -= e.deltaY * unit;
    clampPan();
    applyTransform(false);
  }
}

/* ---------------- document-level wiring ---------------- */

function onDocumentClick(e: MouseEvent): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const el = (e.target as Element | null)?.closest?.('[data-lb]');
  if (!(el instanceof HTMLElement) || !ui || ui.root.contains(el)) return;
  e.preventDefault();
  openLightbox(el);
}

function onKeydown(e: KeyboardEvent): void {
  const u = ui;
  if (!u) return;
  if (!isOpen) {
    // Enter/Space on a non-native trigger (e.g. a div with tabindex) behaves like a click.
    const t = e.target;
    if (
      (e.key === 'Enter' || e.key === ' ') &&
      t instanceof HTMLElement &&
      t.matches('[data-lb]') &&
      !t.matches('a[href], button, input, select, textarea, summary')
    ) {
      e.preventDefault();
      openLightbox(t);
    }
    return;
  }
  if (!isTopLayer(u.root) || e.defaultPrevented) return;
  switch (e.key) {
    case 'Escape':
      e.preventDefault();
      closeLightbox();
      return;
    case 'ArrowLeft':
      e.preventDefault();
      go(-1);
      return;
    case 'ArrowRight':
      e.preventDefault();
      go(1);
      return;
    case 'Home':
      e.preventDefault();
      if (current !== 0) show(0, -1);
      return;
    case 'End':
      e.preventDefault();
      if (current !== slides.length - 1) show(slides.length - 1, 1);
      return;
    case 'Tab':
      trapFocus(e, u.root);
      return;
  }
  // e.code keeps Z working on the Russian layout (where the key types "я")
  if (e.code === 'KeyZ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    toggleZoom();
  }
}

function onOpenRequest(e: Event): void {
  const { group, id } = (e as CustomEvent<{ group?: string; id?: string }>).detail ?? {};
  if (!group || !id) return;
  const matches = [
    ...document.querySelectorAll<HTMLElement>(`[data-lb][data-lb-group="${CSS.escape(group)}"][data-lb-id="${CSS.escape(id)}"]`),
  ];
  const el = matches.find(isShown) ?? matches[0];
  if (el) openLightbox(el);
}

function onResize(): void {
  if (!isOpen || resizeFrame) return;
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    resetZoom();
    layout();
    refreshSizes();
  });
}

function bindUi(u: Ui): void {
  u.stage.addEventListener('pointerdown', onPointerDown);
  u.stage.addEventListener('pointermove', onPointerMove);
  u.stage.addEventListener('pointerup', onPointerUp);
  u.stage.addEventListener('pointercancel', onPointerUp);
  u.root.addEventListener('wheel', onWheel, { passive: false });
  u.close.addEventListener('click', () => closeLightbox());
  u.zoom.addEventListener('click', () => toggleZoom());
  u.prev.addEventListener('click', () => go(-1));
  u.next.addEventListener('click', () => go(1));
}

/** Wire the lightbox for the current page. Safe to call on every `astro:page-load`. */
export function initLightbox(): void {
  if (!bound) {
    bound = true;
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('lightbox:open', onOpenRequest);
    // A navigation while open (e.g. browser Back) must not leave the page locked.
    document.addEventListener('astro:before-swap', () => closeLightbox({ instant: true, restoreFocus: false }));
    window.addEventListener('resize', onResize);
  }
  const root = document.getElementById('lightbox');
  if (!root || root === ui?.root) return;
  closeLightbox({ instant: true, restoreFocus: false });
  ui = collectUi(root);
  if (ui) bindUi(ui);
}
