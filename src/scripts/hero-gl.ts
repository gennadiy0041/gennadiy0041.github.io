/**
 * Live WebGL background of the hero: an animated topographic map whose contours ring around the cursor.
 *
 * Mount it only on the rich (desktop, motion-allowed) tier, after first paint:
 *   const { mountHeroGL } = await import('../scripts/hero-gl');
 *   const hero = mountHeroGL(canvas);   // later: hero.destroy()
 *
 * The canvas must be sized by CSS (e.g. `position:absolute; inset:0; width:100%; height:100%;
 * pointer-events:none`); the module only sets its drawing-buffer size. While it renders, the canvas
 * carries data-hero-gl="ready" ("lost" while the GPU context is gone) so CSS can fade it in over the poster.
 * Without WebGL2 nothing happens and the returned handle is a no-op.
 */
import {
  CONTEXT_ATTRIBUTES,
  DEFAULT_LOOK,
  POSTER_FRAME,
  createHeroCore,
  type HeroCore,
  type HeroFrame,
  type HeroLook,
  type RGB,
} from './hero-gl/core';

export type { RGB };

export interface HeroGLOptions {
  /** Colour the contours bloom into near the cursor. Default: --accent #d0ff4a. */
  accent?: RGB;
  /** Colour of the corner glow. Default: --glow #7c5cff. */
  glow?: RGB;
  /** Overall opacity multiplier, clamped to 0..2. Default 1. */
  intensity?: number;
}

export interface HeroGLHandle {
  /** Stop rendering, detach every listener/observer and release the GPU context. The canvas is not reusable afterwards. */
  destroy(): void;
}

const MAX_DPR = 1.5;
/** Above this many device pixels the scene is shaded at a reduced resolution and CSS-scaled up... */
const LARGE_AREA = 1_000_000;
const LARGE_SCALE = 0.75;
/** ...and never more than this many pixels per frame (the scale bottoms out at 0.5). */
const MAX_PIXELS = 2_400_000;
/** Skip rAF ticks closer than this: ~60 fps even on 120/144 Hz screens, the motion is slow anyway. */
const MIN_FRAME_MS = 1000 / 75;
/** Exponential approach rates, 1/s: pointer inertia, hill/bloom rising, hill/bloom fading. */
const FOLLOW_RATE = 5;
const RISE_RATE = 3;
const FADE_RATE = 1.25;
/** The lime bloom is full while the pointer moves and settles to this level once it rests (e.g. while reading). */
const REST_BLOOM = 0.45;
const MOVING_MS = 350;

