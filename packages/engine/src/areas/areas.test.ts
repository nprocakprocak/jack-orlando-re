import { describe, expect, it } from "vitest";
import { Cursor, CursorEnable, enableDrawVerb, type CursorVerb } from "../cursor";
import { type Area } from "../formats/scene";
import { compileMcc } from "../script/compiler";
import { Interpreter, LoggingHost } from "../script/interpreter";
import {
  AREA_FLAG_SLOTS, AreaState, EXIT_CURSOR_MODE, applyAreaCommand, areaClick, areaHit, areaReaction, areaUnder,
  dupIndices, edgeScrollMode, exitNameAt, interpreterPort, isEnabledExit, isZoneMode, resolveAreaRef, resolveClick,
  spriteClickTarget, spritePasses, spriteReaction, startReaction, zoneCursorMode,
  type Action, type AreaClick, type ClickEnv, type MacroPort, type Reaction, type SpriteCandidate,
} from "./index";

/** Rectangle from two triangles, the way the areas are drawn in the .ACE files. */
const rect = (name: string, x: number, y: number, w: number, h: number, exit = false): Area => ({
  name, exit, triangles: [[x, y, x, y + h, x + w, y], [x, y + h, x + w, y, x + w, y + h]],
});
const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const HAND: Action = { verb: "POKAZANIE", item: null };

/** A port over a list of macro names; `locked` ones exist but cannot start. */
class FakePort implements MacroPort {
  readonly started: string[] = [];
  readonly interrupted: number[] = [];
  constructor(readonly names: string[], readonly locked: string[] = []) {}
  exists(n: string): boolean {
    return this.names.includes(n);
  }
  start(n: string): number {
    if (!this.names.includes(n) || this.locked.includes(n)) return -1;
    this.started.push(n);
    return this.names.indexOf(n);
  }
  interruptOutMacros(except: number): void {
    this.interrupted.push(except);
  }
}

describe("AreaState", () => {
  it("starts with 30 enabled areas, nothing ignored; the rest is 0", () => {
    const s = new AreaState();
    expect(AREA_FLAG_SLOTS).toBe(30);
    for (let i = 0; i < 30; i++) expect([s.enabled[i], s.special[i], s.ignore[i]]).toEqual([1, 1, 0]);
    expect([s.enabled[30], s.special[30], s.ignore[30]]).toEqual([0, 0, 0]);
  });

  it("commands write one byte; IGNOREAREA only sets; reset restores", () => {
    const s = new AreaState();
    s.setArea(2, 0x100); // (char)state keeps the low byte only
    s.setSpecArea(3, 0);
    s.ignoreArea(4);
    s.setArea(-1, 1);
    s.setArea(9999, 1);
    expect([s.enabled[2], s.special[3], s.ignore[4]]).toEqual([0, 0, 1]);
    s.reset();
    expect([s.enabled[2], s.special[3], s.ignore[4]]).toEqual([1, 1, 0]);
  });

  it("resolves a name + duplicate index to the area index", () => {
    const areas = [rect("A", 0, 0, 1, 1), rect("B", 0, 0, 1, 1), rect("A", 0, 0, 1, 1), rect("A", 0, 0, 1, 1)];
    expect(dupIndices(areas)).toEqual([0, 0, 1, 2]);
    expect(resolveAreaRef(areas, "A", 0)).toBe(0);
    expect(resolveAreaRef(areas, "A", 2)).toBe(3);
    expect(resolveAreaRef(areas, "B", 1)).toBe(-1);
    expect(resolveAreaRef(areas, "C", 0)).toBe(-1);
    const s = new AreaState();
    expect(applyAreaCommand(s, areas, { word: "SETAREA", n1: "A", a: [1, 0] })).toBe(true);
    expect(applyAreaCommand(s, areas, { word: "SETSPECAREA", n1: "B", a: [0, 0] })).toBe(true);
    expect(applyAreaCommand(s, areas, { word: "IGNOREAREA", n1: "A", a: [2] })).toBe(true);
    expect(applyAreaCommand(s, areas, { word: "SETAREA", n1: "X", a: [0, 0] })).toBe(true);
    expect(applyAreaCommand(s, areas, { word: "WAIT", n1: "", a: [] })).toBe(false);
    expect([s.enabled[2], s.special[1], s.ignore[3]]).toEqual([0, 0, 1]);
    expect(s.enabled[0]).toBe(1);
  });

  it("applyAreaCommand works on a compiled script", () => {
    const areas = [rect("DRZWI", 0, 0, 10, 10), rect("DRZWI", 20, 0, 10, 10)];
    const prog = compileMcc(bytes("[PRE]\nSetArea DRZWI 1 0\nSetSpecArea DRZWI 0 0\nIgnoreArea DRZWI 1\n"));
    const s = new AreaState();
    for (const c of prog.commands) applyAreaCommand(s, areas, c);
    expect([s.enabled[1], s.special[0], s.ignore[1], s.enabled[0], s.ignore[0]]).toEqual([0, 0, 1, 1, 0]);
  });
});

