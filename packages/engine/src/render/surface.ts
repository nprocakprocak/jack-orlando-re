// 16 bpp surfaces and the original blitters.

/** RGB565 pixels, row-major, `stride` pixels per row (defaults to width). 0 is the color key. */
export interface Surface16 {
  width: number;
  height: number;
  pixels: Uint16Array;
  stride?: number;
}

export function createSurface(width: number, height: number): Surface16 {
  return { width, height, pixels: new Uint16Array(width * height) };
}

export function strideOf(s: Surface16): number {
  return s.stride ?? s.width;
}

/**
 * 16.16 fixed-point source step of a scaled 8-bit sprite, as computed by Sprite_Set
 * s = trunc(65535 / scale), int = s / 0xffff, frac = s % 0xffff (sic, not 0x10000).
 * A negative int part mirrors the sprite horizontally.
 */
export interface Step {
  int: number;
  frac: number;
}

export const UNIT_STEP: Step = { int: 1, frac: 0 };

/** Value the pixel walkers in advance by per destination pixel (absolute). */
export function stepValue(step: Step): number {
  return Math.abs(step.int) * 0x10000 + step.frac;
}

/**
 * Plain copy of a w*h block (Blit_Copy16, also for scratch -> screen).
 * Negative coordinates are clamped to 0 like in the original; unlike the original, pixels
 * outside either surface are skipped instead of read/written past the row.
 */
export function blitCopy(
  src: Surface16,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dst: Surface16,
  dx: number,
  dy: number,
): void {
  blit16(src, sx, sy, w, h, dst, dx, dy, false);
}

/** Copy that skips color 0 (between buffers, to the screen). */
export function blitKeyed(
  src: Surface16,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dst: Surface16,
  dx: number,
  dy: number,
): void {
  blit16(src, sx, sy, w, h, dst, dx, dy, true);
}

function blit16(
  src: Surface16,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dst: Surface16,
  dx: number,
  dy: number,
  keyed: boolean,
): void {
  if (w <= 0 || h <= 0) return;
  sx = Math.max(sx, 0);
  sy = Math.max(sy, 0);
  dx = Math.max(dx, 0);
  dy = Math.max(dy, 0);
  const ss = strideOf(src);
  const ds = strideOf(dst);
  const cw = Math.min(w, src.width - sx, dst.width - dx);
  const ch = Math.min(h, src.height - sy, dst.height - dy);
  for (let y = 0; y < ch; y++) {
    let si = (sy + y) * ss + sx;
    let di = (dy + y) * ds + dx;
    if (!keyed) {
      dst.pixels.set(src.pixels.subarray(si, si + cw), di);
      continue;
    }
    for (let x = 0; x < cw; x++, si++, di++) {
      const p = src.pixels[si];
      if (p !== 0) dst.pixels[di] = p;
    }
  }
}

/**
 * Scaled, optionally mirrored keyed blit of an 8-bit sprite (Blit_Pal8Keyed).
 * Draws a w*h destination block; (sx, sy) is the offset of that block inside the scaled
 * sprite. Destination column c (from 0) samples source column
 * floor(step * m / 65536), m = sx + c, or m = sx + w - 1 - c when mirrored; rows likewise
 * without mirroring. `img` holds palette colors already applied (bm.ts / pbm.ts), which is
 * equivalent: the original looks the color up per pixel and skips the value 0.
 */
export function blitScaled(
  img: Surface16,
  step: Step,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dst: Surface16,
  dx: number,
  dy: number,
): void {
  if (w <= 0 || h <= 0) return;
  dx = Math.max(dx, 0);
  dy = Math.max(dy, 0);
  sx = Math.max(sx, 0);
  sy = Math.max(sy, 0);
  const mirrored = step.int < 0;
  const sv = stepValue(step);
  const is = strideOf(img);
  const ds = strideOf(dst);
  const cw = Math.min(w, dst.width - dx);
  const ch = Math.min(h, dst.height - dy);
  for (let y = 0; y < ch; y++) {
    const row = Math.floor((sv * (sy + y)) / 0x10000);
    if (row >= img.height) continue;
    let di = (dy + y) * ds + dx;
    for (let x = 0; x < cw; x++, di++) {
      const m = mirrored ? sx + w - 1 - x : sx + x;
      const col = Math.floor((sv * m) / 0x10000);
      if (col >= img.width) continue;
      const p = img.pixels[row * is + col];
      if (p !== 0) dst.pixels[di] = p;
    }
  }
}

