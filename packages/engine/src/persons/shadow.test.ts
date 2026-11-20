import { describe, expect, it } from "vitest";
import { type Image16 } from "../formats/bm";
import { BUNDLED_REMAP } from "../play/facewin";
import { approximateShadowTables } from "../scene/shadow";
import {
  darken,
  darkenPixel,
  maskBufferPixels,
  PersonShadow,
  shadowEnabledByMode,
  type ShadowInput,
} from "./shadow";

const IN: ShadowInput = { x: 300, y: 400, personScale: 1, lightScale: 1, maskWidth: 100, maskHeight: 20 };

function mask(width: number, height: number, set: (x: number, y: number) => boolean): Image16 {
  const pixels = new Uint16Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = set(x, y) ? 0xffff : 0;
  return { width, height, kind: "pal8", pixels };
}

describe("which persons have a shadow", () => {
  it("uses the header mode as the flag below 2, rejects 2 and accepts larger modes", () => {
    expect([0, 1, 2, 3, 800, 12000].map(shadowEnabledByMode)).toEqual([false, true, false, true, true, true]);
  });

  it("sizes the mask buffer: 12000 bytes below 2, otherwise mode * 2, minus the 4-byte header", () => {
    expect(maskBufferPixels(1)).toBe(5998);
    expect(maskBufferPixels(800)).toBe(798);
  });
});

describe("shadow state and script commands", () => {
  it("draws nothing when shadows are off or the person has none", () => {
    expect(new PersonShadow(1).draw(false, IN)).toBeNull();
    expect(new PersonShadow(2).draw(true, IN)).toBeNull();
  });

  it("normal case: size and position from the scale, anchor (55, 14), default strength 8", () => {
    const d = new PersonShadow(1).draw(true, { ...IN, personScale: 0.5, lightScale: 1 })!;
    expect(d.scale).toBe(0.5);
    expect([d.width, d.height]).toEqual([50, 10]);
    expect([d.x, d.y]).toEqual([272, 393]); // trunc(300 - 27.5), trunc(400 - 7)
    expect(d.level).toBe(8);
    // 65535 / 0.5 = 131070 = 2 * 65535 + 0
    expect([d.stepInt, d.stepFrac]).toEqual([2, 0]);
    expect(d.backdrop).toEqual({ srcX: 272, srcWidth: 50, dstX: 0 });
  });

  it("multiplies the person scale by PCS field 4 and caps the scale at 0.99", () => {
    const p = new PersonShadow(1);
    expect(p.draw(true, { ...IN, personScale: 0.8, lightScale: 0.5 })!.scale).toBe(Math.fround(0.4));
    const big = p.draw(true, { ...IN, personScale: 3, lightScale: 1 })!;
    expect(big.scale).toBe(Math.fround(0.99));
    expect(big.width).toBe(99);
  });

  it("splits the source step at 0xffff, not 0x10000", () => {
    const d = new PersonShadow(1).draw(true, { ...IN, personScale: 0.7 })!;
    const step = Math.trunc(65535 / Math.fround(0.7));
    expect(d.stepInt).toBe(Math.floor(step / 65535));
    expect(d.stepFrac).toBe(step % 65535);
    expect(d.stepInt).toBe(1);
  });

  it("clips the backdrop copy at the left edge of the screen", () => {
    const d = new PersonShadow(1).draw(true, { ...IN, x: 20, personScale: 1 })!;
    expect(d.x).toBe(20 - Math.trunc(55 * Math.fround(0.99))); // negative corner
    expect(d.x).toBeLessThan(0);
    expect(d.backdrop.dstX).toBe(-d.x);
    expect(d.backdrop.srcX).toBe(0);
    expect(d.backdrop.srcWidth).toBe(d.width + d.x);
  });

  it("SETSHADOW: 0 removes the shadow, n > 0 restores it with strength n and cancels fades", () => {
    const p = new PersonShadow(1);
    p.fadeOut(5);
    expect(p.setShadow(0)).toBe("removed");
    expect(p.fadingOut).toBe(false);
    expect(p.draw(true, IN)).toBeNull();
    expect(p.setShadow(12)).toBe("none");
    expect(p.draw(true, IN)!.level).toBe(12);
    p.setShadow(200); // stored as a signed byte
    expect(p.strength).toBe(-56);
  });

  it("MINSHADOW of Jack: the fade-out level is also multiplied by g_jackShadowScale (levelScale)", () => {
    const p = new PersonShadow(1);
    p.fadeOut(4);
    // counter 3 -> 2 after the decrement: 8 * 2 * 0.25 = 4, times 0.5 = 2; a person (no levelScale) keeps 4
    expect(p.draw(true, { ...IN, levelScale: 0.5 })!.level).toBe(2);
    const q = new PersonShadow(1);
    q.fadeOut(4);
    expect(q.draw(true, IN)!.level).toBe(4);
  });

  it("MINSHADOW n: the scale shrinks with the counter, the level with the decremented counter, then it is off", () => {
    const p = new PersonShadow(1);
    p.fadeOut(4);
    const scales: number[] = [];
    const levels: number[] = [];
    for (let i = 0; i < 3; i++) {
      const d = p.draw(true, { ...IN, personScale: 0.8 })!;
      scales.push(d.scale);
      levels.push(d.level);
    }
    // counters 3, 2, 1 before the decrement: scale 0.8 * c / 4; levels 8 * (c - 1) / 4
    expect(scales).toEqual([0.6, 0.4, 0.2].map(Math.fround));
    expect(levels).toEqual([4, 2, 0]);
    expect(p.fadingOut).toBe(false);
    expect(p.enabled).toBe(false);
    expect(p.draw(true, IN)).toBeNull();
  });

  it("MAXSHADOW n: the scale grows with the counter from 0 and the shadow is on again after n - 1 draws", () => {
    const p = new PersonShadow(0);
    p.fadeIn(4);
    const first = p.draw(true, { ...IN, personScale: 0.8 })!;
    expect(first.scale).toBe(0); // counter 0
    expect(first.width).toBe(0);
    expect(p.draw(true, { ...IN, personScale: 0.8 })!.scale).toBe(Math.fround(0.2));
    expect(p.enabled).toBe(false);
    expect(p.draw(true, { ...IN, personScale: 0.8 })!.scale).toBe(Math.fround(0.4)); // counter reaches 3 = limit
    expect(p.fadingIn).toBe(false);
    expect(p.enabled).toBe(true);
    expect(p.draw(true, { ...IN, personScale: 0.8 })!.level).toBe(8);
  });

  it("ShowShadow: anchor (60, 15), scale as given (no cap, no person scale), strength kept", () => {
    const p = new PersonShadow(1);
    const d = p.show({ ...IN, personScale: 0.1, lightScale: 0.1, x: 540, y: 357 }, 1.5);
    expect(d.scale).toBe(1.5);
    expect([d.width, d.height]).toEqual([150, 30]);
    expect([d.x, d.y]).toEqual([450, 334]); // trunc(540 - 90), trunc(357 - 22.5)
    expect(d.level).toBe(8);
  });

  it("SETSPECSHADOW marks the custom mask; reset returns to the scene start state", () => {
    const p = new PersonShadow(1);
    p.setShadow(0);
    p.useObjectMask();
    p.fadeIn(3);
    expect(p.customMask).toBe(true);
    p.reset();
    expect([p.customMask, p.enabled, p.fadingIn, p.strength]).toEqual([false, true, false, 8]);
  });
});

