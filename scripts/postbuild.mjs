#!/usr/bin/env node
/**
 * Renders the print-only pages of `astro build` into files, then removes those pages from dist.
 *
 *   /resume/, /en/resume/   ->  cv/gennadiy-kozlov-ru.pdf, cv/gennadiy-kozlov-en.pdf   (A4, ≤ 2 pages)
 *   /og-card/<key>/         ->  og/<key>.png                                           (1200×630 cards)
 *
 * Usage:    node scripts/postbuild.mjs [--dist <dir>]         (default ./dist)
 * Browser:  $CHROME_PATH, else Google Chrome, else Microsoft Edge, else Playwright's own Chromium.
 * Pages:    rendered once every font face and image has loaded and <html data-render-pending> (set by
 *           pages that still adjust themselves, e.g. the cards fitting their text) is gone.
 * Checks:   a CV longer than two pages in its tightest layout, and a card whose text sticks out of its
 *           box or is squeezed out of sight, are failures; a CV that fits only with a tall gap before a
 *           page break, and card text shortened with an ellipsis, are warnings.
 * Any failure exits with code 1, so CI fails loudly.
 */
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import sharp from 'sharp';

const RESUMES = [
  { route: '/resume/', out: 'cv/gennadiy-kozlov-ru.pdf' },
  { route: '/en/resume/', out: 'cv/gennadiy-kozlov-en.pdf' },
];
const MAX_PAGES = 2;
/**
 * Layouts of [data-resume] in src/components/ResumeDoc.astro, in order of preference: regular type →
 * smaller type → shorter lists (RESUME_LIMITS.*.tight), first with every achievement group kept whole
 * under its heading, then with [data-split] (a group may continue in the next column). The first one
 * that fits on MAX_PAGES without a gap taller than MAX_GAP_MM at the foot of a page wins: a group kept
 * whole that does not fit at the bottom of page 1 moves on and leaves such a gap behind.
 */
const LAYOUTS = [
  { density: 'normal', split: false },
  { density: 'compact', split: false },
  { density: 'tight', split: false },
  { density: 'normal', split: true },
  { density: 'compact', split: true },
  { density: 'tight', split: true },
];
/**
 * A column that ends before the next group or entry (kept whole) leaves up to ~50 mm; a section that
 * jumped to the next page because its first group did not fit leaves 80 mm and more.
 */
const MAX_GAP_MM = 60;
/** `@page { margin-bottom }` of the CV (src/components/ResumeDoc.astro): the running footer lives below it. */
const PAGE_MARGIN_BOTTOM_MM = 16;
const PT_PER_MM = 72 / 25.4;
/** How long a page may keep <html data-render-pending> after its fonts and images have loaded. */
const RENDER_TIMEOUT_MS = 15_000;

const CARD_ROUTE = 'og-card';
const CARD_VIEWPORT = { width: 1200, height: 630 };
const CARD_MAX_BYTES = 600 * 1024;

/** Print-only routes, deleted once rendered (the sitemap already filters them out). */
const PRINT_SOURCES = ['og-card', 'resume', 'en/resume'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
};
/** Files whose text may reference hashed assets in _astro/. */
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.json', '.xml', '.svg', '.webmanifest', '.txt']);

/* ------------------------------------------------------------------ static server */

