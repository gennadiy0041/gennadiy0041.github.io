// @ts-check
/**
 * The achievements folder: walking it (read-only), hashing files and the private
 * `.private/sources.json` map (sha256 → where the file lives on this PC).
 *
 * Identity of a source is the SHA-256 of its bytes, so the same file copied into two folders
 * is one source (the extra copies are listed in `also`). The map is rewritten on every run;
 * hashes of files whose path, size and mtime did not change are reused, because opening files
 * is the slow part on Windows (antivirus scans every open).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PRIVATE, SKIP_DIRS, findSourceDir } from './config.mjs';
import { readJson, writeJson } from './util.mjs';

/** @typedef {'pdf' | 'image' | 'heic' | 'docx' | 'pptx'} SourceKind */

/** Supported extensions → how the file is opened. Everything else is reported as unsupported. */
export const SUPPORTED = /** @type {Record<string, SourceKind>} */ ({
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  webp: 'image',
  heic: 'heic',
  heif: 'heic',
  docx: 'docx',
  pptx: 'pptx',
});

/** @typedef {{ rel: string, path: string, size: number, mtime: string }} Copy where one copy of a file lives */

/**
 * @typedef {object} Source
 * @property {string} sha256
 * @property {string} path absolute path of the first copy (by sorted path)
 * @property {string} rel path relative to the achievements folder (forward slashes)
 * @property {string} ext lower-case extension without the dot
 * @property {SourceKind} kind
 * @property {number} size bytes
 * @property {string} mtime ISO time of last modification
 * @property {Copy[]} also other copies with identical bytes
 * @property {number} [pages] page count, once known
 */

/**
 * One record of `.private/sources.json`.
 * @typedef {{ path: string, rel: string, size: number, mtime: string, ext: string, pages?: number, also?: Copy[] }} SourceRecord
 */
/** @typedef {Record<string, SourceRecord>} SourcesMap */

/** @param {string} name */
const isJunk = (name) =>
  name === 'desktop.ini' || name === 'Thumbs.db' || name === '.DS_Store' || name.startsWith('~$') || name.toLowerCase().endsWith('.tmp');

/** @param {string} p */
export const extOf = (p) => path.extname(p).slice(1).toLowerCase();

/**
 * Lists files of the achievements folder recursively (sorted; junk and service folders skipped).
 * @param {string} dir
 */
export function walkSources(dir) {
  /** @type {{ path: string, rel: string, ext: string }[]} */
  const files = [];
  /** @type {{ rel: string, ext: string }[]} */
  const unsupported = [];
  /** @param {string} d */
  const visit = (d) => {
    const entries = fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) visit(p);
        continue;
      }
      if (!e.isFile() || isJunk(e.name)) continue;
      const rel = path.relative(dir, p).split(path.sep).join('/');
      const ext = extOf(e.name);
      if (SUPPORTED[ext]) files.push({ path: p, rel, ext });
      else unsupported.push({ rel, ext });
    }
  };
  visit(dir);
  return { files, unsupported };
}

/** @param {string} file */
export function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Walks and hashes the folder. Returns unique sources keyed by SHA-256 (first copy wins).
 * @param {string} dir
 */
export function indexSources(dir) {
  const { files, unsupported } = walkSources(dir);
  const previous = loadSourcesMap();
  /** @type {Map<string, { sha: string, size: number, mtime: string }>} path → last known hash */
  const known = new Map();
  for (const [sha, r] of Object.entries(previous)) {
    for (const c of [r, ...(r.also ?? [])]) known.set(c.path, { sha, size: c.size, mtime: c.mtime });
  }
  /** @type {Map<string, Source>} */
  const bySha = new Map();
  for (const f of files) {
    const st = fs.statSync(f.path);
    const mtime = st.mtime.toISOString();
    const hit = known.get(f.path);
    const sha256 = hit && hit.size === st.size && hit.mtime === mtime ? hit.sha : hashFile(f.path);
    const first = bySha.get(sha256);
    if (first) {
      first.also.push({ rel: f.rel, path: f.path, size: st.size, mtime });
      continue;
    }
    const pages = previous[sha256]?.pages;
    bySha.set(sha256, {
      sha256,
      path: f.path,
      rel: f.rel,
      ext: f.ext,
      kind: SUPPORTED[f.ext],
      size: st.size,
      mtime,
      also: [],
      ...(pages ? { pages } : {}),
    });
  }
  return { bySha, unsupported, fileCount: files.length };
}

/** @param {Map<string, Source>} bySha */
export function saveSourcesMap(bySha) {
  /** @type {SourcesMap} */
  const map = {};
  for (const s of [...bySha.values()].sort((a, b) => a.rel.localeCompare(b.rel))) {
    map[s.sha256] = {
      path: s.path,
      rel: s.rel,
      size: s.size,
      mtime: s.mtime,
      ext: s.ext,
      ...(s.pages ? { pages: s.pages } : {}),
      ...(s.also.length ? { also: s.also } : {}),
    };
  }
  writeJson(PRIVATE.sources, map);
}

/** @returns {SourcesMap} */
export function loadSourcesMap() {
  return readJson(PRIVATE.sources, /** @type {SourcesMap} */ ({}));
}

/**
 * Remembers page counts in the private map, so --status does not reopen every PDF.
 * @param {Map<string, number>} pagesBySha
 */
export function rememberPages(pagesBySha) {
  const map = loadSourcesMap();
  let changed = false;
  for (const [sha, pages] of pagesBySha) {
    if (map[sha] && map[sha].pages !== pages) {
      map[sha].pages = pages;
      changed = true;
    }
  }
  if (changed) writeJson(PRIVATE.sources, map);
}

/**
 * @param {string} sha256
 * @param {SourceRecord} r
 * @returns {Source}
 */
export const sourceFromRecord = (sha256, r) => ({
  sha256,
  path: r.path,
  rel: r.rel,
  ext: r.ext ?? extOf(r.path),
  kind: SUPPORTED[r.ext ?? extOf(r.path)],
  size: r.size,
  mtime: r.mtime,
  also: r.also ?? [],
  ...(r.pages ? { pages: r.pages } : {}),
});

/** @param {SourceRecord} r */
function stillValid(r) {
  try {
    const st = fs.statSync(r.path);
    return st.size === r.size && st.mtime.toISOString() === r.mtime;
  } catch {
    return false;
  }
}

/**
 * Finds sources by hash through `.private/sources.json`; when a record is missing or stale
 * (file moved, edited, map absent) the folder is re-indexed once and the map rewritten.
 */
export class SourceLocator {
  /** @param {string} [sourceDir] explicit achievements folder (else $ACHIEVEMENTS_DIR / the mask) */
  constructor(sourceDir) {
    this.sourceDir = sourceDir;
    this.map = loadSourcesMap();
    this.reindexed = false;
  }

  /**
   * @param {string} sha256
   * @returns {Source | null}
   */
  find(sha256) {
    const r = this.map[sha256];
    if (r && stillValid(r)) return sourceFromRecord(sha256, r);
    if (!this.reindexed) {
      this.reindexed = true;
      const { bySha } = indexSources(findSourceDir(this.sourceDir));
      saveSourcesMap(bySha);
      this.map = loadSourcesMap();
      const fresh = this.map[sha256];
      if (fresh) return sourceFromRecord(sha256, fresh);
    }
    return null;
  }
}
