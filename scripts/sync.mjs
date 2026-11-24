#!/usr/bin/env node
// @ts-check
/**
 * `npm run sync` — the achievements inbox behind "обнови ачивки". Full procedure: docs/SYNC.md.
 *
 * Finds files in the achievements folder whose SHA-256 is not in content/.sync/manifest.json,
 * renders every page, OCRs it, detects private data and prepares a draft in
 * .private/inbox/<sha12>/. Also edits the manifest (--link / --hide / --forget) and shows the
 * state of every source (--status). The achievements folder is only ever read.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CONTENT_DIR, PRIVATE, ROOT, findSourceDir, inboxDirFor, manifestPathFor, usePrivateDir } from './lib/config.mjs';
import { KINDS, KIND_LABEL, detectPage, detectPlain, detectQr, docHints, hintPages, mergeCandidates, pageRows, spanBox } from './lib/detect.mjs';
import { buildDraft } from './lib/draft.mjs';
import { entryIds } from './lib/entries.mjs';
import { isTurn } from './lib/geometry.mjs';
import { OCR_CONCURRENCY, ocrAvailable, ocrPage } from './lib/ocr.mjs';
import { paintBoxes, radiusFor, writeReview, writeWebp } from './lib/paint.mjs';
import { countPages, eachPage, officeText } from './lib/render.mjs';
import { hashFile, indexSources, loadSourcesMap, rememberPages, saveSourcesMap, sourceFromRecord } from './lib/sources.mjs';
import {
  REASONS,
  REASON_LABEL,
  applyDecision,
  describeItems,
  formatPages,
  loadLedger,
  loadManifest,
  newRecord,
  parsePages,
  saveLedger,
  saveManifest,
} from './lib/store.mjs';
import { UserError, color, createLimiter, displayPath, parseCli, plural, readJson, runMain, short, today, writeJson } from './lib/util.mjs';

/**
 * Bump when page rendering or OCR changes: cached page-*.png / text-*.json / ocr-*.json are then
 * redone. v2: text direction of the PDF text layer, OCR of small pages from a 2× copy, OCR of
 * sideways pages from a turned copy.
 */
const RENDER_VERSION = 2;
/** Written into candidates.json so old results can be told apart. */
const DETECT_VERSION = 3;
const REVIEW_DPI = 150;
const REVIEW_MAX_SIDE = 2400;
/** redacted-<n>.webp previews use the same size/quality as published images. */
const PREVIEW_MAX = 1800;
const PREVIEW_QUALITY = 82;
/** Files in flight at once (page rendering is in-process; OCR runs in OCR_CONCURRENCY PowerShell processes). */
const FILE_CONCURRENCY = 2;
/** Pages whose PDF text layer has at least this many characters use it (not OCR) for the draft text… */
const TEXT_LAYER_MIN_CHARS = 40;
/** …and the OCR text is added as well when it is this much longer (wording printed as a picture). */
const OCR_EXTRA_TEXT = 1.3;

const HELP_HINT = 'npm run sync -- --help';
const HELP = `npm run sync — новые файлы из папки ачивок → .private/inbox/<sha12>/
(превью страниц, OCR, поиск личных данных, review- и redacted-картинки, черновик draft.md)

  npm run sync                             обработать новые файлы и добавить их в манифест (pending)
  npm run sync -- --scan-only [--all]      то же без записи в манифест; --all — и уже известные файлы
  npm run sync -- --only <sha12|путь>      только этот файл (можно повторять); --force — заново рендер и OCR
  npm run sync -- --status [--json]        все источники: статус в манифесте и путь на этом ПК
  npm run sync -- --link <sha12|путь> --entry <id> [--pages 1-2] [--note "…"]
  npm run sync -- --hide <sha12|путь> --reason <код> [--pages 3] [--note "…"]
  npm run sync -- --forget <sha12|путь>    убрать файл из манифеста (следующий sync снова сочтёт его новым)
  npm run sync -- --boxes <sha12|путь> [--page N] [--grep "текст"]
                                           строки страницы с координатами 0..1 — готовые пункты redact

Коды --reason: ${REASONS.join(', ')}
--note пишется только в приватный .private/ledger.json.
Для тестов: --manifest <файл>  --content-dir <папка>  --source <папка ачивок>  --private-dir <вместо .private>
Папка ачивок: $ACHIEVEMENTS_DIR или первая C:/Dad/*chievements. Порядок работы: docs/SYNC.md`;

/** Options each command accepts (anything else is an error, so typos do not silently do nothing). */
const ALLOWED = /** @type {Record<string, string[]>} */ ({
  sync: ['scan-only', 'all', 'force', 'only'],
  status: ['json'],
  link: ['entry', 'pages', 'note'],
  hide: ['reason', 'pages', 'note'],
  forget: [],
  boxes: ['page', 'grep'],
});
const COMMON = ['help', 'manifest', 'content-dir', 'source', 'private-dir'];