/** Serves `root` on 127.0.0.1 at a free port; "/x/" maps to "/x/index.html". */
async function serve(root) {
  const server = createServer(async (req, res) => {
    const send = (status, body = '') => res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(body);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405);
    let file;
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
      file = path.join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
    } catch {
      return send(400);
    }
    const inside = path.relative(root, file);
    if (inside.startsWith('..') || path.isAbsolute(inside)) return send(403);
    let info = await stat(file).catch(() => null);
    if (info?.isDirectory()) {
      file = path.join(file, 'index.html');
      info = await stat(file).catch(() => null);
    }
    if (!info?.isFile()) return send(404, 'not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

/* ------------------------------------------------------------------ browser */

async function launchBrowser() {
  const candidates = [
    ...(process.env.CHROME_PATH ? [{ label: `CHROME_PATH (${process.env.CHROME_PATH})`, options: { executablePath: process.env.CHROME_PATH } }] : []),
    { label: 'Google Chrome', options: { channel: 'chrome' } },
    { label: 'Microsoft Edge', options: { channel: 'msedge' } },
    { label: "Playwright's bundled Chromium", options: {} },
  ];
  const failures = [];
  for (const { label, options } of candidates) {
    try {
      return { browser: await chromium.launch({ ...options, headless: true }), label };
    } catch (err) {
      const reason = String(err?.message ?? err).split('\n')[0];
      failures.push(`  - ${label}: ${reason}`);
      // an explicit setting that does not work should not be skipped silently
      if (options.executablePath) console.warn(`postbuild: ${label} could not be started (${reason}), trying the next browser`);
    }
  }
  throw new Error(
    `no Chromium-based browser could be started:\n${failures.join('\n')}\n` +
      'Install Google Chrome or Microsoft Edge, or set CHROME_PATH to a Chrome/Chromium executable.',
  );
}

/**
 * Opens `url` and waits until every font face and image is ready and the page has dropped
 * <html data-render-pending>; any load problem is an error.
 */
async function openPage(context, url) {
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (err) => problems.push(`script error: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const where = msg.location().url;
    problems.push(`console: ${msg.text()}${where ? ` (${where})` : ''}`);
  });
  page.on('requestfailed', (req) => problems.push(`request failed: ${req.url()} (${req.failure()?.errorText})`));
  page.on('response', (res) => res.status() >= 400 && problems.push(`HTTP ${res.status()}: ${res.url()}`));
  try {
    const response = await page.goto(url, { waitUntil: 'load' });
    if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'}`);
    await page.evaluate(async () => {
      // Faces are split by unicode-range and load lazily: load them all so nothing prints in a fallback font.
      await Promise.all([...document.fonts].map((face) => face.load().catch(() => undefined)));
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map(async (img) => {
          img.loading = 'eager';
          if (!img.complete) {
            await new Promise((resolve, reject) => {
              img.addEventListener('load', resolve, { once: true });
              img.addEventListener('error', reject, { once: true });
            }).catch(() => undefined);
          }
          if (!img.naturalWidth) throw new Error(`image did not load: ${img.currentSrc || img.src}`);
          await img.decode();
        }),
      );
    });
    await page
      .waitForFunction(() => !document.documentElement.hasAttribute('data-render-pending'), null, { timeout: RENDER_TIMEOUT_MS })
      .catch(() => {
        throw new Error(`still marked data-render-pending after ${RENDER_TIMEOUT_MS / 1000} s`);
      });
    if (problems.length > 0) throw new Error(problems.join('\n    '));
    return page;
  } catch (err) {
    await page.close();
    // keep the message, drop the stack frames that Playwright appends to errors thrown in the page
    const message = String(err?.message ?? err)
      .split('\n')
      .filter((line) => !/^\s+at /.test(line))
      .join('\n');
    throw new Error(`${new URL(url).pathname}: ${message}`);
  }
}

/* ------------------------------------------------------------------ résumé PDFs */

/**
 * Page count of a printed CV and the tallest gap (mm) between the last line of its left or right half
 * and the foot of the page, over every page but the last. mupdf (wasm, a devDependency also used by
 * scripts/sync.mjs) reads the text lines back from the PDF; it is loaded on first use.
 */
