// The face window: the scene behind it is copied, darkened through the colour
// tables, a two-ring bevel is drawn the same way, and the portrait is blitted over it. No DOM.
import { FACE_WINDOW } from "../dialog";
import { REMAP_BLUE } from "./facewin-blue";
import { REMAP_GREEN } from "./facewin-green";
import { REMAP_RED } from "./facewin-red";

export { REMAP_BLUE, REMAP_GREEN, REMAP_RED };

/** The tables hold 33 levels of 0x80 bytes (= 0x1080 bytes). */
export const REMAP_LEVELS = 33;

/** Colour tables: a pixel's 5-6-5 parts are looked up per level. */
export interface Remap {
  /** byte per blue value (5 bit), 0x80 per level */
  blue: Uint8Array;
  /** word per green value (6 bit), 64 per level */
  green: Uint16Array;
  /** word per red value (5 bit), 64 per level */
  red: Uint16Array;
}

/** Exact colour tables. The face window and shadows share them. */
export const BUNDLED_REMAP: Remap = {
  blue: Uint8Array.from(REMAP_BLUE),
  green: Uint16Array.from(REMAP_GREEN),
  red: Uint16Array.from(REMAP_RED),
};

/** One pixel through the tables of `level`. */
export function remapPixel(p: number, level: number, t: Remap): number {
  return t.blue[level * 0x80 + (p & 0x1f)] | t.green[level * 64 + ((p >> 5) & 0x3f)] | t.red[level * 64 + ((p >> 11) & 0x1f)];
}

function remapRect(px: Uint16Array, w: number, x: number, y: number, rw: number, rh: number, level: number, t: Remap): void {
  for (let r = 0; r < rh; r++) for (let c = 0; c < rw; c++) px[(y + r) * w + x + c] = remapPixel(px[(y + r) * w + x + c], level, t);
}

/**
 * (0x84, 0x84, 1): for the rings c = 0, 1 two corner pixels at level 0x10, the top and left edge at level 10,
 * the right and bottom edge at 0x16; then the inside (from 2, 0x80 x 0x80) at level 0x10. Works in place on `px`
 * (132 x 132, the copy of the scene).
 */
export function frameWindow(px: Uint16Array, t: Remap): void {
  const W = FACE_WINDOW;
  for (let c = 0; c <= 1; c++) {
    remapRect(px, W, W - c - 1, c, 1, 1, 0x10, t);
    remapRect(px, W, c, W - c - 1, 1, 1, 0x10, t);
    remapRect(px, W, c, c, W - 2 * c - 1, 1, 10, t);
    remapRect(px, W, W - c - 1, c + 1, 1, W - 2 - 2 * c, 0x16, t);
    remapRect(px, W, c + 1, W - c - 1, W - 2 * c - 1, 1, 0x16, t);
    remapRect(px, W, c, c + 1, 1, W - 2 - 2 * c, 10, t);
  }
  remapRect(px, W, 2, 2, W - 4, W - 4, 0x10, t);
}

/** The window: `scene` copied from (x, y) of its pixels, framed, then the keyed portrait over it. */
export function faceWindowPixels(
  scene: { pixels: Uint16Array; width: number; stride?: number },
  x: number,
  y: number,
  face: Uint16Array,
  t: Remap,
): Uint16Array {
  const W = FACE_WINDOW;
  const stride = scene.stride ?? scene.width;
  const px = new Uint16Array(W * W);
  for (let r = 0; r < W; r++) {
    for (let c = 0; c < W; c++) {
      const sx = x + c;
      px[r * W + c] = sx >= 0 && sx < scene.width ? (scene.pixels[(y + r) * stride + sx] ?? 0) : 0;
    }
  }
  frameWindow(px, t);
  face.forEach((p, i) => {
    if (p) px[i] = p;
  });
  return px;
}
