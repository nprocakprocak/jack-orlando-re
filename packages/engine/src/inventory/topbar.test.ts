// The legacy item bar: synthetic tests on mock images, no game files.
import { describe, expect, it } from "vitest";
import type { Font, Glyph } from "../formats/fnt";
import { createSurface, type Surface16 } from "../render/surface";
import { Inventory } from "./model";
import {
  BAR_HIDDEN_Y, BAR_SHOWN_Y, SLOT_W, STRIP_H, STRIP_W, TopBar, inside, STRIP_BOX, type BarInput, type TopBarHost, type TopBarImages,
} from "./topbar";

const img = (w: number, h: number, v: number): Surface16 => {
  const s = createSurface(w, h);
  s.pixels.fill(v);
  return s;
};
const glyph = (code: number): Glyph => ({ code, offset: 0, width: 3, height: 5, pixels: new Uint8Array(15).fill(2) });
const font: Font = { glyphs: Array.from({ length: 256 }, (_, i) => glyph(i)), dataEnd: 0 };
const images: TopBarImages = {
  panel: img(640, 71, 0x0841),
  options: img(131, 34, 0x1111),
  left: img(37, 50, 0x2222),
  right: img(41, 50, 0x3333),
  strip: img(792, 48, 0x4444),
  frame: img(48, 41, 0x5555),
};

function make(macros: string[] = []) {
  const inv = new Inventory();
  const started: string[] = [];
  const running = new Set<string>();
  const log = { options: 0 };
  const host: TopBarHost = {
    startMacro: (n) => {
      started.push(n);
      if (!macros.includes(n)) return false;
      running.add(n);
      return true;
    },
    macroActive: (n) => running.has(n),
    itemName: (f) => (f === "A.BM" ? Uint8Array.from("ALFA", (c) => c.charCodeAt(0)) : null),
    requestOptions: () => log.options++,
  };
  const bar = new TopBar(inv, images, font, host);
  return { inv, bar, started, running, log };
}

const at = (x: number, y: number, o: Partial<BarInput> = {}): BarInput => ({ x, y, down: false, pressed: false, right: false, rightPressed: false, inWindow: true, ...o });
const click = (x: number, y: number): BarInput => at(x, y, { down: true, pressed: true });
const item = (v = 0x7777) => img(10, 10, v);

/** Frames until the bar is open (mouse at the top edge, then in the strip row). */
function openBar(b: ReturnType<typeof make>): void {
  b.bar.frame(at(300, 0), true);
  for (let i = 0; i < 20 && b.bar.state !== "open"; i++) b.bar.frame(at(300, 20), true);
  expect(b.bar.state).toBe("open");
}
/** x of the middle of position `i` on the screen (current offset). */
const slotX = (b: ReturnType<typeof make>, i: number) => STRIP_BOX.x0 + b.bar.offset + i * SLOT_W + 20;
const SY = 40; // inside the drop zone

describe("TopBar: sliding", () => {
  it("opens at the top edge, slides 6 px per frame in 13 frames and stops at y = 4", () => {
    const b = make();
    b.bar.frame(at(300, 30), true);
    expect(b.bar.state).toBe("closed");
    b.bar.frame(at(300, 0), true);
    expect(b.bar.state).toBe("opening");
    expect(b.bar.y).toBe(BAR_HIDDEN_Y);
    let frames = 0;
    while (b.bar.state === "opening") {
      b.bar.frame(at(300, 20), true);
      frames++;
    }
    expect(frames).toBe(13);
    expect(b.bar.y).toBe(BAR_SHOWN_Y);
    expect(b.bar.state).toBe("open");
  });

  it("does not open when the game is not free (script holds the player, menu) or the pointer is outside the window", () => {
    const b = make();
    b.bar.frame(at(300, 0), false);
    b.bar.frame(at(300, 0, { inWindow: false }), true);
    expect(b.bar.state).toBe("closed");
  });

  it("mouse below row 0x5a closes it: it rolls back 6 px per frame and needs the pointer to leave the top edge before it opens again", () => {
    const b = make();
    openBar(b);
    b.bar.frame(at(300, 0x5a), true);
    expect(b.bar.state).toBe("open");
    b.bar.frame(at(300, 0x5b), true);
    expect(b.bar.state).toBe("closing");
    for (let i = 0; i < 13; i++) b.bar.frame(at(300, 0x5b), true);
    expect(b.bar.state).toBe("closed");
    expect(b.bar.y).toBe(BAR_HIDDEN_Y);
    b.bar.frame(at(300, 0), true);
    expect(b.bar.state).toBe("opening");
  });

  it("closing a still sliding-in bar works too, and overlays are empty while closed", () => {
    const b = make();
    b.bar.frame(at(300, 0), true);
    b.bar.frame(at(300, 20), true);
    b.bar.frame(at(300, 200), true);
    expect(b.bar.state).toBe("closing");
    const c = make();
    expect(c.bar.overlays(createSurface(640, 480), 0)).toEqual([]);
  });
});

