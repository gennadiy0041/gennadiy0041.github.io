// @ts-check
/**
 * Turns sources into pixels and text (read-only on the source files).
 *
 * - PDF: mupdf (wasm) renders pages and gives the text layer with glyph positions.
 * - JPG/PNG/WEBP: sharp, auto-rotated by EXIF orientation.
 * - HEIC/HEIF: sharp when its libvips build can decode them, otherwise the user converts manually.
 * - DOCX: text of word/document.xml (no picture).
 * - PPTX: slide text + the first embedded picture (that picture is "page 1").
 *
 * All rasters are RGB without alpha (transparent areas become white), so boxes measured on
 * one rendering map 1:1 onto any other rendering of the same page via page-relative coordinates.
 */
import fs from 'node:fs';
import JSZip from 'jszip';
import sharp from 'sharp';
import { UserError } from './util.mjs';

/** @typedef {import('./sources.mjs').Source} Source */
/** @typedef {import('./geometry.mjs').Turn} Turn */
/** @typedef {{ text: string, x: number, y: number, w: number, h: number }} Word */
/** @typedef {Word & { words: Word[] }} TextLine */
/**
 * OCR output (scripts/lib/ocr.mjs) and the PDF text layer share this shape; boxes are pixels
 * of the rendered page image. `rotation` (clockwise degrees) says the text reads upright only
 * after the page is turned that much (a sideways photo, a /Rotate'd PDF page); absent = 0.
 * @typedef {{ width: number, height: number, rotation?: Turn, lines: TextLine[] }} TextPage
 */
/** @typedef {{ data: Buffer, width: number, height: number }} Raster RGB, 3 channels, no padding */
/** @typedef {Raster & { page: number, text: { lines: TextLine[], rotation: Turn } | null }} RenderedPage */
/** @typedef {{ dpi: number, maxSide: number, withText?: boolean }} RenderOptions */

/** Raster formats sharp can decode, used to pick pictures out of PPTX files. */
const RASTER_EXT = /\.(png|jpe?g|webp|gif|tiff?)$/i;

/** @type {Promise<typeof import('mupdf')> | undefined} */
let mupdfModule;
/** mupdf is ~10 MB of wasm: load it only when a PDF is actually opened. */
const loadMupdf = () => (mupdfModule ??= import('mupdf'));

/** @param {string} file */
async function openPdf(file) {
  const mupdf = await loadMupdf();
  /** @type {import('mupdf').Document} */
  let doc;
  try {
    doc = mupdf.Document.openDocument(fs.readFileSync(file), 'application/pdf');
  } catch (e) {
    throw new UserError(`PDF не открывается: ${/** @type {Error} */ (e).message}`);
  }
  if (doc.needsPassword()) {
    doc.destroy();
    throw new UserError('PDF защищён паролем — сохрани копию без пароля');
  }
  return { mupdf, doc };
}

/**
 * Number of pages: PDF pages; every other kind counts as one page.
 * @param {Source} src
 */
export async function countPages(src) {
  if (src.kind !== 'pdf') return 1;
  const { doc } = await openPdf(src.path);
  try {
    return doc.countPages();
  } finally {
    doc.destroy();
  }
}

/**
 * Renders every page of a source and hands it to `fn` one at a time (pages of big scans are
 * never all in memory). DOCX has no pages; a PPTX without pictures has none either.
 * @param {Source} src
 * @param {RenderOptions} opts
 * @param {(page: RenderedPage) => Promise<void>} fn
 * @returns {Promise<number>} number of pages rendered
 */
export async function eachPage(src, opts, fn) {
  if (src.kind === 'pdf') {
    const { mupdf, doc } = await openPdf(src.path);
    try {
      const n = doc.countPages();
      for (let i = 0; i < n; i++) await fn({ page: i + 1, ...renderPdfPage(mupdf, doc, i, opts) });
      return n;
    } finally {
      doc.destroy();
    }
  }
  if (src.kind === 'docx') return 0;
  const input = src.kind === 'pptx' ? await firstPptxPicture(src.path) : src.path;
  if (!input) return 0;
  await fn({ page: 1, ...(await rasterize(input, opts.maxSide, src.kind)), text: null });
  return 1;
}

