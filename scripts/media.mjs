#!/usr/bin/env node
// @ts-check
/**
 * `npm run media` — public images with private data painted over. Procedure: docs/SYNC.md.
 *
 * For every content/achievements/<id>.md that has `source`, the source document is found by its
 * SHA-256 on this PC, the first page of source[0].pages is rendered at high quality, every
 * `redact` box of that page is painted solid (irreversible), `crop` is applied, the image is
 * turned by `rotate` (a sideways photo), shrunk to 1800 px and written to
 * content/achievements/media/<id>.webp without metadata; the entry gets
 * `image: ./media/<id>.webp` if it has no image yet. Project / profile pictures listed in
 * .private/media-map.json go through the same steps.
 *
 * Runs only on the PC with the achievements folder; the site build just uses the written files.
 * Without --all only new images and images whose inputs (source, page, crop, redact, rotate)
 * changed since the last render on this PC are redone.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { CONTENT_DIR, PRIVATE, ROOT, inboxDirFor, manifestPathFor, usePrivateDir } from './lib/config.mjs';
import { KIND_LABEL } from './lib/detect.mjs';
import { addImageField, entryIds, readEntry } from './lib/entries.mjs';
import { isTurn } from './lib/geometry.mjs';
import { paintBoxes, radiusFor, writeWebp } from './lib/paint.mjs';
import { renderPage } from './lib/render.mjs';
import { SUPPORTED, SourceLocator, extOf, hashFile } from './lib/sources.mjs';
import { firstPage, loadManifest, parsePages } from './lib/store.mjs';
import { UserError, color, displayPath, parseCli, plural, readJson, runMain, short, writeJson } from './lib/util.mjs';

/** Bump when rendering or painting changes: the next run then redoes every image. */
const MEDIA_VERSION = 1;
/** Page raster before crop / resize: ~300 dpi, long side ≤ 4000 px (≥ 2× the published size). */
const RENDER = { dpi: 300, maxSide: 4000 };
const ENTRY_MAX = 1800;
const MAP_MAX = 2000;
const QUALITY = 82;
/** Candidate kinds that are (almost) never false positives: a published image must cover them. */
const STRONG = new Set(['qr', 'iin', 'phone', 'email', 'birth-date']);
/**
 * Lines only draft.md has — its header and hints, the masked page text ("#   …") and the
 * candidate notes "(ocr 0.97)": none of it may reach the public repo.
 */
const DRAFT_MARK =
  /# Черновик из npm run sync|\(чувствительное замаскировано\)|^#   |# Подсказка:|# Даты в тексте:|# Похоже на category:|# Повёрнуты \(|\((?:ocr|textlayer|qr) [01](?:\.\d+)?\)/m;
/** Text files under content/ that --check reads for draft leftovers. */
const CONTENT_TEXT = /\.(?:mdx?|ya?ml)$/i;

const HELP_HINT = 'npm run media -- --help';
const HELP = `npm run media — публичные картинки с закрашенными личными данными
(content/achievements/media/<id>.webp и картинки из .private/media-map.json)

  npm run media                     новые картинки и те, у которых поменялись source / redact / crop / rotate
  npm run media -- --id <id>        только эта ачивка (можно повторять), рисуется заново
  npm run media -- --all            перерисовать всё
  npm run media -- --check          только проверить: нет картинки, нет исходника, redact не закрывает
                                    QR/ИИН/телефон, redact пуст при найденных кандидатах, не привязано в манифесте,
                                    rotate не как в инбоксе, где-то в content/ остался текст из draft.md

Для тестов: --content-dir <папка>  --source <папка ачивок>  --private-dir <вместо .private>
Порядок работы: docs/SYNC.md`;

/** @typedef {import('./lib/entries.mjs').RedactBox} RedactBox */
/** @typedef {import('./lib/entries.mjs').Crop} Crop */
/** @typedef {import('./lib/entries.mjs').Entry} Entry */
/** @typedef {import('./lib/sources.mjs').Source} Source */
/** @typedef {import('./lib/detect.mjs').Candidate} Candidate */
/** @typedef {import('./lib/geometry.mjs').Turn} Turn */
/**
 * One image to produce.
 * @typedef {object} Job
 * @property {string} label entry id or "media-map #n"
 * @property {string} out absolute path of the .webp
 * @property {string | null} srcKey SHA-256 of the source bytes (null: source file missing)
 * @property {(locator: SourceLocator) => Source} source finds the source file (throws UserError)
 * @property {number} page 1-based page that is published
 * @property {Crop | undefined} crop
 * @property {Turn | undefined} rotate clockwise turn applied after painting and crop
 * @property {RedactBox[]} redact boxes of that page
 * @property {number} skipped redact boxes of other pages of the source (not painted here)
 * @property {number} max
 * @property {number} quality
 * @property {Entry} [entry] achievements only
 */
