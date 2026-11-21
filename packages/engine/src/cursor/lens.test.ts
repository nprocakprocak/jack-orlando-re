import { describe, expect, it } from "vitest";
import { type Image16 } from "../formats/bm";
import {
  blend565,
  boxScale,
  composeLens,
  lensSourceRect,
  readRegion,
  renderLens,
  tintRegion,
  zoomImage,
  zoomStep,
} from "./lens";

const img = (w: number, h: number, px: number[]): Image16 => ({
  width: w,
  height: h,
  kind: "rgb565",
  pixels: Uint16Array.from(px),
});

describe("lens geometry", () => {
  it("region is mask-sized at mouse - 12", () => {
    expect(lensSourceRect(100, 50, 14, 14)).toEqual({ x: 88, y: 38, w: 14, h: 14 });
  });

  it("readRegion copies the rectangle from the background", () => {
    const bg = Uint16Array.from({ length: 6 * 4 }, (_, i) => i + 1);
    expect([...readRegion(bg, 6, { x: 2, y: 1, w: 2, h: 2 })]).toEqual([9, 10, 15, 16]);
  });

  it("readRegion clamps a negative origin to 0 without shifting", () => {
    const bg = Uint16Array.from({ length: 6 * 4 }, (_, i) => i + 1);
    expect([...readRegion(bg, 6, { x: -3, y: -1, w: 2, h: 2 })]).toEqual([1, 2, 7, 8]);
  });

  it("readRegion runs into the next row at the right edge and reads 0 past the end", () => {
    const bg = Uint16Array.from({ length: 6 * 4 }, (_, i) => i + 1);
    expect([...readRegion(bg, 6, { x: 5, y: 0, w: 2, h: 1 })]).toEqual([6, 7]);
    expect([...readRegion(bg, 6, { x: 5, y: 3, w: 2, h: 1 })]).toEqual([24, 0]);
  });
});

describe("tint", () => {
  it("blend565 moves level/32 of the way, ties to even", () => {
    expect(blend565(0, 0xffff, 0)).toBe(0);
    expect(blend565(0, 0xf800, 16)).toBe(0x8000); // 31 * 16 / 32 = 15.5 -> 16 (even)
    expect(blend565(0x001f, 0x001f, 9)).toBe(0x001f);
    expect(blend565(0xffff, 0, 32)).toBe(0);
  });

  it("only pixels under non-zero mask colours change", () => {
    const region = Uint16Array.from([0x0000, 0xffff, 0x1234, 0x5555]);
    const mask = img(2, 2, [0, 0xffff, 0, 0]);
    tintRegion(region, mask, 9);
    expect(region[0]).toBe(0);
    expect(region[1]).toBe(0xffff);
    expect(region[2]).toBe(0x1234);
    expect(region[3]).toBe(0x5555);
    const r2 = Uint16Array.from([0, 0]);
    tintRegion(r2, img(2, 1, [0xf800, 0]), 16);
    expect([...r2]).toEqual([0x8000, 0]);
  });

  it("rejects a mask of the wrong size", () => {
    expect(() => tintRegion(new Uint16Array(3), img(2, 2, [0, 0, 0, 0]))).toThrow("differ");
  });
});

describe("composeLens", () => {
  const lupa = img(
    5,
    5,
    Array.from({ length: 25 }, (_, i) => (i === 0 || i === 24 ? 0x1111 : 0)),
  );
  it("puts the region at (3,3), LUPA keyed on top, the rest transparent", () => {
    const small = img(2, 2, [0, 0, 0, 0]);
    const out = composeLens(Uint16Array.from([7, 0, 8, 9]), small, lupa);
    expect(out.width).toBe(5);
    expect(out.pixels[0]).toBe(0x1111);
    expect(out.pixels[24]).toBe(0x1111);
    // region at (3,3) would overflow a 5x5 image only past 2x2 -> exactly fits
    expect(out.pixels[3 * 5 + 3]).toBe(7);
    expect(out.pixels[3 * 5 + 4]).toBe(0);
    expect(out.pixels[4 * 5 + 3]).toBe(8);
    expect(out.pixels[4 * 5 + 4]).toBe(0x1111); // LUPA wins over the region
    expect(out.pixels[1 * 5 + 1]).toBe(0);
  });

  it("throws when the region does not fit", () => {
    expect(() => composeLens(new Uint16Array(9), img(3, 3, new Array(9).fill(0)), lupa)).toThrow("fit");
  });

  it("renderLens runs the whole pipeline", () => {
    const bg = new Uint16Array(20 * 20).fill(0x8410);
    const out = renderLens(bg, 20, 10, 10, img(2, 2, [0, 0, 0, 0]), lupa);
    expect(out.pixels[3 * 5 + 3]).toBe(0x8410);
  });
});

