// The city map SC000D on mocks (no game files): the scene flag, the cursor at its start, the script patterns of the map
// (the CITYCOUNT cycle, the hover macros that never lock the player, LOC5 ending them) and the hit test of its areas.
import { describe, expect, it } from "vitest";
import { compileMcc, Interpreter, type CommandResult, type ScriptHost } from "../script";
import { insideTriangleSides } from "../walk/geometry";
import { PlayGame } from "../play/game";
import { resolveClick, type AreaClick } from "../areas/click";
import { isNoControlScene, MAP_SCENE, noControlCursor } from "./map";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

class Host implements ScriptHost {
  readonly calls: string[] = [];
  command(cmd: { word: string; n1: string }): CommandResult {
    this.calls.push(`${cmd.word} ${cmd.n1}`.trim());
    return "done";
  }
  clickX(): number {
    return 0;
  }
  random(): number {
    return 0;
  }
  macroEnded(): void {}
  log(): void {}
}

describe("map: the scenes without control", () => {
  it("are exactly SC000D and SC008B (strcmp with the .CCG name)", () => {
    expect(MAP_SCENE).toBe("SC000D");
    expect(["SC000D", "SC008B"].map(isNoControlScene)).toEqual([true, true]);
    expect(["SC000", "SC000C", "SC008", "SC008A", "SC032", "sc000d"].map(isNoControlScene)).toEqual([false, false, false, false, false, false]);
  });

  it("zero the cursor mode and the verb at their start; other scenes keep the verb", () => {
    expect(noControlCursor("SC000D", 1, 1)).toEqual({ mode: 0, verbMode: 0 });
    expect(noControlCursor("SC008B", 0, 3)).toEqual({ mode: 0, verbMode: 0 });
    expect(noControlCursor("SC032", 0, 2)).toEqual({ mode: 0, verbMode: 2 });
  });

  it("PlayGame.startNoControl: the lens chosen in SC006 is gone on the map and after it", () => {
    const g = Object.create(PlayGame.prototype) as unknown as { cursor: { mode: number }; verbMode: number; startNoControl(n: string): void };
    g.cursor = { mode: 1 };
    g.verbMode = 1;
    g.startNoControl("SC006");
    expect([g.cursor.mode, g.verbMode]).toEqual([1, 1]);
    g.startNoControl("SC000D");
    expect([g.cursor.mode, g.verbMode]).toEqual([0, 0]);
  });
});

describe("map: the patterns of SC000D.MCC on a synthetic script", () => {
  it("[PRE] cycles CITYCOUNT 2..7, 1, 2 (Inc, then 8 -> 1): one value per visit picks the cars of the drive", () => {
    const host = new Host();
    const it = new Interpreter(compileMcc(bytes("[PRE] Inc CITYCOUNT If CITYCOUNT 8 Let CITYCOUNT 1 EndIf")), host, new Map([["CITYCOUNT", 0]]));
    const seen: number[] = [];
    for (let k = 0; k < 9; k++) {
      it.runSynchronous("PRE");
      seen.push(it.vars.get("CITYCOUNT"));
    }
    expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 1, 2]);
  });

  it("a hover macro (UNLOCK, a MOUSEX/MOUSEY box, re-activated through CALL_) never locks the player and lights the label inside its box", () => {
    const text =
      "[CZY] UnLock If LOC5 1 DeactiveSelf EndIf IfF MOUSEX < 641 IfF MOUSEX > 541 Anima LAB 0 3 3 0 - EndIf EndIf ActiveMacro CALL_CZY " +
      "[CALL_CZY] UnLock ActiveMacro CZY";
    const host = new Host();
    const it = new Interpreter(compileMcc(bytes(text)), host, new Map([["LOC5", 0], ["MOUSEX", 0]]));
    it.start("CZY");
    for (let k = 0; k < 10; k++) {
      it.tick();
      expect(it.playerLocked()).toBe(false);
    }
    expect(host.calls.some((c) => c.startsWith("ANIMA"))).toBe(false); // the mouse is outside the box
    // inside the box the label animation runs (JACK13.BM in the game)
    it.vars.set("MOUSEX", 600);
    for (let k = 0; k < 4; k++) it.tick();
    expect(host.calls.some((c) => c.startsWith("ANIMA LAB"))).toBe(true);
    expect(it.playerLocked()).toBe(false);
  });
});

describe("map: Area_Contains on the areas of SC000D (numbers from SC000D.ACE)", () => {
  const hit = (tris: number[][], x: number, y: number) => tris.some((t) => insideTriangleSides(t, x, y));
  const HAFFEN = [[591, 3, 590, 75, 769, 74], [590, 2, 770, 75, 770, 2]];
  const JACKH = [[541, 314, 541, 254, 641, 314], [542, 255, 640, 313, 641, 254]];
  const COCL = [[347, 185, 238, 123, 347, 123], [240, 124, 238, 185, 347, 183]];

  it("JACKH is the rectangle 541..641 x 254..314", () => {
    expect(hit(JACKH, 590, 280)).toBe(true);
    expect(hit(JACKH, 530, 280)).toBe(false);
    expect(hit(JACKH, 590, 330)).toBe(false);
  });

  it("HAFFEN: only the upper-right half of its box; the lower-left triangle reacts left of x 591 instead (the whole top strip)", () => {
    expect(hit(HAFFEN, 760, 10)).toBe(true);
    expect(hit(HAFFEN, 641, 28)).toBe(false); // inside the box, below the diagonal
    expect(hit(HAFFEN, 300, 40)).toBe(true); // far left of the port, near the top edge of the map
    expect(hit(HAFFEN, 300, 120)).toBe(false);
  });

  it("COCL (the club): its second triangle reaches the left part of the map", () => {
    expect(hit(COCL, 290, 155)).toBe(true);
    expect(hit(COCL, 100, 100)).toBe(true);
    expect(hit(COCL, 100, 400)).toBe(true);
    expect(hit(COCL, 500, 400)).toBe(false);
  });

  it("but COCL has no macro: a click there is not handled and goes to the sprites - only STAD13.BM drives to the club", () => {
    const cocl: AreaClick = {
      area: 2, name: "COCL", walkArea: false, handled: false, macro: null, started: -1, itemMacroFound: false, itemFailed: false,
    };
    const click = (sprite: boolean) =>
      resolveClick({
        mode: 0, armed: true, cursorEnabled: true, playerLocked: false, walkAllowed: true, itemInHand: false,
        area: () => cocl,
        sprite: () => (sprite ? { macro: "POKAZANIE-STAD13.BM", started: 7, itemMacroFound: false, itemFailed: false } : null),
        inWalkArea: () => false, // the map has no walk area
      });
    expect(click(true)).toEqual({ outcome: { kind: "macro", source: "sprite" }, armed: false }); // the label CENTRUM
    expect(click(false)).toEqual({ outcome: { kind: "nothing" }, armed: true }); // the empty bottom-left of the map
  });
});
