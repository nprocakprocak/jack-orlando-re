import { describe, expect, it } from "vitest";
import {
  blitCopy,
  blitKeyed,
  blitScaled,
  createSurface,
  renderScaled,
  softenEdges,
  stepValue,
  UNIT_STEP,
  windowToRgba,
  type Surface16,
} from "./surface";
import { stepForScale } from "./sprites";

function surf(w: number, h: number, values: number[]): Surface16 {
  expect(values.length).toBe(w * h);
  return { width: w, height: h, pixels: Uint16Array.from(values) };
}

function rows(s: Surface16): number[][] {
  const out: number[][] = [];
  for (let y = 0; y < s.height; y++) out.push([...s.pixels.subarray(y * s.width, (y + 1) * s.width)]);
  return out;
}

describe("blitCopy / blitKeyed", () => {
  const src = surf(3, 2, [1, 0, 3, 4, 5, 0]);

  it("copies a block including zeros", () => {
    const dst = createSurface(4, 3);
    dst.pixels.fill(9);
    blitCopy(src, 0, 0, 3, 2, dst, 1, 1);
    expect(rows(dst)).toEqual([
      [9, 9, 9, 9],
      [9, 1, 0, 3],
      [9, 4, 5, 0],
    ]);
  });

  it("keyed copy skips color 0", () => {
    const dst = createSurface(3, 2);
    dst.pixels.fill(9);
    blitKeyed(src, 0, 0, 3, 2, dst, 0, 0);
    expect(rows(dst)).toEqual([
      [1, 9, 3],
      [4, 5, 9],
    ]);
  });

  it("clamps negative coordinates to 0 like the original", () => {
    const dst = createSurface(3, 2);
    blitCopy(src, -5, -1, 2, 1, dst, -2, -7);
    expect(rows(dst)).toEqual([
      [1, 0, 0],
      [0, 0, 0],
    ]);
  });

  it("clips at the surface edges", () => {
    const dst = createSurface(2, 2);
    blitCopy(src, 1, 1, 5, 5, dst, 1, 1);
    expect(rows(dst)).toEqual([
      [0, 0],
      [0, 5],
    ]);
  });

  it("ignores empty blocks", () => {
    const dst = createSurface(2, 2);
    blitCopy(src, 0, 0, 0, 2, dst, 0, 0);
    blitKeyed(src, 0, 0, 2, -1, dst, 0, 0);
    expect(rows(dst)).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  it("honours the stride of a raw buffer", () => {
    const raw: Surface16 = {
      width: 2,
      height: 2,
      stride: 3,
      pixels: Uint16Array.from([1, 2, 99, 3, 4, 99]),
    };
    const dst = createSurface(2, 2);
    blitCopy(raw, 0, 0, 2, 2, dst, 0, 0);
    expect(rows(dst)).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("blitScaled", () => {
  const img = surf(4, 2, [1, 2, 3, 4, 5, 6, 7, 8]);

  it("unit step is a keyed copy", () => {
    const dst = createSurface(4, 2);
    blitScaled(img, UNIT_STEP, 0, 0, 4, 2, dst, 0, 0);
    expect(rows(dst)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);
  });

  it("scale 0.5 samples every second pixel and row", () => {
    const step = stepForScale(0.5, false);
    expect(step).toEqual({ int: 2, frac: 0 });
    const dst = createSurface(2, 1);
    blitScaled(img, step, 0, 0, 2, 1, dst, 0, 0);
    expect(rows(dst)).toEqual([[1, 3]]);
  });

  it("mirrors when the integer step is negative", () => {
    const dst = createSurface(4, 1);
    blitScaled(img, { int: -1, frac: 0 }, 0, 0, 4, 1, dst, 0, 0);
    expect(rows(dst)).toEqual([[4, 3, 2, 1]]);
  });

  it("mirrored offset counts from the right edge", () => {
    // visible right part of a mirrored 4-px sprite cut 1 px on the right: offset = 1
    const dst = createSurface(3, 1);
    blitScaled(img, { int: -1, frac: 0 }, 1, 0, 3, 1, dst, 0, 0);
    expect(rows(dst)).toEqual([[4, 3, 2]]);
  });

  it("starts inside the sprite at (sx, sy)", () => {
    const dst = createSurface(2, 1);
    blitScaled(img, UNIT_STEP, 2, 1, 2, 1, dst, 0, 0);
    expect(rows(dst)).toEqual([[7, 8]]);
  });

  it("uses the 16.16 step with the 0xffff split", () => {
    const step = stepForScale(0.75, false);
    // trunc(65535 / 0.75) = 87380 -> 1, 21845
    expect(step).toEqual({ int: 1, frac: 21845 });
    expect(stepValue(step)).toBe(87381);
    const wide = surf(8, 1, [1, 2, 3, 4, 5, 6, 7, 8]);
    const dst = createSurface(6, 1);
    blitScaled(wide, step, 0, 0, 6, 1, dst, 0, 0);
    // floor(87381 * c / 65536) for c = 0..5: 0 1 2 3 5 6 (87381 * 3 is just below 4 * 65536)
    expect(rows(dst)).toEqual([[1, 2, 3, 4, 6, 7]]);
  });

  it("skips transparent pixels and source pixels outside the image", () => {
    const dst = createSurface(3, 1);
    dst.pixels.fill(9);
    blitScaled(surf(2, 1, [0, 5]), UNIT_STEP, 0, 0, 3, 1, dst, 0, 0);
    expect(rows(dst)).toEqual([[9, 5, 9]]);
  });

  it("renderScaled gives the drawn sprite", () => {
    // mirrored walk starts at step * (w - 1) = column 2 and goes left
    expect(rows(renderScaled(img, { int: -2, frac: 0 }, 2, 1))).toEqual([[3, 1]]);
  });
});

describe("softenEdges", () => {
  it("does nothing for sprites of 4 px or less", () => {
    const dst = createSurface(6, 6);
    dst.pixels.fill(0xffff);
    softenEdges(surf(4, 4, new Array(16).fill(1)), dst, 0, 0);
    expect(dst.pixels.every((p) => p === 0xffff)).toBe(true);
  });

  it("blends an edge pixel with its diagonal neighbours", () => {
    // 5x5 sprite with a single opaque pixel in the middle: every neighbour is transparent
    const sprite = createSurface(5, 5);
    sprite.pixels[12] = 0xf800;
    const dst = createSurface(5, 5);
    dst.pixels.fill(0x001f); // blue background
    dst.pixels[12] = 0xf800; // red sprite pixel drawn on it
    softenEdges(sprite, dst, 0, 0);
    // center (blended twice: horizontal, then vertical pass)
    // 1st: r = (0 + 0xf800) >> 1 & 0xf800 = 0x7800, b = (0x1f + 0) >> 1 = 0x0f
    // left/right neighbours blended from their diagonals (all blue): stay blue
    // 2nd on center: r = 0x7800 >> 1 & 0xf800 = 0x3800, b = (0x1f + 0x0f) >> 1 = 0x17
    expect(dst.pixels[12]).toBe(0x3800 | 0x17);
    expect(dst.pixels[11]).toBe(0x001f);
    expect(dst.pixels[13]).toBe(0x001f);
  });

  it("checks the pixel above together with its right neighbour", () => {
    const sprite = createSurface(6, 6);
    // opaque at (2,2) and at (3,1): the dword above (2,1),(3,1) is not 0
    sprite.pixels[2 * 6 + 2] = 1;
    sprite.pixels[1 * 6 + 3] = 1;
    const dst = createSurface(6, 6);
    dst.pixels.fill(0xffff);
    dst.pixels[1 * 6 + 2] = 0; // would change if (2,1) were blended
    softenEdges(sprite, dst, 0, 0);
    expect(dst.pixels[1 * 6 + 2]).toBe(0);
  });
});

describe("windowToRgba", () => {
  it("widens channels by bit replication and is opaque; outside is black", () => {
    const s = surf(2, 1, [0xffff, 0x8410]);
    const out = windowToRgba(s, 1, 0, 2, 1);
    expect([...out]).toEqual([0x84, 0x82, 0x84, 255, 0, 0, 0, 255]);
  });
});
