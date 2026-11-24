// @ts-check
/** Small helpers shared by the sync/media scripts: errors, JSON files, CLI parsing, console output. */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

/** An expected problem (bad argument, missing file): printed as a friendly message without a stack. */
export class UserError extends Error {}

/**
 * Reads a JSON file; returns `fallback` when the file does not exist.
 * @template T
 * @param {string} file
 * @param {T} fallback
 * @returns {T}
 */
export function readJson(file, fallback) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new UserError(`Битый JSON: ${file} — ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * Writes JSON atomically (temp file + rename), 2-space indented, LF, trailing newline.
 * @param {string} file
 * @param {unknown} data
 */
export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

/** Local calendar date as YYYY-MM-DD. */
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Runs at most `n` async tasks at a time.
 * @param {number} n
 * @returns {<T>(task: () => Promise<T>) => Promise<T>}
 */
export function createLimiter(n) {
  let active = 0;
  /** @type {(() => void)[]} */
  const waiting = [];
  const next = () => {
    active--;
    waiting.shift()?.();
  };
  return (task) =>
    new Promise((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < n) run();
      else waiting.push(run);
    });
}

/** First 12 hex chars of a SHA-256: the short id used for inbox folders and CLI arguments. */
export const short = (/** @type {string} */ sha) => sha.slice(0, 12);

/** Project-relative path with forward slashes, for printing. */
export function displayPath(/** @type {string} */ root, /** @type {string} */ p) {
  const rel = path.relative(root, p);
  return (rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? rel : p).split(path.sep).join('/');
}

/**
 * Russian plural: plural(5, 'файл', 'файла', 'файлов') → "файлов".
 * @param {number} n
 * @param {string} one
 * @param {string} few
 * @param {string} many
 */
export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
/** @param {string} code */
const paint = (code) => (/** @type {string|number} */ s) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const color = {
  dim: paint('2'),
  bold: paint('1'),
  green: paint('32'),
  yellow: paint('33'),
  red: paint('31'),
  cyan: paint('36'),
};

/**
 * Parses argv with node:util and turns its English errors into short Russian ones.
 * @template {import('node:util').ParseArgsConfig['options']} O
 * @param {string[]} argv
 * @param {O} options
 * @param {string} helpHint how to get help, e.g. "npm run sync -- --help"
 */
export function parseCli(argv, options, helpHint) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: false }).values;
  } catch (e) {
    const err = /** @type {NodeJS.ErrnoException} */ (e);
    const opt = /'([^']+)'/.exec(err.message)?.[1] ?? '';
    const text =
      err.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION'
        ? `Неизвестный параметр ${opt}.`
        : err.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE'
          ? `Параметру ${opt.split(/[ ,]/)[0]} нужно значение (или оно лишнее).`
          : err.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL'
            ? `Лишний аргумент «${opt}». Значения передаются через параметры, например --entry <id>.`
            : err.message;
    throw new UserError(`${text} Справка: ${helpHint}`);
  }
}

/**
 * Runs a CLI entry point: friendly output for UserError, stack for real bugs. `main` starts in a
 * microtask, after the calling module has finished evaluating, so constants declared below the
 * `runMain(...)` call are initialized by the time it runs.
 * @param {() => Promise<number | void>} main
 */
export function runMain(main) {
  Promise.resolve()
    .then(main)
    .then(
      (code) => {
        process.exitCode = typeof code === 'number' ? code : 0;
      },
      (e) => {
        if (e instanceof UserError) console.error(color.red(`✗ ${e.message}`));
        else console.error(e);
        process.exitCode = 1;
      },
    );
}
