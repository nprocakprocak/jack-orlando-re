// Mode 1 cursor (the magnifier): the image Cursor_UpdateHotspot composes every step,
// and the box-filter scaler of the mode-switch zoom. Pure functions on RGB565 buffers
// (0 = transparent colour key). Description and evidence.
import type { Image16 } from "../formats/bm";
import { blend565 } from "../render/rgb565";
export { blend565 };

/** Glass region: its top-left is `mouse - 12` in both axes (`g_mouseX + -0xc`). */
export const LENS_REGION_OFFSET = 12;
/** Where the region lands inside the LUPA-sized image (Blit_Copy16 dst 3,3; image origin = mouse - 15). */
export const LENS_REGION_INSET = 3;
/** First argument of in: tint strength out of 32. */
export const LENS_TINT_LEVEL = 9;

const key = 0;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The scene rectangle `Render_ComposeRegion` is asked for: mask-sized, at `mouse - 12`. */
export function lensSourceRect(mouseX: number, mouseY: number, maskW: number, maskH: number): Rect {
  return { x: mouseX - LENS_REGION_OFFSET, y: mouseY - LENS_REGION_OFFSET, w: maskW, h: maskH };
}

/**
 * The background copy of Render_ComposeRegion (-> Blit_Copy16). The source origin
 * is clamped to >= 0 (`if (param_1 < 1) param_1 = 0`) without shifting the destination, so near the
 * left/top edge the glass shows the content of column/row 0 onwards. The original reads linearly
 * with no right/bottom clip (a row that runs off the right edge continues into the next row); the
 * part past the end of the buffer reads as 0 here (undefined in the original).
 * Sprites above the background are the caller's job (it composes the scene without the cursor).
 */
export function readRegion(bg: Uint16Array, bgW: number, rect: Rect): Uint16Array {
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const out = new Uint16Array(Math.max(0, rect.w) * Math.max(0, rect.h));
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const i = (y0 + y) * bgW + x0 + x;
      out[y * rect.w + x] = i < bg.length ? bg[i] : 0;
    }
  }
  return out;
}

/**
 * (level, mask, region): every region pixel under a non-zero mask colour moves
 * `level`/32 of the way to that colour (the glass tint and glare); mask colour 0 leaves it alone.
 * In place; `region` has the mask's size.
 */
export function tintRegion(region: Uint16Array, mask: Image16, level = LENS_TINT_LEVEL): void {
  if (region.length !== mask.pixels.length) throw new Error("region and mask differ in size");
  for (let i = 0; i < region.length; i++) {
    const c = mask.pixels[i];
    if (c !== key) region[i] = blend565(region[i], c, level);
  }
}

/**
 * The lens image of (mode 1, `g_cursorIdle == 0` branch or the other one - they differ
 * only in which frame index they use): a LUPA-sized buffer cleared to 0, the tinted
 * region copied to (3, 3) (Blit_Copy16), then the LUPA frame keyed over it (Blit_Keyed16, 0 =
 * transparent). The glass is a 1:1 copy of the scene - **there is no magnification**.
 */
export function composeLens(region: Uint16Array, mask: Image16, lupa: Image16): Image16 {
  const out = new Uint16Array(lupa.width * lupa.height);
  if (
    mask.width + LENS_REGION_INSET > lupa.width ||
    mask.height + LENS_REGION_INSET > lupa.height ||
    region.length !== mask.width * mask.height
  ) {
    throw new Error("lens region does not fit the LUPA image");
  }
  for (let y = 0; y < mask.height; y++) {
    const o = (y + LENS_REGION_INSET) * lupa.width + LENS_REGION_INSET;
    out.set(region.subarray(y * mask.width, (y + 1) * mask.width), o);
  }
  for (let i = 0; i < out.length; i++) if (lupa.pixels[i] !== key) out[i] = lupa.pixels[i];
  return { width: lupa.width, height: lupa.height, kind: "rgb565", pixels: out };
}

