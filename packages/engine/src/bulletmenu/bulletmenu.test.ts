import { describe, expect, it } from "vitest";
import { formulaTables, setDarkenTables } from "../gui/darken";
import { fakeAssets, flat } from "../gui/fixtures";
import { createSurface } from "../render/surface";
import { encodeMazovia } from "../dialog/caption";
import { textWidth } from "../formats/fnt";
import { BulletMenu, type BulletFrameInput } from "./bullet";
import { drawBullet } from "./draw";
import { bulletPosition, ICONS, inRect, verbMenuPosition } from "./geometry";
import { buttonName, VERB_TEXTS, VerbMenu, verbMenuItems, verbMenuModes } from "./verbmenu";

setDarkenTables(formulaTables());

function input(p: Partial<BulletFrameInput> = {}): BulletFrameInput {
  return {
    mouseX: 300,
    mouseY: 240,
    scrollX: 0,
    clickX: 291,
    clickY: 228,
    leftDown: false,
    rightDown: false,
    esc: false,
    cursorMode: 0,
    gun: false,
    showBullet: true,
    blocked: false,
    cursorEnabled: true,
    ...p,
  };
}
const icon = (id: string) => ICONS.find((i) => i.id === id)!;
/** Click point at the middle of an icon of a bullet at (bx, by). */
const at = (id: string, bx: number, by: number) => {
  const i = icon(id);
  return { clickX: bx + i.x + (i.w >> 1), clickY: by + i.y + (i.h >> 1) };
};
const opened = (gun = false) => {
  const m = new BulletMenu();
  m.rightReleased = true;
  m.frame(input({ rightDown: true, gun }));
  return m;
};

describe("geometry", () => {
  it("click rectangle uses strict inequalities", () => {
    expect(inRect(10, 10, 10, 10, 5, 5)).toBe(false);
    expect(inRect(11, 11, 10, 10, 5, 5)).toBe(true);
    expect(inRect(14, 14, 10, 10, 5, 5)).toBe(true);
    expect(inRect(15, 14, 10, 10, 5, 5)).toBe(false);
  });
  it("bullet is placed up-left of the mouse and clamped to the screen band", () => {
    expect(bulletPosition(300, 240, 0)).toEqual({ x: 198, y: 143 });
    expect(bulletPosition(0, 0, 0)).toEqual({ x: 10, y: 15 });
    expect(bulletPosition(639, 479, 0)).toEqual({ x: 630 - 181, y: 470 - 182 });
    expect(bulletPosition(1000, 240, 400)).toEqual({ x: 849, y: 143 });
    expect(bulletPosition(405, 240, 400)).toEqual({ x: 410, y: 143 });
  });
  it("verb window sits 63 px above the mouse, centred on mouse - 7, clamped; German is wider", () => {
    expect(verbMenuPosition(320, 240, 0, false)).toEqual({ x: 320 - 7 - 72, y: 177 });
    expect(verbMenuPosition(0, 0, 0, true)).toEqual({ x: 10, y: 15 });
    expect(verbMenuPosition(639, 479, 0, true)).toEqual({ x: 630 - 145, y: 470 - 185 });
    expect(verbMenuPosition(639, 479, 0, false, "D")).toEqual({ x: 390, y: 312 });
    expect(verbMenuPosition(600, 240, 100, false).x).toBe(600 - 7 - 72 - 100);
  });
  it("icon table matches g_bulletIconPos", () => {
    expect(ICONS.map((i) => [i.id, i.mode, i.x, i.y, i.w, i.h])).toEqual([
      ["look", 1, 90, 111, 20, 26],
      ["pointer", 0, 54, 70, 22, 38],
      ["take", 4, 74, 49, 42, 34],
      ["hit", 2, 121, 90, 32, 32],
      ["gun", 3, 71, 80, 36, 23],
    ]);
  });
});

describe("opening", () => {
  it("opens on the right button at the clamped position", () => {
    const m = new BulletMenu();
    m.rightReleased = true;
    expect(m.frame(input({ rightDown: true }))).toEqual([{ type: "open", x: 198, y: 143 }]);
    expect(m.open).toBe(true);
    expect(m.blockLeft).toBe(true);
  });
  it("does not open before the button was ever seen released", () => {
    const m = new BulletMenu();
    expect(m.frame(input({ rightDown: true }))).toEqual([]);
    expect(m.frame(input())).toEqual([]);
    expect(m.rightReleased).toBe(true);
    expect(m.frame(input({ rightDown: true })).map((e) => e.type)).toEqual(["open"]);
  });
  it.each([
    ["item in hand", { cursorMode: 5 }],
    ["talking face / exit / no-control scene", { blocked: true }],
    ["cursor disabled", { cursorEnabled: false }],
  ])("does not open: %s", (_n, patch) => {
    const m = new BulletMenu();
    m.rightReleased = true;
    expect(m.frame(input({ rightDown: true, ...patch }))).toEqual([]);
    expect(m.open).toBe(false);
  });
  it("BulletOnOff = 0 asks for the verb window instead", () => {
    const m = new BulletMenu();
    m.rightReleased = true;
    const ev = m.frame(input({ rightDown: true, showBullet: false, gun: true }));
    expect(ev).toEqual([{ type: "verbMenu", x: 300 - 7 - 72, y: 177 }]);
    expect(m.open).toBe(false);
    expect(m.blockLeft).toBe(false);
  });
  it("Esc closes; with the right button still down it reopens at once (flag never cleared)", () => {
    const m = opened();
    expect(m.frame(input({ esc: true })).map((e) => e.type)).toEqual(["close"]);
    expect(m.open).toBe(false);
    expect(m.frame(input({ esc: true, rightDown: true })).map((e) => e.type)).toEqual(["open"]);
  });
  it("a right click while open does nothing", () => {
    const m = opened();
    expect(m.frame(input({ rightDown: true, mouseX: 50 }))).toEqual([]);
    expect(m.x).toBe(198);
  });
});

