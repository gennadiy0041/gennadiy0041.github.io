// @ts-check
/**
 * Drawing on page rasters.
 *
 * - Review images: candidate boxes outlined, numbered labels in margins beside the page
 *   (numbers = order in candidates.json).
 * - Redaction: solid #16181b boxes with slightly rounded corners, painted into the pixels.
 *   It is irreversible by construction: the published file is re-encoded from the painted
 *   raster, never blurred, never layered, and written without metadata.
 */
import fs from 'node:fs';
import sharp from 'sharp';
import { UserError } from './util.mjs';

/** @typedef {{ x: number, y: number, w: number, h: number }} PageBox page-relative 0..1 */
/** @typedef {import('./render.mjs').Raster} Raster */
/** @typedef {import('./geometry.mjs').Turn} Turn */

export const REDACT_FILL = '#16181b';
/** Each box grows by 0.4 % of the page's long side on every edge. */
export const REDACT_PAD = 0.004;
/** Corner radius in pixels of the final (published) image. */
export const REDACT_RADIUS = 6;

/** @type {Record<string, string>} */
const KIND_COLOR = {
  qr: '#00c853',
  iin: '#ff1744',
  phone: '#ff9100',
  email: '#c6a700',
  'birth-date': '#f50057',
  'doc-number': '#d500f9',
  address: '#00b8d4',
  grade: '#2979ff',
};

const esc = (/** @type {string} */ s) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c);
const f1 = (/** @type {number} */ v) => v.toFixed(1);

/**
 * Paints solid boxes over an RGB raster and returns the new pixels (same size, 3 channels).
 * Boxes are not clamped to the page: a box at the edge extends past it, so its rounded
 * corners fall outside the image and never leave original pixels uncovered.
 * @param {Raster} raster
 * @param {PageBox[]} boxes
 * @param {number} radius corner radius in raster pixels
 * @returns {Promise<Buffer>}
 */
