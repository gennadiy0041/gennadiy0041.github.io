/**
 * Command palette: Ctrl/⌘+K, "/" outside text fields, or a click on any [data-palette-open].
 *
 * Searches projects and achievements from the #site-index JSON (buildClientIndex in
 * src/lib/data.ts) and the current page's sections: [data-section][id][data-section-label].
 *
 * `initPalette()` is idempotent and meant for every `astro:page-load`: document listeners are
 * bound once; the palette root, the index and the sections are re-read for the current page.
 *
 * Choosing an achievement that is on the current page dispatches on document:
 *   timeline:reveal { id }                        so a filtered-out row can be shown again
 *   lightbox:open   { group: 'achievements', id } when the achievement has a document image
 * and flashes the row (#a-<id>) with the `is-flash` class for 1.6 s (styled by the row's owner).
 */
import { navigate } from 'astro:transitions/client';
import { prefetch } from 'astro:prefetch';
import type { ClientIndex } from '../lib/data';
import { prepare, search, segments, switchLayout, tokenize, type PreparedDoc, type Range, type SearchField } from '../lib/search';
import { getLenis, hasOpenLayer, isTopLayer, motionAllowed, popLayer, pushLayer, settled, trapFocus } from './lightbox';

type Kind = 'project' | 'achievement' | 'section';
type Field = 't' | 'alt' | 's' | 'r' | 'i' | 'e' | 'd' | 'gl' | 'lv' | 'st' | 'id';
type Ranges = Partial<Record<Field, Range[]>>;

interface Entry {
  kind: Kind;
  id: string;
  title: string;
  /** Searchable text by field (current language, plus `alt` = the title/tagline in the other one). */
  text: Partial<Record<Field, string>>;
  /** Fields shown on the secondary line, in order. */
  meta: Field[];
  href?: string;
  thumb?: string;
  /** Category group label, shown as a badge. */
  badge?: string;
  podium?: boolean;
  /** The achievement has a document image, i.e. it can open in the lightbox. */
  doc?: boolean;
  /** Section element on the current page. */
  el?: HTMLElement;
}

interface Row {
  entry: Entry;
  ranges: Ranges;
}

interface Group {
  kind: Kind;
  rows: Row[];
}

interface Ui {
  root: HTMLElement;
  backdrop: HTMLElement;
  panel: HTMLElement;
  input: HTMLInputElement;
  close: HTMLButtonElement;
  scroller: HTMLElement;
  list: HTMLElement;
  empty: HTMLElement;
  emptyQuery: HTMLElement;
  live: HTMLElement;
  labels: Record<Kind, string>;
  emptyText: string;
}

const WEIGHTS: Record<Field, number> = { t: 1, alt: 0.92, s: 0.8, st: 0.75, e: 0.72, r: 0.72, i: 0.66, d: 0.66, gl: 0.6, id: 0.6, lv: 0.55 };
/** Fields that are not on screen; when one of them is what matched, it joins the meta line. */
const HIDDEN_FIELDS: Field[] = ['alt', 'e', 's', 'st', 'lv', 'id'];
const KIND_ORDER: Kind[] = ['project', 'achievement', 'section'];
const LIMIT: Record<Kind, number> = { project: 10, achievement: 30, section: 12 };
const DEFAULTS: Record<Kind, number> = { project: 5, achievement: 5, section: Infinity };
const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const DURATION = 180;
const FLASH_MS = 1600;
const FOCUSABLE = 'a[href], button, input, select, textarea, [tabindex]';

const ICONS: Record<Kind, string> = {
  project:
    '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3.5 4 7.75l8 4.25 8-4.25L12 3.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m4 12 8 4.25L20 12M4 16.25l8 4.25 8-4.25" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  achievement:
    '<svg viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="9.5" r="5.25" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m8.6 13.6-1.4 6.9 4.8-2.4 4.8 2.4-1.4-6.9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  section:
    '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M5 9h14M5 15h14M10.5 4 8.5 20M15.5 4l-2 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
};
const STAR =
  '<svg viewBox="0 0 24 24" width="11" height="11" aria-hidden="true"><path d="m12 3.2 2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6L3.4 9.5l6-.8L12 3.2Z" fill="currentColor"/></svg>';