/** Sprite image as the scaled blitter draws it at (0, 0): the input of softenEdges for 8-bit sprites. */
export function renderScaled(img: Surface16, step: Step, w: number, h: number): Surface16 {
  const out = createSurface(Math.max(w, 0), Math.max(h, 0));
  blitScaled(img, step, 0, 0, w, h, out, 0, 0);
  return out;
}

const R = 0xf800;
const G = 0x07e0;
const B = 0x001f;

/** pixel:= (average of its 4 diagonal neighbours + pixel) / 2, per RGB565 channel. */
function blendDiagonal(px: Uint16Array, i: number, stride: number): void {
  const a = px[i - stride - 1];
  const b = px[i - stride + 1];
  const c = px[i + stride - 1];
  const d = px[i + stride + 1];
  const c0 = px[i];
  const r = (((a & R) + (b & R) + (c & R) + (d & R)) >>> 2) + (c0 & R);
  const g = (((a & G) + (b & G) + (c & G) + (d & G)) >>> 2) + (c0 & G);
  const bl = (((a & B) + (b & B) + (c & B) + (d & B)) >>> 2) + (c0 & B);
  px[i] = ((r >>> 1) & R) + ((g >>> 1) & G) + ((bl >>> 1) & B);
}

/**
 * Edge softening of a freshly drawn sprite. `sprite` is the sprite as drawn
 * (w*h, 0 = transparent), placed in `dst` at (dx, dy). For every opaque sprite pixel at
 * least 2 px from the sprite border: if its left or right neighbour is transparent the
 * pixel is blended, and so is each transparent horizontal neighbour; the same for
 * vertical neighbours, except that the pixel above counts as transparent only when it
 * and the one right of it are both 0 (the original compares a dword there). Blends are
 * done in place, in scan order, so later pixels see earlier results.
 */
export function softenEdges(sprite: Surface16, dst: Surface16, dx: number, dy: number): void {
  const w = sprite.width;
  const h = sprite.height;
  if (w <= 4 || h <= 4) return;
  dx = Math.max(dx, 0);
  dy = Math.max(dy, 0);
  const sp = sprite.pixels;
  const ss = strideOf(sprite);
  const ds = strideOf(dst);
  // the original has no bounds checks; skip what would fall outside the destination
  if (dx + w > dst.width || dy + h > dst.height) return;
  const px = dst.pixels;
  for (let y = 2; y < h - 2; y++) {
    for (let x = 2; x < w - 2; x++) {
      const si = y * ss + x;
      if (sp[si] === 0) continue;
      const di = (dy + y) * ds + dx + x;
      const left = sp[si - 1] === 0;
      const right = sp[si + 1] === 0;
      if (left || right) {
        blendDiagonal(px, di, ds);
        if (left) blendDiagonal(px, di - 1, ds);
        if (right) blendDiagonal(px, di + 1, ds);
      }
      const up = sp[si - ss] === 0;
      const down = sp[si + ss] === 0;
      if (up || down) {
        blendDiagonal(px, di, ds);
        if (up && sp[si - ss + 1] === 0) blendDiagonal(px, di - ds, ds);
        if (down) blendDiagonal(px, di + ds, ds);
      }
    }
  }
}

/** RGBA bytes of a w*h window of `src` at (sx, sy), opaque; outside the surface is black. */
export function windowToRgba(
  src: Surface16,
  sx: number,
  sy: number,
  w: number,
  h: number,
  out: Uint8ClampedArray = new Uint8ClampedArray(w * h * 4),
): Uint8ClampedArray {
  const ss = strideOf(src);
  for (let y = 0; y < h; y++) {
    const yy = sy + y;
    for (let x = 0; x < w; x++) {
      const xx = sx + x;
      const o = 4 * (y * w + x);
      const p = yy >= 0 && yy < src.height && xx >= 0 && xx < src.width ? src.pixels[yy * ss + xx] : 0;
      const r = p >> 11;
      const g = (p >> 5) & 0x3f;
      const b = p & 0x1f;
      out[o] = (r << 3) | (r >> 2);
      out[o + 1] = (g << 2) | (g >> 4);
      out[o + 2] = (b << 3) | (b >> 2);
      out[o + 3] = 255;
    }
  }
  return out;
}
