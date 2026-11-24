// @ts-check
/**
 * Private-data detection on document pages.
 *
 * Input: lines of words with pixel boxes (Windows OCR or the PDF text layer, same shape).
 * Output: candidate boxes normalized to the page (0..1) with a kind, a masked hint and a confidence.
 * Raw values are never stored or printed — only hints such as "ИИН · 12 цифр" or "№ ••••42".
 *
 * Lines that sit on the same baseline are joined into "rows" (table cells, label + value), so a
 * label in one cell can find its value in the next one. Detectors run in priority order on each
 * row and a span claimed by a stronger detector is not reported again by a weaker one. Rows of a
 * sideways page (TextPage.rotation) are built on the page turned upright and mapped back.
 */
import jsqr from 'jsqr';
import sharp from 'sharp';
import { isTurn, turnBox, turnedSize, undoTurn } from './geometry.mjs';

/** jsqr is CommonJS: Node's default import is module.exports, which carries the decoder as `.default`. */
const jsQR = jsqr.default;

/** @typedef {'qr' | 'iin' | 'phone' | 'email' | 'birth-date' | 'doc-number' | 'address' | 'grade'} Kind */
/** @typedef {'ocr' | 'textlayer' | 'qr'} From */
/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/**
 * @typedef {object} Candidate
 * @property {number} page 1-based
 * @property {number} x page-relative 0..1
 * @property {number} y
 * @property {number} w
 * @property {number} h
 * @property {Kind} kind
 * @property {string} masked human hint without the raw value
 * @property {number} confidence 0..1
 * @property {From} from
 */
/** @typedef {{ kind: Kind, masked: string, confidence: number }} Finding text-only (DOCX/PPTX) */
/** @typedef {{ start: number, end: number, box: Box }} Piece */
/** @typedef {{ text: string, norm: string, pieces: Piece[], cells: Piece[], box: Box }} Row */
/** @typedef {{ start: number, end: number, kind: Kind, masked: string, confidence: number, whole?: 'row' | 'cell' }} Span */

/** Strongest first: decides the kind when boxes of different kinds coincide. */
export const KINDS = /** @type {const} */ (['qr', 'iin', 'phone', 'email', 'birth-date', 'doc-number', 'address', 'grade']);
const RANK = new Map(KINDS.map((k, i) => [k, i]));

/** @type {Record<Kind, string>} */
export const KIND_LABEL = {
  qr: 'QR-код',
  iin: 'ИИН',
  phone: 'телефон',
  email: 'e-mail',
  'birth-date': 'дата рождения',
  'doc-number': 'номер документа',
  address: 'адрес',
  grade: 'оценки',
};

/** Separator between cells of a row; wider than a word gap so numbers never merge across cells. */
const CELL_SEP = '   ';

// ── rows ──────────────────────────────────────────────────────────────────────────────────

/** @param {Box[]} boxes */
const union = (boxes) => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

/** Same text row: big vertical overlap and similar heights. */
const sameRow = (/** @type {Box} */ a, /** @type {Box} */ b) => {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const lo = Math.min(a.h, b.h);
  return overlap >= 0.5 * lo && Math.max(a.h, b.h) <= 2.5 * lo;
};

const xOverlap = (/** @type {Box} */ a, /** @type {Box} */ b) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.2 * Math.min(a.w, b.w);

/**
 * Joins lines that share a baseline into rows (left to right), sorted top to bottom.
 * @param {import('./render.mjs').TextLine[]} lines
 * @returns {Row[]}
 */
function buildRows(lines) {
  const items = lines
    .map((l) => ({ box: { x: l.x, y: l.y, w: l.w, h: l.h }, words: (l.words ?? []).filter((w) => w.text && w.text.trim() && w.w > 0 && w.h > 0) }))
    .filter((l) => l.words.length && l.box.h > 0)
    .sort((a, b) => a.box.y + a.box.h / 2 - (b.box.y + b.box.h / 2));
  /** @type {(typeof items)[]} */
  const groups = [];
  for (const it of items) {
    let target = null;
    for (let i = groups.length - 1; i >= Math.max(0, groups.length - 8); i--) {
      const g = groups[i];
      if (g.some((m) => sameRow(m.box, it.box)) && !g.some((m) => xOverlap(m.box, it.box))) {
        target = g;
        break;
      }
    }
    if (target) target.push(it);
    else groups.push([it]);
  }
  return groups.map((members) => {
    members.sort((a, b) => a.box.x - b.box.x);
    let text = '';
    /** @type {Piece[]} */
    const pieces = [];
    /** @type {Piece[]} */
    const cells = [];
    members.forEach((m, mi) => {
      if (mi) text += CELL_SEP;
      const cellStart = text.length;
      m.words.forEach((w, wi) => {
        if (wi) text += ' ';
        const start = text.length;
        text += w.text.replace(/\s+/g, '');
        pieces.push({ start, end: text.length, box: { x: w.x, y: w.y, w: w.w, h: w.h } });
      });
      cells.push({ start: cellStart, end: text.length, box: m.box });
    });
    return { text, norm: digitish(text), pieces, cells, box: union(members.map((m) => m.box)) };
  });
}

/**
 * Pixel box of a text range of a row (union of the words it touches).
 * @param {Row} row
 * @param {number} start
 * @param {number} end
 */
export function spanBox(row, start, end) {
  const hit = row.pieces.filter((p) => p.end > start && p.start < end);
  return hit.length ? union(hit.map((p) => p.box)) : null;
}

// ── text normalization ────────────────────────────────────────────────────────────────────

/** OCR look-alikes of digits, applied only inside tokens that are mostly digits. */
const LOOKALIKE = new Map(
  Object.entries({ O: '0', o: '0', 'О': '0', 'о': '0', Q: '0', D: '0', l: '1', I: '1', '|': '1', 'і': '1', 'І': '1', 'З': '3', 'з': '3', S: '5', B: '8', 'В': '8', 'б': '6', 'Б': '6', 'Ч': '4' }),
);

/**
 * Same-length copy of `text` where tokens that are ≥ 60 % digits get their look-alike letters
 * turned into digits ("12О45О789О12" → "120450789012"), so OCR slips do not hide numbers.
 * @param {string} text
 */
function digitish(text) {
  return text.replace(/\S+/g, (tok) => {
    const digits = (tok.match(/\d/g) ?? []).length;
    const alnum = (tok.match(/[\p{L}\p{N}|]/gu) ?? []).length;
    if (alnum < 4 || digits / alnum < 0.6) return tok;
    return tok.replace(/[^\d]/g, (ch) => LOOKALIKE.get(ch) ?? ch);
  });
}