describe("TopBar: items", () => {
  it("takes an item out of a slot (the slot is empty, the cursor holds it, mode 5) and puts it into another empty slot only in the drop zone", () => {
    const b = make();
    b.inv.add("A.BM", item());
    openBar(b);
    b.bar.frame(click(slotX(b, 0), SY), true);
    expect(b.inv.held?.name).toBe("A.BM");
    expect(b.inv.slots[0]).toBeNull();
    expect(b.bar.cursorMode).toBe(5);
    b.bar.frame(at(slotX(b, 3), SY), true);
    // upper part of the strip (y < 10): nothing happens
    b.bar.frame(click(slotX(b, 3), 5), true);
    expect(b.inv.held).not.toBeNull();
    b.bar.frame(at(slotX(b, 3), SY), true);
    b.bar.frame(click(slotX(b, 3), SY), true);
    expect(b.inv.held).toBeNull();
    expect(b.inv.slots[3]?.name).toBe("A.BM");
    expect(b.bar.cursorMode).toBe(4);
  });

  it("a held click needs the button released in between (armed)", () => {
    const b = make();
    b.inv.add("A.BM", item());
    openBar(b);
    b.bar.frame(click(slotX(b, 0), SY), true);
    b.bar.frame(at(slotX(b, 0), SY, { down: true }), true); // still down: no put-down
    expect(b.inv.held).not.toBeNull();
  });

  it("an item on an occupied slot starts the macro 'held-slot': the hand empties (limbo), the bar closes and is blocked until the macro ends", () => {
    const b = make(["A.BM-B.BM"]);
    b.inv.add("A.BM", item());
    b.inv.add("B.BM", item());
    openBar(b);
    b.bar.frame(click(slotX(b, 0), SY), true);
    b.bar.frame(at(slotX(b, 1), SY), true);
    b.bar.frame(click(slotX(b, 1), SY), true);
    expect(b.started).toEqual(["A.BM-B.BM"]);
    expect(b.inv.held).toBeNull();
    expect(b.inv.limbo?.name).toBe("A.BM");
    expect(b.bar.exclusive).toBe(true);
    expect(b.bar.state).toBe("closing");
    for (let i = 0; i < 13; i++) b.bar.frame(at(300, 200), true);
    expect(b.bar.state).toBe("closed");
    // the macro still runs: the bar stays shut although the pointer is at the top edge
    b.bar.frame(at(300, 0), true);
    expect(b.bar.state).toBe("closed");
    b.running.clear();
    b.bar.frame(at(300, 0), true);
    expect(b.bar.exclusive).toBe(false);
    expect(b.bar.state).toBe("opening");
  });

  it("no such macro: nothing happens, the item stays in the hand and the bar stays open", () => {
    const b = make();
    b.inv.add("A.BM", item());
    b.inv.add("B.BM", item());
    openBar(b);
    b.bar.frame(click(slotX(b, 0), SY), true);
    b.bar.frame(at(slotX(b, 1), SY), true);
    b.bar.frame(click(slotX(b, 1), SY), true);
    expect(b.started).toEqual(["A.BM-B.BM"]);
    expect(b.inv.held?.name).toBe("A.BM");
    expect(b.bar.state).toBe("open");
    expect(b.bar.exclusive).toBe(false);
  });

  it("clicking an empty slot with an empty hand, or outside the strip, does nothing; edges of the strip box are excluded", () => {
    const b = make();
    b.inv.add("A.BM", item());
    openBar(b);
    b.bar.frame(click(slotX(b, 5), SY), true);
    expect(b.inv.held).toBeNull();
    expect(inside(STRIP_BOX, 0xbc, 20)).toBe(false);
    expect(b.bar.slotAt(0xbd, 20)).toBe(0);
    expect(b.bar.slotAt(0x235, 20)).toBe(-1);
    expect(b.bar.slotAt(300, 0x32)).toBe(-1);
  });

  it("a full bar (hand on the last position of the region) and the uniform region (MARZECZY = 0: slots 66..83)", () => {
    const b = make();
    for (let i = 0; i < 66; i++) b.inv.add("A.BM", item());
    expect(b.bar.positions).toBe(66);
    b.inv.marzeczy = 0;
    expect(b.bar.positions).toBe(18);
    b.inv.slots[66] = { name: "U.BM", image: item() };
    openBar(b);
    b.bar.frame(click(slotX(b, 0), SY), true);
    expect(b.inv.held?.name).toBe("U.BM");
    expect(b.inv.slots[66]).toBeNull();
  });
});