/**
 * @typedef {object} Meta  .private/inbox/<sha12>/meta.json
 * @property {number} version RENDER_VERSION
 * @property {string} sha256
 * @property {string} ext
 * @property {string} kind
 * @property {number} pages page count recorded in the manifest
 * @property {{ w: number, h: number }[]} sizes rendered page images (empty for DOCX)
 * @property {number[]} textLayer pages that have a PDF text layer (text-<n>.json)
 * @property {string} rendered ISO time
 */
/** @typedef {import('./lib/render.mjs').TextPage} TextPage */
/** @typedef {import('./lib/geometry.mjs').Turn} Turn */
/**
 * @typedef {object} Processed
 * @property {import('./lib/sources.mjs').Source} src
 * @property {string} dir
 * @property {number} pages
 * @property {import('./lib/detect.mjs').Candidate[]} candidates
 * @property {import('./lib/detect.mjs').Finding[]} findings
 * @property {import('./lib/detect.mjs').DocHint[]} hints
 * @property {Map<number, Turn>} rotations pages that read upright only after a clockwise turn
 * @property {string[]} warnings
 * @property {boolean} reused page images and OCR came from an earlier run
 * @property {number} seconds
 */
/** @typedef {{ src: import('./lib/sources.mjs').Source, error: string }} Failed */

/** @param {string} dir @param {string} kind @param {number} n @param {string} ext */
const inboxFile = (dir, kind, n, ext) => path.join(dir, `${kind}-${n}.${ext}`);
/** Everything sync writes into an inbox folder (ocr-<n>-t<turn>.* are leftovers of an interrupted OCR). */
const INBOX_OUTPUT = /^(?:(?:page|ocr|text|review|redacted)-\d+\.(?:png|json|webp)|ocr-\d+-t\d+\.(?:png|json)|candidates\.json|draft\.md|meta\.json)$/;
const rel = (/** @type {string} */ p) => displayPath(ROOT, p);
/** @param {string} dir */
const readMeta = (dir) => readJson(path.join(dir, 'meta.json'), /** @type {Meta | null} */ (null));
/** Non-space characters of an OCR / text-layer page. @param {TextPage | null} tp */
const textChars = (tp) => (tp ? tp.lines.reduce((s, l) => s + l.text.replace(/\s/g, '').length, 0) : 0);

runMain(async () => {
  const o = parseCli(
    process.argv.slice(2),
    {
      help: { type: 'boolean', short: 'h' },
      'scan-only': { type: 'boolean' },
      all: { type: 'boolean' },
      force: { type: 'boolean' },
      only: { type: 'string', multiple: true },
      status: { type: 'boolean' },
      json: { type: 'boolean' },
      link: { type: 'string' },
      entry: { type: 'string' },
      hide: { type: 'string' },
      reason: { type: 'string' },
      pages: { type: 'string' },
      note: { type: 'string' },
      forget: { type: 'string' },
      boxes: { type: 'string' },
      page: { type: 'string' },
      grep: { type: 'string' },
      manifest: { type: 'string' },
      'content-dir': { type: 'string' },
      source: { type: 'string' },
      'private-dir': { type: 'string' },
    },
    HELP_HINT,
  );
  if (o.help) {
    console.log(HELP);
    return 0;
  }
  const given = Object.keys(o).filter((k) => o[/** @type {keyof typeof o} */ (k)] !== undefined);
  const commands = ['status', 'link', 'hide', 'forget', 'boxes'].filter((k) => given.includes(k));
  if (commands.length > 1) throw new UserError(`Команды ${commands.map((c) => `--${c}`).join(' и ')} нельзя смешивать.`);
  const command = commands[0] ?? 'sync';
  const stray = given.filter((k) => !COMMON.includes(k) && k !== command && !ALLOWED[command].includes(k));
  if (stray.length) throw new UserError(`--${stray[0]} не подходит к ${command === 'sync' ? 'обработке' : `--${command}`}. Справка: ${HELP_HINT}`);

  if (o['private-dir']) usePrivateDir(o['private-dir']);
  const contentDir = path.resolve(o['content-dir'] ?? CONTENT_DIR);
  /** @type {Ctx} */
  const ctx = { contentDir, manifestFile: path.resolve(o.manifest ?? manifestPathFor(contentDir)), sourceOpt: o.source };
  switch (command) {
    case 'status':
      return cmdStatus(ctx, Boolean(o.json));
    case 'link':
      if (!o.entry) throw new UserError('Для --link нужен --entry <id>.');
      return cmdDecide(ctx, /** @type {string} */ (o.link), { status: 'entry', entry: o.entry, pages: o.pages, note: o.note });
    case 'hide':
      if (!o.reason) throw new UserError(`Для --hide нужен --reason: ${REASONS.join(', ')}.`);
      return cmdDecide(ctx, /** @type {string} */ (o.hide), { status: 'hidden', reason: o.reason, pages: o.pages, note: o.note });
    case 'forget':
      return cmdForget(ctx, /** @type {string} */ (o.forget));
    case 'boxes':
      return cmdBoxes(ctx, /** @type {string} */ (o.boxes), o.page, o.grep);
    default:
      return cmdSync(ctx, { scanOnly: Boolean(o['scan-only']), all: Boolean(o.all), force: Boolean(o.force), only: o.only ?? [] });
  }
});