describe("hit tests", () => {
  const areas = [rect("LEWO", 0, 0, 100, 100, true), rect("KUBEL", 50, 50, 100, 100), rect("OKNO", 200, 0, 50, 50)];

  it("zone modes are 10..19", () => {
    expect([9, 10, 15, 19, 20].map(isZoneMode)).toEqual([false, true, true, true, false]);
  });

  it("the gate: (enabled or mode != 0) and special", () => {
    const s = new AreaState();
    const p = { x: 60, y: 60 };
    expect(areaHit(areas, s, 1, p, 0)).toBe(true);
    s.setArea(1, 0);
    expect(areaHit(areas, s, 1, p, 0)).toBe(false); // SETAREA 0 hides it from the pointer...
    expect(areaHit(areas, s, 1, p, 1)).toBe(true); // ...but not from the other verbs
    s.setSpecArea(1, 0);
    expect(areaHit(areas, s, 1, p, 1)).toBe(false); // SETSPECAREA 0 hides it from all
    expect(areaHit(areas, s, 1, { x: 400, y: 400 }, 0)).toBe(false);
  });

  it("scans from the last area down; zone modes see enabled exits only", () => {
    const s = new AreaState();
    const p = { x: 60, y: 60 }; // inside LEWO (0) and KUBEL (1)
    expect(areaUnder(areas, s, p, 0)).toBe(1);
    expect(areaUnder(areas, s, p, 10)).toBe(0);
    s.setArea(0, 0);
    expect(isEnabledExit(areas, s, 0)).toBe(false);
    expect(areaUnder(areas, s, p, 10)).toBe(-1);
    expect(exitNameAt(areas, s, p, 10)).toBe("");
    s.setArea(0, 1);
    expect(exitNameAt(areas, s, { x: 10, y: 10 }, 0)).toBe("LEWO");
    expect(exitNameAt(areas, s, { x: 220, y: 20 }, 0)).toBe("");
  });

  it("IGNOREAREA skips the area for the cursor in mode 0 only", () => {
    const s = new AreaState();
    s.ignoreArea(1);
    const port = new FakePort(["POKAZANIE-LEWO", "POKAZANIE-KUBEL"]);
    const p = { x: 60, y: 60 };
    expect(areaReaction(areas, s, port, p, 0, HAND).name).toBe("LEWO");
    expect(areaReaction(areas, s, port, p, 1, { verb: "PATRZENIE", item: null }).name).toBe("KUBEL");
    // a click ignores the flag
    expect(areaClick(areas, s, port, p, 0, HAND).name).toBe("KUBEL");
  });

  it("the cursor test: over = area under the hotspot even without a macro; exists = macro exists", () => {
    const s = new AreaState();
    const port = new FakePort(["POKAZANIE-OKNO"]);
    expect(areaReaction(areas, s, port, { x: 220, y: 20 }, 0, HAND)).toEqual({
      area: 2, name: "OKNO", over: true, exists: true, label: "POKAZANIE-OKNO",
    });
    const r = areaReaction(areas, s, port, { x: 120, y: 120 }, 0, HAND);
    expect([r.name, r.over, r.exists]).toEqual(["KUBEL", true, false]);
    expect(areaReaction(areas, s, port, { x: 500, y: 500 }, 0, HAND).over).toBe(false);
    // item in hand: "<item>-NAME", no PIERDOLA in this test
    const held: Action = { verb: "POKAZANIE", item: "KLUCZ_I.BM" };
    const p2 = new FakePort(["PIERDOLA-OKNO"]);
    expect(areaReaction(areas, s, p2, { x: 220, y: 20 }, 5, held)).toMatchObject({ exists: false, label: "KLUCZ_I.BM-OKNO" });
  });
});