let ui: Ui | null = null;
let bound = false;
let isOpen = false;
let generation = 0;
/** The #site-index element the prepared documents were built from (one per page). */
let indexSource: Element | null = null;
let indexEntries: Entry[] = [];
let indexDocs: PreparedDoc<Entry, Field>[] = [];
let sectionEntries: Entry[] = [];
let sectionDocs: PreparedDoc<Entry, Field>[] = [];
let rows: Row[] = [];
let active = -1;
let returnFocus: HTMLElement | null = null;
/** Achievement to reveal once navigation to its page finishes. */
let pendingReveal: { id: string; doc: boolean } | null = null;
const thumbs = new Map<string, HTMLImageElement>();
const flashTimers = new WeakMap<Element, number>();

/* ---------------- data ---------------- */

function toDoc(entry: Entry) {
  const fields: SearchField<Field>[] = [];
  for (const key of Object.keys(entry.text) as Field[]) {
    const text = entry.text[key];
    if (text) fields.push({ key, text, weight: WEIGHTS[key] });
  }
  return { item: entry, fields };
}

function readIndex(): void {
  const source = document.getElementById('site-index');
  if (source === indexSource) return;
  indexSource = source;
  let data: Partial<ClientIndex> = {};
  try {
    data = JSON.parse(source?.textContent || '{}') as ClientIndex;
  } catch {
    // A broken index only disables search results; sections still work.
  }
  indexEntries = [
    ...(data.projects ?? []).map(
      (p): Entry => ({
        kind: 'project',
        id: p.id,
        title: p.t,
        href: p.href,
        text: { t: p.t, s: p.s, alt: p.alt, e: p.e, st: p.st },
        meta: ['s', 'e'],
      }),
    ),
    ...(data.achievements ?? []).map(
      (a): Entry => ({
        kind: 'achievement',
        id: a.id,
        title: a.t,
        href: a.href,
        thumb: a.thumb,
        badge: a.gl,
        podium: a.p,
        doc: a.img,
        text: { t: a.t, alt: a.alt, r: a.r, i: a.i, e: a.e, d: a.d, gl: a.gl, lv: a.lv },
        meta: ['d', 'r', 'i'],
      }),
    ),
  ];
  indexDocs = prepare(indexEntries.map(toDoc));
}

function readSections(): void {
  sectionEntries = [...document.querySelectorAll<HTMLElement>('[data-section][id]')]
    .filter((el) => el.dataset.sectionLabel)
    .map((el) => {
      const label = el.dataset.sectionLabel ?? '';
      return { kind: 'section', id: el.id, title: label, el, text: { t: label, id: el.id }, meta: [] };
    });
  sectionDocs = prepare(sectionEntries.map(toDoc));
}

function compute(query: string): Group[] {
  const byKind = (kind: Kind) => (row: Row) => row.entry.kind === kind;
  if (!tokenize(query).length) {
    // No query: the first projects (bento order), the newest achievements, every section.
    const all = [...indexEntries, ...sectionEntries].map((entry): Row => ({ entry, ranges: {} }));
    return KIND_ORDER.map((kind) => ({ kind, rows: all.filter(byKind(kind)).slice(0, DEFAULTS[kind]) })).filter(
      (g) => g.rows.length,
    );
  }
  const docs = [...indexDocs, ...sectionDocs];
  let hits = search(docs, query);
  // Typed with the wrong keyboard layout ("[frfnjy" for "хакатон")? Try the other one.
  if (!hits.length) {
    const swapped = switchLayout(query);
    if (swapped !== query.toLowerCase()) hits = search(docs, swapped);
  }
  const all = hits.map((h): Row => ({ entry: h.item, ranges: h.ranges }));
  const groups = KIND_ORDER.map((kind) => ({ kind, rows: all.filter(byKind(kind)).slice(0, LIMIT[kind]) })).filter(
    (g) => g.rows.length,
  );
  // Hits are sorted best-first, so the group holding the best hit leads and Enter takes the best match.
  const rank = (g: Group) => all.indexOf(g.rows[0]);
  return groups.sort((a, b) => rank(a) - rank(b));
}

