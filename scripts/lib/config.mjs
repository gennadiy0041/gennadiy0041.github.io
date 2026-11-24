// @ts-check
/**
 * Paths and constants shared by `npm run sync` and `npm run media`.
 *
 * Everything private (previews, OCR, source paths, notes) lives under `.private/` (git-ignored).
 * The only public bookkeeping file is `content/.sync/manifest.json`, which holds hashes and
 * decisions but never file names, paths or document text.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from './util.mjs';

export const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const CONTENT_DIR = path.join(ROOT, 'content');
export const OCR_SCRIPT = path.join(ROOT, 'scripts', 'lib', 'winocr.ps1');

/**
 * Private working data. Paths are read at call time, so tests can move all of it to a scratch
 * folder with `usePrivateDir()` (`--private-dir`) and never touch the real ledger or inbox.
 */
export const PRIVATE = {
  dir: path.join(ROOT, '.private'),
  /** .private/inbox/<sha12>/: page previews, OCR, candidates, review images, draft */
  get inbox() {
    return path.join(this.dir, 'inbox');
  },
  /** sha256 → where the file lives on this PC (paths may contain an IIN: never public) */
  get sources() {
    return path.join(this.dir, 'sources.json');
  },
  /** sha256 → human notes (why hidden, what it is) */
  get ledger() {
    return path.join(this.dir, 'ledger.json');
  },
  /** extra images for projects / profile, processed by `npm run media` */
  get mediaMap() {
    return path.join(this.dir, 'media-map.json');
  },
  /** output → fingerprint of the inputs it was rendered from (incremental `npm run media`) */
  get mediaCache() {
    return path.join(this.dir, 'media-cache.json');
  },
};

/** @param {string} dir */
export function usePrivateDir(dir) {
  PRIVATE.dir = path.resolve(dir);
}

/** Parent folder searched with the mask `<parent>/*chievements`. */
const SOURCE_PARENT = 'C:/Dad';
const SOURCE_SUFFIX = 'chievements';

/** Folders inside the achievements folder that never contain sources. */
export const SKIP_DIRS = new Set(['.claude', 'site', '.git', 'node_modules']);

/** @param {string} contentDir */
export const manifestPathFor = (contentDir) => path.join(contentDir, '.sync', 'manifest.json');

/** @param {string} sha256 */
export const inboxDirFor = (sha256) => path.join(PRIVATE.inbox, sha256.slice(0, 12));

/**
 * Locates the achievements folder: explicit path, else $ACHIEVEMENTS_DIR, else the first
 * `C:/Dad/*chievements`. The real folder name starts with a CYRILLIC "А", so it is always
 * found through the mask and never spelled out in code.
 * @param {string} [explicit]
 */
export function findSourceDir(explicit) {
  const given = explicit || process.env.ACHIEVEMENTS_DIR;
  if (given) {
    const dir = path.resolve(given);
    if (!isDir(dir)) throw new UserError(`Папка с ачивками не найдена: ${dir}`);
    return dir;
  }
  /** @type {string[]} */
  let names = [];
  try {
    names = fs
      .readdirSync(SOURCE_PARENT, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name.toLowerCase().endsWith(SOURCE_SUFFIX))
      .map((d) => d.name)
      .sort();
  } catch {
    // parent folder missing (e.g. not on Gennadiy's PC) — handled below
  }
  if (!names.length) {
    throw new UserError(`Не нашёл папку ${SOURCE_PARENT}/*${SOURCE_SUFFIX}. Укажи путь: ACHIEVEMENTS_DIR=<папка> или --source <папка>.`);
  }
  return path.join(SOURCE_PARENT, names[0]);
}

/** @param {string} p */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