/**
 * Renders a single page (1-based) — used by `npm run media`.
 * @param {Source} src
 * @param {number} pageNo
 * @param {RenderOptions} opts
 * @returns {Promise<Raster>}
 */
export async function renderPage(src, pageNo, opts) {
  if (src.kind === 'pdf') {
    const { mupdf, doc } = await openPdf(src.path);
    try {
      const n = doc.countPages();
      if (pageNo < 1 || pageNo > n) throw new UserError(`в PDF нет страницы ${pageNo} (всего ${n})`);
      const { data, width, height } = renderPdfPage(mupdf, doc, pageNo - 1, { ...opts, withText: false });
      return { data, width, height };
    } finally {
      doc.destroy();
    }
  }
  if (src.kind === 'docx') throw new UserError('у DOCX нет картинки — нужен скан или скриншот документа');
  if (pageNo !== 1) throw new UserError(`у ${src.ext.toUpperCase()} только одна страница`);
  const input = src.kind === 'pptx' ? await firstPptxPicture(src.path) : src.path;
  if (!input) throw new UserError('в PPTX нет картинок');
  return rasterize(input, opts.maxSide, src.kind);
}

/**
 * @param {typeof import('mupdf')} mupdf
 * @param {import('mupdf').Document} doc
 * @param {number} index 0-based
 * @param {RenderOptions} opts
 * @returns {Raster & { text: RenderedPage['text'] }}
 */
function renderPdfPage(mupdf, doc, index, opts) {
  const page = doc.loadPage(index);
  try {
    const [x0, y0, x1, y1] = page.getBounds();
    // ~dpi, but never more than maxSide pixels: some scans are stored as 2261×3200 pt "pages".
    const scale = Math.min(opts.dpi / 72, opts.maxSide / Math.max(x1 - x0, y1 - y0, 1));
    const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
    try {
      const [ox, oy] = pix.getBounds();
      const width = pix.getWidth();
      const height = pix.getHeight();
      const stride = pix.getStride();
      const pixels = pix.getPixels();
      let data;
      if (stride === width * 3) data = Buffer.from(pixels);
      else {
        data = Buffer.alloc(width * height * 3);
        for (let y = 0; y < height; y++) data.set(pixels.subarray(y * stride, y * stride + width * 3), y * width * 3);
      }
      const text = opts.withText ? readTextLayer(page, scale, ox, oy, width, height) : null;
      return { data, width, height, text };
    } finally {
      pix.destroy();
    }
  } finally {
    page.destroy();
  }
}

/**
 * Clockwise turn that makes a text line with baseline direction (dx, dy) read left to right
 * (device space, y down): text running up the page needs 90°, running down 270°.
 * @param {ArrayLike<number>} dir
 * @returns {Turn}
 */
const turnOfDirection = (dir) => (Math.abs(dir[0]) >= Math.abs(dir[1]) ? (dir[0] >= 0 ? 0 : 180) : dir[1] < 0 ? 90 : 270);

/**
 * Text layer of a PDF page as lines of words with pixel boxes (same space as the rendered image),
 * plus the turn that makes most of its text upright (a page shown sideways by /Rotate).
 * @param {import('mupdf').Page} page
 * @param {number} scale
 * @param {number} ox pixmap origin x (device space)
 * @param {number} oy pixmap origin y
 * @param {number} width
 * @param {number} height
 * @returns {{ lines: TextLine[], rotation: Turn }}
 */
