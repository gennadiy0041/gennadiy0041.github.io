/**
 * Fuzzy search for the command palette.
 *
 * Pure (no DOM, no globals) so it runs unchanged in the browser and under
 * `node --experimental-strip-types`. Matching works on a folded copy of every
 * string — lowercase, ё→е, Latin diacritics stripped, Kazakh letters mapped to
 * the Russian letters people type instead — while highlight ranges are
 * reported in the ORIGINAL string, ready to be wrapped in <mark>.
 *
 * Per query term (AND semantics, every term must match somewhere):
 *   whole word > word prefix > substring > 1-typo word (terms ≥ 5 letters) > subsequence.
 */

/** Half-open [start, end) span in UTF-16 code units. */
export type Range = [start: number, end: number];

/** A string folded for matching plus the offset of every folded char in the original. */
export interface Folded {
  text: string;
  /** map[i] = original offset of folded char i; map[text.length] = original length. */
  map: number[];
}

export interface SearchField<K extends string = string> {
  key: K;
  text: string;
  /** Relative importance, 0..1 (title = 1). */
  weight: number;
}

export interface SearchDoc<T, K extends string = string> {
  item: T;
  fields: SearchField<K>[];
}

interface PreparedField<K extends string> {
  key: K;
  weight: number;
  folded: Folded;
  /** Word spans in folded coordinates. */
  words: Range[];
  starts: Set<number>;
}

export interface PreparedDoc<T, K extends string = string> {
  item: T;
  fields: PreparedField<K>[];
}

export interface SearchHit<T, K extends string = string> {
  item: T;
  score: number;
  /** Highlight spans in the original text of each field, sorted and merged. */
  ranges: Partial<Record<K, Range[]>>;
}

interface Match {
  /** Match quality 0..1 before the field weight is applied. */
  q: number;
  /** Spans in folded coordinates. */
  ranges: Range[];
}

/** Letters folded to what a Russian keyboard user would type: ё and the Kazakh-specific letters. */
const FOLD: Record<string, string> = {
  ё: 'е',
  ә: 'а',
  ғ: 'г',
  қ: 'к',
  ң: 'н',
  ө: 'о',
  ұ: 'у',
  ү: 'у',
  һ: 'х',
  і: 'и',
};
const COMBINING_MARKS = /[̀-ͯ]/g;
const WORD = /[\p{L}\p{N}]+/gu;

/** Quality tiers. A whole word beats a prefix beats a substring, and so on down. */
const Q_SUBSTRING = 0.55;
const Q_TYPO_WORD = 0.5;
const Q_TYPO_PREFIX = 0.44;
/** Matches in non-winning fields still get highlighted when at least this good. */
const Q_HIGHLIGHT = Q_SUBSTRING;
const MAX_TERMS = 8;
/** Word-prefix lengths (relative to the term) tried for a mistyped prefix. */
const PREFIX_CUTS = [0, 1, -1];

function foldChar(ch: string): string {
  let out = '';
  for (const c of ch.toLowerCase()) {
    const mapped = FOLD[c];
    if (mapped) out += mapped;
    // Cyrillic letters stay as they are (й must not turn into и); everything else loses its accents.
    else if (c >= 'Ѐ' && c <= 'ӿ') out += c;
    else out += c.normalize('NFD').replace(COMBINING_MARKS, '');
  }
  return out;
}

/** Fold a string for matching, keeping a map back to the original offsets. */
export function fold(input: string): Folded {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < input.length; ) {
    const size = (input.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
    const folded = foldChar(input.slice(i, i + size));
    for (let k = 0; k < folded.length; k++) map.push(i);
    text += folded;
    i += size;
  }
  map.push(input.length);
  return { text, map };
}

export function normalize(input: string): string {
  return fold(input).text;
}