describe("zoom scaler", () => {
  it("zoomStep: size truncates, step = 65535 / scale split by 0xffff", () => {
    expect(zoomStep(30, 30, 0.5)).toEqual({ w: 15, h: 15, high: 2, low: 0 });
    const z = zoomStep(18, 25, 0.92);
    expect(z.w).toBe(16);
    expect(z.h).toBe(23);
    expect(z.high).toBe(1);
    expect(z.low).toBe(Math.trunc(Math.fround(65535 / Math.fround(0.92))) % 0xffff);
  });

  it("step 2.0 averages 2x2 blocks per channel", () => {
    const src = img(4, 2, [0xf800, 0x0000 + 1, 0, 0x001f, 0xf800, 0x07e0, 0x07e0, 0x001f]);
    const out = boxScale(src, 2, 1, 2, 0);
    // left block: no zeros, n = 4: R 2*0xf800/4 -> 0x7800, G 0x7e0/4 = 0x1f8 -> 0x1e0, B 1/4 -> 0
    expect(out[0]).toBe(0x79e0);
    // right block: one zero, n = 3: R 0, G 0x7e0/3 = 0x2a0, B 0x3e/3 = 0x14
    expect(out[1]).toBe(0x2b4);
  });

  it("all-transparent blocks give 0, transparent pixels are not averaged in", () => {
    const src = img(2, 2, [0, 0, 0, 0xffff]);
    expect(boxScale(src, 1, 1, 2, 0)[0]).toBe(0xf800 | 0x7e0 | 0x1f);
    expect(boxScale(img(2, 2, [0, 0, 0, 0]), 1, 1, 2, 0)[0]).toBe(0);
  });

  it("the fraction carries: step 1.5 gives blocks of 1, 2, 1, 2... pixels", () => {
    const px = [0x0800, 0x1000, 0x1800, 0x2000, 0x2800, 0x3000];
    const out = boxScale(img(6, 1, px), 4, 1, 1, 0x8000);
    // rows: frac 0 + 1.5 -> 1 row; columns: 1.5 -> 1 px (frac .5), 2 px (frac 0), 1, 2
    expect([...out]).toEqual([0x0800, ((0x1000 + 0x1800) / 2) & 0xf800, 0x2000, ((0x2800 + 0x3000) / 2) & 0xf800]);
  });

  it("mirror writes right to left", () => {
    const src = img(2, 1, [0x0800, 0x1000]);
    expect([...boxScale(src, 2, 1, 1, 0, true)]).toEqual([0x1000, 0x0800]);
  });

  it("rejects steps below 1 and reads past the end as transparent", () => {
    expect(() => boxScale(img(1, 1, [1]), 1, 1, 0, 0x8000)).toThrow("at least 1");
    expect(boxScale(img(1, 1, [0x0800]), 1, 1, 2, 0)[0]).toBe(0x0800);
    expect(boxScale(img(1, 1, [1]), 0, 0, 1, 0).length).toBe(0);
  });

  it("zoomImage returns null for a zero width", () => {
    expect(zoomImage(img(2, 2, [1, 1, 1, 1]), 0.2)).toBeNull();
    const z = zoomImage(img(4, 4, new Array(16).fill(0xffff)), 0.5)!;
    expect([z.width, z.height]).toEqual([2, 2]);
  });
});