/* ---------------- rendering ---------------- */

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  attrs: Record<string, string> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function highlighted(text: string, ranges?: Range[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const s of segments(text, ranges)) frag.append(s.mark ? h('mark', '', {}, s.text) : s.text);
  return frag;
}

/** Thumbnails are cached so re-rendering on every keystroke never re-decodes (no flicker). */
function thumbImg(src: string): HTMLImageElement {
  let img = thumbs.get(src);
  if (!img) {
    img = h('img', 'pal-thumb', { src, alt: '', width: '40', height: '40', decoding: 'async', draggable: 'false' });
    thumbs.set(src, img);
  }
  return img;
}

function metaLine(entry: Entry, ranges: Ranges): HTMLElement | null {
  const parts = entry.meta.filter((f) => entry.text[f]);
  // A hit in an off-screen field (other-language title, event, stack…) goes first, so it is never truncated.
  const extra = HIDDEN_FIELDS.find((f) => ranges[f]?.length && entry.text[f] && !parts.includes(f));
  if (extra) parts.unshift(extra);
  if (!parts.length) return null;
  const line = h('span', 'pal-meta');
  parts.forEach((f, i) => {
    if (i) line.append(h('span', 'pal-dot', { 'aria-hidden': 'true' }, '·'));
    const part = h('span');
    part.append(highlighted(entry.text[f] ?? '', ranges[f]));
    line.append(part);
  });
  return line;
}

function renderRow({ entry, ranges }: Row, index: number): HTMLElement {
  const row = h('div', 'pal-item', {
    id: `pal-opt-${index}`,
    role: 'option',
    'aria-selected': 'false',
    'data-index': String(index),
    'data-kind': entry.kind,
  });
  const lead = h('span', 'pal-lead', { 'aria-hidden': 'true' });
  if (entry.thumb) lead.append(thumbImg(entry.thumb));
  else lead.innerHTML = ICONS[entry.kind];

  const body = h('span', 'pal-body');
  const title = h('span', 'pal-title');
  title.append(highlighted(entry.title, ranges.t));
  body.append(title);
  const meta = metaLine(entry, ranges);
  if (meta) body.append(meta);
  row.append(lead, body);

  if (entry.badge) {
    const badge = h('span', entry.podium ? 'pal-badge is-podium' : 'pal-badge');
    if (entry.podium) badge.innerHTML = STAR;
    badge.append(highlighted(entry.badge, ranges.gl));
    row.append(badge);
  }
  row.append(h('span', 'pal-enter', { 'aria-hidden': 'true' }, '↵'));
  return row;
}

function render(): void {
  const u = ui;
  if (!u) return;
  const query = u.input.value;
  const groups = compute(query);
  rows = groups.flatMap((g) => g.rows);
  let index = 0;
  u.list.replaceChildren(
    ...groups.map((g) => {
      const headId = `pal-g-${g.kind}`;
      const group = h('div', 'pal-group', { role: 'group', 'aria-labelledby': headId });
      const head = h('div', 'pal-ghead', { id: headId, role: 'presentation' });
      head.append(h('span', '', {}, u.labels[g.kind]), h('span', 'pal-gcount', { 'aria-hidden': 'true' }, String(g.rows.length)));
      group.append(head, ...g.rows.map((row) => renderRow(row, index++)));
      return group;
    }),
  );
  const empty = rows.length === 0;
  u.list.hidden = empty;
  u.empty.hidden = !empty;
  u.emptyQuery.textContent = `«${query.trim()}»`;
  u.live.textContent = empty ? u.emptyText : '';
  u.input.setAttribute('aria-expanded', String(!empty));
  u.scroller.scrollTop = 0;
  setActive(empty ? -1 : 0);
}

