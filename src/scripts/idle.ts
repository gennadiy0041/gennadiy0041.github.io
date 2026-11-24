/**
 * Scheduling helpers that keep start-up work off the critical path.
 * Nothing decorative may run inside the page-load task: it waits for the load event and an idle slot,
 * or for the visitor's first input (moving the mouse, scrolling, typing), whichever comes first.
 */
type IdleWindow = Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };

/** Run in the next idle slot (or after `timeout` ms at the latest). */
export function whenIdle(fn: () => void, timeout = 2000) {
  const ric = (window as IdleWindow).requestIdleCallback;
  if (ric) ric(fn, { timeout });
  else setTimeout(fn, 60);
}

/** Run once the load event has fired (immediately on client-side navigations, where it already has). */
export function afterLoad(fn: () => void) {
  if (document.readyState === 'complete') fn();
  else window.addEventListener('load', () => fn(), { once: true });
}

const INPUTS = ['pointermove', 'pointerdown', 'wheel', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Run `fn` on the first user input, or `delay` ms after load (in an idle slot) if there is none.
 * Returns a cancel function.
 */
export function onFirstInput(fn: () => void, delay: number): () => void {
  let done = false;
  let cancelled = false;
  let timer = 0;
  const off = () => {
    for (const type of INPUTS) window.removeEventListener(type, run, true);
    clearTimeout(timer);
  };
  // the input event itself stays fast: the work goes to the next idle slot
  const run = () => {
    if (done) return;
    done = true;
    off();
    whenIdle(() => {
      if (!cancelled) fn();
    }, 300);
  };
  for (const type of INPUTS) window.addEventListener(type, run, { capture: true, passive: true });
  afterLoad(() => {
    if (!done) timer = window.setTimeout(run, delay);
  });
  return () => {
    done = true;
    cancelled = true;
    off();
  };
}

/** Run `fn` (in an idle slot) on the first mouse or pen movement; touch never triggers it. Returns a cancel function. */
export function onFirstPointer(fn: () => void): () => void {
  let cancelled = false;
  const move = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    window.removeEventListener('pointermove', move, true);
    whenIdle(() => {
      if (!cancelled) fn();
    }, 300);
  };
  window.addEventListener('pointermove', move, { capture: true, passive: true });
  return () => {
    cancelled = true;
    window.removeEventListener('pointermove', move, true);
  };
}

/** Yield to the browser between chunks of start-up work so no single task gets long. */
export const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