const countDigits = (/** @type {string} */ s) => (s.match(/\d/g) ?? []).length;
/** Last two letters/digits of a value, for hints like "№ ••••42". */
const tail = (/** @type {string} */ s) => s.replace(/[^\p{L}\p{N}]/gu, '').slice(-2);

// ── patterns ──────────────────────────────────────────────────────────────────────────────

const IIN_LABEL = /(?<!\p{L})(?:ИИН|ЖСН|IIN|ІІН|ИИH|ЖCН|БИН|БСН)(?!\p{L})/u;
const DIGIT_GROUPS = /(?<!\p{N})\d+(?:[ \u00a0]\d+)*(?!\p{N})/gu;
const YEAR = /^(?:19|20)\d\d$/;

const PH_SEP = '[\\s\\-–—().]{0,3}';
const PHONE_INTL = new RegExp(`(?<![\\p{N}+])(?:\\+\\s?7|8|7)${PH_SEP}\\d{3}${PH_SEP}\\d{3}${PH_SEP}\\d{2}${PH_SEP}\\d{2}(?!\\p{N})`, 'gu');
const PHONE_LOCAL = /(?<![\p{N}+])[79]\d{2}[\s\-–—)]{1,3}\d{3}[\s\-–—]{0,2}\d{2}[\s\-–—]{0,2}\d{2}(?!\p{N})/gu;
const PHONE_BARE10 = /(?<!\p{N})[79]\d{9}(?!\p{N})/gu;
/**
 * Any other 10–11 digit phone-like run with a 7/8 prefix: "8 (7162) 32-31-34", "(7162) 32-31-34".
 * No dots between digits, so date ranges such as "7.11.2025 - 8.11.2025" are not phones.
 */
