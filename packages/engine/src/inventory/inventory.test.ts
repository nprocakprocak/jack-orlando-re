import { describe, expect, it } from "vitest";
import type { Font, Glyph } from "../formats/fnt";
import { createSurface, type Surface16 } from "../render/surface";
import { ANIM_ROLLUP } from "../keys/notice";
import {
  CELL_CX,
  CELL_CY,
  CELL_H,
  CELL_W,
  DIK_COAT,
  Inventory,
  InventoryError,
  CoatScreen,
  SLOT_COUNT,
  cellAt,
  ctrlPointAt,
  encodeText,
  itemNameLookup,
  slotOfCell,
  type CoatAssets,
  type CoatExit,
  type CoatHost,
} from "./index";
import { shadowPixel } from "./screen";

const img = (w = 8, h = 8, v = 0x1234): Surface16 => {
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
const bg = (v: number): Surface16 => {
  const s = createSurface(640, 480);
  s.pixels.fill(v);
  return s;
};
const images = (v: number) => ({
  background: bg(v),
  up: img(40, 40, 0x1111),
  down: img(40, 40, 0x2222),
  opt: img(152, 72, 0x3333),
  upPressed: img(40, 40, 0x7fff),
  downPressed: img(40, 40, 0x7fff),
  optPressed: img(152, 72, 0x7fff),
});
const assets: CoatAssets = { civilian: images(0x0841), uniform: images(0x1082), font };

function make(macros: string[] = []) {
  const inv = new Inventory();
  const exits: CoatExit[] = [];
  const started: string[] = [];
  const host: CoatHost = {
    startMacro: (n) => (started.push(n), macros.includes(n)),
    itemName: (f) => (f === "A.BM" ? encodeText("ALFA") : null),
    onExit: (e) => exits.push(e),
  };
  const screen = new CoatScreen(inv, assets, host);
  return { inv, screen, exits, started };
}
const cellXY = (col: number, row: number): [number, number] => [CELL_CX + col * CELL_W, CELL_CY + row * CELL_H];

describe("Inventory model", () => {
  it("adds to the first free slot of the active region, no duplicate check", () => {
    const inv = new Inventory();
    expect(inv.add("A.BM", img())).toBe(0);
    expect(inv.add("A.BM", img())).toBe(1);
    inv.marzeczy = 0;
    expect(inv.add("B.BM", img())).toBe(66);
    expect(inv.has("A.BM")).toBe(true); // has() looks at all 84
    expect(inv.has("NOPE.BM")).toBe(false);
  });
  it("a full region ignores the item without error", () => {
    const inv = new Inventory();
    for (let i = 0; i < 66; i++) inv.add(`I${i}.BM`, img());
    expect(inv.add("X.BM", img())).toBe(-1);
    expect(inv.count()).toBe(66);
    inv.marzeczy = 0;
    for (let i = 0; i < 18; i++) expect(inv.add(`J${i}.BM`, img())).toBe(66 + i);
    expect(inv.add("Y.BM", img())).toBe(-1);
    expect(SLOT_COUNT).toBe(84);
  });
  it("rejects names that do not fit the 14-byte slot", () => {
    expect(() => new Inventory().add("ABCDEFGHIJKLMN.BM", img())).toThrow(InventoryError);
    expect(() => new Inventory().take("ABCDEFGHIJKLMN.BM", img())).toThrow(InventoryError);
  });
  it("remove: hand first, then limbo, then the first slot by name", () => {
    const inv = new Inventory();
    inv.add("A.BM", img());
    inv.add("A.BM", img());
    inv.take("A.BM", img());
    expect(inv.remove("A.BM")).toBe(true);
    expect(inv.held).toBeNull();
    expect(inv.slots[0]).not.toBeNull();
    inv.limbo = { name: "L.BM", image: img() };
    expect(inv.remove("L.BM")).toBe(true);
    expect(inv.remove("A.BM")).toBe(true);
    expect(inv.slots[0]).toBeNull();
    expect(inv.slots[1]).not.toBeNull();
    expect(inv.remove("ZZ.BM")).toBe(false);
  });
  it("take puts the previous hand item back, noHave drops it", () => {
    const inv = new Inventory();
    inv.take("A.BM", img());
    inv.take("B.BM", img());
    expect(inv.slots[0]?.name).toBe("A.BM");
    expect(inv.held?.name).toBe("B.BM");
    inv.noHave();
    expect(inv.held).toBeNull();
    expect(inv.count()).toBe(1);
    expect(inv.putBack()).toBe(-1);
  });
  it("putBack with a full region loses the item", () => {
    const inv = new Inventory();
    for (let i = 0; i < 66; i++) inv.add(`I${i}.BM`, img());
    inv.take("X.BM", img());
    expect(inv.putBack()).toBe(-1);
    expect(inv.held).toBeNull();
    expect(inv.has("X.BM")).toBe(false);
  });
  it("EXTRA 11 moves region B into the first free slots of region A", () => {
    const inv = new Inventory();
    inv.add("A.BM", img());
    inv.add("B.BM", img());
    inv.remove("A.BM");
    inv.marzeczy = 0;
    inv.add("C.BM", img());
    inv.add("D.BM", img());
    inv.marzeczy = 1;
    inv.moveBigRegion();
    expect(inv.slots.slice(0, 3).map((s) => s?.name)).toEqual(["C.BM", "B.BM", "D.BM"]);
    expect(inv.slots.slice(66).every((s) => !s)).toBe(true);
  });
  it("snapshot/restore: only occupied slots, hand and scroll row not kept", () => {
    const inv = new Inventory();
    inv.add("A.BM", img());
    inv.marzeczy = 0;
    inv.add("B.BM", img());
    inv.scrollRow = 9;
    inv.take("H.BM", img());
    const snap = inv.snapshot();
    expect(snap.map((s) => [s.slot, s.name])).toEqual([
      [0, "A.BM"],
      [66, "B.BM"],
    ]);
    const other = new Inventory();
    other.add("Z.BM", img());
    other.scrollRow = 5;
    other.restore(snap);
    expect(other.snapshot().map((s) => s.name)).toEqual(["A.BM", "B.BM"]);
    expect(other.held).toBeNull();
    expect(other.scrollRow).toBe(0);
    expect(() => other.restore([{ slot: 84, name: "X", image: img() }])).toThrow(InventoryError);
  });
});

describe("layout", () => {
  it("cell hit test: edges and outside", () => {
    expect(cellAt(0x56, 0xaf)).toBeNull(); // x-0x56 < 1
    expect(cellAt(0x57, 0xaf)).toEqual({ col: 0, row: 0 });
    expect(cellAt(0x56 + 144, 0xaf)).toBeNull(); // right edge belongs to no column
    expect(cellAt(0x56 + 143, 0xae + 259)).toEqual({ col: 2, row: 4 });
    expect(cellAt(0x57, 0xae + 260)).toBeNull();
    expect(slotOfCell(1, 2, 4)).toBe(1 + 6 * 3);
  });
  it("Ctrl points differ between civilian and uniform, tolerance: strict x-4 < mouse < x+4", () => {
    expect(ctrlPointAt(417, 197, false)).toBe(1);
    expect(ctrlPointAt(420, 200, false)).toBe(1);
    expect(ctrlPointAt(414, 194, false)).toBe(1);
    expect(ctrlPointAt(421, 197, false)).toBe(0);
    expect(ctrlPointAt(417, 201, false)).toBe(0);
    expect(ctrlPointAt(413, 197, false)).toBe(0);
    expect(ctrlPointAt(417, 197, true)).toBe(0);
    expect(ctrlPointAt(319, 200, true)).toBe(4);
  });
});

describe("CoatScreen", () => {
  it("pulls an item into the hand (cursor 5) and drops it into any free cell", () => {
    const { inv, screen } = make();
    inv.add("A.BM", img());
    screen.open(false);
    screen.pointerDown(...cellXY(0, 0), 0);
    expect(inv.held?.name).toBe("A.BM");
    expect(inv.slots[0]).toBeNull();
    expect(screen.cursorMode).toBe(5);
    screen.pointerUp(...cellXY(0, 0));
    screen.pointerDown(...cellXY(2, 3), 0);
    expect(inv.held).toBeNull();
    expect(inv.slots[slotOfCell(2, 3, 0)]?.name).toBe("A.BM");
    expect(screen.cursorMode).toBe(4);
    expect(screen.isOpen).toBe(true);
  });
  it("a click is armed only after the button was released", () => {
    const { inv, screen } = make();
    inv.add("A.BM", img());
    screen.open(false);
    screen.pointerDown(...cellXY(0, 0), 0); // pulls
    screen.pointerDown(...cellXY(1, 1), 0); // second press without release: ignored
    expect(inv.held?.name).toBe("A.BM");
    screen.pointerUp(...cellXY(1, 1));
    screen.pointerDown(...cellXY(1, 1), 0);
    expect(inv.held).toBeNull();
  });
  it("clicking outside the grid with an item does nothing; the hand stays", () => {
    const { inv, screen } = make();
    inv.take("A.BM", img());
    screen.open(false);
    expect(screen.cursorMode).toBe(5);
    screen.pointerDown(30, 30, 0);
    screen.pointerUp(30, 30);
    screen.pointerDown(200, 120, 0); // above the grid, left of CLOSE_X
    expect(inv.held?.name).toBe("A.BM");
    expect(screen.isOpen).toBe(true);
  });
  it("combines hand × slot through macro `<hand>-<slot>`; no macro = nothing happens", () => {
    const { inv, screen, exits, started } = make(["A.BM-B.BM"]);
    inv.add("B.BM", img());
    inv.add("C.BM", img());
    inv.take("A.BM", img());
    screen.open(false);
    screen.pointerDown(...cellXY(1, 0), 0); // C.BM: no macro
    expect(started).toEqual(["A.BM-C.BM"]);
    expect(inv.held?.name).toBe("A.BM");
    expect(exits).toEqual([]);
    screen.pointerUp(...cellXY(1, 0));
    screen.pointerDown(...cellXY(0, 0), 0); // B.BM: macro found
    expect(started[1]).toBe("A.BM-B.BM");
    expect(exits).toEqual([{ kind: "macro", name: "A.BM-B.BM" }]);
    expect(inv.held).toBeNull();
    expect(inv.limbo?.name).toBe("A.BM"); // NOHAVETOOL of the macro still finds it
    expect(screen.isOpen).toBe(false);
  });
  it("Ctrl point is a level check: ctrlHeld hits within ±3 px, a miss changes nothing", () => {
    const { screen, exits } = make();
    screen.open(false);
    expect(screen.ctrlHeld(421, 197)).toBe(false);
    expect(screen.isOpen).toBe(true);
    expect(screen.ctrlHeld(420, 198)).toBe(true);
    expect(exits).toEqual([{ kind: "ctrl", point: 1 }]);
    expect(screen.ctrlHeld(417, 197)).toBe(false); // closed already
  });
  it("closing: right/middle button, Esc, F1, the Jack side, options only on release in the area", () => {
    const cases: [(s: CoatScreen) => void, CoatExit][] = [
      [(s) => s.pointerDown(100, 100, 2), { kind: "close" }],
      [(s) => s.pointerDown(100, 100, 1), { kind: "close" }],
      [(s) => s.keyDown(DIK_COAT.ESC), { kind: "close" }],
      [(s) => s.keyDown(DIK_COAT.F1), { kind: "close" }],
      [(s) => s.pointerDown(0xf1, 300, 0), { kind: "close" }],
      [(s) => (s.pointerDown(150, 100, 0), s.pointerUp(150, 100)), { kind: "options" }],
      [(s) => s.pointerDown(417, 365, 0, true), { kind: "ctrl", point: 4 }],
    ];
    for (const [act, want] of cases) {
      const { screen, exits } = make();
      screen.open(false);
      act(screen);
      expect(exits).toEqual([want]);
    }
    const { screen, exits } = make();
    screen.open(false);
    screen.pointerDown(150, 100, 0);
    screen.pointerUp(300, 100); // released outside
    expect(exits).toEqual([]);
    expect(screen.isOpen).toBe(true);
  });
  it("Ctrl point in the uniform coat uses the uniform positions", () => {
    const { screen, exits } = make();
    screen.open(true);
    screen.pointerDown(417, 365, 0, true); // civilian point 4: not here, falls to 'Jack side' (x >= 0xf1)
    expect(exits).toEqual([{ kind: "close" }]);
    const b = make();
    b.screen.open(true);
    b.screen.pointerDown(405, 211, 0, true);
    expect(b.exits).toEqual([{ kind: "ctrl", point: 1 }]);
  });
  it("region A scrolls 0..16 (also empty), arrows animate 8 frames, PgDn x4, End = 16, Home = 0", () => {
    const { inv, screen } = make();
    screen.open(false);
    screen.keyDown(DIK_COAT.DOWN);
    expect(screen.anim).not.toBeNull();
    for (let i = 0; i < 8; i++) screen.tick();
    expect(inv.scrollRow).toBe(1);
    expect(screen.anim).toBeNull();
    screen.keyDown(DIK_COAT.PGDN);
    expect(inv.scrollRow).toBe(5);
    screen.keyDown(DIK_COAT.END);
    expect(inv.scrollRow).toBe(16);
    screen.keyDown(DIK_COAT.DOWN);
    expect(screen.anim).toBeNull(); // bound
    screen.keyDown(DIK_COAT.PGUP);
    expect(inv.scrollRow).toBe(12);
    screen.keyDown(DIK_COAT.HOME);
    expect(inv.scrollRow).toBe(0);
    screen.keyDown(DIK_COAT.UP);
    expect(screen.anim).toBeNull();
    // mouse arrow: press = one step
    screen.pointerDown(0x30, 0x170, 0);
    expect(screen.anim?.dir).toBe(1);
    for (let i = 0; i < 8; i++) screen.tick();
    screen.pointerUp(0x30, 0x170);
    expect(inv.scrollRow).toBe(1);
    // the scroll row survives closing
    screen.pointerDown(100, 100, 2);
    expect(inv.scrollRow).toBe(1);
  });
  it("scroll row lasts between openings; slots follow the view row", () => {
    const { inv, screen } = make();
    for (let i = 0; i < 30; i++) inv.add(`I${i}.BM`, img());
    inv.scrollRow = 3;
    screen.open(false);
    expect(screen.slotAt(...cellXY(1, 2))).toBe(1 + 5 * 3);
    screen.pointerDown(...cellXY(1, 2), 0);
    expect(inv.held?.name).toBe("I16.BM");
  });
  it("region B (MARZECZY 0): fixed view from row 22, no scrolling, slots 81..83 never visible", () => {
    const { inv, screen } = make();
    inv.marzeczy = 0;
    inv.scrollRow = 7;
    for (let i = 0; i < 18; i++) inv.add(`I${i}.BM`, img());
    screen.open(true);
    expect(screen.viewRow).toBe(22);
    expect(screen.slotAt(...cellXY(0, 0))).toBe(66);
    expect(screen.slotAt(...cellXY(2, 4))).toBe(80);
    screen.keyDown(DIK_COAT.DOWN);
    screen.keyDown(DIK_COAT.END);
    expect(screen.anim).toBeNull();
    expect(screen.viewRow).toBe(22);
    screen.pointerDown(0x30, 0x170, 0); // arrow only highlights
    expect(screen.anim).toBeNull();
    screen.pointerDown(100, 100, 2);
    expect(inv.scrollRow).toBe(7); // region A's row is back
    const visible = new Set<number>();
    for (let c = 0; c < 3; c++) for (let r = 0; r < 5; r++) visible.add(screen.slotAt(...cellXY(c, r)));
    expect([81, 82, 83].some((s) => visible.has(s))).toBe(false);
  });
  it("hover shows the name strip at y=400 ('???' without a record), a new cell rolls it up first", () => {
    const { inv, screen } = make();
    inv.add("A.BM", img());
    inv.add("Q.BM", img());
    screen.open(false);
    screen.pointerMove(...cellXY(0, 0));
    screen.tick();
    expect(screen.notice.shown).toBe(true);
    expect(screen.notice.y).toBe(400);
    expect(screen.notice.slot).toBe(0);
    const aWidth = screen.notice.width;
    expect(aWidth).toBeGreaterThan(0);
    screen.pointerMove(...cellXY(1, 0));
    screen.tick();
    expect(screen.notice.anim).toBe(ANIM_ROLLUP);
    for (let i = 0; i < 80 && screen.notice.shown; i++) screen.tick();
    expect(screen.notice.shown).toBe(false);
    screen.tick();
    expect(screen.notice.slot).toBe(1);
    expect(screen.notice.width).toBeGreaterThan(aWidth - 100); // "???" has a width of 3 glyphs
    screen.pointerMove(300, 300); // away
    screen.tick();
    expect(screen.notice.anim).toBe(ANIM_ROLLUP);
    expect(screen.cursorMode).toBe(0);
    expect(screen.cursorIdle).toBe(true);
    screen.pointerMove(...cellXY(0, 0));
    screen.tick();
    expect(screen.cursorIdle).toBe(false);
    expect(screen.cursorMode).toBe(4);
  });
  it("the shadow pixel keeps 3/4 of every channel ((p, 0, 0.5f)): paler than half brightness", () => {
    expect(shadowPixel(0xffff)).toBe((23 << 11) | (47 << 5) | 23);
    expect(shadowPixel(0xf800)).toBe(23 << 11);
    expect(shadowPixel(0x0841)).toBe(1 << 5); // (1, 2, 1) -> (0, 1, 0)
    expect(shadowPixel(0x0021)).toBe(0); // (0, 1, 1) -> all 0: the key colour, the shadow pixel is transparent
    expect(shadowPixel(0x0000)).toBe(0);
  });
  it("draws the background, the item with a shadow clipped to the grid and the pressed option sprite", () => {
    const { inv, screen } = make();
    inv.add("A.BM", img(10, 10, 0xf800));
    screen.open(false);
    const out = createSurface(640, 480);
    screen.draw(out);
    const [cx, cy] = cellXY(0, 0);
    expect(out.pixels[(cy - 5) * 640 + cx - 5]).toBe(0xf800);
    expect(out.pixels[(cy + 6) * 640 + cx + 6]).toBe(1 << 5); // shadow strip (+3,+3): 3/4 of the background (1, 2, 1) -> (0, 1, 0)
    expect(out.pixels[10 * 640 + 10]).toBe(0x0841);
    // resting buttons are painted into the background at entry (A_UP1 at (0x21,0xfc), A_DN1 at (0x21,0x15a), OPT1 at (99,0x42))
    expect(out.pixels[0xfc * 640 + 0x21]).toBe(0x1111);
    expect(out.pixels[0x15a * 640 + 0x21 + 39]).toBe(0x2222);
    expect(out.pixels[0x42 * 640 + 99 + 151]).toBe(0x3333);
    expect(out.pixels[0x42 * 640 + 98]).toBe(0x0841);
    screen.pointerDown(150, 100, 0);
    screen.draw(out);
    expect(out.pixels[0x42 * 640 + 99 + 10]).toBe(0x7fff);
    screen.pointerUp(1, 1);
    screen.open(true);
    screen.draw(out);
    expect(out.pixels[10 * 640 + 10]).toBe(0x1082); // INV_M
  });
  it("the item name lookup follows ELEM.LST rules (key = 3rd token, '_' to space)", () => {
    const look = itemNameLookup(new TextEncoder().encode("1 KLUCZYK_A KLUCZYK.BM\n2 BETA B.BM\n"));
    expect(look("B.BM")).toEqual(encodeText("BETA"));
    expect(look("KLUCZYK.BM")).toEqual(encodeText("KLUCZYK A"));
    expect(look("X.BM")).toBeNull();
  });
});