describe("icons", () => {
  it("press highlights, release over the icon chooses and closes", () => {
    const m = opened();
    const p = at("hit", m.x, m.y);
    expect(m.frame(input({ ...p, leftDown: true }))).toEqual([]);
    expect(m.highlights()).toEqual(["hit"]);
    expect(m.frame(input({ ...p }))).toEqual([{ type: "close" }, { type: "select", mode: 2, icon: "hit" }]);
    expect(m.open).toBe(false);
    expect(m.highlights()).toEqual([]);
  });
  it.each([
    ["look", 1],
    ["pointer", 0],
    ["take", 4],
    ["hit", 2],
  ])("icon %s selects mode %i", (id, mode) => {
    const m = opened();
    const p = at(id, m.x, m.y);
    m.frame(input({ ...p, leftDown: true }));
    const ev = m.frame(input({ ...p }));
    expect(ev[ev.length - 1]).toEqual({ type: "select", mode, icon: id });
  });
  it("sliding off the icon before release cancels the highlight and keeps the menu", () => {
    const m = opened();
    const p = at("take", m.x, m.y);
    m.frame(input({ ...p, leftDown: true }));
    expect(m.frame(input({ clickX: 0, clickY: 0, leftDown: true }))).toEqual([]);
    expect(m.highlights()).toEqual([]);
    expect(m.frame(input({ clickX: 0, clickY: 0 }))).toEqual([]);
    expect(m.open).toBe(true);
  });
  it("clicking beside the icons does nothing; the left click is blocked from the scene", () => {
    const m = opened();
    m.frame(input({ clickX: m.x + 5, clickY: m.y + 5, leftDown: true }));
    expect(m.blockLeft).toBe(true);
    expect(m.frame(input({ clickX: m.x + 5, clickY: m.y + 5 }))).toEqual([]);
    expect(m.open).toBe(true);
  });
  it("the revolver icon exists only with GUN", () => {
    const m = opened(false);
    m.frame(input({ ...at("gun", m.x, m.y), leftDown: true }));
    expect(m.highlights()).toEqual([]);
    const g = opened(true);
    const q = at("gun", g.x, g.y);
    g.frame(input({ ...q, leftDown: true, gun: true }));
    expect(g.highlights()).toEqual(["gun"]);
    const ev = g.frame(input({ ...q, gun: true }));
    expect(ev[ev.length - 1]).toEqual({ type: "select", mode: 3, icon: "gun" });
  });
  it("overlap of pointer and revolver: both highlight, release picks both, the revolver wins", () => {
    const m = opened(true);
    const p = { clickX: m.x + 74, clickY: m.y + 90 }; // inside both (x 72..75, y 81..102)
    m.frame(input({ ...p, leftDown: true, gun: true }));
    expect([...m.highlights()].sort()).toEqual(["gun", "pointer"]);
    const sel = m.frame(input({ ...p, gun: true })).filter((e) => e.type === "select");
    expect(sel.map((e) => (e as { mode: number }).mode)).toEqual([0, 3]);
  });
  it("Esc over a pressed icon keeps prev: the next opening chooses it on its first frame", () => {
    const m = opened();
    const p = at("look", m.x, m.y);
    m.frame(input({ ...p, leftDown: true }));
    m.frame(input({ esc: true, leftDown: true, ...p }));
    expect(m.open).toBe(false);
    expect(m.prev.look).toBe(true);
    // reopens (same mouse position) with the click point already over the icon, left button up
    const ev = m.frame(input({ ...at("look", 198, 143), rightDown: true }));
    expect(ev.some((e) => e.type === "select" && e.mode === 1)).toBe(true);
  });
  it("holding the right button while choosing reopens the bullet next frame at the new place", () => {
    const m = opened();
    const p = at("hit", m.x, m.y);
    m.frame(input({ ...p, leftDown: true, rightDown: true }));
    m.frame(input({ ...p, rightDown: true }));
    expect(m.open).toBe(false);
    expect(m.frame(input({ ...p, rightDown: true, mouseX: 400, mouseY: 300 }))).toEqual([
      { type: "open", x: 298, y: 203 },
    ]);
  });
  it("close() hides once", () => {
    const m = opened();
    expect(m.close()).toEqual([{ type: "close" }]);
    expect(m.close()).toEqual([]);
  });
});