/** @typedef {{ label: string, error: string }} Invalid an entry or media-map item with wrong fields */
/** @typedef {{ out: string, src: string, page?: number, crop?: Crop, rotate?: unknown, redact?: RedactBox[], max?: number, quality?: number }} MapItem */

const rel = (/** @type {string} */ p) => displayPath(ROOT, p);

runMain(async () => {
  const o = parseCli(
    process.argv.slice(2),
    {
      help: { type: 'boolean', short: 'h' },
      id: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      check: { type: 'boolean' },
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
  if (o.check && (o.id || o.all)) throw new UserError('--check только проверяет — без --id и --all.');
  if (o.id && o.all) throw new UserError('Либо --id, либо --all.');
  if (o['private-dir']) usePrivateDir(o['private-dir']);
  const contentDir = path.resolve(o['content-dir'] ?? CONTENT_DIR);
  const ids = o.id ?? [];
  const { jobs, manual, invalid } = entryJobs(contentDir, ids);
  if (!ids.length) {
    const map = mapJobs();
    jobs.push(...map.jobs);
    invalid.push(...map.invalid);
  }
  const locator = new SourceLocator(o.source);
  if (o.check) return check(jobs, manual, invalid, contentDir, locator);
  return render(jobs, invalid, { force: Boolean(o.all) || ids.length > 0, locator });
});

// ── jobs ──────────────────────────────────────────────────────────────────────────────────

/**
 * Jobs for achievements with `source` (all, or only `ids`). Entries without a source are
 * returned separately (their image, if any, was placed by hand); entries with wrong fields are
 * returned as `invalid`, so one broken entry does not stop the others.
 * @param {string} contentDir
 * @param {string[]} ids
 */
function entryJobs(contentDir, ids) {
  const dir = path.join(contentDir, 'achievements');
  const all = entryIds(dir);
  for (const id of ids) if (!all.includes(id)) throw new UserError(`Нет записи ${rel(path.join(dir, `${id}.md`))}.`);
  /** @type {Job[]} */
  const jobs = [];
  /** @type {Entry[]} */
  const manual = [];
  /** @type {Invalid[]} */
  const invalid = [];
  for (const id of ids.length ? ids : all) {
    try {
      const entry = readEntry(dir, id);
      const d = entry.data;
      if (!Array.isArray(d.source) || !d.source.length) {
        if (ids.length) throw new UserError('нет source — такую картинку кладут вручную');
        manual.push(entry);
        continue;
      }
      const sha = String(d.source[0]?.sha256 ?? '').toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(sha)) throw new UserError('source[0].sha256 — нужен полный SHA-256 (64 символа)');
      const spec = String(d.source[0].pages ?? '').trim();
      const page = firstPage(spec);
      const allowed = !spec || spec.toLowerCase() === 'all' ? null : parsePages(spec, 0);
      const { boxes, skipped } = boxesForPage(boxesOf(d.redact), page, allowed, spec);
      jobs.push({
        label: id,
        out: path.join(dir, 'media', `${id}.webp`),
        srcKey: sha,
        source: (locator) => {
          const src = locator.find(sha);
          if (!src) throw new UserError(`исходник ${short(sha)} не найден в папке ачивок (файл удалён или изменён?)`);
          return src;
        },
        page,
        crop: d.crop === undefined ? undefined : cropOf(d.crop),
        rotate: turnOf(d.rotate),
        redact: boxes,
        skipped,
        max: ENTRY_MAX,
        quality: QUALITY,
        entry,
      });
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      invalid.push({ label: id, error: e.message });
    }
  }
  return { jobs, manual, invalid };
}

/** Jobs from the private .private/media-map.json (project / profile pictures). */
function mapJobs() {
  /** @type {Job[]} */
  const jobs = [];
  /** @type {Invalid[]} */
  const invalid = [];
  const list = readJson(PRIVATE.mediaMap, /** @type {MapItem[] | null} */ (null));
  if (list === null) return { jobs, invalid };
  if (!Array.isArray(list)) throw new UserError(`${rel(PRIVATE.mediaMap)}: нужен массив [{ out, src, page, crop, rotate, redact, max, quality }].`);
  list.forEach((item, i) => {
    const label = `media-map #${i + 1}`;
    try {
      jobs.push(mapJob(item, label));
    } catch (e) {
      if (!(e instanceof UserError)) throw e;
      invalid.push({ label, error: e.message });
    }
  });
  return { jobs, invalid };
}

/**
 * @param {MapItem} item
 * @param {string} label
 * @returns {Job}
 */
function mapJob(item, label) {
  if (!item || typeof item.out !== 'string' || typeof item.src !== 'string') throw new UserError('нужны строки out и src');
  const out = path.resolve(ROOT, item.out);
  const inside = path.relative(ROOT, out);
  if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) throw new UserError('out должен быть внутри проекта');
  if (extOf(out) !== 'webp') throw new UserError('out должен быть .webp');
  const file = path.resolve(ROOT, item.src);
  const ext = extOf(file);
  if (!SUPPORTED[ext]) throw new UserError(`формат .${ext} не поддерживается`);
  const page = item.page ?? 1;
  if (!Number.isInteger(page) || page < 1) throw new UserError('page — целое число ≥ 1');
  const srcKey = fs.existsSync(file) ? hashFile(file) : null;
  const { boxes, skipped } = boxesForPage(boxesOf(item.redact), page, new Set([page]), String(page));
  return {
    label,
    out,
    srcKey,
    source: () => {
      if (!srcKey) throw new UserError(`нет файла ${file}`);
      const st = fs.statSync(file);
      return { sha256: srcKey, path: file, rel: file, ext, kind: SUPPORTED[ext], size: st.size, mtime: st.mtime.toISOString(), also: [] };
    },
    page,
    crop: item.crop === undefined ? undefined : cropOf(item.crop),
    rotate: turnOf(item.rotate),
    redact: boxes,
    skipped,
    max: positive(item.max ?? MAP_MAX, 'max'),
    quality: positive(item.quality ?? QUALITY, 'quality'),
  };
}