/** @typedef {{ contentDir: string, manifestFile: string, sourceOpt?: string }} Ctx */

// ── sync ──────────────────────────────────────────────────────────────────────────────────

/**
 * @param {Ctx} ctx
 * @param {{ scanOnly: boolean, all: boolean, force: boolean, only: string[] }} opts
 */
async function cmdSync(ctx, opts) {
  const started = Date.now();
  const sourceDir = findSourceDir(ctx.sourceOpt);
  console.log(`${color.bold('Папка ачивок:')} ${sourceDir}`);
  const scan = indexSources(sourceDir);
  saveSourcesMap(scan.bySha);
  const manifest = loadManifest(ctx.manifestFile);
  const sources = [...scan.bySha.values()];
  const fresh = sources.filter((s) => !manifest.files[s.sha256]);
  const known = sources.length - fresh.length;

  let queue = opts.all ? sources : fresh;
  if (opts.only.length) {
    const wanted = new Set(opts.only.map((a) => resolveSha(ctx, a, manifest)));
    queue = sources.filter((s) => wanted.has(s.sha256));
    if (queue.length < wanted.size) throw new UserError('Части файлов из --only нет в папке ачивок.');
  }

  const copies = scan.fileCount - sources.length;
  console.log(
    `Файлов: ${scan.fileCount}${copies ? ` (копий одного и того же: ${copies})` : ''} · новых: ${fresh.length} · уже на учёте: ${known} · не поддерживаются: ${scan.unsupported.length}`,
  );
  if (!ocrAvailable()) console.log(color.yellow('! OCR есть только в Windows — здесь проверяются лишь текстовый слой PDF и QR-коды.'));
  if (!queue.length) {
    console.log(color.green('Новых файлов нет — всё уже на учёте.'));
    printUnsupported(scan.unsupported);
    return 0;
  }
  console.log(`Обрабатываю ${queue.length} ${plural(queue.length, 'файл', 'файла', 'файлов')}${opts.scanOnly ? ' (манифест не трогаю)' : ''}…`);

  const ocrLimit = createLimiter(OCR_CONCURRENCY);
  const fileLimit = createLimiter(FILE_CONCURRENCY);
  let done = 0;
  const width = String(queue.length).length;
  /** @type {(Processed | Failed)[]} */
  const results = await Promise.all(
    queue.map((src) =>
      fileLimit(async () => {
        /** @type {Processed | Failed} */
        let r;
        try {
          r = await processSource(src, { force: opts.force, ocrLimit });
        } catch (e) {
          r = { src, error: e instanceof UserError ? e.message : String(/** @type {Error} */ (e)?.stack ?? e) };
          removeIfEmpty(inboxDirFor(src.sha256));
        }
        done++;
        const head = color.dim(`[${String(done).padStart(width)}/${queue.length}]`);
        if ('error' in r) console.log(`${head} ${color.red('✗')} ${short(src.sha256)} ${src.rel} — ${r.error.split('\n')[0]}`);
        else console.log(`${head} ${color.green('✓')} ${short(src.sha256)} · ${r.pages} стр. · ${kindsLine(r) || 'чисто'} ${color.dim(`· ${r.seconds.toFixed(1)} с${r.reused ? ' (OCR из кэша)' : ''}`)}`);
        return r;
      }),
    ),
  );

  const ok = /** @type {Processed[]} */ (results.filter((r) => !('error' in r)));
  const failed = /** @type {Failed[]} */ (results.filter((r) => 'error' in r));
  rememberPages(new Map(ok.map((r) => [r.src.sha256, r.pages])));
  let added = 0;
  if (!opts.scanOnly) {
    for (const r of ok) {
      if (manifest.files[r.src.sha256]) continue;
      manifest.files[r.src.sha256] = newRecord(r.src.ext, r.pages);
      added++;
    }
    if (added) saveManifest(ctx.manifestFile, manifest);
  }

  console.log('');
  console.log(color.bold('Итог'));
  for (const r of [...ok].sort((a, b) => a.src.rel.localeCompare(b.src.rel))) {
    const isNew = fresh.includes(r.src);
    console.log(
      `  ${rel(r.dir)}  ${r.src.ext.padEnd(4)} ${String(r.pages).padStart(3)} стр.  ${(kindsLine(r) || '—').padEnd(34)} ${color.dim(r.src.rel)}${isNew ? '' : color.dim(' (известный)')}`,
    );
    for (const h of r.hints) {
      const where = hintPages(h, r.pages);
      console.log(color.cyan(`      → ${where ? `${where}: ` : ''}${h.text} (если скрываем: --reason ${h.reason})`));
    }
    for (const line of rotationLines(r.rotations, r.pages)) console.log(color.cyan(`      ↻ ${line}`));
    for (const w of r.warnings) console.log(color.yellow(`      ! ${w}`));
  }
  for (const f of failed) {
    console.log(color.red(`  ✗ ${short(f.src.sha256)} ${f.src.rel}: ${f.error.split('\n')[0]}`));
    console.log(color.dim(`      если файл не нужен (есть читаемая копия и т.п.): npm run sync -- --hide ${short(f.src.sha256)} --reason <код> --note "…"`));
  }
  printUnsupported(scan.unsupported);

  const pages = ok.reduce((s, r) => s + r.pages, 0);
  const totals = KINDS.map((k) => [k, ok.reduce((s, r) => s + r.candidates.filter((c) => c.kind === k).length, 0)]).filter(([, n]) => n);
  const secs = Math.round((Date.now() - started) / 1000);
  console.log('');
  console.log(
    `Обработано: ${ok.length} ${plural(ok.length, 'файл', 'файла', 'файлов')}, ${pages} стр., ошибок: ${failed.length} · ${Math.floor(secs / 60)} мин ${secs % 60} с`,
  );
  console.log(`Кандидаты на закраску: ${totals.length ? totals.map(([k, n]) => `${KIND_LABEL[/** @type {import('./lib/detect.mjs').Kind} */ (k)]} ${n}`).join(' · ') : 'нет'}`);
  if (opts.scanOnly) console.log(color.dim('Манифест не менялся (--scan-only).'));
  else if (added) console.log(`В манифест добавлено как pending: ${added}.`);
  console.log('');
  console.log(color.bold('Дальше:'));
  console.log('  1. Для каждой папки инбокса посмотри page-*.png и review-*.png (Read) и реши: публикуем или скрываем.');
  console.log('  2. Скрыть: npm run sync -- --hide <sha12> --reason <код> [--pages …] [--note "…"]');
  console.log('  3. Публикуем: draft.md → content/achievements/<id>.md (факты только из документа, RU+EN), проверь redact;');
  console.log('     npm run media -- --id <id> → посмотри content/achievements/media/<id>.webp → npm run sync -- --link <sha12> --entry <id>');
  console.log('  4. npm run build → git commit & push → проверь Actions и живой сайт. Подробно: docs/SYNC.md');
  return failed.length ? 1 : 0;
}