function ensureVisible(option: HTMLElement): void {
  const sc = ui!.scroller;
  const pad = 6;
  // The first option of a group brings its heading into view too.
  const prev = option.previousElementSibling;
  const anchor = prev instanceof HTMLElement && prev.classList.contains('pal-ghead') ? prev : option;
  const top = anchor.offsetTop - pad;
  const bottom = option.offsetTop + option.offsetHeight + pad;
  if (top < sc.scrollTop) sc.scrollTop = top;
  else if (bottom > sc.scrollTop + sc.clientHeight) sc.scrollTop = bottom - sc.clientHeight;
}

function setActive(index: number, reveal = true): void {
  const u = ui!;
  u.list.querySelector('[aria-selected="true"]')?.setAttribute('aria-selected', 'false');
  active = index;
  const option = index >= 0 ? u.list.querySelector<HTMLElement>(`#pal-opt-${index}`) : null;
  if (!option) {
    u.input.removeAttribute('aria-activedescendant');
    return;
  }
  option.setAttribute('aria-selected', 'true');
  u.input.setAttribute('aria-activedescendant', option.id);
  if (reveal) ensureVisible(option);
  // Warm the next page up while the user is still deciding.
  const entry = rows[index]?.entry;
  if (entry?.href && (entry.kind === 'project' || !document.getElementById(`a-${entry.id}`))) prefetch(entry.href);
}

/* ---------------- choosing a result ---------------- */

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

/** Resolve once the window stops scrolling (works for native smooth scroll without `scrollend`). */
async function scrollSettled(limit = 1600): Promise<void> {
  const start = performance.now();
  let last = window.scrollY;
  let still = 0;
  while (still < 6 && performance.now() - start < limit) {
    await nextFrame();
    still = window.scrollY === last ? still + 1 : 0;
    last = window.scrollY;
  }
}

/** Smooth-scroll (Lenis when present) so `el` sits under the fixed nav or in the middle of the viewport. */
async function scrollToElement(el: HTMLElement, align: 'start' | 'center'): Promise<void> {
  const lenis = getLenis();
  // A filter reset may have just changed the page height; Lenis clamps targets to its cached limit.
  lenis?.resize();
  const rect = el.getBoundingClientRect();
  const navSpace = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const offset = align === 'center' ? Math.max(navSpace, (window.innerHeight - rect.height) / 2) : navSpace;
  const y = Math.max(0, window.scrollY + rect.top - offset);
  if (Math.abs(y - window.scrollY) < 2) return;
  const smooth = motionAllowed();
  if (lenis) {
    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, 2000);
      lenis.scrollTo(y, {
        immediate: !smooth,
        force: true,
        onComplete: () => {
          window.clearTimeout(timer);
          resolve();
        },
      });
    });
    return;
  }
  window.scrollTo({ top: y, behavior: smooth ? 'smooth' : 'instant' });
  if (smooth) await scrollSettled();
}

/** Move focus to a destination (skip-link style) without drawing a focus ring around a whole section. */
function focusDestination(el: HTMLElement): void {
  if (!el.matches(FOCUSABLE)) {
    el.setAttribute('tabindex', '-1');
    el.setAttribute('data-palette-focus', '');
  }
  el.focus({ preventScroll: true });
}

function flash(el: HTMLElement): void {
  window.clearTimeout(flashTimers.get(el));
  el.classList.remove('is-flash');
  void el.offsetWidth; // restart the animation when the same row is chosen twice
  el.classList.add('is-flash');
  flashTimers.set(
    el,
    window.setTimeout(() => el.classList.remove('is-flash'), FLASH_MS),
  );
}

/** Bring an achievement row on this page into view, flash it and open its document. */
async function reveal(id: string, doc: boolean): Promise<void> {
  const row = document.getElementById(`a-${id}`);
  if (!row) return;
  document.dispatchEvent(new CustomEvent('timeline:reveal', { detail: { id } }));
  // Give the timeline a frame to clear its filters and lay the row out again.
  await nextFrame();
  await nextFrame();
  await scrollToElement(row, 'center');
  flash(row);
  if (doc) {
    if (motionAllowed()) await wait(220);
    document.dispatchEvent(new CustomEvent('lightbox:open', { detail: { group: 'achievements', id } }));
  }
  // No lightbox opened (no document, or no trigger in the row): keyboard focus lands on the row.
  if (!hasOpenLayer()) focusDestination(row);
}