/** @param {unknown} v @param {string} what */
function positive(v, what) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new UserError(`${what} — целое число > 0`);
  return v;
}

/** @param {unknown} v */
const unit = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Validates a redact list (page-relative boxes).
 * @param {unknown} list
 * @returns {RedactBox[]}
 */
function boxesOf(list) {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new UserError('redact должен быть списком');
  return list.map((b, i) => {
    const ok = b && typeof b === 'object' && unit(b.x) && unit(b.y) && unit(b.w) && unit(b.h) && b.w > 0 && b.h > 0;
    if (!ok) throw new UserError(`redact #${i + 1} — x, y, w, h должны быть долями страницы 0..1 (w, h > 0)`);
    if (b.page !== undefined && !(Number.isInteger(b.page) && b.page >= 1)) throw new UserError(`redact #${i + 1} — page целое ≥ 1`);
    return /** @type {RedactBox} */ (b);
  });
}

/**
 * The redact boxes painted on the published page. A box without `page` belongs to page 1 (as in
 * the site schema), so it is an error when another page is published — it would be dropped
 * silently. A box of a page outside source.pages is a leftover from another page's draft.
 * @param {RedactBox[]} boxes
 * @param {number} page published page
 * @param {Set<number> | null} allowed pages of source.pages (null: every page)
 * @param {string} spec source.pages as written, for messages
 * @returns {{ boxes: RedactBox[], skipped: number }}
 */
function boxesForPage(boxes, page, allowed, spec) {
  boxes.forEach((b, i) => {
    if (b.page === undefined && page !== 1) {
      throw new UserError(`redact #${i + 1}: нет page, а публикуется стр. ${page} — допиши page: ${page} (или номер страницы, к которой он относится)`);
    }
    if (b.page !== undefined && allowed && !allowed.has(b.page)) {
      throw new UserError(`redact #${i + 1}: стр. ${b.page} не входит в source.pages "${spec}" — лишний пункт из черновика другой страницы?`);
    }
  });
  const mine = boxes.filter((b) => (b.page ?? 1) === page);
  return { boxes: mine, skipped: boxes.length - mine.length };
}

/**
 * @param {unknown} c
 * @returns {Crop}
 */
function cropOf(c) {
  const b = /** @type {Record<string, unknown>} */ (c ?? {});
  if (!(unit(b.x) && unit(b.y) && unit(b.w) && unit(b.h))) throw new UserError('crop — x, y, w, h долями страницы 0..1');
  const crop = /** @type {Crop} */ (b);
  if (crop.w < 0.05 || crop.h < 0.05 || crop.x + crop.w > 1.0001 || crop.y + crop.h > 1.0001) throw new UserError('crop выходит за страницу или слишком мал');
  return crop;
}

