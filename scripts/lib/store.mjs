// @ts-check
/**
 * Bookkeeping files.
 *
 * - Public manifest `content/.sync/manifest.json` (committed): which source (by SHA-256) feeds which
 *   achievement, or why it is hidden. It must never contain file names, paths or document text.
 * - Private ledger `.private/ledger.json`: free-form human notes per source (why hidden, what it is).
 */
import { PRIVATE } from './config.mjs';
import { UserError, readJson, today, writeJson } from './util.mjs';

/** Why a source (or some of its pages) is not on the site. */
export const REASONS = /** @type {const} */ ([
  'not-mine',
  'personal-doc',
  'grades',
  'duplicate',
  'not-achievement',
  'low-value',
  'photo',
  'ask',
  'test',
]);

/** @type {Record<Reason, string>} */
export const REASON_LABEL = {
  'not-mine': 'чужой документ',
  'personal-doc': 'личный документ',
  grades: 'оценки',
  duplicate: 'дубликат',
  'not-achievement': 'не достижение',
  'low-value': 'малоценное',
  photo: 'просто фото',
  ask: 'спросить Геннадия',
  test: 'тест',
};

/** @typedef {typeof REASONS[number]} Reason */
/** @typedef {'entry' | 'hidden' | 'pending'} Status */
/** @typedef {{ pages: string, status: Status, entry?: string, reason?: Reason }} Item */
/** @typedef {{ ext: string, pages: number, firstSeen: string, items: Item[] }} FileRecord */
/** @typedef {{ version: 1, files: Record<string, FileRecord> }} Manifest */

const SHA_RE = /^[0-9a-f]{64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = new Set(['entry', 'hidden', 'pending']);

/**
 * @param {string} file
 * @returns {Manifest}
 */
export function loadManifest(file) {
  const m = readJson(file, /** @type {Manifest} */ ({ version: 1, files: {} }));
  const bad = (/** @type {string} */ why) => new UserError(`Манифест ${file} повреждён: ${why}`);
  if (m.version !== 1 || typeof m.files !== 'object' || !m.files) throw bad('нужны "version": 1 и "files"');
  for (const [sha, rec] of Object.entries(m.files)) {
    if (!SHA_RE.test(sha)) throw bad(`ключ ${sha.slice(0, 16)}… — не SHA-256`);
    if (typeof rec.ext !== 'string' || !Number.isInteger(rec.pages) || !DATE_RE.test(rec.firstSeen) || !Array.isArray(rec.items)) {
      throw bad(`запись ${sha.slice(0, 12)} — нужны ext, pages, firstSeen, items`);
    }
    for (const it of rec.items) {
      if (!STATUSES.has(it.status)) throw bad(`запись ${sha.slice(0, 12)} — неизвестный статус ${it.status}`);
      if (it.status === 'entry' && !it.entry) throw bad(`запись ${sha.slice(0, 12)} — у entry нет id`);
      if (it.reason && !REASONS.includes(it.reason)) throw bad(`запись ${sha.slice(0, 12)} — неизвестная причина ${it.reason}`);
      parsePages(it.pages, rec.pages); // throws on garbage
    }
  }
  return m;
}

/**
 * Saves the manifest with a stable layout (files sorted by hash) and only whitelisted fields,
 * so nothing private can leak into the public repo by accident.
 * @param {string} file
 * @param {Manifest} m
 */
export function saveManifest(file, m) {
  /** @type {Manifest} */
  const out = { version: 1, files: {} };
  for (const sha of Object.keys(m.files).sort()) {
    const r = m.files[sha];
    out.files[sha] = {
      ext: r.ext,
      pages: r.pages,
      firstSeen: r.firstSeen,
      items: r.items.map((it) => ({
        pages: it.pages,
        status: it.status,
        ...(it.entry ? { entry: it.entry } : {}),
        ...(it.reason ? { reason: it.reason } : {}),
      })),
    };
  }
  writeJson(file, out);
}

/**
 * @param {string} ext
 * @param {number} pages
 * @returns {FileRecord}
 */
export function newRecord(ext, pages) {
  return { ext, pages, firstSeen: today(), items: [{ pages: 'all', status: 'pending' }] };
}

/**
 * Parses a page list: "all" (or empty) | "3" | "1-2" | "1,3,5-7".
 * @param {string | undefined} spec
 * @param {number} total pages in the file
 * @returns {Set<number>}
 */
export function parsePages(spec, total) {
  const s = String(spec ?? '').trim().toLowerCase();
  const all = new Set(Array.from({ length: Math.max(total, 1) }, (_, i) => i + 1));
  if (!s || s === 'all') return all;
  /** @type {Set<number>} */
  const out = new Set();
  for (const part of s.split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) throw new UserError(`Непонятные страницы «${spec}». Пример: 1-2 или 1,3,5-7 или all.`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (a < 1 || b < a) throw new UserError(`Неверный диапазон страниц «${part.trim()}».`);
    if (total && b > total) throw new UserError(`Страницы «${part.trim()}» вне файла: в нём ${total} стр.`);
    for (let p = a; p <= b; p++) out.add(p);
  }
  return out;
}

/**
 * Compresses a page set: all pages → "all", else "1-2,5".
 * @param {Set<number>} set
 * @param {number} total
 */
export function formatPages(set, total) {
  if (set.size >= Math.max(total, 1) && [...set].every((p) => p <= Math.max(total, 1))) return 'all';
  const list = [...set].sort((a, b) => a - b);
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < list.length; i++) {
    const start = list[i];
    while (i + 1 < list.length && list[i + 1] === list[i] + 1) i++;
    parts.push(start === list[i] ? String(start) : `${start}-${list[i]}`);
  }
  return parts.join(',');
}