describe("zone cursor modes", () => {
  const areas = ["LEWO", "PRAWO", "DOL", "TO_IN", "UP", "TO_OUT", "KUBEL"].map((n, i) => rect(n, i * 100, 0, 100, 100, n !== "KUBEL"));
  const at = (i: number) => ({ x: i * 100 + 30, y: 30 });
  const mode = (i: number, over: Partial<Parameters<typeof zoneCursorMode>[2]> = {}) =>
    zoneCursorMode(areas, new AreaState(), { mode: 0, verbMode: 0, click: at(i), ...over });

  it("takes the mode from the exit name, falls back to the menu mode", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => mode(i))).toEqual([10, 11, 13, 14, 15, 17]);
    expect(EXIT_CURSOR_MODE).toEqual({ LEWO: 10, PRAWO: 11, DOL: 13, TO_IN: 14, UP: 15, TO_OUT: 17 });
    expect(mode(6)).toBe(0);
    expect(mode(6, { mode: 10 })).toBe(0);
    expect(zoneCursorMode(areas, new AreaState(), { mode: 10, verbMode: 0, click: { x: 900, y: 900 } })).toBe(0);
  });

  it("is skipped for other verbs, an item in hand, scroll cursors, busy/suspended", () => {
    expect(mode(0, { verbMode: 1, mode: 1 })).toBe(1);
    expect(mode(0, { mode: 5 })).toBe(5);
    expect(mode(0, { mode: 20 })).toBe(20);
    expect(mode(0, { mode: 21 })).toBe(21);
    expect(mode(0, { suspended: true })).toBe(0);
    expect(mode(0, { busy: true })).toBe(0);
  });

  it("a disabled exit gives no arrow", () => {
    const s = new AreaState();
    s.setArea(0, 0);
    expect(zoneCursorMode(areas, s, { mode: 0, verbMode: 0, click: at(0) })).toBe(0);
  });
});

describe("the verb after a macro that changes the scene", () => {
  // SC104 in short: the TO_OUT exit; the uniform was taken with the take verb (BRANIE-MUNDUR.PBM ends in GOTOSCENE)
  const areas = [rect("TO_OUT", 0, 400, 640, 80, true)];
  const over = { x: 300, y: 450 };
  const zone = (c: CursorVerb): number => zoneCursorMode(areas, new AreaState(), { mode: c.mode, verbMode: c.verbMode, click: over });

  it("the new scene keeps the hand: no arrow, and no pointer with a stale verb", () => {
    const cursor = new Cursor(() => ({ w: 18, h: 25 }));
    cursor.mode = 4;
    cursor.sceneStart(4);
    const c = { mode: cursor.mode, verbMode: 4 };
    expect(zone(c)).toBe(4);
    // the old engine: mode 0 with the take verb left - the pointer image, the arrows switched off for good
    expect(zone({ mode: 0, verbMode: 4 })).toBe(0);
  });

  it("opening the bullet menu (mode 0 + Cursor_EnableDraw) brings the arrows back", () => {
    const c = { mode: 0, verbMode: enableDrawVerb(0, 4) };
    expect(c.verbMode).toBe(0);
    expect(zone(c)).toBe(EXIT_CURSOR_MODE.TO_OUT);
  });

  it("the unlock after a macro repairs a pointer with a stale verb (step 21)", () => {
    const e = new CursorEnable();
    e.step(false, false);
    e.step(true, false);
    const c = { mode: 0, verbMode: 4 };
    if (e.step(false, false)) c.verbMode = enableDrawVerb(c.mode, c.verbMode);
    expect(zone(c)).toBe(EXIT_CURSOR_MODE.TO_OUT);
  });
});