describe("TopBar: scrolling", () => {
  function many(b: ReturnType<typeof make>): void {
    for (let i = 0; i < 20; i++) b.inv.add(`I${i}.BM`, item());
  }

  it("the right arrow scrolls 4 px per frame until a slot boundary even after the button is released; the left arrow returns", () => {
    const b = make();
    many(b);
    openBar(b);
    b.bar.frame(click(0x260, 30), true);
    expect(b.bar.offset).toBe(0); // the press only starts the scroll
    b.bar.frame(at(0x260, 30, { down: true }), true);
    expect(b.bar.offset).toBe(-4);
    b.bar.frame(at(0x260, 30), true); // released: goes on to the boundary
    let n = 0;
    while (b.bar.offset % SLOT_W !== 0 && n++ < 50) b.bar.frame(at(0x260, 30), true);
    expect(b.bar.offset).toBe(-SLOT_W);
    b.bar.frame(click(0xa0, 30), true);
    for (let i = 0; i < 20; i++) b.bar.frame(at(0xa0, 30), true);
    expect(b.bar.offset).toBe(0);
  });

  it("the right button scrolls twice as fast", () => {
    const b = make();
    many(b);
    openBar(b);
    b.bar.frame(at(0x260, 30, { right: true, rightPressed: true }), true);
    b.bar.frame(at(0x260, 30, { right: true }), true);
    expect(b.bar.offset).toBe(-8);
    b.bar.frame(at(0x260, 30), true);
    expect(b.bar.offset).toBe(-16);
  });

  it("stops at both ends: the left end is 0, the right end shows the last 9 positions of the region", () => {
    const b = make();
    many(b);
    openBar(b);
    b.bar.frame(click(0xa0, 30), true);
    for (let i = 0; i < 5; i++) b.bar.frame(at(0xa0, 30, { down: true }), true);
    expect(b.bar.offset).toBe(0);
    expect(b.bar.minOffset).toBe(-(66 - 9) * SLOT_W);
    b.bar.frame(click(0x260, 30), true);
    for (let i = 0; i < 1500; i++) b.bar.frame(at(0x260, 30, { down: true }), true);
    expect(b.bar.offset).toBe(b.bar.minOffset);
    b.bar.frame(at(0x260, 30), true);
    expect(b.bar.offset).toBe(b.bar.minOffset);
  });

  it("a region too short to scroll (uniform: 18 positions) has a shorter range; an empty bar draws only the belt", () => {
    const b = make();
    b.inv.marzeczy = 0;
    expect(b.bar.minOffset).toBe(-9 * SLOT_W);
    openBar(b);
    const strip = b.bar.stripImage();
    expect(strip.width).toBe(STRIP_W);
    expect(strip.height).toBe(STRIP_H);
    expect(new Set(strip.pixels)).toEqual(new Set([0x4444]));
  });

  it("scrolling is shown in the picture: an item moves with the offset", () => {
    const b = make();
    b.inv.add("A.BM", item(0x7777));
    openBar(b);
    const at0 = b.bar.stripImage().pixels.indexOf(0x7777);
    b.bar.offset = -SLOT_W;
    expect(b.bar.stripImage().pixels.indexOf(0x7777)).toBe(-1); // scrolled out to the left
    b.bar.offset = 0;
    expect(b.bar.stripImage().pixels.indexOf(0x7777)).toBe(at0);
  });
});