/** First page of a page list (media renders this one). */
export function firstPage(/** @type {string | undefined} */ spec) {
  const m = /\d+/.exec(String(spec ?? ''));
  return m ? Number(m[0]) : 1;
}

/**
 * Applies a decision to some pages of a file and keeps the invariant
 * "pending = pages that are neither linked nor hidden".
 *
 * - entry: a page may feed several entries (two diplomas on one scan), so other entries keep it;
 *   it stops being pending or hidden.
 * - hidden: the pages leave every other item, entries included (reported as a warning).
 *
 * @param {FileRecord} rec
 * @param {{ status: 'entry' | 'hidden', pages: Set<number>, entry?: string, reason?: Reason }} d
 * @returns {string[]} warnings for the user
 */
export function applyDecision(rec, d) {
  const total = Math.max(rec.pages, 1);
  /** @type {string[]} */
  const warnings = [];
  const items = rec.items
    .filter((it) => it.status !== 'pending')
    .map((it) => ({ ...it, set: parsePages(it.pages, total) }));

  for (const it of items) {
    const sameTarget = it.status === d.status && (d.status === 'entry' ? it.entry === d.entry : it.reason === d.reason);
    if (sameTarget) continue;
    if (d.status === 'entry' && it.status === 'entry') continue;
    const overlap = [...d.pages].filter((p) => it.set.has(p));
    if (!overlap.length) continue;
    for (const p of overlap) it.set.delete(p);
    const where = it.status === 'entry' ? `была привязана к ${it.entry}` : `была скрыта (${it.reason ?? '—'})`;
    warnings.push(`стр. ${formatPages(new Set(overlap), total)} ${where} — теперь нет`);
  }

  const target = items.find((it) => it.status === d.status && (d.status === 'entry' ? it.entry === d.entry : it.reason === d.reason));
  if (target) for (const p of d.pages) target.set.add(p);
  else items.push({ pages: '', status: d.status, ...(d.entry ? { entry: d.entry } : {}), ...(d.reason ? { reason: d.reason } : {}), set: new Set(d.pages) });

  const covered = new Set(items.flatMap((it) => [...it.set]));
  const pending = new Set([...parsePages('all', total)].filter((p) => !covered.has(p)));
  const kept = items.filter((it) => it.set.size);
  if (pending.size) kept.push({ pages: '', status: 'pending', set: pending });
  kept.sort((a, b) => Math.min(...a.set) - Math.min(...b.set) || a.status.localeCompare(b.status));
  rec.items = kept.map(({ set, ...it }) => ({ ...it, pages: formatPages(set, total) }));
  return warnings;
}

/** One-line human description of a file's items, e.g. "1-2 → hackathon-x · 3 скрыто (дубликат)". */
export function describeItems(/** @type {FileRecord} */ rec) {
  return rec.items
    .map((it) => {
      const pages = it.pages === 'all' ? '' : `стр. ${it.pages} `;
      if (it.status === 'entry') return `${pages}→ ${it.entry}`;
      if (it.status === 'hidden') return `${pages}скрыто (${it.reason ? REASON_LABEL[it.reason] ?? it.reason : '—'})`;
      return `${pages}ждёт решения`;
    })
    .join(' · ');
}

/** @typedef {{ date: string, pages: string, status: Status, entry?: string, reason?: Reason, text: string }} Note */
/** @typedef {Record<string, { notes: Note[] }>} Ledger */

/** @returns {Ledger} */
export function loadLedger() {
  return readJson(PRIVATE.ledger, /** @type {Ledger} */ ({}));
}

/** @param {Ledger} ledger */
export function saveLedger(ledger) {
  writeJson(PRIVATE.ledger, ledger);
}
