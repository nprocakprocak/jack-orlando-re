// Scroll limits of a scene (synthetic data only). Scene_LoadCcg sets g_bgScrollMax from the background width.
import { describe, expect, it } from "vitest";
import { scrollTick } from "../render/present";
import { initialScrollMax, maxScrollFor, restoredScroll } from "./scroll";

describe("initialScrollMax (Scene_LoadCcg)", () => {
  it("a wide background of 872 px (SC010, DEK010.BM) stops at 232, not at 376", () => {
    expect(initialScrollMax(true, 872)).toBe(232);
  });
  it("rounds down to a multiple of 4 and caps at 0x178", () => {
    expect(initialScrollMax(true, 1000)).toBe(360);
    expect(initialScrollMax(true, 1016)).toBe(376);
    expect(initialScrollMax(true, 2000)).toBe(376);
  });
  it("a background of exactly 640 px does not scroll", () => {
    expect(initialScrollMax(true, 640)).toBe(0);
    expect(maxScrollFor(640)).toBe(0);
  });
  it("a non-wide scene keeps 0x178 (g_bgWide = 0 stops the scroll elsewhere)", () => {
    expect(initialScrollMax(false, 640)).toBe(376);
  });
  it("the right-scroll tick never passes the limit, from any start", () => {
    const max = initialScrollMax(true, 872);
    for (const start of [0, 100, 228, 232]) {
      let x = start;
      for (let i = 0; i < 200; i++) x = scrollTick(x, 1, 0, max);
      expect(x).toBe(Math.max(start, max));
    }
  });
});

describe("restoredScroll (g_restoreJackPose)", () => {
  it("Jack right of 650, view at 0: right edge (width - 640, at most 376, multiple of 4)", () => {
    expect(restoredScroll(0, 700, 1016)).toBe(376);
    expect(restoredScroll(0, 651, 900)).toBe(260);
    expect(restoredScroll(0, 700, 1501)).toBe(376);
  });
  it("Jack left of 650, view not at 0: back to 0 (the SC006 case: the scene starts on the right)", () => {
    expect(restoredScroll(376, 300, 1016)).toBe(0);
    expect(restoredScroll(4, 649, 1016)).toBe(0);
  });
  it("otherwise the view stays", () => {
    expect(restoredScroll(100, 700, 1016)).toBe(100);
    expect(restoredScroll(0, 300, 1016)).toBe(0);
    expect(restoredScroll(200, 650, 1016)).toBe(200);
    expect(restoredScroll(0, 650, 1016)).toBe(0);
  });
});