describe("TopBar: name, options, overlays", () => {
  it("the name of the item under the pointer comes up under the bar (row 0x4b) and rolls up when the pointer leaves", () => {
    const b = make();
    b.inv.add("A.BM", item());
    openBar(b);
    b.bar.frame(at(slotX(b, 0), SY), true);
    expect(b.bar.notice.shown).toBe(true);
    expect(b.bar.notice.y).toBe(0x4b);
    expect(b.bar.cursorMode).toBe(4);
    expect(b.bar.cursorIdle).toBe(false);
    for (let i = 0; i < 20; i++) b.bar.frame(at(slotX(b, 0), SY), true);
    b.bar.frame(at(300, 80), true);
    expect(b.bar.notice.anim).toBe(2);
    expect(b.bar.cursorMode).toBe(0);
    for (let i = 0; i < 40; i++) b.bar.frame(at(300, 80), true);
    expect(b.bar.notice.shown).toBe(false);
  });

  it("no name with an item in hand; a slot without a record shows '???'", () => {
    const b = make();
    b.inv.add("X.BM", item());
    b.inv.add("A.BM", item());
    openBar(b);
    b.bar.frame(at(slotX(b, 0), SY), true);
    expect(b.bar.notice.shown).toBe(true); // "???" for X.BM
    b.bar.frame(click(slotX(b, 1), SY), true); // takes A.BM
    for (let i = 0; i < 40; i++) b.bar.frame(at(slotX(b, 0), SY), true);
    expect(b.bar.notice.shown).toBe(false);
  });

  it("the options button: released over itself closes the bar at once and asks the game for the menu; released elsewhere does nothing", () => {
    const b = make();
    openBar(b);
    b.bar.frame(click(50, 30), true);
    b.bar.frame(at(300, 30), true);
    expect(b.log.options).toBe(0);
    expect(b.bar.state).toBe("open");
    b.bar.frame(click(50, 30), true);
    b.bar.frame(at(50, 30), true);
    expect(b.log.options).toBe(1);
    expect(b.bar.state).toBe("closed");
    expect(b.bar.y).toBe(BAR_HIDDEN_Y);
  });

  it("overlays: panel and strip move down with the bar; OPTGR/arrows (pressed states) only while pressed; RAMKA only with an item in hand", () => {
    const b = make();
    const scene = createSurface(640, 480);
    openBar(b);
    const o = b.bar.overlays(scene, 0);
    // Game_Run keeps OPTGR / L_ARROW / R_ARROW above the screen unless pressed: the panel shows the released buttons
    expect(o).toHaveLength(2);
    expect(o[0]).toMatchObject({ x: 0, y: 4 });
    expect(o[1]).toMatchObject({ x: 0xbd, y: 4 + 0xb });
    b.bar.frame(click(50, 30), true); // LMB down on the options button and held
    const pressed = b.bar.overlays(scene, 0);
    expect(pressed).toHaveLength(3);
    expect(pressed[1]).toMatchObject({ x: 0xc - 1 + 1, y: 0x13 + 3 + 1 }); // code + PRESSED_ALIGN (fit over TOPMGR.BM) + PRESS (1 px)
    expect(b.bar.frameOverlay(100, 100)).toBeNull();
    b.inv.held = { name: "A.BM", image: item() };
    expect(b.bar.frameOverlay(100, 100)).toMatchObject({ x: 100 - 0x18, y: 100 - 0x14 });
    expect(b.bar.frameOverlay(100, 100, false)).toBeNull(); // the item cursor is not over anything it can be used on
  });
});