async function measurePdf(pdf) {
  const mupdf = await import('mupdf');
  const doc = mupdf.Document.openDocument(pdf, 'application/pdf');
  try {
    const pages = doc.countPages();
    let gap = 0;
    for (let i = 0; i < pages - 1; i++) {
      const page = doc.loadPage(i);
      const [left, , right, bottom] = page.getBounds();
      const foot = bottom - PAGE_MARGIN_BOTTOM_MM * PT_PER_MM;
      const middle = (left + right) / 2;
      const lowest = { left: 0, right: 0 };
      page.toStructuredText().walk({
        beginLine([x0, , x1, y1]) {
          if (y1 > foot + 1) return; // the running footer in the bottom margin
          if (x0 < middle) lowest.left = Math.max(lowest.left, y1);
          if (x1 > middle) lowest.right = Math.max(lowest.right, y1);
        },
      });
      page.destroy();
      gap = Math.max(gap, (foot - Math.min(lowest.left, lowest.right)) / PT_PER_MM);
    }
    return { pages, gap };
  } finally {
    doc.destroy();
  }
}

const describeLayout = ({ density, split }) => `${density}${split ? ', groups split' : ''}`;

async function printResume(context, origin, dist, { route, out }, warnings) {
  const page = await openPage(context, origin + route);
  try {
    if (!(await page.$('[data-resume]'))) throw new Error(`${route}: no [data-resume] element`);
    let chosen;
    let closest; // fits on MAX_PAGES, smallest gap
    let last;
    for (const layout of LAYOUTS) {
      await page.$$eval(
        '[data-resume]',
        (roots, { density, split }) =>
          roots.forEach((el) => {
            el.setAttribute('data-density', density);
            el.toggleAttribute('data-split', split);
          }),
        layout,
      );
      // The PDF Title comes from <title>; tagged = accessible structure for screen readers.
      const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true });
      last = { pdf, layout, ...(await measurePdf(pdf)) };
      if (last.pages > MAX_PAGES) continue;
      if (last.gap <= MAX_GAP_MM) {
        chosen = last;
        break;
      }
      if (!closest || last.gap < closest.gap) closest = last;
    }
    chosen ??= closest;
    if (!chosen) {
      await writeOutput(dist, out, last.pdf);
      throw new Error(
        `${out}: ${last.pages} pages even in the tightest layout (max ${MAX_PAGES}) — shorten the long profile texts ` +
          `(intro, experience) or lower RESUME_LIMITS in src/lib/resume.ts; the PDF is left in dist for a look`,
      );
    }
    if (chosen.gap > MAX_GAP_MM) {
      warnings.push(`${out}: every layout that fits leaves a ${Math.round(chosen.gap)} mm gap before a page break`);
    }
    await writeOutput(dist, out, chosen.pdf);
    const { pdf, pages, layout } = chosen;
    return { file: out, bytes: pdf.length, note: `${pages} ${pages === 1 ? 'page' : 'pages'}, ${describeLayout(layout)}` };
  } finally {
    await page.close();
  }
}

/* ------------------------------------------------------------------ social cards */