describe("darkening", () => {
  const T = approximateShadowTables();

  it("goes through the three colour tables of the level", () => {
    // stand-in level 2: blue and red lose 2, green loses 4
    expect(darkenPixel(0b11111_111111_00101, 2, T)).toBe(0b11101_111011_00011);
    expect(darkenPixel(0x1234, 0, T)).toBe(0x1234);
  });

  it("darkens only under non-zero mask pixels, one mask pixel per backdrop pixel at step 1 + 0", () => {
    // mask 4x2: left column set; stepInt 1, stepFrac 0 copies the mask 1:1
    const m = mask(4, 2, (x) => x === 0);
    const back = new Uint16Array(8).fill(0x000a);
    const draw = { width: 4, height: 2, level: 2, stepInt: 1, stepFrac: 0 } as Parameters<typeof darken>[1];
    expect(darken(back, draw, m, T)).toBe(true);
    expect([...back]).toEqual([8, 10, 10, 10, 8, 10, 10, 10]);
  });

  it("steps through the mask by the 16.16 step: stepInt 2 takes every second pixel and every second row", () => {
    const m = mask(8, 4, (x, y) => x === 2 && y === 2);
    const back = new Uint16Array(12).fill(0x000a); // 4 x 3
    const draw = { width: 4, height: 3, level: 1, stepInt: 2, stepFrac: 0 } as Parameters<typeof darken>[1];
    darken(back, draw, m, T);
    // destination (1, 1) reads mask (2, 2)
    expect(Array.from(back, (v, i) => (v !== 0x000a ? i : -1)).filter((i) => i >= 0)).toEqual([5]);
  });

  it("carries the fraction into the source position", () => {
    // stepInt 1 + 0.5: destination x reads source x * 1.5 (carry on every second pixel)
    const m = mask(8, 1, (x) => x === 3);
    const back = new Uint16Array(4).fill(0x000a);
    const draw = { width: 4, height: 1, level: 1, stepInt: 1, stepFrac: 0x8000 } as Parameters<typeof darken>[1];
    darken(back, draw, m, T);
    // sources 0, 1, 3, 4 (acc 0.5 -> carry, 0.5 -> carry)
    expect(back[2]).toBe(9);
    expect([back[0], back[1], back[3]]).toEqual([10, 10, 10]);
  });

  it("does nothing for an empty rectangle (the early return of the game)", () => {
    const back = new Uint16Array(4).fill(0x000a);
    const draw = { width: 0, height: 2, level: 1, stepInt: 1, stepFrac: 0 } as Parameters<typeof darken>[1];
    expect(darken(back, draw, mask(2, 2, () => true), T)).toBe(false);
    expect([...back]).toEqual([10, 10, 10, 10]);
  });

  it("reads zero beyond the mask instead of failing", () => {
    const back = new Uint16Array(6).fill(0x000a);
    const draw = { width: 3, height: 2, level: 1, stepInt: 2, stepFrac: 0 } as Parameters<typeof darken>[1];
    expect(() => darken(back, draw, mask(2, 1, () => true), T)).not.toThrow();
  });

  it("level 0 of the colour tables keeps a pixel, level 8 makes a white pixel darker", () => {
    expect(darkenPixel(0xffff, 0, BUNDLED_REMAP)).toBe(0xffff);
    expect(darkenPixel(0xffff, 8, BUNDLED_REMAP)).toBeLessThan(0xffff);
    const lum = (p: number) => (p >> 11) + ((p >> 5) & 0x3f) / 2 + (p & 0x1f);
    for (const p of [0x8410, 0xabcd, 0xc618]) expect(lum(darkenPixel(p, 8, BUNDLED_REMAP))).toBeLessThan(lum(p));
  });
});