export async function paintBoxes(raster, boxes, radius) {
  if (!boxes.length) return raster.data;
  const { width, height } = raster;
  const pad = REDACT_PAD * Math.max(width, height);
  const rects = boxes.map((b) => {
    const x = b.x * width - pad;
    const y = b.y * height - pad;
    const w = b.w * width + 2 * pad;
    const h = b.h * height + 2 * pad;
    return `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" rx="${f1(Math.min(radius, w / 2, h / 2))}" fill="${REDACT_FILL}"/>`;
  });
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects.join('')}</svg>`);
  const { data, info } = await sharp(raster.data, { raw: { width, height, channels: 3 } })
    .composite([{ input: svg, top: 0, left: 0 }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels === 3) return data;
  return sharp(data, { raw: { width, height, channels: /** @type {4} */ (info.channels) } })
    .removeAlpha()
    .raw()
    .toBuffer();
}

/**
 * Runs one sharp step on an RGB raster and returns the new raster. Steps run in separate
 * pipelines on purpose: in one pipeline sharp reorders extract() and rotate() around resize().
 * @param {Raster} r
 * @param {(img: import('sharp').Sharp) => import('sharp').Sharp} step
 * @returns {Promise<Raster>}
 */
async function rasterStep(r, step) {
  const { data, info } = await step(sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } }))
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Crop (page-relative, on the unturned page), turn clockwise by `rotate`, shrink to `max` px on
 * the long side and encode as WebP without metadata.
 * @param {Raster} raster painted pixels
 * @param {{ out: string, max: number, quality: number, crop?: PageBox, rotate?: Turn }} o
 */
export async function writeWebp(raster, o) {
  let r = raster;
  const crop = o.crop;
  if (crop) {
    const left = Math.max(0, Math.round(crop.x * r.width));
    const top = Math.max(0, Math.round(crop.y * r.height));
    const w = Math.min(r.width - left, Math.round(crop.w * r.width));
    const h = Math.min(r.height - top, Math.round(crop.h * r.height));
    if (w < 8 || h < 8) throw new UserError('crop слишком маленький или вне страницы');
    r = await rasterStep(r, (img) => img.extract({ left, top, width: w, height: h }));
  }
  const turn = o.rotate;
  if (turn) r = await rasterStep(r, (img) => img.rotate(turn));
  const tmp = `${o.out}.${process.pid}.tmp`;
  await sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
    .resize({ width: o.max, height: o.max, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: o.quality, effort: 5 })
    .toFile(tmp);
  fs.renameSync(tmp, o.out);
}

/**
 * Corner radius to use at raster resolution so it is ~REDACT_RADIUS px after crop + resize.
 * @param {Raster} raster
 * @param {number} max long side of the output
 * @param {PageBox} [crop]
 */
export function radiusFor(raster, max, crop) {
  const w = raster.width * (crop?.w ?? 1);
  const h = raster.height * (crop?.h ?? 1);
  const scale = Math.min(1, max / Math.max(w, h, 1));
  return REDACT_RADIUS / scale;
}

/**
 * Review image: every candidate outlined in its kind's colour on the page, its "#n kind" label in
 * a grey margin added on the left or the right (whichever is nearer), joined to the box by a thin
 * line. Labels never cover page content, so a missed row next to a candidate is never hidden.
 * @param {string} pagePng
 * @param {{ n: number, kind: string, box: PageBox }[]} marks
 * @param {string} out
 */
export async function writeReview(pagePng, marks, out) {
  const { width = 1, height = 1 } = await sharp(pagePng).metadata();
  if (!marks.length) {
    await sharp(pagePng).png().toFile(out);
    return;
  }
  const long = Math.max(width, height);
  const stroke = Math.max(2, Math.round(long * 0.0018));
  const font = Math.max(13, Math.round(long * 0.0085));
  const lh = Math.round(font * 1.35);
  const step = lh + Math.max(2, Math.round(font * 0.2));
  const labelOf = (/** @type {{ n: number, kind: string }} */ m) => `#${m.n} ${m.kind}`;
  const lw = Math.ceil(Math.max(...marks.map((m) => labelOf(m).length)) * font * 0.6 + font * 0.6);
  const gutter = lw + 2 * Math.round(font * 0.6);

  /** @type {{ m: typeof marks[number], side: 'left' | 'right', want: number, y: number }[]} */
  const placed = marks.map((m) => ({
    m,
    side: m.box.x + m.box.w / 2 < 0.5 ? 'left' : 'right',
    want: (m.box.y + m.box.h / 2) * height - lh / 2,
    y: 0,
  }));
  // per margin: labels as close to their box's height as possible, top to bottom, never overlapping
  let canvasH = height;
  for (const side of ['left', 'right']) {
    const col = placed.filter((p) => p.side === side).sort((a, b) => a.want - b.want);
    let next = 0;
    for (const p of col) {
      p.y = Math.max(p.want, next);
      next = p.y + step;
    }
    // too low at the end: push the stack back up, but never above the top
    let limit = height - lh;
    for (let i = col.length - 1; i >= 0; i--) {
      col[i].y = Math.max(0, Math.min(col[i].y, limit));
      limit = col[i].y - step;
    }
    for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + step);
    canvasH = Math.max(canvasH, Math.ceil((col.at(-1)?.y ?? 0) + lh));
  }

  /** @type {string[]} */
  const outlines = [];
  /** @type {string[]} */
  const labels = [];
  for (const { m, side, y: ly } of placed) {
    const color = KIND_COLOR[m.kind] ?? '#ff1744';
    const x = gutter + m.box.x * width;
    const y = m.box.y * height;
    const w = m.box.w * width;
    const h = m.box.h * height;
    const lx = side === 'left' ? gutter - lw - Math.round(font * 0.6) : gutter + width + Math.round(font * 0.6);
    const fromX = side === 'left' ? lx + lw : lx;
    const toX = side === 'left' ? x : x + w;
    outlines.push(
      `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(w)}" height="${f1(h)}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="${stroke}"/>`,
      `<line x1="${f1(fromX)}" y1="${f1(ly + lh / 2)}" x2="${f1(toX)}" y2="${f1(y + h / 2)}" stroke="${color}" stroke-opacity="0.75" stroke-width="${Math.max(1, Math.round(stroke / 2))}"/>`,
    );
    labels.push(
      `<rect x="${f1(lx)}" y="${f1(ly)}" width="${f1(lw)}" height="${f1(lh)}" rx="${f1(font * 0.2)}" fill="${color}"/>` +
        `<text x="${f1(lx + font * 0.3)}" y="${f1(ly + font * 1.02)}" font-family="Segoe UI, Arial, sans-serif" font-size="${font}" font-weight="700" fill="#ffffff">${esc(labelOf(m))}</text>`,
    );
  }
  const W = width + 2 * gutter;
  // labels go on top of every outline and line, so nothing tints a label
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${canvasH}">${outlines.join('')}${labels.join('')}</svg>`);
  await sharp({ create: { width: W, height: canvasH, channels: 3, background: '#d9dadc' } })
    .composite([
      { input: pagePng, top: 0, left: gutter },
      { input: svg, top: 0, left: 0 },
    ])
    .png()
    .toFile(out);
}