const PHONE_ANY = /(?<![\p{N}+.])(?:\+\s?)?\(?[78](?:[\s\-–—()]{0,3}\d){9,10}(?![\p{N}.])/gu;
const PHONE_LABEL = /(?<!\p{L})(?:тел(?:\.|ефон\p{L}*)?|моб(?:\.|ильн\p{L}*)?|phone|tel\.?|mobile|ұялы)(?!\p{L})[\s:.]*([+\d(](?:[\d\-–—()]|\s(?=[\d(]))*\d)/giu;

/** E-mail; OCR may put spaces around "@" or read it as "©" (only accepted glued: "© 2024 Site.org" is prose). */
const EMAIL = /[\p{L}\p{N}._%+-]+(?:\s?@\s?|©)[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu;

const MONTHS_RU = 'январ\\p{L}*|феврал\\p{L}*|март\\p{L}*|апрел\\p{L}*|ма[йя]|июн\\p{L}*|июл\\p{L}*|август\\p{L}*|сентябр\\p{L}*|октябр\\p{L}*|ноябр\\p{L}*|декабр\\p{L}*';
const MONTHS_KZ = 'қаңтар|каңтар|кантар|ақпан|акпан|наурыз|сәуір|сэуір|мамыр|маусым|шілде|шiлде|тамыз|қыркүйек|кыркуйек|қазан|казан|қараша|караша|желтоқсан|желтоксан';
const MONTHS_EN =
  'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec';
const MONTHS = `${MONTHS_RU}|${MONTHS_KZ}|${MONTHS_EN}`;
/** A date in any of the usual shapes (numeric, "9 ноября 2023", "Nov 9, 2023", "1999 г."). */
const DATE = new RegExp(
  `(?<!\\p{N})(?:\\d{1,2}[./-]\\d{1,2}[./-](?:\\d{4}|\\d{2})|\\d{4}[./-]\\d{1,2}[./-]\\d{1,2}|\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}|(?:${MONTHS})\\.?\\s+\\d{1,2},?\\s+\\d{4}|(?:19|20)\\d{2})(?!\\p{N})`,
  'giu',
);
/**
 * First date in `text` at or after `from` (a fresh regex each time: no shared lastIndex state).
 * @param {string} text
 * @param {number} from
 */
function findDate(text, from) {
  const re = new RegExp(DATE.source, DATE.flags);
  re.lastIndex = from;
  return re.exec(text);
}
const BIRTH_LABEL =
  /(?<!\p{L})(?:дата\s+рожд\p{L}*|д\.\s?р\.|год\s+рожд\p{L}*|туған\s+(?:күні|жылы)|туылған\s+(?:күні|жылы)|туған|born|date\s+of\s+birth|birth\s*date|DOB)(?!\p{L})/giu;
const BIRTH_SUFFIX = /(?<!\p{N})(?:19|20)\d{2}\s?(?:г\.\s?р\.|ж\.\s?т\.)/giu;
/** A label right after a date: "14.03.1999 года рождения", "…г.р.", "1999 жылы туған". */
const BIRTH_AFTER = /^[\s,]*(?:г\.?\s?р\.|г(?:ода|\.)?\s*рожд\p{L}*|жыл\p{L}*\s+туған|ж\.\s?т\.)/iu;

/** Case-sensitive document-number markers (so "No" ≠ "no", "ID" ≠ "id" in prose). */
const DOC_KEY_CS = /№|N[°º]|(?<!\p{L})(?:No|NO|ID|Id)(?!\p{L})\.?|#/gu;
const DOC_KEY_CI =
  /(?<!\p{L})(?:серия|серии|рег\.?|регистрац\p{L}*|т[іi1l|]ркеу\p{L}*|н[өоеo][мm][іi1l|][рp]\p{L}*|номер\p{L}*|number|serial|ref\.?|certificate\s+(?:id|no\.?|number|code)|credential(?:\s+id)?|verif\p{L}*|код\p{L}{0,2}|code|бланк\p{L}*)(?!\p{L})/giu;
/** The value right after a marker: optional series letters, then an alphanumeric token. */
const DOC_VALUE = /^[\s:.\-–—#№=]{0,6}((?:\p{Lu}{1,4}[\s-]?)?[\p{L}\p{N}](?:[\p{L}\p{N}/.\-]*[\p{L}\p{N}])?(?:\s\d{2,}(?=\s|$))*)/u;

const URL_RE =
  /(?:https?:\/\/|www\.)\S+|(?<![\p{L}\p{N}@./])(?:[a-z0-9-]+\.)+(?:org|com|net|kz|ru|io|edu|gov|id|me|ai|co|uk|info|online|app|link|ly|to)\/\S+/giu;
const VERIFY_HINT = /verif|cert|credential|valid|check|qr|\bid\b|\/c\//i;
/** A URL path segment that names one document: has a digit, MiXeD case, or is a long upper-case code. */
const ID_SEGMENT = /\d|\p{Lu}.*\p{Ll}|\p{Ll}.*\p{Lu}|^[\p{Lu}\d]{6,}$/u;

const TOKEN = /(?<![\p{L}\p{N}])[\p{L}\p{N}](?:[\p{L}\p{N}\-_]*[\p{L}\p{N}])?(?![\p{L}\p{N}])/gu;
const DIGIT_RUN = /(?<!\p{N})\d{6,}(?!\p{N})/gu;

/**
 * "14.03.2025", "2025-03-14", "14/03/25" — and "14.032025" when OCR lost a dot: a date with a
 * separator is not a document number. (Bare 8-digit runs stay suspicious: they may be anything.)
 * @param {string} token
 */
function dateLike(token) {
  if (!/\d[./-]\d/.test(token)) return false;
  const d = token.replace(/\D/g, '');
  const valid = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ day) => y >= 1950 && y <= 2100 && m >= 1 && m <= 12 && day >= 1 && day <= 31;
  if (d.length === 6) return valid(2000 + Number(d.slice(4)), Number(d.slice(2, 4)), Number(d.slice(0, 2)));
  if (d.length !== 8) return false;
  return valid(Number(d.slice(4)), Number(d.slice(2, 4)), Number(d.slice(0, 2))) || valid(Number(d.slice(0, 4)), Number(d.slice(4, 6)), Number(d.slice(6)));
}

/** The whitespace-delimited token of `text` around [start, end). */
function tokenAround(/** @type {string} */ text, /** @type {number} */ start, /** @type {number} */ end) {
  let s = start;
  let e = end;
  while (s > 0 && !/\s/.test(text[s - 1])) s--;
  while (e < text.length && !/\s/.test(text[e])) e++;
  return text.slice(s, e);
}

const ADDRESS_STRONG = /(?<!\p{L})(?:адрес\p{L}*|address|мекен-?жай\p{L}*|проживающ\p{L}*|тұратын|residing)(?!\p{L})/iu;
const ADDRESS_WEAK =
  /(?<!\p{L})(?:ул\.|улиц\p{L}*|пр\.|пр-т|проспект\p{L}*|мкр\.?|микрорайон\p{L}*|кв\.|квартир\p{L}*|дом|д\.(?=\s?\d)|street|str\.|avenue|ave\.|apt\.?)(?!\p{L})/iu;
/** "Адрес эл. почты", "e-mail address": an e-mail label, not a postal address. */
const EMAIL_LABEL = /адрес\p{L}*\s+(?:эл\.|электрон)|e-?mail\s+address/iu;
/** Kazakh street words after the name (OCR often reads ө as е/о, ғ as г) and "139 үй" (house 139). */
const ADDRESS_POSTFIX = /(?<!\p{L})(?:к[өое]шес[іi1]\p{L}*|к[өое]ш\.|даң?[ғг]ыл\p{L}*|street|avenue)(?!\p{L})|\d\s?[үу]й(?!\p{L})/iu;

const GRADE_ALWAYS = /(?<!\p{L})(?:GPA|CGPA)(?!\p{L})/u;
const GRADE_WORD = /(?<!\p{L})(?:балл\p{L}*|оценк\p{L}*|оценок|ба[ғг]а(?:сы|лар\p{L}*|ла\p{L}*)?|score\p{L}*|grade[sd]?)(?!\p{L})/iu;
const PERCENT = /\d+(?:[.,]\d+)?\s?%/u;
/** A table header cell that announces a grade column. */
const GRADE_HEADER = /^[\s#№.]*(?:grades?|оценк[аи]|баға|бага|балл\p{L}*|score|marks?)[\s:.]*$/iu;
/** A cell value that looks like a grade (letter, number, or word grade). */
const GRADE_VALUE = /^(?:[A-F][+-]?|\d{1,3}(?:[.,]\d{1,2})?%?|отл\p{L}*|хор\p{L}*|удовл\p{L}*|неуд\p{L}*|зач\p{L}*|pass|fail)$/iu;
/**
 * Transcript tokens: a letter grade — Latin, its Cyrillic OCR twins, any case (OCR reads "C" as
 * "с", "B+" as "в+"), FX — and a grade point such as 3,33 / 3.67.
 */
const LETTER_GRADE = /^(?:[ABCDFАВСДabcdfавсд][+\-−–]?|[Ff][XxХх])$/u;
const GRADE_POINT = /^[0-4][.,]\d{1,2}$/;
/** A cell of credits / hours / points: a bare number up to 3 digits. */
const SMALL_INT = /^\d{1,3}$/;
/** Word grades next to a count: "27 Отлично", "Хорошо 9". */
const GRADE_WORD_RU = /(?<!\p{L})(?:отлично|хорошо|удовлетворительно|неудовлетворительно|зач[её]тено|не\s?зач[её]тено)(?!\p{L})/iu;
/** A score out of a usual maximum: "49/100", "8.5 / 10", "3.67/4.0" (not dates: 12/05). */
const SCORE_FRACTION = /(?<![\p{N}/.,])\d{1,3}(?:[.,]\d{1,2})?\s?\/\s?(?:100|10|5|4(?:[.,]0)?)(?![\p{N}/])/gu;
/** One token of a "scores only" row ("64  36  49  45" under skill names). */
const SMALL_NUMBER = /^\d{1,3}(?:[.,]\d{1,2})?%?$/;
/** Words that make a percentage a result: "Итоговый результат: 76,44 %". */
const RESULT_WORD = /(?<!\p{L})(?:результат\p{L}*|итог\p{L}*|набрал\p{L}*|нәтиже\p{L}*|result\p{L}*|score\p{L}*|total)(?!\p{L})/iu;
/** Machine-readable zone of ID cards and passports ("IVANOV<<IVAN<<<<", "IDKAZ…<<<"). */
const MRZ = /[A-Z0-9<]*<<[A-Z0-9<]{8,}/;
/** Masked hint of an MRZ row; docHints() also reads it as a sign of an ID document. */
const MRZ_HINT = 'MRZ (машиночитаемая зона)';

/**
 * Looks like a generated identifier ("7XQ2M9K4PLWB", UUID chunks, "CERT-20250314-AB1234"),
 * not a word with a number ("COVID-19", "Hackathon2024") and not an OCR'd Kazakh word
 * whose "і" became "1".
 * @param {string} tok
 */
function isIdLike(tok) {
  const core = tok.replace(/[-_]/g, '');
  if (core.length < 8) return false;
  const digitChars = core.match(/\p{N}/gu) ?? [];
  const letters = core.length - digitChars.length;
  if (digitChars.length < 2 || letters < 2) return false;
  let transitions = 0;
  for (let i = 1; i < core.length; i++) if (/\p{N}/u.test(core[i]) !== /\p{N}/u.test(core[i - 1])) transitions++;
  const lower = (core.match(/\p{Ll}/gu) ?? []).length;
  if (digitChars.every((d) => d === '0' || d === '1') && lower / letters > 0.6) return false;
  return transitions >= 2 || digitChars.length >= 5;
}

/** Kazakhstan IIN check digit (and a plausible birth date in the first 6 digits). */
function validIin(/** @type {string} */ d) {
  if (!/^\d{12}$/.test(d)) return false;
  const mm = Number(d.slice(2, 4));
  const dd = Number(d.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31 || Number(d[6]) > 6) return false;
  const digits = [...d].map(Number);
  const sum = (/** @type {number[]} */ w) => w.reduce((s, wi, i) => s + wi * digits[i], 0) % 11;
  let c = sum([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  if (c === 10) c = sum([3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 2]);
  return c !== 10 && c === digits[11];
}

// ── detectors ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} RowContext
 * @property {boolean} expectBirthDate the previous row ended with a birth-date label
 */

/**
 * All private spans of one row, strongest detectors first.
 * @param {Row} row
 * @param {RowContext} ctx
 * @returns {Span[]}
 */
function detectRow(row, ctx) {
  const { text, norm } = row;
  /** @type {Span[]} */
  const spans = [];
  const claimed = (/** @type {number} */ s, /** @type {number} */ e) => spans.some((sp) => !sp.whole && sp.start < e && s < sp.end);
  /** @type {(start: number, end: number, kind: Kind, masked: string, confidence: number, whole?: 'row' | 'cell') => void} */
  const add = (start, end, kind, masked, confidence, whole) => {
    if (end > start) spans.push({ start, end, kind, masked, confidence, ...(whole ? { whole } : {}) });
  };

  // IIN: 12 digits, possibly grouped by spaces ("990314 300123").
  const iinLabel = IIN_LABEL.test(text);
  for (const m of norm.matchAll(DIGIT_GROUPS)) {
    const groups = m[0].split(/[ \u00a0]/);
    /** @type {[number, number][]} */
    const ranges = [];
    if (groups.join('').length === 12 && !(groups.length > 1 && groups.every((g) => YEAR.test(g)))) ranges.push([m.index, m.index + m[0].length]);
    else {
      let off = m.index;
      for (const g of groups) {
        if (g.length === 12) ranges.push([off, off + 12]);
        off += g.length + 1;
      }
    }
    for (const [s, e] of ranges) {
      const valid = validIin(norm.slice(s, e).replace(/\D/g, ''));
      add(s, e, 'iin', iinLabel ? 'ИИН · 12 цифр' : '12 цифр (похоже на ИИН)', valid || iinLabel ? 0.97 : 0.85);
    }
  }
  // A labelled IIN that OCR broke (11 or 13 digits).
  if (iinLabel) {
    for (const m of norm.matchAll(DIGIT_GROUPS)) {
      const n = m[0].replace(/\D/g, '').length;
      if (n >= 10 && n <= 14 && !claimed(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'iin', 'ИИН · цифры', 0.8);
    }
  }

  // Phones.
  for (const m of norm.matchAll(PHONE_LABEL)) {
    const s = m.index + m[0].length - m[1].length;
    const e = m.index + m[0].length;
    const n = countDigits(m[1]);
    if (n >= 7 && n <= 12 && !claimed(s, e)) add(s, e, 'phone', `тел. ••${tail(m[1])}`, 0.9);
  }
  for (const [re, conf] of /** @type {[RegExp, number][]} */ ([
    [PHONE_INTL, 0.85],
    [PHONE_LOCAL, 0.7],
    [PHONE_ANY, 0.6],
    [PHONE_BARE10, 0.55],
  ])) {
    for (const m of norm.matchAll(re)) {
      const e = m.index + m[0].length;
      if (claimed(m.index, e)) continue;
      const formatted = /[^\d]/.test(m[0]);
      add(m.index, e, 'phone', `тел. ••${tail(m[0])}`, formatted ? conf + 0.05 : conf - 0.1);
    }
  }

  // E-mail.
  for (const m of text.matchAll(EMAIL)) {
    const e = m.index + m[0].length;
    if (!claimed(m.index, e)) add(m.index, e, 'email', `e-mail •••@•••.${m[0].split('.').pop()}`, 0.95);
  }

  // Birth date: a label + a date on the same row, or at the start of the next row.
  if (ctx.expectBirthDate) {
    const m = findDate(text, 0);
    if (m && m.index < 25 && !claimed(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'birth-date', 'дата рождения', 0.85);
  }
  ctx.expectBirthDate = false;
  for (const lab of text.matchAll(BIRTH_LABEL)) {
    const after = lab.index + lab[0].length;
    const m = findDate(text, after);
    if (m && m.index - after <= 40) {
      if (!claimed(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'birth-date', 'дата рождения', 0.9);
    } else if (text.slice(after).trim().length > 1) {
      const s = after + (text.slice(after).length - text.slice(after).trimStart().length);
      add(s, text.length, 'birth-date', 'дата рождения (после метки)', 0.5);
    } else ctx.expectBirthDate = true;
  }
  // A whole date before its label first, so "14.03.1999 г.р." is not reduced to its year.
  for (const m of text.matchAll(DATE)) {
    const e = m.index + m[0].length;
    if (BIRTH_AFTER.test(text.slice(e)) && !claimed(m.index, e)) add(m.index, e, 'birth-date', 'дата рождения (перед меткой)', 0.85);
  }
  for (const m of text.matchAll(BIRTH_SUFFIX)) {
    if (!claimed(m.index, m.index + m[0].length)) add(m.index, m.index + m[0].length, 'birth-date', 'год рождения', 0.8);
  }

  // Document numbers after a marker (№, ID, серия, номер, Certificate ID, код …).
  for (const re of [DOC_KEY_CS, DOC_KEY_CI]) {
    for (const k of text.matchAll(re)) {
      const from = k.index + k[0].length;
      const v = DOC_VALUE.exec(text.slice(from));
      if (!v) continue;
      const s = from + v[0].length - v[1].length;
      const e = from + v[0].length;
      const value = norm.slice(s, e);
      const digits = countDigits(value);
      const mixed = /\p{L}/u.test(value) && digits >= 2 && value.replace(/[^\p{L}\p{N}]/gu, '').length >= 5;
      if ((digits >= 3 || mixed) && !claimed(s, e)) add(s, e, 'doc-number', `№ ••••${tail(value)}`, 0.9);
    }
  }

  // Verification links that carry a document id ("coursera.org/verify/7XQ2…", "cert.efset.org/AbC12x");
  // a generic "site.ru/check/" page is not private.
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[).,;:»"']+$/, '');
    const segments = url.replace(/^(?:https?:\/\/)?[^/]+/i, '').split(/[/?#=&.]+/);
    if (!segments.some((s) => s.length >= 4 && ID_SEGMENT.test(s) && !YEAR.test(s))) continue;
    const e = m.index + url.length;
    if (!claimed(m.index, e)) add(m.index, e, 'doc-number', `ссылка проверки ••${tail(url)}`, VERIFY_HINT.test(url) ? 0.9 : 0.7);
  }

  // Generated identifiers and long bare numbers.
  for (const m of text.matchAll(TOKEN)) {
    const e = m.index + m[0].length;
    if (isIdLike(m[0]) && !claimed(m.index, e)) add(m.index, e, 'doc-number', `№ ••••${tail(m[0])}`, 0.75);
  }
  for (const m of norm.matchAll(DIGIT_RUN)) {
    const e = m.index + m[0].length;
    if (claimed(m.index, e) || dateLike(tokenAround(norm, m.index, e))) continue;
    add(m.index, e, 'doc-number', `№ ••••${tail(m[0])} (${m[0].length} цифр)`, m[0].length >= 8 ? 0.7 : 0.6);
  }

  // Addresses: the whole cell (OCR line) that carries an address keyword with a house number.
  for (const cell of row.cells) {
    const ct = text.slice(cell.start, cell.end);
    const weak = ADDRESS_WEAK.exec(ct);
    const post = ADDRESS_POSTFIX.exec(ct);
    const strong = ADDRESS_STRONG.test(ct) && !EMAIL_LABEL.test(ct);
    const numberAfter = weak && /\d/.test(ct.slice(weak.index, weak.index + weak[0].length + 30));
    const numberNear = post && /\d/.test(ct.slice(Math.max(0, post.index - 30), post.index + post[0].length + 30));
    if (strong || numberAfter || numberNear) add(cell.start, cell.end, 'address', 'адрес', strong ? 0.75 : 0.6, 'cell');
  }

  // Machine-readable zone of an ID document: the whole row.
  if (MRZ.test(text)) add(0, text.length, 'doc-number', MRZ_HINT, 0.9, 'row');

  // Grades: GPA always; other grade words only with a number/letter grade or as a short header;
  // transcript rows (letter grade or grade point + numbers in separate cells); a row made only of
  // small numbers (skill scores); "%" in tables. Scores such as "49/100" are boxed on their own.
  const tokens = text.trim().split(/\s+/);
  const gradeValue = /\d|(?<!\p{L})[A-F][+-]?(?!\p{L})/u.test(text.replace(GRADE_WORD, ''));
  if (GRADE_ALWAYS.test(text)) add(0, text.length, 'grade', 'оценки (GPA)', 0.85, 'row');
  else if (GRADE_WORD.test(text) && (gradeValue || tokens.length <= 3)) add(0, text.length, 'grade', 'оценки', tokens.length <= 3 ? 0.5 : 0.6, 'row');
  else if (isTranscriptRow(row)) add(0, text.length, 'grade', 'строка с оценками', 0.7, 'row');
  else if (GRADE_WORD_RU.test(text) && /\d/.test(text)) add(0, text.length, 'grade', 'оценки', 0.6, 'row');
  else if (tokens.length >= 3 && tokens.every((t) => SMALL_NUMBER.test(t))) add(0, text.length, 'grade', 'ряд баллов', 0.55, 'row');
  else if (PERCENT.test(text) && (row.cells.length > 1 || tokens.length <= 6 || RESULT_WORD.test(text))) {
    // a percentage in a table, a short "label: 76,44 %" or a result line — not "скидка 20 % на курс…" in prose
    add(0, text.length, 'grade', 'процент / оценка', row.cells.length > 1 ? 0.65 : 0.5, 'row');
  }
  for (const m of norm.matchAll(SCORE_FRACTION)) {
    const e = m.index + m[0].length;
    if (!claimed(m.index, e)) add(m.index, e, 'grade', 'балл ••/••', 0.8);
  }

  return spans;
}

/** Trimmed texts of a row's cells. @param {Row} row */
const cellTexts = (row) => row.cells.map((c) => row.text.slice(c.start, c.end).trim());

/**
 * A cell that holds the grade of a transcript row: only grade tokens ("A", "в+", "3,67") and
 * small numbers, at least one of them a letter grade or a grade point — "А- 3,67" and
 * "93 А- 3,67" count (OCR often reads neighbouring cells as one), "Лекция в 10" does not.
 * @param {string} t
 */
function gradeCell(t) {
  const tokens = t.split(/\s+/).filter(Boolean);
  return (
    tokens.length > 0 &&
    tokens.length <= 3 &&
    tokens.every((k) => LETTER_GRADE.test(k) || GRADE_POINT.test(k) || SMALL_INT.test(k)) &&
    tokens.some((k) => LETTER_GRADE.test(k) || GRADE_POINT.test(k))
  );
}

/**
 * A row of a transcript table: ≥ 4 cells, ≥ 2 of them small numbers (credits, hours, points),
 * and a grade cell (see gradeCell) — or, when OCR lost the letter, a course name followed by
 * ≥ 3 numbers and an integer grade point 0–4 in the last cell.
 * @param {Row} row
 */
function isTranscriptRow(row) {
  if (row.cells.length < 4) return false;
  const cells = cellTexts(row);
  const numbers = cells.filter((t) => SMALL_INT.test(t)).length;
  if (numbers < 2) return false;
  if (cells.some(gradeCell)) return true;
  const last = cells.at(-1) ?? '';
  return /^[0-4]$/.test(last) && numbers >= 4 && cells.some((t) => /\p{L}{3,}/u.test(t));
}

/**
 * A row that continues a transcript table once the page has two or more transcript rows:
 * ≥ 4 cells with ≥ 2 numbers among their words (its grade cell may be unreadable, or OCR may
 * have glued neighbouring cells together).
 * @param {Row} row
 */
function isTableRow(row) {
  if (row.cells.length < 4) return false;
  const numbers = cellTexts(row)
    .flatMap((t) => t.split(/\s+/))
    .filter((k) => SMALL_INT.test(k) || GRADE_POINT.test(k)).length;
  return numbers >= 2;
}

/** Rows in a grade column may be interrupted by this many rows without a value (empty table rows). */
const GRADE_COLUMN_GAPS = 4;

/**
 * Rows of a grades table: after a header cell such as "Grade" / "Оценка", every following row
 * with a grade-like value under that column (A, B+, 5, 87, отл …) is flagged as a whole.
 * @param {Row[]} rows
 * @returns {Map<Row, Span>}
 */
function gradeTableRows(rows) {
  /** @type {Map<Row, Span>} */
  const out = new Map();
  for (let i = 0; i < rows.length; i++) {
    const head = rows[i].cells.find((c) => GRADE_HEADER.test(rows[i].text.slice(c.start, c.end)));
    if (!head) continue;
    const col = head.box;
    let misses = 0;
    for (let j = i + 1; j < rows.length && misses < GRADE_COLUMN_GAPS; j++) {
      const r = rows[j];
      if (r.box.y - (rows[j - 1].box.y + rows[j - 1].box.h) > 4 * Math.max(r.box.h, 1)) break;
      const hit = r.pieces.some((p) => {
        const cx = p.box.x + p.box.w / 2;
        return cx >= col.x - col.w * 0.75 && cx <= col.x + col.w * 1.75 && GRADE_VALUE.test(r.text.slice(p.start, p.end));
      });
      if (hit) {
        misses = 0;
        out.set(r, { start: 0, end: r.text.length, kind: 'grade', masked: 'строка таблицы оценок', confidence: 0.75, whole: 'row' });
      } else misses++;
    }
  }
  return out;
}

// ── page level ────────────────────────────────────────────────────────────────────────────

const r4 = (/** @type {number} */ v) => Math.round(v * 10000) / 10000;

/**
 * Pixel box → page-relative box, padded and clamped. OCR boxes hug the glyphs, so they get a
 * margin; PDF text-layer boxes span the font's whole ascender–descender height already, so they
 * only get a hair horizontally (more would spill onto the neighbouring lines of big text).
 * @param {Box} b
 * @param {number} width
 * @param {number} height
 * @param {From} [from]
 */
function toPageBox(b, width, height, from = 'ocr') {
  const px = from === 'textlayer' ? Math.max(1, b.h * 0.05) : Math.max(2, b.h * 0.25);
  const py = from === 'textlayer' ? 0 : Math.max(2, b.h * 0.2);
  const x0 = Math.max(0, b.x - px);
  const y0 = Math.max(0, b.y - py);
  const x1 = Math.min(width, b.x + b.w + px);
  const y1 = Math.min(height, b.y + b.h + py);
  return { x: r4(x0 / width), y: r4(y0 / height), w: r4((x1 - x0) / width), h: r4((y1 - y0) / height) };
}

/**
 * Rows of a text page in reading order. Lines of a sideways page (tp.rotation) are first turned
 * upright, so rows run left to right as on a normal page; `toPage` maps a pixel box of these rows
 * back to a page-relative box of the unturned page (the space of page-N.png, candidates, redact).
 * @param {import('./render.mjs').TextPage} tp
 * @param {From} from
 * @returns {{ rows: Row[], toPage: (box: Box) => Box }}
 */
export function pageRows(tp, from) {
  const turn = isTurn(tp.rotation) ? tp.rotation : 0;
  const size = turnedSize(turn, tp.width, tp.height);
  const lines = (tp.lines ?? []).map((l) =>
    turn ? { ...l, ...turnBox(l, turn, tp.width, tp.height), words: (l.words ?? []).map((w) => ({ ...w, ...turnBox(w, turn, tp.width, tp.height) })) } : l,
  );
  const back = undoTurn(turn);
  return {
    rows: buildRows(lines),
    toPage: (box) => {
      const b = turnBox(toPageBox(box, size.width, size.height, from), back, 1, 1);
      return { x: r4(b.x), y: r4(b.y), w: r4(b.w), h: r4(b.h) };
    },
  };
}

/**
 * Detects private data on one page of OCR / text-layer lines.
 * @param {import('./render.mjs').TextPage} tp
 * @param {number} page
 * @param {From} from
 * @returns {{ candidates: Candidate[], masked: string[] }} candidates + the page text with spans masked
 */
export function detectPage(tp, page, from) {
  const { rows, toPage } = pageRows(tp, from);
  const tables = gradeTableRows(rows);
  // a page with two or more transcript rows is a grades table: its other table rows are grades too
  if (rows.filter(isTranscriptRow).length >= 2) {
    for (const row of rows) {
      if (!tables.has(row) && isTableRow(row)) tables.set(row, { start: 0, end: row.text.length, kind: 'grade', masked: 'строка таблицы оценок', confidence: 0.65, whole: 'row' });
    }
  }
  /** @type {RowContext} */
  const ctx = { expectBirthDate: false };
  /** @type {Candidate[]} */
  const candidates = [];
  /** @type {string[]} */
  const masked = [];
  for (const row of rows) {
    const spans = detectRow(row, ctx);
    const table = tables.get(row);
    if (table && !spans.some((s) => s.whole === 'row')) spans.push(table);
    for (const sp of spans) {
      const box =
        sp.whole === 'row'
          ? row.box
          : sp.whole === 'cell'
            ? (row.cells.find((c) => c.start <= sp.start && sp.start < c.end)?.box ?? null)
            : spanBox(row, sp.start, sp.end);
      if (!box) continue;
      candidates.push({ page, ...toPage(box), kind: sp.kind, masked: sp.masked, confidence: sp.confidence, from });
    }
    masked.push(maskText(row, spans));
  }
  return { candidates, masked };
}

/**
 * Text-only detection for DOCX / PPTX paragraphs (no positions → no boxes).
 * @param {string[]} paragraphs
 * @returns {{ findings: Finding[], masked: string[] }}
 */
export function detectPlain(paragraphs) {
  /** @type {Finding[]} */
  const findings = [];
  /** @type {string[]} */
  const masked = [];
  /** @type {RowContext} */
  const ctx = { expectBirthDate: false };
  for (const text of paragraphs) {
    const box = { x: 0, y: 0, w: 1, h: 1 };
    /** @type {Row} */
    const row = { text, norm: digitish(text), pieces: [], cells: [{ start: 0, end: text.length, box }], box };
    const spans = detectRow(row, ctx);
    for (const sp of spans) findings.push({ kind: sp.kind, masked: sp.masked, confidence: sp.confidence });
    masked.push(maskText(row, spans));
  }
  return { findings, masked };
}

/**
 * Row text with every span replaced by "[hint]" (overlaps merged, strongest kind wins).
 * @param {Row} row
 * @param {Span[]} spans
 */
function maskText(row, spans) {
  const ranges = spans
    .map((sp) => {
      const cell = sp.whole === 'cell' ? row.cells.find((c) => c.start <= sp.start && sp.start < c.end) : null;
      const [s, e] = sp.whole === 'row' ? [0, row.text.length] : cell ? [cell.start, cell.end] : [sp.start, sp.end];
      return { s, e, sp };
    })
    .sort((a, b) => a.s - b.s);
  /** @type {{ s: number, e: number, sp: Span }[]} */
  const merged = [];
  for (const r of ranges) {
    const last = merged.at(-1);
    if (last && r.s < last.e) {
      last.e = Math.max(last.e, r.e);
      if ((RANK.get(r.sp.kind) ?? 9) < (RANK.get(last.sp.kind) ?? 9)) last.sp = r.sp;
    } else merged.push({ ...r });
  }
  let out = '';
  let pos = 0;
  for (const r of merged) {
    out += `${row.text.slice(pos, r.s)}[${r.sp.masked}]`;
    pos = r.e;
  }
  return (out + row.text.slice(pos)).replace(/ {3}/g, '  ');
}

// ── QR codes ──────────────────────────────────────────────────────────────────────────────

/**
 * Finds QR codes with jsQR at scales 1, ½ and ¼ (normal and inverted). After each hit the
 * region is whited out and the search repeats, so several codes on a page are all found.
 * Boxes cover the whole code plus a 2 % page margin. Decodes whose corners do not form a
 * near-square (decorative patterns can fool the locator) are ignored.
 * @param {import('./render.mjs').Raster} raster page pixels (RGB)
 * @param {number} page
 * @returns {Promise<Candidate[]>}
 */
export async function detectQr(raster, page) {
  const W = raster.width;
  const H = raster.height;
  const rgba = await sharp(raster.data, { raw: { width: W, height: H, channels: 3 } }).ensureAlpha().raw().toBuffer();
  /** @type {{ px: Uint8ClampedArray, w: number, h: number }[]} */
  const levels = [{ px: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), w: W, h: H }];
  for (const s of [0.5, 0.25]) {
    const w = Math.max(32, Math.round(W * s));
    const h = Math.max(32, Math.round(H * s));
    const buf = await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).resize(w, h, { fit: 'fill' }).raw().toBuffer();
    levels.push({ px: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), w, h });
  }
  /** @type {Box[]} */
  const found = [];
  for (const lv of levels) {
    for (let k = 0; k < 8; k++) {
      const hit = jsQR(lv.px, lv.w, lv.h, { inversionAttempts: 'attemptBoth' });
      if (!hit) break;
      const c = hit.location;
      const xs = [c.topLeftCorner.x, c.topRightCorner.x, c.bottomLeftCorner.x, c.bottomRightCorner.x].map((v) => v / lv.w);
      const ys = [c.topLeftCorner.y, c.topRightCorner.y, c.bottomLeftCorner.y, c.bottomRightCorner.y].map((v) => v / lv.h);
      const x0 = Math.max(0, Math.min(...xs) - 0.02);
      const y0 = Math.max(0, Math.min(...ys) - 0.02);
      const x1 = Math.min(1, Math.max(...xs) + 0.02);
      const y1 = Math.min(1, Math.max(...ys) + 0.02);
      const box = { x: r4(x0), y: r4(y0), w: r4(x1 - x0), h: r4(y1 - y0) };
      if (plausibleQr(hit)) {
        found.push(box);
        for (const other of levels) whiteOut(other, box);
      } else whiteOut(lv, box); // a bogus decode: hide it on this level only and keep looking
    }
  }
  return found.map((b) => ({ page, ...b, kind: /** @type {Kind} */ ('qr'), masked: 'QR-код', confidence: 0.99, from: /** @type {From} */ ('qr') }));
}

/**
 * A real QR code has four corners of a near-square (photos add some perspective) and is not
 * a few pixels big; decorative patterns that fool jsQR's locator usually fail one of these.
 * @param {import('jsqr').QRCode} hit
 */
function plausibleQr(hit) {
  const { topLeftCorner: a, topRightCorner: b, bottomRightCorner: c, bottomLeftCorner: d } = hit.location;
  const dist = (/** @type {{ x: number, y: number }} */ p, /** @type {{ x: number, y: number }} */ q) => Math.hypot(p.x - q.x, p.y - q.y);
  const sides = [dist(a, b), dist(b, c), dist(c, d), dist(d, a)];
  const diagonals = [dist(a, c), dist(b, d)];
  const shortest = Math.min(...sides);
  return shortest >= 12 && Math.max(...sides) / shortest <= 1.6 && Math.max(...diagonals) / Math.min(...diagonals) <= 1.35;
}

/**
 * @param {{ px: Uint8ClampedArray, w: number, h: number }} lv
 * @param {Box} b page-relative
 */
function whiteOut(lv, b) {
  const x0 = Math.floor(b.x * lv.w);
  const y0 = Math.floor(b.y * lv.h);
  const x1 = Math.min(lv.w, Math.ceil((b.x + b.w) * lv.w));
  const y1 = Math.min(lv.h, Math.ceil((b.y + b.h) * lv.h));
  for (let y = y0; y < y1; y++) lv.px.fill(255, (y * lv.w + x0) * 4, (y * lv.w + x1) * 4);
}

// ── merging ───────────────────────────────────────────────────────────────────────────────

const overlapArea = (/** @type {Box} */ a, /** @type {Box} */ b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const iou = (/** @type {Box} */ a, /** @type {Box} */ b) => {
  const i = overlapArea(a, b);
  return i / (a.w * a.h + b.w * b.h - i || 1);
};

/**
 * Merges duplicates: same kind and overlapping (OCR + text layer, neighbouring words), or
 * different kinds covering nearly the same area (the strongest kind wins). Sorted by page, y, x.
 * @param {Candidate[]} list
 * @returns {Candidate[]}
 */
export function mergeCandidates(list) {
  const out = list.map((c) => ({ ...c }));
  let changed = true;
  while (changed) {
    changed = false;
    search: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i];
        const b = out[j];
        if (a.page !== b.page) continue;
        const same = a.kind === b.kind && overlapArea(a, b) > 0;
        if (!same && iou(a, b) < 0.5) continue;
        const strong = (RANK.get(a.kind) ?? 9) <= (RANK.get(b.kind) ?? 9) ? a : b;
        const u = union([a, b]);
        out[i] = {
          ...strong,
          x: r4(u.x),
          y: r4(u.y),
          w: r4(u.w),
          h: r4(u.h),
          confidence: Math.min(0.99, Math.round((Math.max(a.confidence, b.confidence) + (a.from !== b.from ? 0.05 : 0)) * 100) / 100),
          from: strong.kind === 'qr' ? 'qr' : a.from === 'textlayer' || b.from === 'textlayer' ? 'textlayer' : strong.from,
        };
        out.splice(j, 1);
        changed = true;
        break search;
      }
    }
  }
  return out.sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

// ── hints for drafts ──────────────────────────────────────────────────────────────────────

const MONTH_NUM = /** @type {[RegExp, number][]} */ ([
  [/^(?:январ|jan|қаңтар|каңтар|кантар)/i, 1],
  [/^(?:феврал|feb|ақпан|акпан)/i, 2],
  [/^(?:март|mar|наурыз)/i, 3],
  [/^(?:апрел|apr|сәуір|сэуір)/i, 4],
  [/^(?:ма[йя]|may|мамыр)/i, 5],
  [/^(?:июн|jun|маусым)/i, 6],
  [/^(?:июл|jul|шілде|шiлде)/i, 7],
  [/^(?:август|aug|тамыз)/i, 8],
  [/^(?:сентябр|sep|қыркүйек|кыркуйек)/i, 9],
  [/^(?:октябр|oct|қазан|казан)/i, 10],
  [/^(?:ноябр|nov|қараша|караша)/i, 11],
  [/^(?:декабр|dec|желтоқсан|желтоксан)/i, 12],
]);

/**
 * Dates mentioned in (already masked) text, normalized to YYYY-MM-DD / YYYY, most specific first.
 * @param {string[]} lines
 */
export function datesIn(lines) {
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0');
  /** @type {Set<string>} */
  const full = new Set();
  /** @type {Set<string>} */
  const years = new Set();
  const month = (/** @type {string} */ w) => MONTH_NUM.find(([re]) => re.test(w))?.[1] ?? 0;
  for (const line of lines) {
    for (const m of line.matchAll(DATE)) {
      const t = m[0];
      let y = 0;
      let mo = 0;
      let d = 0;
      let p;
      if ((p = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})$/.exec(t))) [d, mo, y] = [Number(p[1]), Number(p[2]), Number(p[3].length === 2 ? `20${p[3]}` : p[3])];
      else if ((p = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/.exec(t))) [y, mo, d] = [Number(p[1]), Number(p[2]), Number(p[3])];
      else if ((p = /^(\d{1,2})\s+(\S+?)\.?\s+(\d{4})$/u.exec(t))) [d, mo, y] = [Number(p[1]), month(p[2]), Number(p[3])];
      else if ((p = /^(\S+?)\.?\s+(\d{1,2}),?\s+(\d{4})$/u.exec(t))) [mo, d, y] = [month(p[1]), Number(p[2]), Number(p[3])];
      else if (/^\d{4}$/.test(t)) years.add(t);
      if (y >= 1990 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) full.add(`${y}-${pad(mo)}-${pad(d)}`);
    }
  }
  const yearsOfFull = new Set([...full].map((s) => s.slice(0, 4)));
  return [...full, ...[...years].filter((y) => !yearsOfFull.has(y) && Number(y) >= 2005 && Number(y) <= 2100)];
}

/** Keyword → category guesses (a hint for the reviewer, never trusted blindly). */
const CATEGORY_HINTS = /** @type {[string, RegExp][]} */ ([
  ['hackathon', /хакатон|hackathon/i],
  ['pitch-startup', /стартап|startup|start-up|питч|pitch|акселерат|accelerat|инкубат|incubat/i],
  ['conference', /конференц|conference|форум|forum|симпозиум|symposium|круглого стола|round table|доклад/i],
  ['publication', /стать[яиё]|публикац|журнал|journal|article|сборник|proceedings/i],
  ['olympiad', /олимпиад|olympiad/i],
  ['competition', /конкурс|competition|чемпионат|championship|турнир|tournament|что\??\s*где\??\s*когда/i],
  ['sport', /баскетбол|basketball|футбол|football|волейбол|volleyball|спартакиад|универсиад|сұңқар|сункар|суцкар|дойбы|шахмат|chess|спорт/iu],
  ['course', /coursera|курс(?!\p{L})|курса|course|mooc|моок|skillbox|stepik|udemy|тренинг|training|обучени/iu],
  ['language-test', /ef set|efset|ielts|toefl|казтест|kaztest|cefr/i],
  ['grant-scholarship', /грант|grant|стипенди|scholarship/i],
  ['academic-mobility', /мобильност|mobility|exchange|обмен|letter of acceptance|credit transfer|semester/i],
  ['volunteering', /волонт[её]р|volunteer|ерікті/i],
  ['work', /стажир|internship|трудов|employment/i],
]);

/** @param {string[]} lines */
export function categoriesIn(lines) {
  const text = lines.join('\n');
  return CATEGORY_HINTS.filter(([, re]) => re.test(text)).map(([c]) => c);
}

/** Phrases that mark a personal document (never an achievement to publish). */
const PERSONAL_DOC = /удостоверени\p{L}*\s+личност|жеке\s+ку[әа]л[іi]к|паспорт|passport|identity\s+card|свидетельств\p{L}*\s+о\s+рождени|туу\s+туралы/iu;
/** Phrases that mark an academic record with grades. */
const GRADES_DOC = /транскрипт|transcript|зач[её]тн\p{L}*\s+книжк|ведомост\p{L}*|успеваемост|приложени\p{L}*\s+к\s+диплому|академическ\p{L}*\s+справк|средний\s+балл|(?<!\p{L})GPA(?!\p{L})/iu;

/** @typedef {{ reason: 'personal-doc' | 'grades', text: string, pages: number[] }} DocHint */

/**
 * What the pages look like, as advice for the reviewer — never acted on automatically.
 * @param {{ page: number, lines: string[] }[]} texts masked text per page (OCR and text layer
 *   both count; page 0 = DOCX/PPTX text). The phrases looked for are not private.
 * @returns {DocHint[]}
 */
export function docHints(texts) {
  /** @type {DocHint[]} */
  const hints = [
    { reason: 'personal-doc', text: 'похоже на удостоверение / паспорт / свидетельство — личный документ', pages: [] },
    { reason: 'grades', text: 'есть оценки (транскрипт / ведомость / GPA): закрасить их или скрыть', pages: [] },
  ];
  /** @type {Map<number, string>} */
  const byPage = new Map();
  for (const t of texts) byPage.set(t.page, `${byPage.get(t.page) ?? ''}\n${t.lines.join('\n')}`);
  for (const [page, text] of [...byPage].sort((a, b) => a[0] - b[0])) {
    if (PERSONAL_DOC.test(text) || text.includes(MRZ_HINT)) hints[0].pages.push(page);
    if (GRADES_DOC.test(text)) hints[1].pages.push(page);
  }
  return hints.filter((h) => h.pages.length);
}

/** "стр. 3, 5–7" for a hint (empty for a DOCX/PPTX text or a one-page file). */
export function hintPages(/** @type {DocHint} */ h, /** @type {number} */ total) {
  const pages = h.pages.filter((p) => p > 0);
  if (!pages.length || total <= 1) return '';
  /** @type {string[]} */
  const parts = [];
  for (let i = 0; i < pages.length; i++) {
    const start = pages[i];
    while (i + 1 < pages.length && pages[i + 1] === pages[i] + 1) i++;
    parts.push(start === pages[i] ? String(start) : `${start}–${pages[i]}`);
  }
  return `стр. ${parts.join(', ')}`;
}