/**
 * `rotate` of an entry / media-map item: a clockwise quarter turn (0 = none → undefined).
 * @param {unknown} v
 * @returns {Turn | undefined}
 */
function turnOf(v) {
  if (v === undefined || v === null) return undefined;
  if (!isTurn(v)) throw new UserError('rotate — 0, 90, 180 или 270 (градусы по часовой стрелке)');
  return v || undefined;
}

/**
 * Fingerprint of everything an image depends on (what the cache compares). `rotate` joins only
 * when set, so images rendered before it existed keep their fingerprints.
 * @param {Job} j
 */
const fingerprint = (j) =>
  crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        v: MEDIA_VERSION,
        src: j.srcKey,
        page: j.page,
        crop: j.crop ?? null,
        redact: j.redact.map((b) => [b.x, b.y, b.w, b.h]),
        max: j.max,
        quality: j.quality,
        ...(j.rotate ? { rotate: j.rotate } : {}),
      }),
    )
    .digest('hex')
    .slice(0, 16);

/** @returns {Record<string, string>} output (project-relative) → fingerprint */
const loadCache = () => readJson(PRIVATE.mediaCache, /** @type {Record<string, string>} */ ({}));

// ── render ────────────────────────────────────────────────────────────────────────────────

/**
 * @param {Job[]} jobs
 * @param {Invalid[]} invalid
 * @param {{ force: boolean, locator: SourceLocator }} o
 */
async function render(jobs, invalid, o) {
  const cache = loadCache();
  for (const bad of invalid) console.log(`${color.red('✗')} ${bad.label}: ${bad.error}`);
  const todo = o.force ? jobs : jobs.filter((j) => !fs.existsSync(j.out) || cache[rel(j.out)] !== fingerprint(j));
  if (!jobs.length) {
    if (!invalid.length) console.log('Нечего рисовать: нет ачивок с source и нет .private/media-map.json.');
    return invalid.length ? 1 : 0;
  }
  if (!todo.length) {
    console.log(color.green(`Все ${jobs.length} ${plural(jobs.length, 'картинка', 'картинки', 'картинок')} актуальны. Перерисовать всё: npm run media -- --all`));
    return invalid.length ? 1 : 0;
  }
  console.log(`Рисую ${todo.length} из ${jobs.length}…`);
  let failed = invalid.length;
  let drawn = 0;
  for (const job of todo) {
    try {
      const notes = await renderJob(job, o.locator);
      cache[rel(job.out)] = fingerprint(job);
      writeJson(PRIVATE.mediaCache, pruneCache(cache));
      drawn++;
      const extra = [
        `стр. ${job.page}`,
        `закрашено ${job.redact.length}`,
        job.skipped ? `пропущено ${job.skipped} (другие стр.)` : '',
        job.crop ? 'crop' : '',
        job.rotate ? `rotate ${job.rotate}°` : '',
      ]
        .filter(Boolean)
        .join(', ');
      console.log(`${color.green('✓')} ${job.label} → ${rel(job.out)} ${color.dim(`(${extra})`)}`);
      for (const n of notes) console.log(color.yellow(`    ! ${n}`));
    } catch (e) {
      failed++;
      console.log(`${color.red('✗')} ${job.label} → ${rel(job.out)}: ${e instanceof UserError ? e.message : String(/** @type {Error} */ (e)?.stack ?? e)}`);
    }
  }
  if (drawn) {
    console.log('');
    console.log(color.bold('Дальше:'), 'открой каждую новую картинку (Read) и убедись, что ИИН, номера, QR, телефоны, адреса и оценки не видны.');
    console.log('        Если видно — поправь redact и повтори npm run media -- --id <id>. Общая проверка: npm run media -- --check');
  }
  return failed ? 1 : 0;
}

/**
 * Renders, paints, crops, turns and writes one image; adds `image:` to the entry if it has none.
 * @param {Job} job
 * @param {SourceLocator} locator
 * @returns {Promise<string[]>} notes for the user
 */
