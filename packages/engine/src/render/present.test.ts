import { describe, expect, it } from "vitest";
import {
  alignScroll, MAX_SCROLL_X, presentRgba, screenToBuffer, SCREEN_H, SCREEN_W, scrollLimits, scrollTick,
} from "./present";
import { createSurface } from "./surface";
import { BUFFER_H, BUFFER_W } from "./renderer";

describe("presentRgba", () => {
  it("shows the 640x480 window at the scroll position", () => {
    const fb = createSurface(BUFFER_W, BUFFER_H);
    fb.pixels[5 * BUFFER_W + 400] = 0xffff;
    const out = presentRgba(fb, 376, 5);
    expect(out.length).toBe(SCREEN_W * SCREEN_H * 4);
    expect([...out.subarray(4 * 24, 4 * 25)]).toEqual([255, 255, 255, 255]);
    expect(out[4 * 23]).toBe(0);
  });

  it("fills the part right of a narrow buffer with black", () => {
    const fb = createSurface(700, 480);
    fb.pixels.fill(0xffff);
    const out = presentRgba(fb, 100);
    expect(out[4 * 599]).toBe(255);
    expect(out[4 * 600]).toBe(0);
  });

  it("reuses the output buffer", () => {
    const fb = createSurface(BUFFER_W, BUFFER_H);
    const buf = new Uint8ClampedArray(SCREEN_W * SCREEN_H * 4);
    expect(presentRgba(fb, 0, 0, buf)).toBe(buf);
  });
});

describe("scrolling", () => {
  it("screen to buffer adds the scroll", () => {
    expect(screenToBuffer(10, 20, 376)).toEqual([386, 20]);
  });

  it("alignScroll clamps and rounds down to 4", () => {
    expect(alignScroll(-3)).toBe(0);
    expect(alignScroll(7)).toBe(4);
    expect(alignScroll(376)).toBe(376);
    expect(alignScroll(377)).toBe(MAX_SCROLL_X);
    expect(alignScroll(1000)).toBe(376);
  });

  it("scrollLimits", () => {
    expect(scrollLimits(-8, 999)).toEqual([0, 376]);
    expect(scrollLimits(6, 103)).toEqual([4, 100]);
  });

  it("scrollTick moves 4 px while strictly inside the limits", () => {
    expect(scrollTick(0, 1, 0, 376)).toBe(4);
    expect(scrollTick(376, 1, 0, 376)).toBe(376);
    expect(scrollTick(8, -1, 4, 376)).toBe(4);
    expect(scrollTick(4, -1, 4, 376)).toBe(4);
    expect(scrollTick(100, 0, 0, 376)).toBe(100);
  });
});