async function listCardKeys(dist) {
  const entries = await readdir(path.join(dist, CARD_ROUTE), { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

/** PNG as captured; if too heavy, a 256-colour PNG; as a last resort JPEG (then the file is .jpg). */
async function compressCard(png) {
  if (png.length <= CARD_MAX_BYTES) return { data: png, ext: 'png', note: 'png' };
  const palette = await sharp(png).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toBuffer();
  if (palette.length <= CARD_MAX_BYTES) return { data: palette, ext: 'png', note: 'png, 256 colours' };
  for (const quality of [90, 85, 80, 75, 70]) {
    const jpeg = await sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (jpeg.length <= CARD_MAX_BYTES) return { data: jpeg, ext: 'jpg', note: `jpeg q${quality}` };
  }
  throw new Error(`stays above ${CARD_MAX_BYTES / 1024} KB even as JPEG q70`);
}

/** Base.astro links /og/<key>.png; when a card had to become a JPEG, point the built pages at it. */
async function retargetCard(dist, key) {
  const from = `/og/${key}.png`;
  const to = `/og/${key}.jpg`;
  for (const file of await listFiles(dist)) {
    if (path.extname(file) !== '.html') continue;
    const html = await readFile(file, 'utf8');
    if (!html.includes(from)) continue;
    const patched = html
      .replaceAll(from, to)
      .replace(/(<meta\s+property="og:image:type"\s+content=")image\/png"/g, '$1image/jpeg"');
    await writeFile(file, patched);
  }
}

/**
 * Layout check of a fitted card (see src/components/og/OgCard.astro). Every element that holds text
 * must stay visible and inside its nearest [data-og-box] (the card, the text column, the cover), and
 * every box inside its parent box: `errors`. Text that fitted only by ending in an ellipsis
 * ([data-fit] elements still overflowing their own box, by design): `shortened`.
 */
function inspectCard() {
  const SLACK = 1; // px of sub-pixel rounding
  const card = document.querySelector('[data-og]');
  if (!card) return { errors: ['no [data-og] element'], shortened: [] };
  const quote = (el) => `"${el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)}"`;
  const name = (box) => (box === card ? 'the card' : `.${box.classList[0]}`);
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim() !== '');
  /** Where the element's text is drawn, cut down by every clipping element from itself up to `box`. */
  const visibleText = (el, box) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    let { left, top, right, bottom } = range.getBoundingClientRect();
    for (let node = el; node && node !== box; node = node.parentElement) {
      const style = getComputedStyle(node);
      const clip = node.getBoundingClientRect();
      if (style.overflowX !== 'visible') [left, right] = [Math.max(left, clip.left), Math.min(right, clip.right)];
      if (style.overflowY !== 'visible') [top, bottom] = [Math.max(top, clip.top), Math.min(bottom, clip.bottom)];
    }
    return { left, top, right, bottom };
  };
  const outside = (r, b) =>
    [
      r.left < b.left - SLACK && `left by ${Math.round(b.left - r.left)} px`,
      r.right > b.right + SLACK && `right by ${Math.round(r.right - b.right)} px`,
      r.top < b.top - SLACK && `top by ${Math.round(b.top - r.top)} px`,
      r.bottom > b.bottom + SLACK && `bottom by ${Math.round(r.bottom - b.bottom)} px`,
    ]
      .filter(Boolean)
      .join(', ');

  const errors = [];
  const shortened = [];
  for (const box of card.querySelectorAll('[data-og-box]')) {
    const parent = box.parentElement.closest('[data-og-box]');
    const off = outside(box.getBoundingClientRect(), parent.getBoundingClientRect());
    if (off) errors.push(`${name(box)} sticks out of ${name(parent)} (${off})`);
  }
  for (const el of card.querySelectorAll('*')) {
    const fitted = el.matches('[data-fit]');
    // a fitted element is checked as a whole; its parts may be clipped by its own line clamp
    if (!fitted && (!hasOwnText(el) || el.parentElement.closest('[data-fit]'))) continue;
    if (el.getClientRects().length === 0) continue; // not rendered on purpose (display: none)
    const box = el.parentElement.closest('[data-og-box]');
    const text = visibleText(el, box);
    if (text.right - text.left < 1 || text.bottom - text.top < 1) {
      errors.push(`${quote(el)} is squeezed out of sight`);
      continue;
    }
    const off = outside(text, box.getBoundingClientRect());
    if (off) errors.push(`${quote(el)} sticks out of ${name(box)} (${off})`);
    if (fitted && (el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)) shortened.push(quote(el));
  }
  return { errors, shortened };
}

async function shootCard(context, origin, dist, key, warnings) {
  const page = await openPage(context, `${origin}/${CARD_ROUTE}/${key}/`);
  try {
    const { errors, shortened } = await page.evaluate(inspectCard);
    const card = await compressCard(await page.screenshot({ type: 'png' }));
    const out = `og/${key}.${card.ext}`;
    await writeOutput(dist, out, card.data);
    if (errors.length > 0) throw new Error(`${out}: ${errors.join('; ')} (the image is left in dist for a look)`);
    for (const text of shortened) warnings.push(`${out}: shortened with an ellipsis: ${text}`);
    if (card.ext !== 'png') {
      await rm(path.join(dist, `og/${key}.png`), { force: true });
      await retargetCard(dist, key);
      warnings.push(`${out}: PNG exceeded ${CARD_MAX_BYTES / 1024} KB, built pages now point og:image at the JPEG`);
    }
    return { file: out, bytes: card.data.length, note: card.note };
  } finally {
    await page.close();
  }
}

/* ------------------------------------------------------------------ dist housekeeping */

async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

async function writeOutput(dist, relative, data) {
  const file = path.join(dist, relative);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

/**
 * Deletes the print-only routes and the hashed assets that only they referenced
 * (e.g. the cover crops made for the cards). Returns how many assets went with them.
 */
async function removePrintSources(dist) {
  const roots = PRINT_SOURCES.map((p) => path.join(dist, p));
  const isPrintSource = (file) => roots.some((root) => file.startsWith(root + path.sep));
  const texts = (await listFiles(dist)).filter((f) => TEXT_EXT.has(path.extname(f).toLowerCase()));
  const assetRefs = async (files) => {
    const refs = new Set();
    for (const file of files) for (const [ref] of (await readFile(file, 'utf8')).matchAll(/_astro\/[\w.\-/]+/g)) refs.add(ref);
    return refs;
  };
  const used = await assetRefs(texts.filter((f) => !isPrintSource(f)));
  const orphans = [...(await assetRefs(texts.filter(isPrintSource)))].filter((ref) => !used.has(ref));
  await Promise.all([
    ...orphans.map((ref) => rm(path.join(dist, ref), { force: true })),
    ...roots.map((root) => rm(root, { recursive: true, force: true })),
  ]);
  return orphans.length;
}

/* ------------------------------------------------------------------ main */

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

async function main() {
  const { values } = parseArgs({ options: { dist: { type: 'string', default: './dist' } } });
  const dist = path.resolve(values.dist);
  for (const { route } of RESUMES) {
    await stat(path.join(dist, route, 'index.html')).catch(() => {
      throw new Error(`${path.join(dist, route, 'index.html')} is missing — run \`astro build\` first`);
    });
  }
  const cardKeys = await listCardKeys(dist);
  if (cardKeys.length === 0) throw new Error(`no cards in ${path.join(dist, CARD_ROUTE)} — run \`astro build\` first`);

  const server = await serve(dist);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  const failures = [];
  const warnings = [];
  let browser;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    console.log(`postbuild: ${launched.label} ${browser.version()}, serving ${path.relative(process.cwd(), dist) || '.'} at ${origin}`);

    const run = async (job) => {
      try {
        results.push(await job());
      } catch (err) {
        failures.push(err?.message ?? String(err));
      }
    };
    const paper = await browser.newContext();
    for (const resume of RESUMES) await run(() => printResume(paper, origin, dist, resume, warnings));
    await paper.close();

    const screen = await browser.newContext({ viewport: CARD_VIEWPORT, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    for (const key of cardKeys) await run(() => shootCard(screen, origin, dist, key, warnings));
    await screen.close();
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }

  const width = Math.max(...results.map((r) => r.file.length));
  for (const r of results) console.log(`  ${r.file.padEnd(width)}  ${kb(r.bytes).padStart(9)}  ${r.note}`);
  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (failures.length > 0) throw new Error(`${failures.length} file(s) not rendered:\n  ${failures.join('\n  ')}`);

  const orphans = await removePrintSources(dist);
  console.log(`  removed print sources: ${PRINT_SOURCES.map((p) => `${p}/`).join(', ')} (+${orphans} asset(s) only they used)`);
}

main().catch((err) => {
  console.error(`postbuild failed: ${err?.message ?? err}`);
  process.exitCode = 1;
});