async function renderJob(job, locator) {
  const raster = await renderPage(job.source(locator), job.page, RENDER);
  const painted = await paintBoxes(raster, job.redact, radiusFor(raster, job.max, job.crop));
  fs.mkdirSync(path.dirname(job.out), { recursive: true });
  await writeWebp({ ...raster, data: painted }, { out: job.out, max: job.max, quality: job.quality, crop: job.crop, rotate: job.rotate });
  const meta = await sharp(job.out).metadata();
  if (meta.exif || meta.xmp || meta.iptc) {
    fs.rmSync(job.out, { force: true });
    throw new UserError('в картинку попали метаданные — файл удалён, сообщи об ошибке');
  }
  /** @type {string[]} */
  const notes = [];
  const entry = job.entry;
  if (entry) {
    const want = `./media/${entry.id}.webp`;
    if (entry.data.image === undefined) {
      addImageField(entry.file, want);
      notes.push(`в ${entry.id}.md добавлено image: ${want}`);
    } else if (entry.data.image !== want) notes.push(`image в ${entry.id}.md указывает на ${entry.data.image} — оставил как есть`);
    const inbox = inboxOf(entry);
    for (const c of uncovered(inbox.candidates, job)) notes.push(`не закрыт кандидат ${KIND_LABEL[c.kind]} (${c.masked}) — проверь redact`);
    const turn = rotationNote(inbox, job);
    if (turn) notes.push(turn);
  }
  return notes;
}

/** Drops records of images that no longer exist. @param {Record<string, string>} cache */
function pruneCache(cache) {
  return Object.fromEntries(Object.entries(cache).filter(([out]) => fs.existsSync(path.resolve(ROOT, out))));
}

// ── check ─────────────────────────────────────────────────────────────────────────────────

/**
 * What `npm run sync` found on the published page of an entry's source: its candidates and the
 * turn that makes it upright (`known: false` when the source is not in the inbox on this PC).
 * @param {Entry} entry
 * @returns {{ known: boolean, candidates: Candidate[], rotation: number }}
 */
function inboxOf(entry) {
  const src = entry.data.source?.[0];
  if (!src) return { known: false, candidates: [], rotation: 0 };
  const page = firstPage(src.pages);
  const file = path.join(inboxDirFor(String(src.sha256).toLowerCase()), 'candidates.json');
  const found = readJson(file, /** @type {{ candidates?: Candidate[], rotations?: Record<string, number> } | null} */ (null));
  return {
    known: Boolean(found),
    candidates: (found?.candidates ?? []).filter((c) => c.page === page),
    rotation: found?.rotations?.[String(page)] ?? 0,
  };
}

/**
 * A note when `rotate` differs from the turn sync found for the published page.
 * @param {ReturnType<typeof inboxOf>} inbox
 * @param {Job} job
 */
function rotationNote(inbox, job) {
  if (!inbox.known || inbox.rotation === (job.rotate ?? 0)) return '';
  return inbox.rotation
    ? `sync читал стр. ${job.page} повёрнутой на ${inbox.rotation}°, а в записи rotate: ${job.rotate ?? 0} — посмотри, не лежит ли картинка боком`
    : `sync читал стр. ${job.page} без поворота, а в записи rotate: ${job.rotate} — посмотри, не лежит ли картинка боком`;
}

/** @param {{ x: number, y: number, w: number, h: number }} a @param {{ x: number, y: number, w: number, h: number }} b */
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/**
 * Strong candidates (QR, IIN, phone, e-mail, birth date) that would stay visible: inside the
 * crop and not ≥ 70 % covered by one redact box.
 * @param {Candidate[]} candidates
 * @param {Job} job
 */
function uncovered(candidates, job) {
  return candidates.filter(
    (c) =>
      STRONG.has(c.kind) &&
      (!job.crop || overlap(c, job.crop) > 0) &&
      !job.redact.some((b) => overlap(c, b) >= 0.7 * c.w * c.h),
  );
}

/**
 * Text files anywhere under content/ (entries, `_` files, projects, profile).
 * @param {string} dir
 * @returns {string[]}
 */
function contentTextFiles(dir) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} d */
  const visit = (d) => {
    /** @type {fs.Dirent[]} */
    let list = [];
    try {
      list = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return; // no such folder (an empty test content dir)
    }
    for (const e of list) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) visit(p);
      else if (e.isFile() && CONTENT_TEXT.test(e.name)) out.push(p);
    }
  };
  visit(dir);
  return out.sort();
}

/**
 * --check: reports problems (exit 1) and things to look at; writes nothing.
 * @param {Job[]} jobs
 * @param {Entry[]} manual entries without a source
 * @param {Invalid[]} invalid entries / media-map items with wrong fields
 * @param {string} contentDir
 * @param {SourceLocator} locator
 */
