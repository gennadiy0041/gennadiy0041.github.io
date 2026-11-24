// @ts-check
/**
 * Quarter turns of page boxes.
 *
 * Photos of certificates often lie sideways or upside down. OCR reads such a page from a turned
 * copy, detection builds its rows in that upright frame, and `npm run media` turns the published
 * image. A turn is always clockwise, in degrees (0, 90, 180, 270), and means "turn the page this
 * much to make it upright". Boxes in files (OCR, candidates, redact) always stay on the unturned page.
 */

/** @typedef {{ x: number, y: number, w: number, h: number }} Box */
/** @typedef {0 | 90 | 180 | 270} Turn */

export const TURNS = /** @type {const} */ ([0, 90, 180, 270]);

/**
 * @param {unknown} v
 * @returns {v is Turn}
 */
export const isTurn = (v) => TURNS.includes(/** @type {Turn} */ (v));

/** The turn that undoes `turn`. @param {Turn} turn @returns {Turn} */
export const undoTurn = (turn) => /** @type {Turn} */ ((360 - turn) % 360);

/**
 * Where a box of a W×H page lands when the page is turned clockwise by `turn` (pixels, or
 * page-relative 0..1 with W = H = 1). The turned page is H×W for 90° and 270°, so the way back
 * is `turnBox(b, undoTurn(turn), H, W)` for those (W, H for 0° and 180°).
 * @param {Box} b
 * @param {Turn} turn
 * @param {number} W
 * @param {number} H
 * @returns {Box}
 */
export function turnBox(b, turn, W, H) {
  switch (turn) {
    case 90:
      return { x: H - b.y - b.h, y: b.x, w: b.h, h: b.w };
    case 180:
      return { x: W - b.x - b.w, y: H - b.y - b.h, w: b.w, h: b.h };
    case 270:
      return { x: b.y, y: W - b.x - b.w, w: b.h, h: b.w };
    default:
      return { x: b.x, y: b.y, w: b.w, h: b.h };
  }
}

/** Size of a W×H page after `turn`. @param {Turn} turn @param {number} W @param {number} H */
export const turnedSize = (turn, W, H) => (turn % 180 ? { width: H, height: W } : { width: W, height: H });
