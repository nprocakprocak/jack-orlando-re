// scrolling the scene by the mouse at the screen edge (edgescroll.ts; Game_Run).
import { describe, expect, it } from "vitest";
import { edgeClick, edgeFrame, noControlDir, type EdgeInput, type EdgeState } from "./edgescroll";

const NONE = { x: -1000, y: -1000 };
const base: EdgeInput = {
  mouseX: 320,
  scrollX: 100,
  scrollMin: 0,
  scrollMax: 376,
  bgWide: true,
  noControl: false,
  menuOrText: false,
  scrolling: false,
  cursorEnabled: true,
  clickArmed: false,
  jackTurning: false,
  jackX: 300,
  points: { L: NONE, R: NONE },
};
const idle: EdgeState = { mode: 0, saved: 0, prevScrolling: false };

describe("edge cursor (edgeFrame)", () => {
  it("enters the left zone within 30 px and the right one from 610 px, remembering the mode", () => {
    expect(edgeFrame({ ...idle, mode: 3 }, { ...base, mouseX: 29 })).toMatchObject({
      mode: 20,
      saved: 3,
    });
    expect(edgeFrame(idle, { ...base, mouseX: 30 }).mode).toBe(0);
    expect(edgeFrame(idle, { ...base, mouseX: 611 })).toMatchObject({ mode: 21, saved: 0 });
    expect(edgeFrame(idle, { ...base, mouseX: 610 }).mode).toBe(0);
  });
  it("needs room to scroll that way, a wide background, no item in hand, no menu / line, not a no-control scene", () => {
    expect(edgeFrame(idle, { ...base, mouseX: 5, scrollX: 0 }).mode).toBe(0);
    expect(edgeFrame(idle, { ...base, mouseX: 630, scrollX: 376 }).mode).toBe(0);
    expect(edgeFrame(idle, { ...base, mouseX: 5, bgWide: false }).mode).toBe(0);
    expect(edgeFrame({ ...idle, mode: 5 }, { ...base, mouseX: 5 }).mode).toBe(5);
    expect(edgeFrame(idle, { ...base, mouseX: 5, menuOrText: true }).mode).toBe(0);
    expect(edgeFrame(idle, { ...base, mouseX: 5, noControl: true }).mode).toBe(0);
  });
  it("leaves when the mouse leaves the zone or when scrolling stops (the flag was set and is not any more)", () => {
    const left: EdgeState = { mode: 20, saved: 4, prevScrolling: false };
    expect(edgeFrame(left, { ...base, mouseX: 31 }).mode).toBe(4);
    expect(edgeFrame(left, { ...base, mouseX: 10 }).mode).toBe(20);
    expect(edgeFrame({ ...left, prevScrolling: true }, { ...base, mouseX: 10, scrolling: false }).mode).toBe(4);
    expect(edgeFrame({ ...left, prevScrolling: true }, { ...base, mouseX: 10, scrolling: true })).toMatchObject({
      mode: 20,
      prevScrolling: true,
    });
    // the flag is refreshed only while the edge code runs
    expect(edgeFrame(idle, { ...base, scrolling: true }).prevScrolling).toBe(false);
    expect(edgeFrame(left, { ...base, mouseX: 10, scrolling: true }).prevScrolling).toBe(true);
  });
  it("scrolling that runs into the limit ends the zone", () => {
    const right: EdgeState = { mode: 21, saved: 0, prevScrolling: true };
    expect(edgeFrame(right, { ...base, mouseX: 630, scrollX: 376, scrolling: false }).mode).toBe(0);
  });
  it("a click in the zone sets the direction; nothing happens on the frame the zone is left", () => {
    const left: EdgeState = { mode: 20, saved: 0, prevScrolling: false };
    const right: EdgeState = { mode: 21, saved: 0, prevScrolling: false };
    expect(edgeFrame(left, { ...base, mouseX: 5, clickArmed: true })).toMatchObject({
      dir: -1,
      walkTo: null,
    });
    expect(edgeFrame(right, { ...base, mouseX: 630, clickArmed: true })).toMatchObject({
      dir: 1,
      walkTo: null,
    });
    expect(edgeFrame(left, { ...base, mouseX: 5 }).dir).toBeNull();
    expect(edgeFrame(left, { ...base, mouseX: 5, clickArmed: true, cursorEnabled: false }).dir).toBeNull();
    expect(edgeFrame(left, { ...base, mouseX: 60, clickArmed: true }).dir).toBeNull();
  });
  it("a click on the entry frame counts too (the entry and the click run in one frame)", () => {
    expect(edgeFrame(idle, { ...base, mouseX: 2, clickArmed: true })).toMatchObject({
      mode: 20,
      dir: -1,
    });
  });
});

describe("edge click with SETPOSSCROLL points (edgeClick)", () => {
  const pts = { L: { x: 430, y: 341 }, R: { x: 536, y: 366 } };
  it("left: Jack right of the R point walks to L; otherwise the view only scrolls", () => {
    expect(edgeClick(true, { ...base, points: pts, jackX: 600 })).toEqual({
      dir: -1,
      walkTo: pts.L,
    });
    expect(edgeClick(true, { ...base, points: pts, jackX: 536 })).toEqual({
      dir: -1,
      walkTo: null,
    });
    expect(edgeClick(true, { ...base, points: pts, jackX: 100 })).toEqual({
      dir: -1,
      walkTo: null,
    });
  });
  it("right: Jack left of the L point walks to R; otherwise the view only scrolls", () => {
    expect(edgeClick(false, { ...base, points: pts, jackX: 100 })).toEqual({
      dir: 1,
      walkTo: pts.R,
    });
    expect(edgeClick(false, { ...base, points: pts, jackX: 430 })).toEqual({
      dir: 1,
      walkTo: null,
    });
    expect(edgeClick(false, { ...base, points: pts, jackX: 500 })).toEqual({
      dir: 1,
      walkTo: null,
    });
  });
  it("without both points, or during a turn, no walk", () => {
    expect(edgeClick(true, { ...base, jackX: 600 })).toEqual({ dir: -1, walkTo: null });
    expect(edgeClick(true, { ...base, points: { L: pts.L, R: NONE }, jackX: 600 }).walkTo).toBeNull();
    expect(edgeClick(true, { ...base, points: { L: NONE, R: pts.R }, jackX: 600 }).walkTo).toBeNull();
    expect(edgeClick(false, { ...base, points: pts, jackX: 100, jackTurning: true })).toEqual({
      dir: 1,
      walkTo: null,
    });
  });
  it("a menu or a spoken line blocks the click entirely", () => {
    expect(edgeClick(true, { ...base, points: pts, jackX: 600, menuOrText: true })).toEqual({
      dir: null,
      walkTo: null,
    });
  });
});

describe("no-control scenes", () => {
  it("the mouse within 20 px of an edge scrolls, with the cursor enabled", () => {
    expect(noControlDir(19, true)).toBe(-1);
    expect(noControlDir(20, true)).toBeNull();
    expect(noControlDir(0x26c, true)).toBeNull();
    expect(noControlDir(0x26d, true)).toBe(1);
    expect(noControlDir(5, false)).toBeNull();
  });
});
