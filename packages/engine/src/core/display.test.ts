import { describe, expect, it } from "vitest";
import { computeDisplay, containDisplay, parseScaleMode } from "./display";

const base = { logicalWidth: 640, logicalHeight: 480, targetCssWidth: 640, maxCssWidth: 2000 };

describe("computeDisplay", () => {
  it("dpr 1: native size, pixelated", () => {
    expect(computeDisplay({ ...base, dpr: 1 })).toEqual({
      cssWidth: 640,
      cssHeight: 480,
      scale: 1,
      smooth: false,
    });
  });
  it("dpr 2: 640 CSS px is exactly 2x", () => {
    expect(computeDisplay({ ...base, dpr: 2 })).toMatchObject({
      cssWidth: 640,
      scale: 2,
      smooth: false,
    });
  });
  it("dpr 1.25: integer 1x covers 80% of wanted -> crisp 512 CSS px", () => {
    const l = computeDisplay({ ...base, dpr: 1.25 });
    expect(l).toMatchObject({ cssWidth: 512, cssHeight: 384, scale: 1, smooth: false });
    expect(l.cssWidth * 1.25).toBe(640);
  });
  it("dpr 1.5: 1x would shrink to 67% -> smooth at the wanted size", () => {
    const l = computeDisplay({ ...base, dpr: 1.5 });
    expect(l.smooth).toBe(true);
    expect(l.cssWidth).toBe(640);
    expect(l.scale).toBeCloseTo(1.5);
  });
  it("dpr 1.75 -> smooth", () => {
    expect(computeDisplay({ ...base, dpr: 1.75 }).smooth).toBe(true);
  });
  it("dpr 2.5: 2x is 80% -> crisp", () => {
    expect(computeDisplay({ ...base, dpr: 2.5 })).toMatchObject({
      scale: 2,
      smooth: false,
      cssWidth: 512,
    });
  });
  it("narrow window: max width caps the size", () => {
    const l = computeDisplay({ ...base, dpr: 1, maxCssWidth: 400 });
    expect(l.smooth).toBe(true);
    expect(l.cssWidth).toBe(400);
    expect(l.cssHeight).toBe(300);
  });
  it("mode integer never smooths, minimum 1x", () => {
    expect(computeDisplay({ ...base, dpr: 1.5, mode: "integer" })).toMatchObject({
      scale: 1,
      smooth: false,
    });
    expect(computeDisplay({ ...base, dpr: 1, maxCssWidth: 300, mode: "integer" })).toMatchObject({
      scale: 1,
      cssWidth: 640,
    });
  });
  it("mode smooth keeps the wanted size, but exact integers stay pixelated", () => {
    expect(computeDisplay({ ...base, dpr: 1.25, mode: "smooth" })).toMatchObject({
      cssWidth: 640,
      smooth: true,
    });
    expect(computeDisplay({ ...base, dpr: 2, mode: "smooth" }).smooth).toBe(false);
  });
  it("wanted 960 CSS px at dpr 1.25 (1.875x) -> smooth", () => {
    expect(computeDisplay({ ...base, targetCssWidth: 960, dpr: 1.25 }).smooth).toBe(true);
  });
  it("invalid dpr falls back to 1; other buffer size keeps aspect", () => {
    expect(computeDisplay({ ...base, dpr: 0 }).scale).toBe(1);
    expect(computeDisplay({ ...base, dpr: NaN }).scale).toBe(1);
    const l = computeDisplay({
      logicalWidth: 320,
      logicalHeight: 200,
      targetCssWidth: 640,
      maxCssWidth: 2000,
      dpr: 1,
    });
    expect(l).toMatchObject({ cssWidth: 640, cssHeight: 400, scale: 2 });
  });
});

describe("containDisplay", () => {
  const game = { logicalWidth: 640, logicalHeight: 480, dpr: 1 };

  it("wide window: full height, side bars", () => {
    const l = containDisplay({ ...game, availCssWidth: 1000, availCssHeight: 400 });
    expect(l.cssHeight).toBe(400);
    expect(l.cssWidth).toBe(533);
    expect(l.cssWidth / l.cssHeight).toBeCloseTo(640 / 480, 2);
    expect(l.smooth).toBe(true);
  });

  it("tall window: full width, bars above and below", () => {
    const l = containDisplay({ ...game, availCssWidth: 800, availCssHeight: 1000 });
    expect(l.cssWidth).toBe(800);
    expect(l.cssHeight).toBe(600);
    expect(l.smooth).toBe(true);
  });

  it("exact 2x stays pixelated", () => {
    expect(containDisplay({ ...game, availCssWidth: 1280, availCssHeight: 960 })).toEqual({
      cssWidth: 1280,
      cssHeight: 960,
      scale: 2,
      smooth: false,
    });
  });

  it("a window smaller than the buffer still keeps the aspect", () => {
    const l = containDisplay({ ...game, availCssWidth: 320, availCssHeight: 200 });
    expect(l.cssWidth).toBe(266);
    expect(l.cssHeight).toBe(200);
    expect(l.smooth).toBe(true);
  });
});

describe("parseScaleMode", () => {
  it("reads ?scale=", () => {
    expect(parseScaleMode("?mute=1&scale=smooth")).toBe("smooth");
    expect(parseScaleMode("?scale=integer")).toBe("integer");
    expect(parseScaleMode("?scale=foo")).toBe("auto");
    expect(parseScaleMode("")).toBe("auto");
  });
});