describe("scroll edge cursors", () => {
  const env = (mode: number, mouseX: number) => ({ mode, mouseX, scrollX: 100, scrollMin: 0, scrollMax: 376 });
  it("enters at the edges when the view can scroll and remembers the mode", () => {
    expect(edgeScrollMode(env(0, 120), 0)).toEqual({ mode: 20, saved: 0 });
    expect(edgeScrollMode(env(11, 100 + 0x263), 0)).toEqual({ mode: 21, saved: 11 });
    expect(edgeScrollMode(env(0, 150), 0)).toEqual({ mode: 0, saved: 0 });
    expect(edgeScrollMode({ ...env(0, 120), scrollX: 0 }, 0)).toEqual({ mode: 0, saved: 0 });
    expect(edgeScrollMode({ ...env(0, 100 + 0x263), scrollX: 376 }, 0)).toEqual({ mode: 0, saved: 0 });
  });
  it("leaves back to the saved mode", () => {
    expect(edgeScrollMode(env(20, 140), 3)).toEqual({ mode: 3, saved: 3 });
    expect(edgeScrollMode(env(20, 120), 3)).toEqual({ mode: 20, saved: 3 });
    expect(edgeScrollMode(env(20, 120), 3, false)).toEqual({ mode: 3, saved: 3 });
    expect(edgeScrollMode(env(21, 100 + 0x200), 4)).toEqual({ mode: 4, saved: 4 });
  });
});

describe("startReaction / area click", () => {
  const item: Action = { verb: "POKAZANIE", item: "KLUCZ_I.BM" };
  it("empty hand: verb macro only, no fallback; interrupts OUTMACROs except itself", () => {
    const port = new FakePort(["PIERDOLA-X", "POKAZANIE-X"]);
    const r = startReaction(port, HAND, "X");
    expect([r.macro, r.started, r.itemMacroFound, r.itemFailed]).toEqual(["POKAZANIE-X", 1, false, false]);
    expect(port.interrupted).toEqual([1]);
    const none = startReaction(new FakePort(["PIERDOLA-X"]), HAND, "X");
    expect([none.macro, none.started, none.itemFailed]).toEqual([null, -1, false]);
  });
  it("item in hand: item macro, then PIERDOLA, then failure", () => {
    let port = new FakePort(["KLUCZ_I.BM-X", "PIERDOLA-X"]);
    expect(startReaction(port, item, "X")).toMatchObject({ macro: "KLUCZ_I.BM-X", itemMacroFound: true, itemFailed: false });
    port = new FakePort(["PIERDOLA-X"]);
    expect(startReaction(port, item, "X")).toMatchObject({ macro: "PIERDOLA-X", started: 0, itemMacroFound: true, itemFailed: false });
    port = new FakePort(["POKAZANIE-X"]);
    const r = startReaction(port, item, "X");
    expect(r).toMatchObject({ macro: null, started: -1, itemMacroFound: false, itemFailed: true });
    expect(port.interrupted).toEqual([]);
  });
  it("a BLOCKMACRO-ed macro is not started (but exists)", () => {
    const port = new FakePort(["POKAZANIE-X"], ["POKAZANIE-X"]);
    expect(port.exists("POKAZANIE-X")).toBe(true);
    expect(startReaction(port, HAND, "X").started).toBe(-1);
  });

  const areas = [rect("A", 0, 0, 100, 100), rect("WALKAREA", 0, 0, 300, 300), rect("B", 200, 0, 50, 50)];
  it("the topmost area wins even without a macro; no area -> nothing", () => {
    const s = new AreaState();
    const port = new FakePort(["POKAZANIE-A"]);
    const c = areaClick(areas, s, port, { x: 10, y: 10 }, 0, HAND);
    expect([c.name, c.handled, c.walkArea, c.started]).toEqual(["WALKAREA", false, true, -1]);
    const b = areaClick(areas, s, new FakePort(["POKAZANIE-B"]), { x: 210, y: 10 }, 0, HAND);
    expect([b.name, b.handled]).toEqual(["B", true]);
    const noMacro = areaClick(areas, s, new FakePort([]), { x: 210, y: 10 }, 0, HAND);
    expect([noMacro.name, noMacro.handled, noMacro.itemFailed]).toEqual(["B", false, false]);
    expect(areaClick(areas, s, port, { x: 900, y: 900 }, 0, HAND).area).toBe(-1);
  });
  it("WALKAREA: starts its macro but without fallback or interrupt, and blocks the walk", () => {
    const s = new AreaState();
    const port = new FakePort(["POKAZANIE-WALKAREA"]);
    const c = areaClick(areas, s, port, { x: 250, y: 250 }, 0, HAND);
    expect(c).toMatchObject({ name: "WALKAREA", walkArea: true, handled: false, macro: "POKAZANIE-WALKAREA" });
    expect(port.started).toEqual(["POKAZANIE-WALKAREA"]);
    expect(port.interrupted).toEqual([]);
    const held = areaClick(areas, s, new FakePort(["PIERDOLA-WALKAREA"]), { x: 250, y: 250 }, 5, item);
    expect([held.walkArea, held.macro, held.itemFailed]).toEqual([true, null, false]);
  });
  it("in zone mode only exits are clicked", () => {
    const ex = [rect("KUBEL", 0, 0, 100, 100), rect("LEWO", 0, 0, 50, 50, true)];
    const s = new AreaState();
    const port = new FakePort(["POKAZANIE-KUBEL", "POKAZANIE-LEWO"]);
    expect(areaClick(ex, s, port, { x: 70, y: 70 }, 10, HAND).area).toBe(-1);
    expect(areaClick(ex, s, port, { x: 20, y: 20 }, 10, HAND).name).toBe("LEWO");
  });
});

