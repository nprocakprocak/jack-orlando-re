import { describe, expect, it } from "vitest";
import { hotspotOffset } from "../cursor/modes";
import { encodeMazovia, placeCaption, placePersonCaption, wrapCaption, type Measure } from "./caption";
import { lipWithoutVoice, lipWithVoice, PACE_TALK, stepInterval } from "./lipsync";
import { buildMenu, menuTop, MenuPointer, ReleaseGate, rowStyle } from "./menu";
import { type DialogTables } from "./tables";

const m6: Measure = (t) => t.length * 6; // every char 6 px
const entry = (id: number, text: string, width = 200, sound = "T001.SND") => ({
  id,
  text,
  width,
  sound,
});

const tables: DialogTables = {
  lipPair: (c) => (c === 0x41 ? [4, 2] : [0, 1]),
  mouthCycle: [0, 2, 4, 3, 1, 2, 4, 3, 1, 3],
  blinkOrder: [0, 1, 2, 1, 0],
  speakerColors: Array.from({ length: 17 }, (_, i) => 1000 + i),
  textColors: [1, 65504, 1, 63480, 7, 9],
  menuFill: 65504,
};

describe("wrapCaption", () => {
  it("keeps a short text on one line", () => expect(wrapCaption(m6, "ala ma kota", 200)).toEqual(["ala ma kota"]));
  it("breaks at spaces, dropping the closed line's last space; a chunk fits only when strictly narrower", () => {
    // "aaa bbb " = 48 px: not strictly narrower than 48
    expect(wrapCaption(m6, "aaa bbb ccc", 48)).toEqual(["aaa", "bbb ccc"]);
    expect(wrapCaption(m6, "aaa bbb ccc", 49)).toEqual(["aaa bbb", "ccc"]);
    expect(wrapCaption(m6, "aaa bbb ccc", 25)).toEqual(["aaa", "bbb", "ccc"]);
  });
  it("stops after 5 lines and drops the rest", () => {
    expect(wrapCaption(m6, "a b c d e f g", 13)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("a word wider than the box leaves empty lines behind", () => {
    const lines = wrapCaption(m6, "x wwwwwwwwwwwwww y", 40);
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe("x");
    expect(lines.slice(1)).toEqual(["", "", "", ""]);
  });
});

describe("encodeMazovia", () => {
  it("turns text back into game bytes", () => {
    expect([...encodeMazovia("Ala ę")]).toEqual([0x41, 0x6c, 0x61, 0x20, 0x91]);
  });

  it("draws é as e, the glyph the Resource.pak fonts actually have", () => {
    expect([...encodeMazovia("é")]).toEqual([0x65]);
  });
});

describe("caption placement", () => {
  const base = { measure: m6, text: "hej", width: 100, scrollX: 100 };
  const colors = { leftColor: { outline: 1, fill: 10 }, rightColor: { outline: 1, fill: 20 } };
  it("LEFT is pushed to the left screen edge and takes the left colour", () => {
    const c = placeCaption({ ...base, ...colors }, 100, 0x8c);
    expect(c.x).toBe(101);
    expect(c.fill).toBe(10);
    expect(c.y).toBe(0x8c);
    expect(c.lines[0].x).toBe(c.x + (100 - 18) / 2);
  });
  it("RIGHT is pushed to the right edge and takes the right colour", () => {
    const c = placeCaption({ ...base, ...colors }, 100 + 0x280, 0x8c);
    expect(c.x).toBe(100 + 0x27f - 100);
    expect(c.fill).toBe(20);
  });
  it("clamps y to the screen", () => {
    expect(placeCaption({ ...base, ...colors }, 400, 470).y).toBe(0x1df - 24);
    expect(placeCaption({ ...base, ...colors }, 400, -5).y).toBe(1);
  });
  it("a person caption sits above the point; a clamped one lands off screen (as in the game)", () => {
    const c = placePersonCaption(base, 400, 200, { outline: 7, fill: 9 });
    expect(c.y).toBe(200 - 24);
    expect(c.fill).toBe(9);
    expect(placePersonCaption(base, 400, 10, { outline: 7, fill: 9 }).y).toBe(1 - 24);
  });
});

describe("menu", () => {
  const opts = [entry(1, "aaaaaaaaaa"), entry(2, "bbb"), entry(3, "cccccc"), entry(4, "dd")];
  it("sorts by width ascending and maps rows back to the original index", () => {
    const rows = buildMenu(opts, [false, false, false, false], m6, 50, 0, menuTop(4));
    expect(rows.map((r) => r.index)).toEqual([3, 1, 2, 0]);
    expect(rows.map((r) => r.y)).toEqual([0x1d3 - 100, 0x1d3 - 76, 0x1d3 - 52, 0x1d3 - 28]);
    expect(rows[0].x).toBe(56);
    expect(rows[0].width).toBe(16); // 12 + 4
  });
  it("rounds odd widths up and keeps equal widths in file order", () => {
    const rows = buildMenu([entry(1, "ab"), entry(2, "cd")], [false, false], (t) => t.length * 3, 0, 0, 0);
    expect(rows.map((r) => [r.index, r.width])).toEqual([
      [0, 10],
      [1, 10],
    ]);
    expect(buildMenu([entry(1, "a")], [false], (t) => t.length * 3, 0, 0, 0)[0].width).toBe(8); // 3 + 4 = 7 -> 8
  });
  it("leaves hidden options out", () => {
    const rows = buildMenu(opts, [false, true, false, true], m6, 0, 0, 0);
    expect(rows.map((r) => r.index)).toEqual([2, 0]);
  });
  it("highlights on press, chooses on release over the same row, cancels when leaving", () => {
    const rows = buildMenu(opts, [false, false, false, false], m6, 0, 0, 0);
    const p = new MenuPointer(rows);
    expect(p.update(8, 5, false)).toMatchObject({ hover: 0, pressed: -1 });
    expect(p.update(8, 5, true).pressed).toBe(0);
    expect(p.update(8, 100, true).pressed).toBe(-1); // dragged away, still held
    expect(p.update(8, 100, false).chosen).toBeUndefined();
    p.update(8, 30, true); // row 1 (y 24..49)
    expect(p.update(8, 30, false).chosen).toBe(rows[1].index);
  });
});

describe("menu: the click that interrupted the line", () => {
  const rows = buildMenu([entry(1, "aaaaaaaaaa"), entry(2, "bbb")], [false, false], m6, 0, 0, 0);
  /** one frame as game.ts runs it: the gate feeds the pointer while the menu is open */
  function frames(seq: boolean[]): (number | undefined)[] {
    const gate = new ReleaseGate();
    const p = new MenuPointer(rows);
    return seq.map((down) => p.update(8, 5, gate.update(true, down)).chosen);
  }
  it("a button already down when the menu opens neither highlights nor chooses; the next click does", () => {
    // held through the opening, released, then pressed and released again
    const r = frames([true, true, false, true, false]);
    expect(r.slice(0, 3)).toEqual([undefined, undefined, undefined]);
    expect(r[4]).toBe(rows[0].index);
  });
  it("the pointer alone would take the held click (reads the level); the gate stands for g_clickArmed", () => {
    const p = new MenuPointer(rows);
    expect(p.update(8, 5, true).pressed).toBe(0);
    expect(p.update(8, 5, false).chosen).toBe(rows[0].index);
  });
  it("a menu opened with the button up takes the first click at once", () => {
    expect(frames([false, true, false])[2]).toBe(rows[0].index);
  });
  it("closing the menu resets the gate: the next menu opens with a held button again", () => {
    const gate = new ReleaseGate();
    expect(gate.update(true, false)).toBe(false);
    expect(gate.update(true, true)).toBe(true);
    gate.update(false, true);
    expect(gate.update(true, true)).toBe(false);
    expect(gate.update(true, false)).toBe(false);
    expect(gate.update(true, true)).toBe(true);
  });
});

describe("menu hit box", () => {
  // two visible options, y = 0x1d3 - 25 * 2 = 417, rows 24 px apart
  const rows = buildMenu([entry(1, "Stay"), entry(2, "Ask later")], [false, false], m6, 0, 0, menuTop(2));
  const hit = (x: number, y: number) => new MenuPointer(rows).hit(x, y);
  it("covers 25 px per row, rows 24 px apart; the later row wins on the shared pixel", () => {
    expect(rows.map((r) => r.y)).toEqual([417, 441]);
    expect(hit(10, 416)).toBe(-1);
    expect(hit(10, 417)).toBe(0);
    expect(hit(10, 440)).toBe(0);
    expect(hit(10, 441)).toBe(1);
    expect(hit(10, 465)).toBe(1);
    expect(hit(10, 466)).toBe(-1);
  });
  it("is bounded by the box width (text width + 4, even) starting at x = 6", () => {
    expect(hit(5, 420)).toBe(-1);
    expect(hit(6, 420)).toBe(0);
    expect(hit(6 + rows[0].width - 1, 420)).toBe(0);
    expect(hit(6 + rows[0].width, 420)).toBe(-1);
  });
  it("is tested at the click point (mouse + hotspot offset), not at the mouse position", () => {
    // the arrow tip is 12 px above and 9 px left of the mouse: tip on row 0 (y 437) = mouse y 449 = inside row 1
    const { dx, dy } = hotspotOffset(0);
    expect([dx, dy]).toEqual([-9, -12]);
    const mouse = { x: 40, y: 449 };
    expect(hit(mouse.x, mouse.y)).toBe(1);
    expect(hit(mouse.x + dx, mouse.y + dy)).toBe(0);
  });
});

describe("menu row style", () => {
  it("pressed = white, no shadow, moved by (1,1); normal = yellow with shadow; no hover state", () => {
    expect(rowStyle(true, 65504)).toEqual({ dx: 1, dy: 1, shadow: false, fill: 0xffff });
    expect(rowStyle(false, 65504)).toEqual({ dx: 0, dy: 0, shadow: true, fill: 65504 });
    const rows = buildMenu([entry(1, "abc")], [false], m6, 0, 0, 0);
    const p = new MenuPointer(rows);
    expect(p.update(8, 5, false).pressed).toBe(-1); // hovering only: nothing highlighted
  });
});

describe("lip sync", () => {
  it("without a voice: one step per character through the 10-value cycle, length strlen/10", () => {
    const l = lipWithoutVoice("abcdefghijkl", tables);
    expect(l.steps).toBe(12);
    expect(l.frames.slice(0, 11)).toEqual([0, 2, 4, 3, 1, 2, 4, 3, 1, 3, 0]);
    expect(l.seconds).toBeCloseTo(1.2, 5);
  });
  it("with a voice: two closed steps, the table's runs, ten closed steps; length = the sound's", () => {
    const a = lipWithVoice("A", 1.5, tables);
    expect(a.frames).toEqual([0, 0, 4, 4, ...Array(10).fill(0)]);
    expect(a.steps).toBe(14);
    expect(a.seconds).toBe(1.5);
  });
  it("reads the table with a signed char (high bytes index below it)", () => {
    const seen: number[] = [];
    lipWithVoice("ę", 1, { ...tables, lipPair: (c) => (seen.push(c), [0, 1]) });
    expect(seen).toEqual([0x91 - 256]);
  });
  it("step interval is seconds / (steps * pace) in single precision", () => {
    const l = lipWithoutVoice("x".repeat(40), tables);
    expect(stepInterval(l, PACE_TALK)).toBe(Math.fround(l.seconds / Math.fround(Math.fround(40) * PACE_TALK)));
  });
});
