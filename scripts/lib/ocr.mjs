// @ts-check
/**
 * Windows built-in OCR (Windows.Media.Ocr) through scripts/lib/winocr.ps1 — one PowerShell
 * process per image, with a hard timeout. Other platforms skip OCR (with a warning upstream).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import sharp from 'sharp';
import { OCR_SCRIPT } from './config.mjs';
import { turnBox, turnedSize, undoTurn } from './geometry.mjs';
import { readJson, writeJson } from './util.mjs';

export const OCR_TIMEOUT_MS = 60_000;
export const OCR_CONCURRENCY = 2;
/** Pages with a shorter long side are read from a 2× copy: Windows OCR misses most text under ~12 px. */
const UPSCALE_BELOW = 1600;
/** A page where OCR found fewer non-space characters than this may lie sideways or upside down. */
export const SIDEWAYS_MAX_CHARS = 30;
/** A turned reading wins only with at least this many real words (and clearly more than upright). */
const MIN_TURNED_WORDS = 3;

/** @typedef {import('./geometry.mjs').Turn} Turn */
/** @typedef {import('./render.mjs').TextLine} TextLine */
/**
 * ocr-<n>.json: lines and words in pixels of the page image; `rotation` is the clockwise turn
 * that makes the page upright (the text was read from a copy turned that much).
 * @typedef {import('./render.mjs').TextPage & { lang?: string, rotation: Turn }} OcrPage
 */
/** @typedef {<T>(task: () => Promise<T>) => Promise<T>} Limit */

export const ocrAvailable = () => process.platform === 'win32';

/**
 * OCRs one image into a JSON file ({ width, height, lang, lines: [{ text, x, y, w, h, words }] }).
 * Never throws: failures come back as `{ ok: false, error }` so one bad page does not stop a run.
 * @param {string} image
 * @param {string} out
 * @param {string} [lang]
 * @returns {Promise<{ ok: true, page: import('./render.mjs').TextPage & { lang?: string } } | { ok: false, error: string }>}
 */
export function runOcr(image, out, lang = 'ru') {
  fs.rmSync(out, { force: true }); // a stale file must not pass for a fresh result
  return new Promise((resolve) => {
    let stderr = '';
    let settled = false;
    /** @param {Awaited<ReturnType<typeof runOcr>>} r */
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', OCR_SCRIPT, '-Path', image, '-Out', out, '-Lang', lang],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    const timer = setTimeout(() => {
      child.kill();
      done({ ok: false, error: `OCR не уложился в ${OCR_TIMEOUT_MS / 1000} с` });
    }, OCR_TIMEOUT_MS);
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', (e) => done({ ok: false, error: `не запустился powershell.exe: ${e.message}` }));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(out)) {
        try {
          done({ ok: true, page: readJson(out, { width: 0, height: 0, lines: [] }) });
        } catch (e) {
          done({ ok: false, error: /** @type {Error} */ (e).message });
        }
      } else {
        const first = stderr.split(/\r?\n/).find((l) => l.trim()) ?? '';
        done({ ok: false, error: `OCR завершился с кодом ${code}${first ? `: ${first.trim()}` : ''}` });
      }
    });
  });
}

const r1 = (/** @type {number} */ v) => Math.round(v * 10) / 10;
/** Non-space characters of OCR lines. @param {TextLine[]} lines */
export const lineChars = (lines) => lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0);
/** Words made of 3+ letters: garbage read from a wrongly turned page has few of them. @param {TextLine[]} lines */
const realWords = (lines) => lines.reduce((s, l) => s + (l.words ?? []).filter((w) => /^\p{L}{3,}[.,:;!?»)]*$/u.test(w.text)).length, 0);

/**
 * OCRs a page image into `out` as an OcrPage (boxes in pixels of the page image).
 *
 * - Small pages (long side < 1600 px, e.g. phone photos of 909×1280) are read from a 2× copy:
 *   on such photos this reads about twice as much text.
 * - With `turns`, a page where almost nothing was read (photos of certificates lying sideways)
 *   is also read turned by 90°, 180° and 270°; the turn with the most real words wins, its
 *   boxes are mapped back onto the unturned page and the turn is saved as `rotation`.
 *
 * Every OCR process goes through `limit`. Never throws: errors come back as `{ ok: false }`.
 * @param {string} png page image
 * @param {string} out
 * @param {{ limit: Limit, turns: boolean }} o
 * @returns {Promise<{ ok: true, page: OcrPage } | { ok: false, error: string }>}
 */
export async function ocrPage(png, out, o) {
  const { width: W = 0, height: H = 0 } = await sharp(png).metadata();
  const scale = Math.max(W, H) < UPSCALE_BELOW ? 2 : 1;
  const stem = out.replace(/\.json$/, '');

  /**
   * One OCR pass over the page turned by `turn` (and upscaled), boxes mapped back to the page.
   * @param {Turn} turn
   * @returns {Promise<{ ok: true, turn: Turn, lang?: string, lines: TextLine[] } | { ok: false, error: string }>}
   */
  const read = (turn) =>
    o.limit(async () => {
      const copy = turn === 0 && scale === 1 ? null : `${stem}-t${turn}.png`;
      const json = `${stem}-t${turn}.json`;
      try {
        const size = turnedSize(turn, W, H);
        if (copy) {
          // sharp applies rotate() before resize() whatever the call order (there is no extract here)
          let img = sharp(png).rotate(turn);
          if (scale !== 1) img = img.resize({ width: size.width * scale, height: size.height * scale, fit: 'fill', kernel: 'lanczos3' });
          await img.png().toFile(copy);
        }
        const r = await runOcr(copy ?? png, json);
        if (!r.ok) return r;
        const back = undoTurn(turn);
        /** @param {{ x: number, y: number, w: number, h: number }} b */
        const toPage = (b) => {
          const p = turnBox({ x: b.x / scale, y: b.y / scale, w: b.w / scale, h: b.h / scale }, back, size.width, size.height);
          return { x: r1(p.x), y: r1(p.y), w: r1(p.w), h: r1(p.h) };
        };
        const lines = (r.page.lines ?? []).map((l) => ({ text: l.text, ...toPage(l), words: (l.words ?? []).map((w) => ({ text: w.text, ...toPage(w) })) }));
        return { ok: true, turn, lang: r.page.lang, lines };
      } finally {
        if (copy) fs.rmSync(copy, { force: true });
        fs.rmSync(json, { force: true });
      }
    });

  const upright = await read(0);
  if (!upright.ok) return upright;
  let best = upright;
  if (o.turns && lineChars(upright.lines) < SIDEWAYS_MAX_CHARS) {
    const base = realWords(upright.lines);
    let bestWords = base;
    for (const r of await Promise.all(/** @type {Turn[]} */ ([90, 180, 270]).map(read))) {
      if (!r.ok) continue; // a failed extra reading only means no turn is found
      const words = realWords(r.lines);
      if (words >= Math.max(MIN_TURNED_WORDS, base + 2) && words > bestWords) {
        best = r;
        bestWords = words;
      }
    }
  }
  /** @type {OcrPage} */
  const page = { width: W, height: H, ...(best.lang ? { lang: best.lang } : {}), rotation: best.turn, lines: best.lines };
  writeJson(out, page);
  return { ok: true, page };
}