/** Query -> distinct folded terms (letters and digits only). */
export function tokenize(query: string): string[] {
  const terms = normalize(query).match(WORD) ?? [];
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

const LAYOUT_EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const LAYOUT_RU = 'йцукенгшщзхъфывапролджэячсмитьбюё';

/**
 * Retype a string as if the other keyboard layout (QWERTY <-> ЙЦУКЕН) had been active:
 * "[frfnjy" -> "хакатон", "ащкь" -> "form".
 */
export function switchLayout(input: string): string {
  let out = '';
  for (const ch of input.toLowerCase()) {
    const en = LAYOUT_EN.indexOf(ch);
    if (en >= 0) {
      out += LAYOUT_RU[en];
      continue;
    }
    const ru = LAYOUT_RU.indexOf(ch);
    out += ru >= 0 ? LAYOUT_EN[ru] : ch;
  }
  return out;
}

/**
 * True when `a` and `b.slice(start, start + len)` are at most one edit apart:
 * one insertion, deletion, substitution or swap of neighbouring letters.
 * Linear time and allocation-free (it runs for every word on every keystroke).
 */
export function oneEdit(a: string, b: string, start = 0, len = b.length - start): boolean {
  const m = a.length;
  if (Math.abs(m - len) > 1) return false;
  let p = 0;
  while (p < m && p < len && a[p] === b[start + p]) p++;
  if (p === m && p === len) return true;
  let s = 0;
  while (s < m - p && s < len - p && a[m - 1 - s] === b[start + len - 1 - s]) s++;
  if (m !== len) return p + s >= Math.min(m, len);
  return p + s >= m - 1 || (p + s === m - 2 && a[p] === b[start + p + 1] && a[p + 1] === b[start + p]);
}

function prepareField<K extends string>(field: SearchField<K>): PreparedField<K> | null {
  const folded = fold(field.text);
  if (!folded.text.trim()) return null;
  const words: Range[] = [];
  for (const m of folded.text.matchAll(WORD)) words.push([m.index, m.index + m[0].length]);
  return { key: field.key, weight: field.weight, folded, words, starts: new Set(words.map(([s]) => s)) };
}

/** Fold and tokenize documents once; reuse the result for every keystroke. */
export function prepare<T, K extends string>(docs: readonly SearchDoc<T, K>[]): PreparedDoc<T, K>[] {
  return docs.map((doc) => ({
    item: doc.item,
    fields: doc.fields.map(prepareField).filter((f): f is PreparedField<K> => f !== null),
  }));
}

function wordMatch(term: string, f: PreparedField<string>): Match | null {
  const { text } = f.folded;
  let best: Match | null = null;
  for (let w = 0; w < f.words.length; w++) {
    const [ws, we] = f.words[w];
    if (!text.startsWith(term, ws)) continue;
    const len = we - ws;
    // An exact word scores 1; a prefix scores by how much of the word it covers. The first word gets a nudge.
    const q = (len === term.length ? 0.96 : 0.78 + 0.14 * (term.length / len)) + (w === 0 ? 0.04 : 0);
    if (!best || q > best.q) best = { q, ranges: [[ws, ws + term.length]] };
  }
  return best;
}

function typoMatch(term: string, f: PreparedField<string>): Match | null {
  const { text } = f.folded;
  let best: Match | null = null;
  for (const [ws, we] of f.words) {
    const len = we - ws;
    if (len < term.length - 1) continue;
    if (oneEdit(term, text, ws, len)) return { q: Q_TYPO_WORD, ranges: [[ws, we]] };
    // The term may be a mistyped prefix of a longer word: compare against the word cut to term length ±1.
    if (best) continue;
    for (const delta of PREFIX_CUTS) {
      const cut = term.length + delta;
      if (cut < len && oneEdit(term, text, ws, cut)) {
        best = { q: Q_TYPO_PREFIX, ranges: [[ws, ws + cut]] };
        break;
      }
    }
  }
  return best;
}

/**
 * fzf-style subsequence: the first letter must open a word, and at least half of the letters
 * must either open a word or follow the previous hit directly ("мк" → "Международная Конференция").
 */
function subsequenceMatch(term: string, f: PreparedField<string>): Match | null {
  const { text } = f.folded;
  let best: Match | null = null;
  for (const [ws] of f.words) {
    if (text[ws] !== term[0]) continue;
    for (const preferWordStarts of [false, true]) {
      const hits = [ws];
      for (let k = 1; k < term.length; k++) {
        const from = hits[k - 1] + 1;
        let next = -1;
        if (preferWordStarts) {
          for (let p = text.indexOf(term[k], from); p >= 0; p = text.indexOf(term[k], p + 1)) {
            if (f.starts.has(p)) {
              next = p;
              break;
            }
          }
        }
        if (next < 0) next = text.indexOf(term[k], from);
        if (next < 0) break;
        hits.push(next);
      }
      if (hits.length < term.length) continue;
      let strong = 0;
      hits.forEach((p, k) => {
        if (f.starts.has(p) || (k > 0 && p === hits[k - 1] + 1)) strong++;
      });
      const quality = strong / term.length;
      if (quality < 0.5) continue;
      const gaps = hits[hits.length - 1] - hits[0] + 1 - term.length;
      const q = 0.22 + 0.16 * quality - Math.min(0.08, gaps * 0.004);
      if (best && q <= best.q) continue;
      const ranges: Range[] = [];
      for (const p of hits) {
        const last = ranges[ranges.length - 1];
        if (last && last[1] === p) last[1] = p + 1;
        else ranges.push([p, p + 1]);
      }
      best = { q, ranges };
    }
  }
  return best;
}

function matchField(term: string, f: PreparedField<string>): Match | null {
  const word = wordMatch(term, f);
  if (word) return word;
  // Single letters only ever match the start of a word — anything looser is noise.
  if (term.length < 2) return null;
  const at = f.folded.text.indexOf(term);
  if (at >= 0) return { q: Q_SUBSTRING, ranges: [[at, at + term.length]] };
  return (term.length >= 5 && typoMatch(term, f)) || subsequenceMatch(term, f);
}

/** Folded span -> original span (one original char can fold into several or none). */
function toOriginal([a, b]: Range, { map }: Folded): Range {
  const last = map[b - 1];
  let k = b;
  while (k < map.length - 1 && map[k] === last) k++;
  return [map[a], map[k]];
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: Range[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Rank prepared documents against a query. Returns only documents where every
 * term matched, best first; ties keep the input order.
 */
export function search<T, K extends string>(docs: readonly PreparedDoc<T, K>[], query: string): SearchHit<T, K>[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const hits: Array<SearchHit<T, K> & { order: number }> = [];

  docs.forEach((doc, order) => {
    const spans = new Map<K, Range[]>();
    let total = 0;
    let homeField: K | null | undefined;
    for (const term of terms) {
      let bestScore = 0;
      let bestField: PreparedField<K> | null = null;
      let bestMatch: Match | null = null;
      const strong: Array<[PreparedField<K>, Match]> = [];
      for (const f of doc.fields) {
        const m = matchField(term, f);
        if (!m) continue;
        const score = m.q * f.weight;
        if (score > bestScore) {
          bestScore = score;
          bestField = f;
          bestMatch = m;
        }
        if (m.q >= Q_HIGHLIGHT) strong.push([f, m]);
      }
      if (!bestField || !bestMatch) return;
      total += bestScore;
      homeField = homeField === undefined || homeField === bestField.key ? bestField.key : null;
      const marked: Array<[PreparedField<K>, Match]> = [[bestField, bestMatch], ...strong];
      for (const [f, m] of marked) {
        const list = spans.get(f.key) ?? [];
        for (const r of m.ranges) list.push(toOriginal(r, f.folded));
        spans.set(f.key, list);
      }
    }
    // All terms landing in one field ("1 место" in a title) reads as a phrase: small bonus.
    const score = total / terms.length + (terms.length > 1 && homeField ? 0.05 : 0);
    const ranges: Partial<Record<K, Range[]>> = {};
    for (const [key, list] of spans) ranges[key] = mergeRanges(list);
    hits.push({ item: doc.item, score, ranges, order });
  });

  hits.sort((a, b) => b.score - a.score || a.order - b.order);
  return hits.map(({ item, score, ranges }) => ({ item, score, ranges }));
}

/** Split text into plain and highlighted runs for rendering. */
export function segments(text: string, ranges: readonly Range[] = []): Array<{ text: string; mark: boolean }> {
  const out: Array<{ text: string; mark: boolean }> = [];
  let pos = 0;
  for (const [a, b] of ranges) {
    const start = Math.max(a, pos);
    const end = Math.min(b, text.length);
    if (start >= end) continue;
    if (start > pos) out.push({ text: text.slice(pos, start), mark: false });
    out.push({ text: text.slice(start, end), mark: true });
    pos = end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos), mark: false });
  return out;
}