function readTextLayer(page, scale, ox, oy, width, height) {
  const st = page.toStructuredText('');
  /** @type {TextLine[]} */
  const lines = [];
  /** @type {{ c: string, x0: number, y0: number, x1: number, y1: number }[]} */
  let chars = [];
  /** @type {Turn} */
  let lineTurn = 0;
  /** characters per text direction */
  const byTurn = new Map(/** @type {[Turn, number][]} */ ([[0, 0], [90, 0], [180, 0], [270, 0]]));
  try {
    st.walk({
      beginLine(_bbox, _wmode, direction) {
        chars = [];
        lineTurn = turnOfDirection(direction);
      },
      onChar(c, _origin, _font, _size, q) {
        chars.push({
          c,
          x0: Math.min(q[0], q[2], q[4], q[6]) * scale - ox,
          y0: Math.min(q[1], q[3], q[5], q[7]) * scale - oy,
          x1: Math.max(q[0], q[2], q[4], q[6]) * scale - ox,
          y1: Math.max(q[1], q[3], q[5], q[7]) * scale - oy,
        });
      },
      endLine() {
        const line = charsToLine(chars, width, height);
        if (!line) return;
        lines.push(line);
        byTurn.set(lineTurn, (byTurn.get(lineTurn) ?? 0) + line.text.length);
      },
    });
  } finally {
    st.destroy();
  }
  const [rotation] = [...byTurn].reduce((a, b) => (b[1] > a[1] ? b : a));
  return { lines, rotation };
}

const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;

/**
 * Groups glyphs into words (split on whitespace) clipped to the page.
 * @param {{ c: string, x0: number, y0: number, x1: number, y1: number }[]} chars
 * @param {number} width
 * @param {number} height
 * @returns {TextLine | null}
 */
function charsToLine(chars, width, height) {
  /** @type {{ text: string, x0: number, y0: number, x1: number, y1: number }[]} */
  const raw = [];
  /** @type {{ text: string, x0: number, y0: number, x1: number, y1: number } | null} */
  let cur = null;
  for (const ch of chars) {
    if (!ch.c.trim()) {
      if (cur) raw.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: '', x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    cur.text += ch.c;
    cur.x0 = Math.min(cur.x0, ch.x0);
    cur.y0 = Math.min(cur.y0, ch.y0);
    cur.x1 = Math.max(cur.x1, ch.x1);
    cur.y1 = Math.max(cur.y1, ch.y1);
  }
  if (cur) raw.push(cur);
  /** @type {Word[]} */
  const words = [];
  for (const w of raw) {
    const x0 = Math.max(0, w.x0);
    const y0 = Math.max(0, w.y0);
    const x1 = Math.min(width, w.x1);
    const y1 = Math.min(height, w.y1);
    if (x1 - x0 < 0.5 || y1 - y0 < 0.5) continue; // off-page or degenerate glyphs
    words.push({ text: w.text, x: r1(x0), y: r1(y0), w: r1(x1 - x0), h: r1(y1 - y0) });
  }
  if (!words.length) return null;
  const x0 = Math.min(...words.map((w) => w.x));
  const y0 = Math.min(...words.map((w) => w.y));
  const x1 = Math.max(...words.map((w) => w.x + w.w));
  const y1 = Math.max(...words.map((w) => w.y + w.h));
  return { text: words.map((w) => w.text).join(' '), x: r1(x0), y: r1(y0), w: r1(x1 - x0), h: r1(y1 - y0), words };
}

/**
 * Decodes a picture to RGB: EXIF orientation applied, alpha flattened on white, long side ≤ maxSide.
 * @param {string | Buffer} input
 * @param {number} maxSide
 * @param {import('./sources.mjs').SourceKind} kind
 * @returns {Promise<Raster>}
 */
async function rasterize(input, maxSide, kind) {
  try {
    const { data, info } = await sharp(input, { failOn: 'none', limitInputPixels: 400_000_000 })
      .rotate()
      .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .toColourspace('srgb')
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`unexpected ${info.channels} channels`);
    return { data, width: info.width, height: info.height };
  } catch (e) {
    if (kind === 'heic') throw new UserError('HEIC/HEIF не читается этой сборкой sharp — сконвертируй вручную в JPG и положи рядом');
    throw new UserError(`картинка не читается: ${/** @type {Error} */ (e).message}`);
  }
}

