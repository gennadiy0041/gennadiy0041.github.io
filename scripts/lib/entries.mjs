// @ts-check
/**
 * Achievement entries: content/achievements/<id>.md (flat folder; files starting with "_" are
 * ignored, like the Astro glob loader does). Frontmatter is parsed with `yaml`; edits are made
 * as text insertions so comments and formatting of the file survive.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { UserError } from './util.mjs';

/** @typedef {{ page?: number, x: number, y: number, w: number, h: number, kind?: string }} RedactBox */
/** @typedef {{ x: number, y: number, w: number, h: number }} Crop */
/**
 * Fields `npm run media` reads (as written in the file: not validated yet).
 * @typedef {object} EntryData
 * @property {string} [image]
 * @property {{ sha256: string, pages?: string }[]} [source]
 * @property {RedactBox[]} [redact]
 * @property {Crop} [crop]
 * @property {unknown} [rotate] clockwise turn of the published image: 0 | 90 | 180 | 270
 */
/** @typedef {{ id: string, file: string, data: EntryData }} Entry */

const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/** @param {string} achievementsDir */
export function entryIds(achievementsDir) {
  let names = [];
  try {
    names = fs.readdirSync(achievementsDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.md') && !n.startsWith('_'))
    .map((n) => n.slice(0, -3))
    .sort();
}

/**
 * @param {string} achievementsDir
 * @param {string} id
 * @returns {Entry}
 */
export function readEntry(achievementsDir, id) {
  const file = path.join(achievementsDir, `${id}.md`);
  const text = fs.readFileSync(file, 'utf8');
  const m = FRONTMATTER.exec(text);
  if (!m) throw new UserError(`${id}.md: нет frontmatter между строками ---`);
  let data;
  try {
    data = parse(m[1]) ?? {};
  } catch (e) {
    throw new UserError(`${id}.md: YAML не читается — ${/** @type {Error} */ (e).message.split('\n')[0]}`);
  }
  if (typeof data !== 'object' || Array.isArray(data)) throw new UserError(`${id}.md: frontmatter должен быть объектом`);
  return { id, file, data };
}

/**
 * Adds `image: <value>` as the last frontmatter line, keeping everything else byte-for-byte.
 * @param {string} file
 * @param {string} value
 */
export function addImageField(file, value) {
  const text = fs.readFileSync(file, 'utf8');
  const m = FRONTMATTER.exec(text);
  if (!m) throw new UserError(`${path.basename(file)}: нет frontmatter`);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const opening = /^\uFEFF?---\r?\n/.exec(m[0])?.[0].length ?? 0;
  const insertAt = m.index + opening + m[1].length;
  fs.writeFileSync(file, `${text.slice(0, insertAt)}${eol}image: ${value}${text.slice(insertAt)}`);
}