describe("sprites", () => {
  const sp = (name: string, pixelHit: boolean, flagged = false, excluded = false): SpriteCandidate => ({ name, pixelHit, flagged, excluded });
  it("passes: click 2 for modes other than 0 and 1, cursor test 2 for every mode but 1", () => {
    expect([0, 1, 2, 5].map((m) => spritePasses(m, true))).toEqual([1, 1, 2, 2]);
    expect([0, 1, 2, 5].map((m) => spritePasses(m, false))).toEqual([2, 1, 2, 2]);
  });
  it("the click takes the topmost hit sprite, Jack is never a target", () => {
    const list = [sp("A", true), sp("B", true), sp("JACK", true, false, true)];
    expect(spriteClickTarget(list, 0)).toBe(1);
    expect(spriteClickTarget([sp("A", false, true)], 0)).toBe(-1);
    expect(spriteClickTarget([sp("A", false, true)], 2)).toBe(0);
  });
  it("the cursor test goes on to a lower sprite that has a macro; the click does not", () => {
    const list = [sp("LOW", true), sp("TOP", true)];
    const port = new FakePort(["POKAZANIE-LOW"]);
    expect(spriteReaction(list, port, 0, HAND)).toMatchObject({ over: true, exists: true, index: 0, label: "POKAZANIE-LOW" });
    expect(spriteClickTarget(list, 0)).toBe(1);
  });
  it(" (SC026 spoon): the flag lights the cursor next to a small thing, the click needs a flagged sprite - and a big sprite without a macro under the hotspot takes it first", () => {
    const verb: Action = { verb: "BRANIE", item: null };
    const port = new FakePort(["BRANIE-LYZKA.PBM"]);
    // list in drawing order: the table (opaque under the hotspot, no macro), the spoon and the bowl above it (only flagged by the cursor rectangle)
    const list = [sp("STOL.PBM", true, true), sp("LYZKA.PBM", false, true), sp("MISKA.PBM", false, true)];
    // 'highlight yes' (pass 0 table: no macro, pass 1 the spoon: macro) ...
    expect(spriteReaction(list, port, 4, verb)).toMatchObject({ over: true, exists: true, index: 1, label: "BRANIE-LYZKA.PBM" });
    // ... the original's click stops at the table (Sprite_ClickMacro leaves the loop at the first hit, macro or not)
    expect(spriteClickTarget(list, 4)).toBe(0);
    // the click skips sprites without a macro like the cursor test, so it lands on the spoon where the hand lights up
    const has = (n: string): boolean => port.exists(`BRANIE-${n}`);
    expect(spriteClickTarget(list, 4, has)).toBe(1);
    // no hit sprite has a macro: the original's target (the topmost hit one), the refusal of an item depends on it
    expect(spriteClickTarget(list, 4, () => false)).toBe(0);
    // a macro of a sprite that is not hit does not matter
    expect(spriteClickTarget([sp("STOL.PBM", true, true), sp("LYZKA.PBM", false, false)], 4, has)).toBe(0);
    // mode 0 keeps one pass for the click
    expect(spriteClickTarget([sp("STOL.PBM", true, true), sp("LYZKA.PBM", false, true)], 0, has)).toBe(0);
    // the edge of the spoon itself: its own pixel is under the hotspot, so the click goes through
    expect(spriteClickTarget([sp("STOL.PBM", true, true), sp("LYZKA.PBM", true, true)], 4)).toBe(1);
    // with nothing opaque under the hotspot but the spoon flagged, the click uses pass 1 as well (hand 'HAN', mode 4)
    expect(spriteClickTarget([sp("STOL.PBM", false, false), sp("LYZKA.PBM", false, true)], 4)).toBe(1);
    // the arrow (mode 0): no second pass for the click
    expect(spriteClickTarget([sp("LYZKA.PBM", false, true)], 0)).toBe(-1);
  });
  it("with an item the cursor test knows PIERDOLA", () => {
    const held: Action = { verb: "POKAZANIE", item: "X.BM" };
    expect(spriteReaction([sp("A", true)], new FakePort(["PIERDOLA-A"]), 5, held).exists).toBe(true);
    expect(spriteReaction([sp("A", false)], new FakePort(["PIERDOLA-A"]), 5, held)).toMatchObject({ over: false, exists: false });
  });
});