async function choose(entry: Entry, newTab: boolean): Promise<void> {
  if (entry.kind === 'section') {
    await closePalette({ restoreFocus: false });
    if (entry.el?.isConnected) {
      await scrollToElement(entry.el, 'start');
      focusDestination(entry.el);
    }
    return;
  }
  const onPage = entry.kind === 'achievement' && document.getElementById(`a-${entry.id}`);
  if (onPage) {
    await closePalette({ restoreFocus: false });
    await reveal(entry.id, Boolean(entry.doc));
    return;
  }
  if (!entry.href) return;
  if (newTab) {
    window.open(entry.href, '_blank', 'noopener');
    return;
  }
  pendingReveal = entry.kind === 'achievement' ? { id: entry.id, doc: Boolean(entry.doc) } : null;
  // Close without animation so the view-transition snapshot is clean.
  await closePalette({ instant: true, restoreFocus: false });
  await navigate(entry.href);
}

/* ---------------- open / close ---------------- */

function setExpanded(open: boolean): void {
  for (const el of document.querySelectorAll('[data-palette-open]')) el.setAttribute('aria-expanded', String(open));
}

export function openPalette(): void {
  const u = ui;
  if (!u || isOpen) return;
  isOpen = true;
  generation++;
  const focused = document.activeElement;
  returnFocus = focused instanceof HTMLElement && focused !== document.body ? focused : null;
  readIndex();
  readSections();
  u.root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
  u.root.hidden = false;
  pushLayer(u.root);
  setExpanded(true);
  render();
  u.input.focus({ preventScroll: true });
  u.input.select();
  if (motionAllowed()) {
    u.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION, easing: 'ease-out' });
    u.panel.animate(
      [
        { opacity: 0, transform: 'translateY(-8px) scale(0.98)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: DURATION, easing: EASE_OUT },
    );
  }
}

export function closePalette({ instant = false, restoreFocus = true } = {}): Promise<void> {
  const u = ui;
  if (!u || !isOpen) return Promise.resolve();
  isOpen = false;
  const gen = ++generation;
  const target = restoreFocus ? returnFocus : null;
  returnFocus = null;
  setExpanded(false);
  const finish = () => {
    if (gen !== generation) return;
    u.root.hidden = true;
    u.root.getAnimations({ subtree: true }).forEach((a) => a.cancel());
    popLayer(u.root);
    if (target?.isConnected) target.focus({ preventScroll: true });
  };
  if (instant || !motionAllowed()) {
    finish();
    return Promise.resolve();
  }
  return settled([
    u.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION, easing: 'ease-in', fill: 'forwards' }),
    u.panel.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateY(-4px) scale(0.98)' },
      ],
      { duration: DURATION, easing: 'ease-in', fill: 'forwards' },
    ),
  ]).then(finish);
}

/* ---------------- events ---------------- */

function isTypingTarget(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.isContentEditable || t.matches('input, textarea, select, [role="textbox"]'));
}

function onKeydown(e: KeyboardEvent): void {
  const u = ui;
  if (!u || e.defaultPrevented || e.isComposing) return;
  const key = e.key.toLowerCase();
  // e.code keeps Ctrl+K working on the Russian layout, where the key reports "л".
  const isK = key === 'k' || (e.code === 'KeyK' && !/^[a-z]$/.test(key));
  if (isK && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
    if (hasOpenLayer() && !isTopLayer(u.root)) return; // the lightbox is on top
    e.preventDefault();
    if (isOpen) void closePalette();
    else openPalette();
    return;
  }
  if (isOpen || hasOpenLayer() || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
  // "/" — or the same physical key on ЙЦУКЕН, which types "."
  if (e.key === '/' || (e.code === 'Slash' && !e.shiftKey)) {
    e.preventDefault();
    openPalette();
  }
}

function onPanelKeydown(e: KeyboardEvent): void {
  const u = ui;
  if (!u || !isOpen || e.isComposing) return;
  const n = rows.length;
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault();
      if (n) setActive((active + 1) % n);
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (n) setActive((active - 1 + n) % n);
      break;
    case 'Home':
      e.preventDefault();
      if (n) setActive(0);
      break;
    case 'End':
      e.preventDefault();
      if (n) setActive(n - 1);
      break;
    case 'Enter': {
      e.preventDefault();
      const row = rows[active];
      if (row) void choose(row.entry, e.metaKey || e.ctrlKey);
      break;
    }
    case 'Escape':
      e.preventDefault();
      void closePalette();
      break;
    case 'Tab':
      trapFocus(e, u.panel);
      break;
  }
}