function check(jobs, manual, invalid, contentDir, locator) {
  const cache = loadCache();
  const manifest = loadManifest(manifestPathFor(contentDir));
  /** @type {string[]} */
  const problems = invalid.map((bad) => `${bad.label}: ${bad.error}`);
  /** @type {string[]} */
  const warnings = [];
  let folderMissing = false;

  for (const job of jobs) {
    const fix = job.entry ? `npm run media -- --id ${job.label}` : 'npm run media';
    if (!job.srcKey) problems.push(`${job.label}: нет исходного файла`);
    else if (job.entry && !folderMissing) {
      try {
        if (!locator.find(job.srcKey)) problems.push(`${job.label}: исходник ${short(job.srcKey)} не найден в папке ачивок`);
      } catch (e) {
        if (!(e instanceof UserError)) throw e;
        folderMissing = true;
        warnings.push(`папка ачивок не найдена — наличие исходников не проверено (${e.message})`);
      }
    }
    const record = cache[rel(job.out)];
    if (!fs.existsSync(job.out)) problems.push(`${job.label}: нет картинки ${rel(job.out)} → ${fix}`);
    else if (record && record !== fingerprint(job)) problems.push(`${job.label}: source/redact/crop/rotate менялись после рендера → ${fix}`);
    else if (!record) warnings.push(`${job.label}: картинка нарисована не на этом ПК или до учёта — перерисуй для уверенности: ${fix}`);

    const entry = job.entry;
    if (!entry) continue;
    const want = `./media/${entry.id}.webp`;
    if (entry.data.image === undefined) warnings.push(`${entry.id}: в записи нет image → ${fix} (добавит ${want})`);
    else if (entry.data.image !== want) warnings.push(`${entry.id}: image = ${entry.data.image}, а media пишет ${want}`);
    const inbox = inboxOf(entry);
    if (!job.redact.length && inbox.candidates.length) {
      const kinds = [...new Set(inbox.candidates.map((c) => KIND_LABEL[c.kind]))].join(', ');
      warnings.push(
        `${entry.id}: redact пуст, а sync нашёл ${inbox.candidates.length} ${plural(inbox.candidates.length, 'кандидат', 'кандидата', 'кандидатов')} (${kinds}) — проверь review-${job.page}.png`,
      );
    }
    for (const c of uncovered(inbox.candidates, job)) problems.push(`${entry.id}: не закрыт ${KIND_LABEL[c.kind]} (${c.masked}) на стр. ${job.page}`);
    const turn = rotationNote(inbox, job);
    if (turn) warnings.push(`${entry.id}: ${turn}`);
    const linked = manifest.files[/** @type {string} */ (job.srcKey)]?.items.some((it) => it.status === 'entry' && it.entry === entry.id);
    if (!linked) warnings.push(`${entry.id}: не привязан в манифесте → npm run sync -- --link ${short(/** @type {string} */ (job.srcKey))} --entry ${entry.id} --pages ${entry.data.source?.[0]?.pages || job.page}`);
  }
  for (const entry of manual) {
    const img = entry.data.image;
    if (typeof img === 'string' && !fs.existsSync(path.resolve(path.dirname(entry.file), img))) problems.push(`${entry.id}: нет файла ${img}`);
  }
  // every text file under content/ is public once committed: draft leftovers anywhere are a leak
  for (const file of contentTextFiles(contentDir)) {
    const name = displayPath(contentDir, file);
    if (DRAFT_MARK.test(fs.readFileSync(file, 'utf8'))) {
      problems.push(`content/${name}: остались строки черновика (текст документа, заметки кандидатов) — удали их; черновики держи в .private/drafts/`);
    } else if (path.basename(file).startsWith('_')) {
      warnings.push(`content/${name}: файл на «_» сайт не показывает, но git его закоммитит — черновикам место в .private/drafts/`);
    }
  }

  console.log(color.bold('Проверка картинок'));
  for (const p of problems) console.log(`${color.red('✗')} ${p}`);
  for (const w of warnings) console.log(`${color.yellow('!')} ${w}`);
  if (!problems.length && !warnings.length) console.log(color.green('✓ Всё в порядке.'));
  console.log('');
  console.log(
    `Ачивок с source: ${jobs.filter((j) => j.entry).length} · без source (картинка вручную или без картинки): ${manual.length} · media-map: ${jobs.filter((j) => !j.entry).length} · с ошибками в полях: ${invalid.length} · проблем: ${problems.length} · проверить: ${warnings.length}`,
  );
  return problems.length ? 1 : 0;
}