describe("verb window", () => {
  const assets = fakeAssets();
  const scene = createSurface(640, 480);
  it("four items, Colt only with the revolver; modes 0 4 2 1 (3)", () => {
    expect(verbMenuItems(VERB_TEXTS.P, false)).toEqual(["Wskaźnik", "Zabierz", "Uderz", "Sprawdź"]);
    expect(verbMenuItems(VERB_TEXTS.P, true)).toEqual(["Wskaźnik", "Zabierz", "Uderz", "Sprawdź", "Colt"]);
    expect(verbMenuModes(true)).toEqual([0, 4, 2, 1, 3]);
    expect(verbMenuItems(VERB_TEXTS.D, true)[4]).toBe("Waffe");
  });
  it("window height is n*27+50 (the stored 158 / 185 are for 4 / 5 items)", () => {
    expect(new VerbMenu(assets, scene, 10, 15, false).win.h).toBe(158);
    expect(new VerbMenu(assets, scene, 10, 15, true).win.h).toBe(185);
  });
  it("a click picks the item's mode; Enter (on release) picks the first; Esc picks nothing", () => {
    const click = (n: number) => {
      const v = new VerbMenu(assets, scene, 100, 100, true);
      const x = v.win.x + 30;
      const y = v.win.y + 38 + 27 * n + 5;
      v.pointerDown(x, y);
      v.pointerUp(x, y);
      return v;
    };
    expect(click(0).result).toEqual({ mode: 0 });
    expect(click(1).result).toEqual({ mode: 4 });
    expect(click(2).result).toEqual({ mode: 2 });
    expect(click(3).result).toEqual({ mode: 1 });
    expect(click(4).result).toEqual({ mode: 3 });
    const e = new VerbMenu(assets, scene, 100, 100, false);
    e.keyDown("Enter");
    expect(e.done).toBe(false);
    e.keyUp("Enter");
    expect(e.result).toEqual({ mode: 0 });
    const x = new VerbMenu(assets, scene, 100, 100, false);
    x.keyDown("Escape");
    expect(x.done).toBe(true);
    expect(x.result).toBeNull();
  });
  it("uses the small font 1 (JACKM) for the width; titles keep the exe's /3 letter-spacing code", () => {
    const narrow = {
      ...assets,
      fontSmall: {
        ...assets.fontSmall,
        glyphs: assets.fontSmall.glyphs.map((g) => ({ ...g, width: 3 })),
      },
    };
    const tw = textWidth(narrow.fontSmall, encodeMazovia("Wskaźnik"));
    expect(textWidth(narrow.fontBig, encodeMazovia("Wskaźnik"))).not.toBe(tw);
    expect(new VerbMenu(narrow, scene, 10, 15, false).win.w).toBe(tw + 80 + ((tw + 80) % 2));
    expect([VERB_TEXTS.P.title, VERB_TEXTS.E.title, VERB_TEXTS.D.title]).toEqual([
      "/3WYBIERZ",
      "/3SELECT",
      "/3AUSWAHL",
    ]);
  });
  it("releasing outside the pressed button does not choose", () => {
    const v = new VerbMenu(assets, scene, 100, 100, false);
    v.pointerDown(v.win.x + 30, v.win.y + 45);
    v.pointerUp(v.win.x + 30, v.win.y + 100);
    expect(v.done).toBe(false);
    expect(buttonName(2)).toBe("Btn C");
  });
});

describe("drawing", () => {
  it("draws the bullet and only the pressed highlights at the icon rectangle corner", () => {
    const m = opened();
    const imgs: Record<string, ReturnType<typeof flat>> = {
      "POCISK.BM": flat(181, 182, 0x1111),
      "PIESC_1.BM": flat(37, 32, 0x2222),
    };
    const s = createSurface(640, 480);
    const px = (x: number, y: number) => s.pixels[y * 640 + x];
    drawBullet(m, false, (n) => imgs[n], s);
    expect(px(m.x, m.y)).toBe(0x1111);
    m.frame(input({ ...at("hit", m.x, m.y), leftDown: true }));
    drawBullet(m, false, (n) => imgs[n], s);
    expect(px(m.x + 121, m.y + 90)).toBe(0x2222);
    expect(px(m.x + 120, m.y + 90)).toBe(0x1111);
  });
  it("draws nothing when closed", () => {
    const s = createSurface(10, 10);
    drawBullet(new BulletMenu(), false, () => flat(5, 5, 7), s);
    expect(s.pixels.every((v) => v === 0)).toBe(true);
  });
});