describe("resolveClick", () => {
  const noArea: AreaClick = {
    area: -1, name: "", walkArea: false, handled: false, macro: null, started: -1, itemMacroFound: false, itemFailed: false,
  };
  const noReaction: Reaction = { macro: null, started: -1, itemMacroFound: false, itemFailed: false };
  const mk = (o: Partial<ClickEnv> = {}): ClickEnv => ({
    mode: 0, armed: true, cursorEnabled: true, playerLocked: false, walkAllowed: true, itemInHand: false,
    area: () => noArea, sprite: () => null, inWalkArea: () => true, ...o,
  });
  it("guards: not armed, cursor disabled, turning, scroll cursor", () => {
    expect(resolveClick(mk({ armed: false }))).toEqual({ outcome: { kind: "ignored" }, armed: false });
    for (const o of [{ cursorEnabled: false }, { turning: true }, { mode: 20 }, { mode: 21 }])
      expect(resolveClick(mk(o))).toEqual({ outcome: { kind: "ignored" }, armed: true });
  });
  it("area first, then sprite, then walk", () => {
    const area: AreaClick = { ...noArea, area: 0, name: "A", handled: true, started: 3, macro: "POKAZANIE-A" };
    expect(resolveClick(mk({ area: () => area }))).toEqual({ outcome: { kind: "macro", source: "area" }, armed: false });
    const spr: Reaction = { ...noReaction, macro: "POKAZANIE-S", started: 2 };
    expect(resolveClick(mk({ sprite: () => spr }))).toEqual({ outcome: { kind: "macro", source: "sprite" }, armed: false });
    expect(resolveClick(mk())).toEqual({ outcome: { kind: "walk" }, armed: false });
  });
  it("walking needs LOCKWALK off, a point in the walk area, mode 0 and no WALKAREA hit", () => {
    expect(resolveClick(mk({ walkAllowed: false })).outcome).toEqual({ kind: "nothing" });
    expect(resolveClick(mk({ inWalkArea: () => false })).outcome).toEqual({ kind: "nothing" });
    expect(resolveClick(mk({ mode: 1 })).outcome).toEqual({ kind: "nothing" });
    const walk: AreaClick = { ...noArea, area: 1, name: "WALKAREA", walkArea: true };
    expect(resolveClick(mk({ area: () => walk })).outcome).toEqual({ kind: "nothing" });
  });
  it("a locked player cannot click anything", () => {
    const e = mk({
      playerLocked: true,
      area: () => {
        throw new Error("not called");
      },
    });
    expect(resolveClick(e)).toEqual({ outcome: { kind: "nothing" }, armed: true });
  });
  it("item used on a target without any reaction: Jack refuses; on empty space: back to the bar", () => {
    const failed: AreaClick = { ...noArea, area: 0, name: "A", itemFailed: true };
    expect(resolveClick(mk({ mode: 5, itemInHand: true, area: () => failed }))).toEqual({ outcome: { kind: "refuse" }, armed: true });
    expect(resolveClick(mk({ mode: 5, itemInHand: true }))).toEqual({ outcome: { kind: "putBack" }, armed: false });
    const sprFail: Reaction = { ...noReaction, itemFailed: true };
    expect(resolveClick(mk({ mode: 5, itemInHand: true, sprite: () => sprFail })).outcome).toEqual({ kind: "refuse" });
  });
});