const NOOP: HeroGLHandle = { destroy() {} };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function mountHeroGL(canvas: HTMLCanvasElement, opts: HeroGLOptions = {}): HeroGLHandle {
  const look: HeroLook = {
    accent: opts.accent ?? DEFAULT_LOOK.accent,
    glow: opts.glow ?? DEFAULT_LOOK.glow,
    intensity: Number.isFinite(opts.intensity) ? clamp(opts.intensity as number, 0, 2) : DEFAULT_LOOK.intensity,
  };

  // Claim the context with the final attributes (OGL reuses it); no WebGL2 -> keep the static fallback.
  const probe = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
  if (!probe || probe.isContextLost()) return NOOP;

  const dpr = () => Math.min(window.devicePixelRatio || 1, MAX_DPR);
  let core: HeroCore;
  try {
    core = createHeroCore(canvas, look, dpr());
  } catch (error) {
    console.warn('[hero-gl]', error);
    probe.getExtension('WEBGL_lose_context')?.loseContext();
    return NOOP;
  }

  // Start from the poster's frame: a seamless hand-off, after which the cursor hill eases out (or follows the pointer).
  const frame: HeroFrame = { ...POSTER_FRAME };
  let targetX = frame.pointerX;
  let targetY = frame.pointerY;
  let clientX = 0;
  let clientY = 0;
  let movedAt = -Infinity;
  let hasPointer = false;
  let rect: DOMRect | null = null; // canvas box in the viewport; dropped on scroll/resize
  let cssWidth = 0;
  let cssHeight = 0;
  let inView = true;
  let lost = false;
  let destroyed = false;
  let raf = 0;
  let last = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const render = () => {
    if (lost || !cssWidth || !cssHeight) return;
    core.draw(frame);
    canvas.dataset.heroGl = 'ready';
  };

  const resize = () => {
    const ratio = dpr();
    const area = cssWidth * cssHeight * ratio * ratio;
    const scale = area > LARGE_AREA ? clamp(Math.sqrt(MAX_PIXELS / area), 0.5, LARGE_SCALE) : 1;
    core.resize(cssWidth, cssHeight, ratio * scale);
  };

  /** Ease value towards goal: frame-rate independent exponential approach. */
  const approach = (value: number, goal: number, dt: number) =>
    value + (goal - value) * (1 - Math.exp(-dt * (goal > value ? RISE_RATE : FADE_RATE)));

  const step = (dt: number, now: number) => {
    frame.time += dt;
    let inside = false;
    if (hasPointer) {
      rect ??= canvas.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      inside = x >= 0 && x <= 1 && y >= 0 && y <= 1;
      if (inside) {
        targetX = x;
        targetY = y;
        // Re-entering after the hill has faded: raise it under the cursor instead of sliding it across.
        if (frame.hover < 0.02) {
          frame.pointerX = x;
          frame.pointerY = y;
        }
      }
    }
    const follow = 1 - Math.exp(-dt * FOLLOW_RATE);
    frame.pointerX += (targetX - frame.pointerX) * follow;
    frame.pointerY += (targetY - frame.pointerY) * follow;
    frame.hover = approach(frame.hover, inside ? 1 : 0, dt);
    frame.bloom = approach(frame.bloom, inside ? (now - movedAt < MOVING_MS ? 1 : REST_BLOOM) : 0, dt);
  };

  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    if (last && now - last < MIN_FRAME_MS) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
    last = now;
    step(dt, now);
    render();
  };

  /** Run the loop only while it can be seen: on screen, tab visible, context alive, motion allowed. */
  const sync = () => {
    const run = !destroyed && !lost && inView && !document.hidden && !reducedMotion.matches && cssWidth > 0 && cssHeight > 0;
    if (run && !raf) {
      last = 0;
      raf = requestAnimationFrame(tick);
    } else if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const resizeObserver = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1].contentRect;
    cssWidth = box.width;
    cssHeight = box.height;
    rect = null;
    if (cssWidth && cssHeight) {
      resize();
      render(); // a resized buffer is blank: redraw before this frame paints, even while paused
    }
    sync();
  });
  const intersectionObserver = new IntersectionObserver((entries) => {
    inView = entries[entries.length - 1].isIntersecting;
    sync();
  });

  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return; // touch has no hover: no hill under a finger
    clientX = event.clientX;
    clientY = event.clientY;
    movedAt = event.timeStamp;
    hasPointer = true;
  };
  const onPointerOut = (event: PointerEvent) => {
    if (!event.relatedTarget) hasPointer = false; // left the window
  };
  const onScroll = () => {
    rect = null;
  };
  const onContextLost = (event: Event) => {
    event.preventDefault(); // allow the browser to restore it
    lost = true;
    canvas.dataset.heroGl = 'lost';
    sync();
  };
  const onContextRestored = () => {
    try {
      core = createHeroCore(canvas, look, dpr());
      lost = false;
      if (cssWidth && cssHeight) {
        resize();
        render();
      }
    } catch (error) {
      console.warn('[hero-gl]', error);
    }
    sync();
  };

  resizeObserver.observe(canvas);
  intersectionObserver.observe(canvas);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerout', onPointerOut, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', sync);
  reducedMotion.addEventListener('change', sync);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      sync();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerout', onPointerOut);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', sync);
      reducedMotion.removeEventListener('change', sync);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      if (!lost) core.dispose();
      core.gl.getExtension('WEBGL_lose_context')?.loseContext();
      delete canvas.dataset.heroGl;
    },
  };
}