function onDocumentClick(e: MouseEvent): void {
  const trigger = (e.target as Element | null)?.closest?.('[data-palette-open]');
  if (!trigger || !ui) return;
  e.preventDefault();
  openPalette();
}

function optionIndex(target: EventTarget | null): number {
  const option = target instanceof Element ? target.closest<HTMLElement>('[role="option"]') : null;
  return option ? Number(option.dataset.index) : -1;
}

function bindUi(u: Ui): void {
  u.input.addEventListener('input', render);
  u.panel.addEventListener('keydown', onPanelKeydown);
  u.backdrop.addEventListener('click', () => void closePalette());
  u.close.addEventListener('click', () => void closePalette());
  // Clicks inside the panel keep focus in the input (options are not focusable by design).
  u.panel.addEventListener('mousedown', (e) => {
    if (!(e.target as Element).closest('input, button')) e.preventDefault();
  });
  // Hover selects, but only on real pointer movement: keyboard-driven scrolling must not steal the selection.
  u.list.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const i = optionIndex(e.target);
    if (i >= 0 && i !== active) setActive(i, false);
  });
  u.list.addEventListener('click', (e) => {
    const row = rows[optionIndex(e.target)];
    if (row) void choose(row.entry, e.metaKey || e.ctrlKey);
  });
}

function collectUi(root: HTMLElement): Ui | null {
  const q = <T extends HTMLElement>(part: string) => root.querySelector<T>(`[data-part="${part}"]`);
  const p = {
    backdrop: q('backdrop'),
    panel: q('panel'),
    input: q<HTMLInputElement>('input'),
    close: q<HTMLButtonElement>('close'),
    scroller: q('scroller'),
    list: q('list'),
    empty: q('empty'),
    emptyQuery: q('empty-query'),
    live: q('live'),
  };
  if (Object.values(p).some((el) => !el)) return null;
  const d = root.dataset;
  return {
    root,
    ...(p as { [K in keyof typeof p]: NonNullable<(typeof p)[K]> }),
    labels: { project: d.labelProject ?? '', achievement: d.labelAchievement ?? '', section: d.labelSection ?? '' },
    emptyText: d.labelEmpty ?? '',
  };
}

const isApple = () => {
  const uaPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return /mac|iphone|ipad|ipod/i.test(uaPlatform || navigator.platform || navigator.userAgent);
};

/** Wire the palette for the current page. Safe to call on every `astro:page-load`. */
export function initPalette(): void {
  if (!bound) {
    bound = true;
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('astro:before-swap', () => void closePalette({ instant: true, restoreFocus: false }));
  }
  if (isApple()) for (const el of document.querySelectorAll('[data-mod-key]')) el.textContent = '⌘';
  for (const el of document.querySelectorAll('[data-palette-open]')) {
    el.setAttribute('aria-haspopup', 'dialog');
    el.setAttribute('aria-expanded', String(isOpen));
  }

  const root = document.getElementById('palette');
  if (root && root !== ui?.root) {
    void closePalette({ instant: true, restoreFocus: false });
    ui = collectUi(root);
    if (ui) bindUi(ui);
  }

  if (pendingReveal) {
    const { id, doc } = pendingReveal;
    pendingReveal = null;
    // The timeline and the lightbox initialise on the same page-load: act once they are wired.
    requestAnimationFrame(() => requestAnimationFrame(() => void reveal(id, doc)));
  }
}