describe("interpreterPort", () => {
  const text = "[POKAZANIE-A]\nLock\nOutMacro\nDoNothing 100\n[POKAZANIE-B]\nUnlock\nDoNothing 1\n[~POKAZANIE-A]\nUnlock\nDoNothing 1\n";
  it("exists / start / interrupt on the real interpreter", () => {
    const it = new Interpreter(compileMcc(bytes(text)), new LoggingHost(), new Map());
    const port = interpreterPort(it);
    expect(port.exists("POKAZANIE-A")).toBe(true);
    expect(port.exists("POKAZANIE-Z")).toBe(false);
    expect(port.start("POKAZANIE-Z")).toBe(-1);
    expect(it.anyActive()).toBe(false); // no "missing macro" entry started anything
    const a = port.start("POKAZANIE-A");
    for (let i = 0; i < 3; i++) it.tick();
    expect(it.macros[a].out).toBe(true);
    const b = port.start("POKAZANIE-B");
    port.interruptOutMacros(b);
    expect(it.macros[a].active).toBe(false);
    expect(it.isActive("~POKAZANIE-A")).toBe(true);
  });
});

describe(" inert BRANIE-AUTO", () => {
  const text = ["[PATRZENIE-AUTO]", "DoNothing 1", "[BRANIE-AUTO]", "DoNothing 1", "[BRANIE-DRZWI]", "DoNothing 1", ""].join("\n");
  const mk = (makarte?: number) =>
    interpreterPort(new Interpreter(compileMcc(bytes(text)), new LoggingHost(), new Map(makarte === undefined ? [] : [["MAKARTE", makarte]])));
  it("hand is off over the car after the card was taken, only for BRANIE", () => {
    expect(mk(0).exists("BRANIE-AUTO")).toBe(true);
    expect(mk(1).exists("BRANIE-AUTO")).toBe(false);
    expect(mk(1).exists("PATRZENIE-AUTO")).toBe(true);
    expect(mk(1).exists("BRANIE-DRZWI")).toBe(true);
    expect(mk().exists("BRANIE-AUTO")).toBe(true); // no MAKARTE: other scene, unchanged
  });
  it("click still starts the macro (as in the original)", () => {
    const p = mk(1);
    expect(p.start("BRANIE-AUTO")).toBeGreaterThanOrEqual(0);
  });
});