/** @param {string} xml */
const decodeXml = (xml) =>
  xml
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&');

/**
 * Paragraph texts of a WordprocessingML / DrawingML part.
 * @param {string} xml
 * @param {'w' | 'a'} ns w: Word body, a: PowerPoint shapes
 */
function xmlParagraphs(xml, ns) {
  const body = xml.replace(/<w:(instrText|delText)\b[^>]*>[\s\S]*?<\/w:\1>/g, '');
  /** @type {string[]} */
  const out = [];
  for (const p of body.split(new RegExp(`</${ns}:p>`))) {
    const text = decodeXml(
      p
        .replace(new RegExp(`<${ns}:tab\\b[^>]*/>`, 'g'), '\t')
        .replace(new RegExp(`<${ns}:(?:br|cr)\\b[^>]*/>`, 'g'), '\n')
        .replace(/<[^>]+>/g, ''),
    );
    for (const line of text.split('\n')) if (line.trim()) out.push(line.replace(/\s+/g, ' ').trim());
  }
  return out;
}

/**
 * Text of a DOCX (word/document.xml) or PPTX (slides in order) and its number of pictures.
 * @param {Source} src
 * @returns {Promise<{ paragraphs: string[], pictures: number }>}
 */
export async function officeText(src) {
  const zip = await JSZip.loadAsync(fs.readFileSync(src.path)).catch(() => {
    throw new UserError(`${src.ext.toUpperCase()} не открывается (битый архив)`);
  });
  if (src.kind === 'docx') {
    const xml = await zip.file('word/document.xml')?.async('string');
    if (!xml) throw new UserError('в DOCX нет word/document.xml');
    return { paragraphs: xmlParagraphs(xml, 'w'), pictures: zip.file(/^word\/media\//).length };
  }
  /** @type {string[]} */
  const paragraphs = [];
  for (const name of slideNames(zip)) {
    paragraphs.push(...xmlParagraphs((await zip.file(name)?.async('string')) ?? '', 'a'));
  }
  return { paragraphs, pictures: zip.file(/^ppt\/media\//).filter((f) => RASTER_EXT.test(f.name)).length };
}

/** @param {JSZip} zip */
function slideNames(zip) {
  const num = (/** @type {string} */ n) => Number(/slide(\d+)\.xml$/.exec(n)?.[1] ?? 0);
  return zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .map((f) => f.name)
    .sort((a, b) => num(a) - num(b));
}

/**
 * The first picture of a presentation in slide order (falls back to ppt/media order).
 * @param {string} file
 * @returns {Promise<Buffer | null>}
 */
async function firstPptxPicture(file) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  /** @type {string[]} */
  const ordered = [];
  for (const slide of slideNames(zip)) {
    const rels = (await zip.file(slide.replace(/slides\/(slide\d+\.xml)$/, 'slides/_rels/$1.rels'))?.async('string')) ?? '';
    for (const rel of rels.match(/<Relationship\b[^>]*>/g) ?? []) {
      const type = /\bType="([^"]+)"/.exec(rel)?.[1] ?? '';
      const target = /\bTarget="([^"]+)"/.exec(rel)?.[1] ?? '';
      if (!type.endsWith('/image') || /TargetMode="External"/.test(rel)) continue;
      ordered.push(new URL(target, `http://x/${slide}`).pathname.slice(1));
    }
  }
  ordered.push(...zip.file(/^ppt\/media\//).map((f) => f.name).sort());
  for (const name of ordered) {
    if (!RASTER_EXT.test(name)) continue;
    const buf = await zip.file(name)?.async('nodebuffer');
    if (!buf) continue;
    try {
      await sharp(buf).metadata();
      return buf;
    } catch {
      // not decodable (e.g. EMF disguised) — try the next picture
    }
  }
  return null;
}
