import { describe, expect, it } from "vitest";
import { createSurface } from "./surface";
import {
  FADE_H, FADE_STEPS, FADE_W, mixStep, RED_STEP, SceneTransition, STEP_MS,
} from "./transition";

const px = (r: number, g: number, b: number): number => (r << 11) | (g << 5) | b;
const mixOne = (c: number, t: number): number => {
  const cur = new Uint16Array([c]);
  mixStep(cur, new Uint16Array([t]));
  return cur[0];
};

/** Channel rule written from the description, independent of the bit tricks in mixStep. */
function refChannel(c: number, t: number, wide: boolean): number {
  if (c === t) return c;
  const d = t - c;
  const step = wide ? (Math.abs(d) >= 2 ? 2 : 1) : 1;
  return c + Math.sign(d) * step;
}

describe("mixStep", () => {
  it("steps red and blue by 1 and green by 1 or 2 toward the target", () => {
    expect(mixOne(px(0, 0, 0), px(31, 63, 31))).toBe(px(1, 2, 1));
    expect(mixOne(px(31, 63, 31), px(0, 0, 0))).toBe(px(30, 61, 30));
    expect(mixOne(px(5, 10, 7), px(5, 11, 7))).toBe(px(5, 11, 7)); // green 1 away: +1
    expect(mixOne(px(5, 10, 7), px(5, 12, 7))).toBe(px(5, 12, 7)); // 2 away: +2, no overshoot
    expect(mixOne(px(5, 13, 7), px(5, 11, 7))).toBe(px(5, 11, 7));
    expect(mixOne(px(5, 12, 7), px(5, 11, 7))).toBe(px(5, 11, 7));
  });

  it("matches the per-channel rule for every channel value pair", () => {
    for (let c = 0; c < 64; c++) {
      for (let t = 0; t < 64; t++) {
        const got = (mixOne(px(0, c, 0), px(0, t, 0)) >> 5) & 63;
        expect(got).toBe(refChannel(c, t, true));
        if (c < 32 && t < 32) {
          expect(mixOne(px(c, 0, 0), px(t, 0, 0)) >> 11).toBe(refChannel(c, t, false));
          expect(mixOne(px(0, 0, c), px(0, 0, t)) & 31).toBe(refChannel(c, t, false));
        }
      }
    }
  });

  it("changes channels independently and leaves equal pixels alone", () => {
    const rnd = (n: number): number => Math.floor(Math.random() * n);
    for (let i = 0; i < 2000; i++) {
      const [a, b] = [rnd(0x10000), rnd(0x10000)];
      const want = px(
        refChannel(a >> 11, b >> 11, false),
        refChannel((a >> 5) & 63, (b >> 5) & 63, true),
        refChannel(a & 31, b & 31, false),
      );
      expect(mixOne(a, b)).toBe(want);
      expect(mixOne(a, a)).toBe(a);
    }
  });

  it("never wraps at the channel limits", () => {
    expect(mixOne(0xffff, 0xffff)).toBe(0xffff);
    expect(mixOne(0x0000, 0x0000)).toBe(0);
    expect(mixOne(0xf800, 0x07ff)).toBe(px(30, 2, 1));
    expect(mixOne(0x07ff, 0xf800)).toBe(px(1, 61, 30));
  });

  it("converges within 32 passes from any extreme", () => {
    const cols = [0, 0xffff, 0xf800, 0x07e0, 0x001f, 0x07ff, 0xf81f, 0xffe0];
    for (const a of cols) {
      for (const b of cols) {
        const cur = new Uint16Array([a]);
        const tgt = new Uint16Array([b]);
        for (let i = 0; i < FADE_STEPS; i++) mixStep(cur, tgt);
        expect(cur[0]).toBe(b);
      }
    }
    // green needs the full 32: 63 -> 0 in steps of 2 ends with a single 1
    const cur = new Uint16Array([px(0, 63, 0)]);
    for (let i = 0; i < FADE_STEPS - 1; i++) mixStep(cur, new Uint16Array([0]));
    expect(cur[0]).toBe(px(0, 1, 0));
  });

  it("counts unfinished pixels and handles odd and empty sizes", () => {
    const cur = new Uint16Array([1, 2, 3, 4, 5]);
    expect(mixStep(cur, new Uint16Array([1, 2, 3, 4, 6]))).toBe(1);
    expect(cur[4]).toBe(6);
    expect(mixStep(cur, new Uint16Array(5), 0)).toBe(0);
    expect(cur[4]).toBe(6);
  });

  it("uses RED_STEP 0x800 and honours another step", () => {
    expect(RED_STEP).toBe(0x800);
    const cur = new Uint16Array([0]);
    mixStep(cur, new Uint16Array([0xf800]), 1, 0x1000);
    expect(cur[0]).toBe(0x1000);
  });
});

