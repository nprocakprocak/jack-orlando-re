// The follow camera, on invented widths.
import { describe, expect, it } from "vitest";
import { followScroll, maxScrollFor, SCROLL_MARGIN } from "./scroll";

describe("follow camera (synthetic)", () => {
  it("narrow backgrounds never scroll", () => {
    expect(maxScrollFor(640)).toBe(0);
    expect(followScroll(0, 600, 640)).toBe(0);
  });
  it("limits scroll to 376 and aligns to 4", () => {
    expect(maxScrollFor(1016)).toBe(376);
    expect(maxScrollFor(900)).toBe(260);
    expect(maxScrollFor(2000)).toBe(376);
  });
  it("stays put inside the margins", () => {
    expect(followScroll(100, 100 + SCROLL_MARGIN, 1016)).toBe(100);
    expect(followScroll(100, 100 + 640 - SCROLL_MARGIN, 1016)).toBe(100);
  });
  it("moves 4 px per tick towards a centred Jack and stops at the limits", () => {
    expect(followScroll(0, 700, 1016)).toBe(4);
    let s = 0;
    for (let i = 0; i < 200; i++) s = followScroll(s, 1000, 1016);
    expect(s).toBe(376);
    for (let i = 0; i < 200; i++) s = followScroll(s, 20, 1016);
    expect(s).toBe(0);
  });
});
