// Mouse wheel on the coat and the item bar (deviation from the original): synthetic, no game files.
import { describe, expect, it } from "vitest";
import type { Font, Glyph } from "../formats/fnt";
import { createSurface, type Surface16 } from "../render/surface";
import { CoatScreen, Inventory, MAX_SCROLL_ROW, SCROLL_FRAMES, type CoatAssets, type CoatHost } from "./index";
import { TopBar, type BarInput, type TopBarHost, type TopBarImages } from "./topbar";
import { NOTCH_PX, WheelAccumulator } from "./wheel";

const surf = (w: number, h: number, v = 0x1234): Surface16 => {
  const s = createSurface(w, h);
  s.pixels.fill(v);
  return s;
};
const glyph = (code: number): Glyph => ({
  code,
  offset: 0,
  width: 3,
  height: 5,
  pixels: new Uint8Array(15).fill(2),
});
const font: Font = { glyphs: Array.from({ length: 256 }, (_, i) => glyph(i)), dataEnd: 0 };
const coatImages = () => ({
  background: surf(640, 480),
  up: surf(40, 40),
  down: surf(40, 40),
  opt: surf(152, 72),
  upPressed: surf(40, 40),
  downPressed: surf(40, 40),
  optPressed: surf(152, 72),
});
const assets: CoatAssets = { civilian: coatImages(), uniform: coatImages(), font };

function makeCoat() {
  const inv = new Inventory();
  const host: CoatHost = { startMacro: () => false, itemName: () => null, onExit: () => undefined };
  const screen = new CoatScreen(inv, assets, host);
  screen.open(false);
  return { inv, screen };
}
const settle = (s: CoatScreen): void => {
  for (let i = 0; i < SCROLL_FRAMES + 2; i++) s.tick();
};

describe("WheelAccumulator", () => {
  it("a mouse notch (100 px) is one step; direction by sign", () => {
    const w = new WheelAccumulator();
    expect(w.add(NOTCH_PX)).toBe(1);
    expect(w.add(-NOTCH_PX)).toBe(-1);
  });
  it("small touchpad deltas are summed to one notch", () => {
    const w = new WheelAccumulator();
    const got = [30, 30, 30, 30, 30, 30, 30, 30, 30, 30].map((d) => w.add(d));
    expect(got).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0, 0]);
  });
  it("a large delta gives one step only (no several rows at once)", () => {
    const w = new WheelAccumulator();
    expect(w.add(450)).toBe(1);
    expect(w.add(10)).toBe(0);
  });
  it("a change of direction drops the sum of the other way", () => {
    const w = new WheelAccumulator();
    expect(w.add(80)).toBe(0);
    expect(w.add(-30)).toBe(0);
    expect(w.add(-80)).toBe(-1);
  });
  it("deltaMode: lines (3 per notch) and pages", () => {
    const w = new WheelAccumulator();
    expect(w.add(1, 1)).toBe(0);
    expect(w.add(2, 1)).toBe(1);
    expect(w.add(1, 2)).toBe(1);
  });
  it("zero and non-finite deltas do nothing; reset clears the sum", () => {
    const w = new WheelAccumulator();
    expect(w.add(0)).toBe(0);
    expect(w.add(NaN)).toBe(0);
    w.add(60);
    w.reset();
    expect(w.add(60)).toBe(0);
  });
});

describe("CoatScreen.wheel", () => {
  it("down scrolls one row like the down arrow, up goes back", () => {
    const { inv, screen } = makeCoat();
    expect(screen.wheel(1)).toBe(true);
    expect(screen.anim).toMatchObject({ dir: 1 });
    settle(screen);
    expect(inv.scrollRow).toBe(1);
    screen.wheel(-1);
    settle(screen);
    expect(inv.scrollRow).toBe(0);
  });
  it("bounds: up at row 0 and down at the last row do nothing (the wheel is still taken)", () => {
    const { inv, screen } = makeCoat();
    expect(screen.wheel(-1)).toBe(true);
    expect(screen.anim).toBeNull();
    inv.scrollRow = MAX_SCROLL_ROW;
    expect(screen.wheel(1)).toBe(true);
    expect(screen.anim).toBeNull();
    expect(inv.scrollRow).toBe(MAX_SCROLL_ROW);
  });
  it("a notch during the animation is ignored (no queue)", () => {
    const { inv, screen } = makeCoat();
    screen.wheel(1);
    screen.tick();
    screen.wheel(1);
    settle(screen);
    expect(inv.scrollRow).toBe(1);
    expect(screen.anim).toBeNull();
  });
  it("region B (MARZECZY = 0): the wheel does nothing and is not taken", () => {
    const { inv, screen } = makeCoat();
    inv.marzeczy = 0;
    expect(screen.wheel(1)).toBe(false);
    expect(screen.anim).toBeNull();
  });
  it("closed coat: not taken", () => {
    const { screen } = makeCoat();
    screen.isOpen = false;
    expect(screen.wheel(1)).toBe(false);
  });
});

const barImages = {
  options: surf(140, 70),
  optionsPressed: surf(140, 70),
  left: surf(37, 50),
  right: surf(41, 50),
  strip: surf(792, 48),
  frame: surf(48, 41),
} as unknown as TopBarImages;
const at = (x: number, y: number): BarInput => ({
  x,
  y,
  down: false,
  pressed: false,
  right: false,
  rightPressed: false,
  inWindow: true,
});

function makeBar() {
  const inv = new Inventory();
  const host: TopBarHost = {
    startMacro: () => false,
    macroActive: () => false,
    itemName: () => null,
    requestOptions: () => undefined,
  };
  const bar = new TopBar(inv, barImages, font, host);
  return { inv, bar };
}
function openBar(bar: TopBar): void {
  bar.frame(at(300, 0), true);
  for (let i = 0; i < 20 && bar.state !== "open"; i++) bar.frame(at(300, 20), true);
}
const run = (bar: TopBar, n = 30): void => {
  for (let i = 0; i < n; i++) bar.frame(at(300, 20), true);
};

describe("TopBar.wheel", () => {
  it("closed or sliding: not taken, nothing moves", () => {
    const { bar } = makeBar();
    expect(bar.wheel(1)).toBe(false);
    bar.frame(at(300, 0), true);
    expect(bar.state).toBe("opening");
    expect(bar.wheel(1)).toBe(false);
  });
  it("down moves one slot (44 px) towards the later slots and stops on the boundary; up goes back", () => {
    const { bar } = makeBar();
    openBar(bar);
    expect(bar.wheel(1)).toBe(true);
    run(bar);
    expect(bar.offset).toBe(-44);
    bar.wheel(-1);
    run(bar);
    expect(bar.offset).toBe(0);
  });
  it("left end: up does nothing; right end: down does nothing", () => {
    const { bar } = makeBar();
    openBar(bar);
    expect(bar.wheel(-1)).toBe(true);
    run(bar);
    expect(bar.offset).toBe(0);
    bar.offset = bar.minOffset;
    expect(bar.wheel(1)).toBe(true);
    run(bar);
    expect(bar.offset).toBe(bar.minOffset);
  });
  it("a notch during the scroll is ignored", () => {
    const { bar } = makeBar();
    openBar(bar);
    bar.wheel(1);
    bar.frame(at(300, 20), true);
    bar.wheel(1);
    run(bar);
    expect(bar.offset).toBe(-44);
  });
});
