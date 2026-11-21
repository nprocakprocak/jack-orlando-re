import { describe, expect, it } from "vitest";
import type { Image16 } from "../formats/bm";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import type { CursorDraw } from "./cursor";
import { renderLens, zoomImage } from "./lens";
import { drawCursor, lensMaskName } from "./overlay";

const img = (w: number, h: number, px: (i: number) => number): Image16 => ({
  width: w,
  height: h,
  kind: "rgb565",
  pixels: Uint16Array.from({ length: w * h }, (_, i) => px(i)),
});
/** a background of a flat colour, RGBA */
const screen = (r: number, g: number, b: number) => {
  const out = new Uint8ClampedArray(SCREEN_WIDTH * SCREEN_HEIGHT * 4);
  for (let i = 0; i < out.length; i += 4) out.set([r, g, b, 255], i);
  return out;
};
const at = (rgba: Uint8ClampedArray, x: number, y: number) => [...rgba.slice((y * SCREEN_WIDTH + x) * 4, (y * SCREEN_WIDTH + x) * 4 + 3)];

describe("lensMaskName", () => {
  it("LUPAnn -> MASKAnn, BLIR0k -> M0k, everything else none", () => {
    expect(lensMaskName("LUPA01.BM")).toBe("MASKA01.BM");
    expect(lensMaskName("LUPA09.BM")).toBe("MASKA09.BM");
    expect(lensMaskName("BLIR00.BM")).toBe("M00.BM");
    expect(lensMaskName("BLIR04.BM")).toBe("M04.BM");
    expect(lensMaskName("WSK00.BM")).toBeNull();
    expect(lensMaskName("item")).toBeNull();
  });
});

describe("drawCursor: the lens in mode 1", () => {
  // 6x6 "LUPA" with a frame ring of white (0xffff) and a transparent middle; 2x2 mask whose pixels are colour 0xf800
  const lupa = img(6, 6, (i) => (i % 6 === 0 || i % 6 === 5 || i < 6 || i >= 30 ? 0xffff : 0));
  const mask = img(2, 2, () => 0xf800);
  const masks = new Map([["MASKA01.BM", mask], ["M00.BM", mask]]);
  const draw = (image: string, x = 100, y = 50, scale = 1): CursorDraw => ({ image, x, y, w: 6, h: 6, scale });

  it("draws the background under the glass, tinted, not the plain transparent hole", () => {
    const out = screen(0, 0, 255);
    drawCursor(out, lupa, draw("LUPA01.BM"), 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, masks);
    // the glass is at (3,3) of the image, 2x2: the blue background pulled 9/32 towards red; the ring is the LUPA frame
    expect(at(out, 100, 50)).toEqual([255, 255, 255]);
    const glass = at(out, 103, 53);
    expect(glass[0]).toBeGreaterThan(0);
    expect(glass[2]).toBeGreaterThan(150);
    expect(glass[2]).toBeLessThan(255);
    // outside the glass hole of the mask the pixel keeps the image's transparency: the old frame is untouched
    expect(at(out, 101, 51)).toEqual([0, 0, 255]);
  });

  it("matches renderLens on the scene without the cursor (region at mouse - 12, mouse = image centre)", () => {
    const out = screen(0, 0, 0);
    for (let x = 0; x < 20; x++) out.set([x * 10, 40, 200, 255], ((50 + 3) * SCREEN_WIDTH + 100 + x) * 4);
    const bg = new Uint16Array(SCREEN_WIDTH * SCREEN_HEIGHT);
    for (let i = 0; i < bg.length; i++) bg[i] = ((out[4 * i] >> 3) << 11) | ((out[4 * i + 1] >> 2) << 5) | (out[4 * i + 2] >> 3);
    const expected = renderLens(bg, SCREEN_WIDTH, 100 + 3, 50 + 3, mask, lupa);
    drawCursor(out, lupa, draw("LUPA01.BM"), 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, masks);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 6; x++) {
        const p = expected.pixels[y * 6 + x];
        if (p === 0) continue;
        const r = p >> 11, g = (p >> 5) & 63, b = p & 31;
        expect(at(out, 100 + x, 50 + y)).toEqual([(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]);
      }
    }
  });

  it("uses M0k over a reaction (BLIR)", () => {
    const only = new Map([["M00.BM", img(2, 2, () => 0x07e0)]]);
    const out = screen(0, 0, 0);
    drawCursor(out, lupa, draw("BLIR00.BM"), 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, only);
    expect(at(out, 103, 53)[1]).toBeGreaterThan(0); // green tint of the mask
  });

  it("is plain blit in other modes, without masks, with a missing mask and under the zoom", () => {
    const base = screen(0, 0, 255);
    const plain = screen(0, 0, 255);
    drawCursor(plain, lupa, draw("LUPA01.BM"));
    for (const [name, m] of [["WSK00.BM", masks], ["LUPA01.BM", undefined], ["LUPA05.BM", masks]] as const) {
      const out = screen(0, 0, 255);
      drawCursor(out, lupa, draw(name), 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, m);
      expect(out).toEqual(plain);
    }
    expect(plain).not.toEqual(base);
    const zoomed = screen(0, 0, 255);
    drawCursor(zoomed, lupa, { ...draw("LUPA01.BM"), w: 3, h: 3, scale: 0.5 }, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, masks);
    expect(at(zoomed, 103, 53)).toEqual([0, 0, 255]); // 3x3 image: no tinted hole
  });

  it("subtracts the scroll from the lens position", () => {
    const out = screen(0, 0, 255);
    drawCursor(out, lupa, draw("LUPA01.BM", 500, 50), 400, 0, SCREEN_WIDTH, SCREEN_HEIGHT, masks);
    expect(at(out, 100, 50)).toEqual([255, 255, 255]);
  });
});

describe("drawCursor: the mode-switch zoom", () => {
  it("draws zoomImage (box filter), not a nearest-neighbour pick", () => {
    const src = img(4, 4, (i) => (i % 2 === 0 ? 0xf800 : 0x001f)); // red / blue columns
    const z = zoomImage(src, 0.5)!;
    expect([z.width, z.height]).toEqual([2, 2]);
    const out = screen(0, 0, 0);
    drawCursor(out, src, { image: "x", x: 10, y: 10, w: 2, h: 2, scale: 0.5 });
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const p = z.pixels[y * 2 + x];
        const r = p >> 11, b = p & 31;
        expect(at(out, 10 + x, 10 + y)).toEqual([(r << 3) | (r >> 2), (((p >> 5) & 63) << 2) | (((p >> 5) & 63) >> 4), (b << 3) | (b >> 2)]);
      }
    }
    expect(at(out, 10, 10)).not.toEqual([255, 0, 0]); // a mixed colour: red and blue averaged
  });

  it("draws nothing when the zoomed width is 0", () => {
    const out = screen(1, 2, 3);
    drawCursor(out, img(2, 2, () => 0xffff), { image: "x", x: 0, y: 0, w: 0, h: 0, scale: 0.2 });
    expect(out).toEqual(screen(1, 2, 3));
  });
});