/**
 * "стр. 2, 4 повёрнуты на 90° (в записи: rotate: 90)" per turn, for the summary.
 * @param {Map<number, Turn>} rotations
 * @param {number} pages
 */
function rotationLines(rotations, pages) {
  /** @type {Map<Turn, number[]>} */
  const byTurn = new Map();
  for (const [page, turn] of rotations) byTurn.set(turn, [...(byTurn.get(turn) ?? []), page]);
  return [...byTurn].map(([turn, list]) => {
    const what = pages > 1 ? `стр. ${list.join(', ')} ${list.length > 1 ? 'повёрнуты' : 'повёрнута'}` : 'картинка повёрнута';
    return `${what} на ${turn}° (в записи: rotate: ${turn})`;
  });
}

/** "ИИН×1 QR×2" for a processed file (boxes + text-only findings). */
function kindsLine(/** @type {Processed} */ r) {
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const c of [...r.candidates, ...r.findings]) counts.set(c.kind, (counts.get(c.kind) ?? 0) + 1);
  return KINDS.filter((k) => counts.has(k))
    .map((k) => `${KIND_LABEL[k]}×${counts.get(k)}`)
    .join(' ');
}

/** @param {{ rel: string, ext: string }[]} list */
function printUnsupported(list) {
  if (!list.length) return;
  console.log(color.yellow(`Не поддерживаются (${list.length}) — сконвертируй в PDF/JPG, если это ачивки:`));
  for (const u of list) console.log(color.yellow(`  · ${u.rel}`));
}

/** Drops the inbox folder of a file that failed before anything was written into it. @param {string} dir */
function removeIfEmpty(dir) {
  try {
    if (!fs.readdirSync(dir).length) fs.rmdirSync(dir);
  } catch {
    // no folder: nothing to tidy
  }
}

/**
 * Decodes a page preview to RGB pixels.
 * @param {string} png
 * @returns {Promise<import('./lib/render.mjs').Raster>}
 */