function solid(w: number, h: number, v: number) {
  const s = createSurface(w, h);
  s.pixels.fill(v);
  return s;
}

describe("SceneTransition", () => {
  it("does the first pass at once and the others stepMs apart", () => {
    const t = new SceneTransition(solid(FADE_W, FADE_H, 0), solid(FADE_W, FADE_H, 0xffff));
    expect(t.step).toBe(0);
    expect(t.current.pixels[0]).toBe(0);
    expect(t.advance(0)).toBe(true);
    expect(t.step).toBe(1);
    expect(t.current.pixels[0]).toBe(px(1, 2, 1));
    expect(t.advance(STEP_MS - 1)).toBe(false);
    expect(t.advance(1)).toBe(true);
    expect(t.step).toBe(2);
    expect(t.advance(3 * STEP_MS)).toBe(true);
    expect(t.step).toBe(5);
  });

  it("reaches the target after 32 passes and finishes after the last wait", () => {
    const t = new SceneTransition(solid(FADE_W, FADE_H, 0), solid(FADE_W, FADE_H, 0xffff));
    t.advance(31 * STEP_MS);
    expect(t.step).toBe(FADE_STEPS);
    expect(t.finished).toBe(false);
    expect(t.current.pixels.every((v) => v === 0xffff)).toBe(true);
    t.advance(STEP_MS);
    expect(t.finished).toBe(true);
    expect(t.advance(1000)).toBe(false);
    expect(t.step).toBe(FADE_STEPS);
  });

  it("works with a custom step and copies its inputs", () => {
    const from = solid(FADE_W, FADE_H, px(10, 20, 10));
    const to = solid(FADE_W, FADE_H, px(10, 20, 10));
    const t = new SceneTransition(from, to, { stepMs: 10 });
    from.pixels.fill(0);
    to.pixels.fill(0xffff);
    t.advance(320);
    expect(t.finished).toBe(true);
    expect(t.current.pixels[5]).toBe(px(10, 20, 10));
  });

  it("takes a wide target by columns, or flat like the original", () => {
    const to = createSurface(1016, FADE_H);
    for (let y = 0; y < FADE_H; y++) to.pixels.fill(y < 2 ? px(31, 0, 0) : 0, y * 1016, y * 1016 + 1016);
    const from = solid(FADE_W, FADE_H, 0);
    const cropped = new SceneTransition(from, to, { stepMs: 1 });
    cropped.advance(31);
    expect(cropped.current.pixels[0]).toBe(px(31, 0, 0));
    expect(cropped.current.pixels[2 * FADE_W]).toBe(0); // row 2 stays black
    const flat = new SceneTransition(from, to, { flatTarget: true, stepMs: 1 });
    flat.advance(31);
    // flat read: the first 640*480 values of a 1016-wide image, so row 1 of the result
    // starts at x = 640 of image row 0 (red) and row 1 reads columns 640.. (still red)
    expect(flat.current.pixels[FADE_W]).toBe(px(31, 0, 0));
    expect(flat.current.pixels[FADE_W * 2]).toBe(px(31, 0, 0)); // 1280 < 2032: image row 1
    expect(flat.current.pixels[FADE_W * 4]).toBe(0); // 2560 -> image row 2
  });

  it("accepts a source or target smaller than 640x480", () => {
    const t = new SceneTransition(solid(100, 50, 0xffff), solid(80, 40, 0xffff), { stepMs: 1 });
    t.advance(32);
    expect(t.current.pixels[0]).toBe(0xffff);
    expect(t.current.pixels[FADE_W * 100]).toBe(0);
    expect(t.finished).toBe(true);
  });

  it("respects a stride on the input surface", () => {
    const from = { width: 4, height: 2, stride: 10, pixels: new Uint16Array(20) };
    from.pixels[10] = 0x1234;
    const t = new SceneTransition(from, solid(FADE_W, FADE_H, 0));
    expect(t.current.pixels[FADE_W]).toBe(0x1234);
  });
});