/** Whole pipeline: scene background -> lens image. `bg` is the scene without the cursor. */
export function renderLens(
  bg: Uint16Array,
  bgW: number,
  mouseX: number,
  mouseY: number,
  mask: Image16,
  lupa: Image16,
): Image16 {
  const region = readRegion(bg, bgW, lensSourceRect(mouseX, mouseY, mask.width, mask.height));
  tintRegion(region, mask);
  return composeLens(region, mask, lupa);
}

// --- Mode-switch zoom scaler (called from Game_Run) ---

/** The `65535.0` constant. */
const STEP_BASE = 65535;

export interface ZoomStep {
  /** Destination size: `ftol(size * scale)`. */
  w: number;
  h: number;
  /** Source pixels per destination pixel as 16.16: `high << 16 | low`. */
  high: number;
  low: number;
}

/**
 * Parameters of the scaler for a zoom `scale` (0 < scale <= 1) over a `srcW` x `srcH` image:
 * `X = ftol(65535 / scale)`, `high = X / 0xffff`, `low = X % 0xffff` (the div by 0xffff, not
 * 0x10000, is the original's). Float arithmetic is single precision (x87 `fdiv dword`).
 */
export function zoomStep(srcW: number, srcH: number, scale: number): ZoomStep {
  const s = Math.fround(scale);
  const x = Math.trunc(Math.fround(STEP_BASE / s));
  return {
    w: Math.trunc(Math.fround(srcW * s)),
    h: Math.trunc(Math.fround(srcH * s)),
    high: Math.trunc(x / 0xffff),
    low: x % 0xffff,
  };
}

/**
 * box-filter downscale. Each destination pixel averages the whole source pixels of a
 * block `n` wide and `m` tall, where `n` = high 16 bits of (fraction + step) and the fraction (low
 * 16 bits) is carried along the row (same for rows); the block starts where the previous one ended.
 * Per channel (5/6/5 bits) the sum of the masked values is divided by the number of **non-zero**
 * pixels, so transparent pixels do not darken the edge; an all-transparent block gives 0.
 * `mirror` (negative high part in the original) writes each row right to left.
 *
 * Only steps >= 1 are valid: with a block width of 0 the original's do-while loop would run 65536
 * times and read garbage, so this throws instead. Reads past the end of the source read as 0.
 */
export function boxScale(
  src: Image16,
  dstW: number,
  dstH: number,
  high: number,
  low: number,
  mirror = false,
): Uint16Array {
  if (high < 1) throw new Error("boxScale needs a step of at least 1");
  const out = new Uint16Array(Math.max(0, dstW) * Math.max(0, dstH));
  if (dstW <= 0 || dstH <= 0) return out;
  const step = high * 0x10000 + low;
  const srcW = src.width;
  let rowFrac = 0;
  let rowStart = 0; // index of the first source pixel of the current band
  for (let y = 0; y < dstH; y++) {
    const rowSum = rowFrac + step;
    const rows = Math.floor(rowSum / 0x10000);
    let colFrac = 0;
    let colStart = rowStart;
    for (let x = 0; x < dstW; x++) {
      const colSum = colFrac + step;
      const cols = Math.floor(colSum / 0x10000);
      let r = 0,
        g = 0,
        b = 0,
        n = 0;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const idx = colStart + i + j * srcW;
          const p = idx < src.pixels.length ? src.pixels[idx] : 0;
          if (p === key) continue;
          r += p & 0xf800;
          g += p & 0x7e0;
          b += p & 0x1f;
          n++;
        }
      }
      const px = n === 0 ? 0 : (Math.floor(r / n) & 0xf800) | (Math.floor(g / n) & 0x7e0) | (Math.floor(b / n) & 0x1f);
      out[y * dstW + (mirror ? dstW - 1 - x : x)] = px;
      colStart += cols;
      colFrac = colSum % 0x10000;
    }
    rowStart += rows * srcW;
    rowFrac = rowSum % 0x10000;
  }
  return out;
}

/** The zoomed cursor image for `scale`: size and pixels as produces them, or null when the width is 0. */
export function zoomImage(src: Image16, scale: number): Image16 | null {
  const z = zoomStep(src.width, src.height, scale);
  if (z.w === 0) return null;
  return {
    width: z.w,
    height: z.h,
    kind: "rgb565",
    pixels: boxScale(src, z.w, z.h, z.high, z.low),
  };
}