async function readRaster(png) {
  const { data, info } = await sharp(png).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * Renders, OCRs and scans one source into .private/inbox/<sha12>/. Page images and OCR from an
 * earlier run are reused unless `force`; detection, review images and the draft are always redone.
 * @param {import('./lib/sources.mjs').Source} src
 * @param {{ force: boolean, ocrLimit: ReturnType<typeof createLimiter> }} opts
 * @returns {Promise<Processed>}
 */
async function processSource(src, opts) {
  const t0 = Date.now();
  const dir = inboxDirFor(src.sha256);
  fs.mkdirSync(dir, { recursive: true });
  const old = readMeta(dir);
  const reused = Boolean(
    !opts.force &&
      old &&
      old.version === RENDER_VERSION &&
      old.sha256 === src.sha256 &&
      old.sizes.every((_, i) => fs.existsSync(inboxFile(dir, 'page', i + 1, 'png'))),
  );
  const office = src.kind === 'docx' || src.kind === 'pptx' ? await officeText(src) : null;

  /** @type {Meta} */
  let meta;
  if (reused && old) meta = old;
  else {
    for (const name of fs.readdirSync(dir)) if (INBOX_OUTPUT.test(name)) fs.rmSync(path.join(dir, name), { force: true });
    /** @type {{ w: number, h: number }[]} */
    const sizes = [];
    /** @type {number[]} */
    const textLayer = [];
    const n = await eachPage(src, { dpi: REVIEW_DPI, maxSide: REVIEW_MAX_SIDE, withText: true }, async (p) => {
      await sharp(p.data, { raw: { width: p.width, height: p.height, channels: 3 } }).png().toFile(inboxFile(dir, 'page', p.page, 'png'));
      sizes.push({ w: p.width, h: p.height });
      if (p.text?.lines.length) {
        writeJson(inboxFile(dir, 'text', p.page, 'json'), { width: p.width, height: p.height, source: 'textlayer', rotation: p.text.rotation, lines: p.text.lines });
        textLayer.push(p.page);
      }
    });
    meta = { version: RENDER_VERSION, sha256: src.sha256, ext: src.ext, kind: src.kind, pages: src.kind === 'pdf' ? n : 1, sizes, textLayer, rendered: new Date().toISOString() };
    writeJson(path.join(dir, 'meta.json'), meta);
  }

  /** @type {string[]} */
  const warnings = [];
  if (ocrAvailable()) {
    await Promise.all(
      meta.sizes.map(async (_, i) => {
        const out = inboxFile(dir, 'ocr', i + 1, 'json');
        if (fs.existsSync(out)) return;
        const layer = readJson(inboxFile(dir, 'text', i + 1, 'json'), /** @type {TextPage | null} */ (null));
        // a page whose PDF text layer has the text needs no reading from turned copies
        const r = await ocrPage(inboxFile(dir, 'page', i + 1, 'png'), out, { limit: opts.ocrLimit, turns: textChars(layer) < TEXT_LAYER_MIN_CHARS });
        if (!r.ok) warnings.push(`стр. ${i + 1}: ${r.error}`);
      }),
    );
  }

  /** @type {import('./lib/detect.mjs').Candidate[]} */
  const found = [];
  /** masked text per page for the draft: the text layer when it has real text, OCR when it saw more */
  /** @type {{ page: number, from: string, lines: string[] }[]} */
  const texts = [];
  /** every masked text we have (OCR and text layer), for the document-type hints */
  /** @type {{ page: number, lines: string[] }[]} */
  const allTexts = [];
  /** @type {Map<number, Turn>} */
  const rotations = new Map();
  for (let n = 1; n <= meta.sizes.length; n++) {
    const ocr = readJson(inboxFile(dir, 'ocr', n, 'json'), /** @type {TextPage | null} */ (null));
    const layer = readJson(inboxFile(dir, 'text', n, 'json'), /** @type {TextPage | null} */ (null));
    const fromOcr = ocr ? detectPage(ocr, n, 'ocr') : null;
    const fromLayer = layer ? detectPage(layer, n, 'textlayer') : null;
    found.push(...(fromOcr?.candidates ?? []), ...(fromLayer?.candidates ?? []), ...(await detectQr(await readRaster(inboxFile(dir, 'page', n, 'png')), n)));
    const layerChars = textChars(layer);
    const useLayer = Boolean(fromLayer) && layerChars >= TEXT_LAYER_MIN_CHARS;
    if (fromLayer && useLayer) texts.push({ page: n, from: 'textlayer', lines: fromLayer.masked });
    // certificates often have only the filled-in fields as text and the wording baked into a picture
    if (!useLayer || textChars(ocr) > layerChars * OCR_EXTRA_TEXT) texts.push({ page: n, from: 'ocr', lines: fromOcr?.masked ?? [] });
    for (const r of [fromOcr, fromLayer]) if (r) allTexts.push({ page: n, lines: r.masked });
    const turn = (useLayer ? layer : ocr)?.rotation;
    if (isTurn(turn) && turn) rotations.set(n, turn);
  }
  const candidates = mergeCandidates(found);
  const plain = office ? detectPlain(office.paragraphs) : null;
  if (plain) {
    texts.push({ page: 0, from: src.kind, lines: plain.masked });
    allTexts.push({ page: 0, lines: plain.masked });
  }
  const findings = plain?.findings ?? [];
  const hints = docHints(allTexts);
  writeJson(path.join(dir, 'candidates.json'), {
    version: DETECT_VERSION,
    sha256: src.sha256,
    pages: meta.pages,
    generated: new Date().toISOString(),
    rotations: Object.fromEntries(rotations),
    candidates,
    findings,
    hints,
  });

  for (let n = 1; n <= meta.sizes.length; n++) {
    const png = inboxFile(dir, 'page', n, 'png');
    const marks = candidates.map((c, i) => ({ n: i + 1, kind: c.kind, box: c, page: c.page })).filter((m) => m.page === n);
    await writeReview(png, marks, inboxFile(dir, 'review', n, 'png'));
    const raster = await readRaster(png);
    const painted = await paintBoxes(raster, candidates.filter((c) => c.page === n), radiusFor(raster, PREVIEW_MAX));
    // the preview is turned upright like the published image would be
    await writeWebp({ ...raster, data: painted }, { out: inboxFile(dir, 'redacted', n, 'webp'), max: PREVIEW_MAX, quality: PREVIEW_QUALITY, rotate: rotations.get(n) });
  }
  fs.writeFileSync(
    path.join(dir, 'draft.md'),
    buildDraft({ sha256: src.sha256, ext: src.ext, pages: meta.pages, candidates, findings, texts, pictures: office?.pictures ?? 0, hints, rotations }),
  );
  return { src, dir, pages: meta.pages, candidates, findings, hints, rotations, warnings, reused, seconds: (Date.now() - t0) / 1000 };
}

// ── status ────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} StatusRow
 * @property {string} sha256
 * @property {string} sha12
 * @property {string} ext
 * @property {number} pages
 * @property {'manifest' | 'new' | 'missing'} state
 * @property {import('./lib/store.mjs').Item[]} items
 * @property {string} summary
 * @property {string | null} rel path inside the achievements folder (null: not on this PC)
 * @property {string[]} also other copies
 * @property {string | null} inbox
 * @property {string | null} note last private note
 */

/**
 * @param {Ctx} ctx
 * @param {boolean} asJson
 */
async function cmdStatus(ctx, asJson) {
  const sourceDir = findSourceDir(ctx.sourceOpt);
  const scan = indexSources(sourceDir);
  saveSourcesMap(scan.bySha);
  const manifest = loadManifest(ctx.manifestFile);
  const ledger = loadLedger();
  const entries = new Set(entryIds(path.join(ctx.contentDir, 'achievements')));

  /** @type {StatusRow[]} */
  const rows = [];
  /** @type {Map<string, number>} */
  const counted = new Map();
  for (const s of [...scan.bySha.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const rec = manifest.files[s.sha256];
    const meta = readMeta(inboxDirFor(s.sha256));
    let pages = rec?.pages ?? meta?.pages ?? s.pages;
    if (pages === undefined) {
      pages = await countPages(s).catch(() => 0);
      if (pages) counted.set(s.sha256, pages);
    }
    rows.push({
      sha256: s.sha256,
      sha12: short(s.sha256),
      ext: s.ext,
      pages,
      state: rec ? 'manifest' : 'new',
      items: rec?.items ?? [],
      summary: rec ? describeItems(rec) : 'новый — нет в манифесте',
      rel: s.rel,
      also: s.also.map((a) => a.rel),
      inbox: meta ? rel(inboxDirFor(s.sha256)) : null,
      note: ledger[s.sha256]?.notes.at(-1)?.text ?? null,
    });
  }
  for (const [sha, rec] of Object.entries(manifest.files)) {
    if (scan.bySha.has(sha)) continue;
    rows.push({
      sha256: sha,
      sha12: short(sha),
      ext: rec.ext,
      pages: rec.pages,
      state: 'missing',
      items: rec.items,
      summary: `${describeItems(rec)} · файла нет в папке`,
      rel: null,
      also: [],
      inbox: null,
      note: ledger[sha]?.notes.at(-1)?.text ?? null,
    });
  }
  rememberPages(counted);
  const brokenLinks = rows.flatMap((r) => r.items.filter((it) => it.status === 'entry' && it.entry && !entries.has(it.entry)).map((it) => `${r.sha12} → ${it.entry}`));

  if (asJson) {
    console.log(JSON.stringify({ sourceDir, manifest: ctx.manifestFile, sources: rows, brokenLinks }, null, 2));
    return 0;
  }
  console.log(`${color.bold('Папка ачивок:')} ${sourceDir}`);
  console.log(color.dim(`${'sha12'.padEnd(12)}  ${'тип'.padEnd(4)} ${'стр'.padStart(3)}  статус`));
  for (const r of rows) {
    const where = r.rel ? color.dim(`  ${r.rel}${r.also.length ? ` (+${r.also.length} ${plural(r.also.length, 'копия', 'копии', 'копий')})` : ''}`) : '';
    const state = r.state === 'new' ? color.yellow(r.summary) : r.state === 'missing' ? color.red(r.summary) : r.items.some((it) => it.status === 'pending') ? color.cyan(r.summary) : r.summary;
    console.log(`${r.sha12}  ${r.ext.padEnd(4)} ${String(r.pages).padStart(3)}  ${state}${where}${r.note ? color.dim(`  « ${r.note} »`) : ''}`);
  }
  const count = (/** @type {(r: StatusRow) => boolean} */ f) => rows.filter(f).length;
  console.log('');
  console.log(
    `Всего: ${rows.length} · на сайте: ${count((r) => r.items.some((it) => it.status === 'entry'))} · ждут решения: ${count((r) => r.items.some((it) => it.status === 'pending'))} · скрыты: ${count((r) => r.items.length > 0 && r.items.every((it) => it.status === 'hidden'))} · новых: ${count((r) => r.state === 'new')} · нет в папке: ${count((r) => r.state === 'missing')}`,
  );
  for (const b of brokenLinks) console.log(color.red(`! в манифесте ссылка на несуществующую запись: ${b}`));
  return 0;
}

// ── manifest edits ────────────────────────────────────────────────────────────────────────

/**
 * --link / --hide: assigns pages of a source to an entry or hides them with a reason.
 * @param {Ctx} ctx
 * @param {string} target sha12 prefix or a path
 * @param {{ status: 'entry' | 'hidden', entry?: string, reason?: string, pages?: string, note?: string }} d
 */
async function cmdDecide(ctx, target, d) {
  const manifest = loadManifest(ctx.manifestFile);
  const sha = resolveSha(ctx, target, manifest);
  if (d.status === 'entry') {
    const id = /** @type {string} */ (d.entry);
    const file = path.join(ctx.contentDir, 'achievements', `${id}.md`);
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u.test(id) || !fs.existsSync(file)) {
      throw new UserError(`Нет записи ${rel(file)} — сначала создай её, потом --link.`);
    }
  } else if (!REASONS.includes(/** @type {import('./lib/store.mjs').Reason} */ (d.reason))) {
    throw new UserError(`Неизвестная причина «${d.reason}». Можно: ${REASONS.join(', ')}.`);
  }

  let rec = manifest.files[sha];
  if (!rec) {
    const { ext, pages } = await describeSource(sha);
    rec = manifest.files[sha] = newRecord(ext, pages);
    console.log(color.dim(`${short(sha)} ещё не было в манифесте — добавил (${ext}, ${pages} стр.).`));
  }
  const pages = parsePages(d.pages ?? 'all', rec.pages);
  const warnings = applyDecision(rec, {
    status: d.status,
    pages,
    ...(d.entry ? { entry: d.entry } : {}),
    ...(d.reason ? { reason: /** @type {import('./lib/store.mjs').Reason} */ (d.reason) } : {}),
  });
  saveManifest(ctx.manifestFile, manifest);

  if (d.note) {
    const ledger = loadLedger();
    (ledger[sha] ??= { notes: [] }).notes.push({
      date: today(),
      pages: formatPages(pages, rec.pages),
      status: d.status,
      ...(d.entry ? { entry: d.entry } : {}),
      ...(d.reason ? { reason: /** @type {import('./lib/store.mjs').Reason} */ (d.reason) } : {}),
      text: d.note,
    });
    saveLedger(ledger);
  }
  const what = d.status === 'entry' ? `→ ${d.entry}` : `скрыто (${REASON_LABEL[/** @type {import('./lib/store.mjs').Reason} */ (d.reason)]})`;
  console.log(`${color.green('✓')} ${short(sha)}: ${pages.size === rec.pages ? 'все страницы' : `стр. ${formatPages(pages, rec.pages)}`} ${what}`);
  for (const w of warnings) console.log(color.yellow(`  ! ${w}`));
  console.log(color.dim(`  сейчас: ${describeItems(rec)}${d.note ? ` · заметка в ${rel(PRIVATE.ledger)}` : ''}`));
  return 0;
}

/**
 * --forget: drops a source from the manifest (and its private notes); the next sync sees it as new.
 * @param {Ctx} ctx
 * @param {string} target
 */
function cmdForget(ctx, target) {
  const manifest = loadManifest(ctx.manifestFile);
  const sha = resolveSha(ctx, target, manifest);
  if (!manifest.files[sha]) throw new UserError(`${short(sha)} нет в манифесте — забывать нечего.`);
  const was = describeItems(manifest.files[sha]);
  delete manifest.files[sha];
  saveManifest(ctx.manifestFile, manifest);
  const ledger = loadLedger();
  if (ledger[sha]) {
    delete ledger[sha];
    saveLedger(ledger);
  }
  console.log(`${color.green('✓')} ${short(sha)} убран из манифеста (было: ${was}). Следующий npm run sync обработает его как новый.`);
  return 0;
}

/**
 * Ext and page count of a source that is not in the manifest yet (inbox meta, else the file).
 * A file that cannot be opened (PDF with a password, broken file) counts as one page, so it can
 * still be hidden — otherwise it would stay "new" and fail every `npm run sync`.
 * @param {string} sha
 */
async function describeSource(sha) {
  const meta = readMeta(inboxDirFor(sha));
  if (meta) return { ext: meta.ext, pages: meta.pages };
  const r = loadSourcesMap()[sha];
  if (!r) throw new UserError(`${short(sha)} не найден ни в инбоксе, ни в папке ачивок. Сначала npm run sync.`);
  const src = sourceFromRecord(sha, r);
  return { ext: src.ext, pages: src.pages ?? (await countPages(src).catch(() => 1)) };
}

/**
 * Turns a CLI target into a full SHA-256: a hex prefix (≥ 6 chars) of a known source, manifest
 * record or inbox folder — or a path to a file (absolute, from cwd, or inside the achievements folder).
 * @param {Ctx} ctx
 * @param {string} arg
 * @param {import('./lib/store.mjs').Manifest} manifest
 */
function resolveSha(ctx, arg, manifest) {
  const a = arg.trim();
  if (/^[0-9a-f]{6,64}$/i.test(a)) {
    const key = a.toLowerCase();
    const pool = new Set([...Object.keys(manifest.files), ...Object.keys(loadSourcesMap()), ...inboxShas()]);
    let hits = [...pool].filter((s) => s.startsWith(key));
    if (!hits.length) {
      // the private map may be stale (files added since the last run)
      const scan = indexSources(findSourceDir(ctx.sourceOpt));
      saveSourcesMap(scan.bySha);
      hits = [...scan.bySha.keys()].filter((s) => s.startsWith(key));
    }
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new UserError(`«${a}» подходит к ${hits.length} файлам — добавь символов хэша.`);
  }
  /** @type {string[]} */
  const paths = [path.resolve(a)];
  try {
    paths.push(path.join(findSourceDir(ctx.sourceOpt), a));
  } catch {
    // no achievements folder on this PC: only the cwd-relative path is tried
  }
  const file = paths.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
  if (!file) throw new UserError(`Не нашёл «${a}»: это не известный хэш и не путь к файлу.`);
  return hashFile(file);
}

/** Full hashes of inbox folders (from their meta.json). */
function inboxShas() {
  /** @type {string[]} */
  let names = [];
  try {
    names = fs.readdirSync(PRIVATE.inbox);
  } catch {
    return [];
  }
  return names.map((n) => readMeta(path.join(PRIVATE.inbox, n))?.sha256).filter((s) => typeof s === 'string');
}

// ── boxes ─────────────────────────────────────────────────────────────────────────────────

/**
 * Prints rows of a page (text layer and OCR) with page-relative boxes; with --grep prints
 * ready-to-paste `redact:` items for the matched text. Console only — text stays private.
 * @param {Ctx} ctx
 * @param {string} target
 * @param {string | undefined} pageOpt
 * @param {string | undefined} grep
 */
function cmdBoxes(ctx, target, pageOpt, grep) {
  const sha = resolveSha(ctx, target, loadManifest(ctx.manifestFile));
  const dir = inboxDirFor(sha);
  const meta = readMeta(dir);
  if (!meta) throw new UserError(`В инбоксе нет ${short(sha)}. Сначала: npm run sync -- --scan-only --only ${short(sha)}`);
  const total = meta.sizes.length;
  const pages = pageOpt ? [Number(pageOpt)] : meta.sizes.map((_, i) => i + 1);
  if (pages.some((p) => !Number.isInteger(p) || p < 1 || p > total)) throw new UserError(`Страницы ${pageOpt} нет (всего ${total}).`);
  const needle = grep?.toLowerCase();
  const fmt = (/** @type {{ x: number, y: number, w: number, h: number }} */ b) => `x: ${b.x}, y: ${b.y}, w: ${b.w}, h: ${b.h}`;
  let hits = 0;
  for (const n of pages) {
    for (const [label, kind] of /** @type {const} */ ([
      ['текстовый слой', 'text'],
      ['OCR', 'ocr'],
    ])) {
      const tp = readJson(inboxFile(dir, kind, n, 'json'), /** @type {TextPage | null} */ (null));
      if (!tp) continue;
      // rows of a sideways page are read upright; boxes are always on the unturned page (as redact wants)
      const { rows, toPage } = pageRows(tp, kind === 'text' ? 'textlayer' : 'ocr');
      console.log(color.bold(`стр. ${n} · ${label}${tp.rotation ? ` · текст повёрнут, в записи rotate: ${tp.rotation}` : ''}`));
      for (const row of rows) {
        if (!needle) {
          console.log(`  { ${fmt(toPage(row.box))} }  ${row.text}`);
          continue;
        }
        const lower = row.text.toLowerCase();
        for (let i = lower.indexOf(needle); i >= 0; i = lower.indexOf(needle, i + needle.length)) {
          const box = spanBox(row, i, i + needle.length);
          if (!box) continue;
          hits++;
          console.log(`  - { page: ${n}, ${fmt(toPage(box))}, kind: private }  # ${row.text}`);
        }
      }
    }
  }
  if (needle && !hits) console.log(color.yellow(`«${grep}» не найдено. Без --grep видно все строки с координатами.`));
  return 0;
}
