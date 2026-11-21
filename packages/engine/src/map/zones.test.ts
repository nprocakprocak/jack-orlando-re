// The zone model on a synthetic scene (no game files): zones from areas and objects,
// the click order (area with a macro, else sprite), the hit grid and the targets computed by running the macros.
import { describe, expect, it } from "vitest";
import type { Area } from "../formats/scene";
import { compileMcc } from "../script";
import type { SpriteCandidate } from "../areas";
import {
  conditionValues,
  describeDestinations,
  destinations,
  hitGrid,
  runClick,
  sceneZones,
  SILENT,
  stateControls,
  triangleBounds,
  zoneAt,
  zoneRows,
} from "./zones";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

// PORT goes to SC075 always; CLUB has no macro; the sprite LABEL.BM (inside CLUB's box) picks SC032 / SC032B by ODJECHAL69
const program = compileMcc(
  bytes(
    "[POKAZANIE-PORT] Let LOC5 1 If LAST 32 DoNothing 3 EndIf GotoScene SC075 " +
      "[POKAZANIE-LABEL.BM] If LAST 32 Let LAST 6 EndIf If ODJECHAL69 0 GotoScene SC032 DeactiveSelf EndIf GotoScene SC032B " +
      "[POKAZANIE-OFFICE] IfF LAST > 40 GotoScene SC100 EndIf " +
      "[HOVER] UnLock",
  ),
);
const square = (x0: number, y0: number, x1: number, y1: number): number[][] => [
  [x0, y0, x0, y1, x1, y1], // lower-left half
  [x0, y0, x1, y1, x1, y0], // upper-right half
];
const areas: Area[] = [
  { name: "PORT", exit: false, triangles: square(100, 0, 200, 50) },
  { name: "CLUB", exit: false, triangles: square(0, 100, 100, 200) },
];
const sprites = (x: number, y: number): SpriteCandidate[] => [
  { name: "OTHER.BM", pixelHit: x >= 0 && x < 300 && y >= 300 && y < 400, flagged: false },
  { name: "LABEL.BM", pixelHit: x >= 40 && x < 60 && y >= 140 && y < 160, flagged: false },
];

describe("map zones: the list", () => {
  it("every area (also without a macro) and every object with a POKAZANIE macro", () => {
    const z = sceneZones(areas, ["OTHER.BM", "LABEL.BM", "LABEL.BM"], program);
    expect(z.map((x) => [x.kind, x.name, x.macro])).toEqual([
      ["area", "PORT", "POKAZANIE-PORT"],
      ["area", "CLUB", null],
      ["sprite", "LABEL.BM", "POKAZANIE-LABEL.BM"],
    ]);
    expect(z[0].bounds).toEqual({ x0: 100, y0: 0, x1: 200, y1: 50 });
    expect(triangleBounds([])).toBeNull();
  });
});

describe("map zones: what a click at a point does", () => {
  const zones = sceneZones(areas, ["OTHER.BM", "LABEL.BM"], program);
  const at = (x: number, y: number) => zoneAt(zones, areas, program, x, y, sprites);

  it("an area with a macro wins", () => {
    expect(at(190, 10)).toEqual({ zone: 0, silent: -1 });
  });
  it("an area without a macro does not stop the click: the sprite under it reacts, elsewhere nothing", () => {
    expect(at(50, 150)).toEqual({ zone: 2, silent: 1 });
    expect(at(10, 190)).toEqual({ zone: -1, silent: 1 });
  });
  it("a sprite without a macro and the empty map do nothing", () => {
    expect(at(250, 350)).toEqual({ zone: -1, silent: -1 });
    expect(at(250, 250)).toEqual({ zone: -1, silent: -1 });
  });
  it("Area_Contains quirk: the lower-left triangle of PORT reacts left of the box too (same as SC000D's HAFFEN)", () => {
    // first triangle (100,0)-(100,50)-(200,50): only 'below the line 1-2' (vertical) and 'below 2-3' are tested in its branch
    expect(at(150, 40).zone).toBe(0);
  });

  it("the hit grid encodes the reacting zone, SILENT + area, -1", () => {
    const g = hitGrid(300, 250, 10, at);
    expect([g.cols, g.rows]).toEqual([30, 25]);
    const cell = (x: number, y: number) => g.cells[(y / 10) * g.cols + x / 10];
    expect(cell(190, 10)).toBe(0); // PORT
    expect(cell(50, 150)).toBe(2); // the sprite behind CLUB
    expect(cell(10, 190)).toBe(SILENT + 1); // CLUB without a sprite behind
    expect(cell(250, 240)).toBe(-1);
    expect(hitGrid(25, 10, 10, at).cols).toBe(3); // a partial cell at the right edge
  });
});

describe("map zones: where a click leads (the macros run on a recording host)", () => {
  it("conditionValues: IF tests give the value, value + 1 and 0; IFF also value - 1", () => {
    expect([...conditionValues(program, "POKAZANIE-LABEL.BM")]).toEqual([
      ["LAST", [0, 32, 33]],
      ["ODJECHAL69", [0, 1]],
    ]);
    expect([...conditionValues(program, "POKAZANIE-OFFICE")]).toEqual([["LAST", [0, 39, 40, 41]]]);
    expect(conditionValues(program, "NONE").size).toBe(0);
  });

  it("runClick: the first GOTOSCENE and the changed variables (waits pass)", () => {
    expect(
      runClick(
        program,
        "POKAZANIE-PORT",
        new Map([
          ["LAST", 32],
          ["LOC5", 0],
        ]),
      ),
    ).toEqual({ scene: "SC075", changed: { LOC5: 1 } });
    expect(runClick(program, "POKAZANIE-PORT", new Map([["LAST", 32]])).changed).toEqual({}); // LOC5 not in VARIABLE.ALL: the write is dropped
    expect(
      runClick(
        program,
        "POKAZANIE-LABEL.BM",
        new Map([
          ["LAST", 32],
          ["ODJECHAL69", 1],
        ]),
      ),
    ).toEqual({ scene: "SC032B", changed: { LAST: 6 } });
    expect(runClick(program, "HOVER", new Map()).scene).toBeNull();
    // one command per tick: the first GOTOSCENE changes the scene before the next one runs
    const p = compileMcc(bytes("[POKAZANIE-X] GotoScene SC001 GotoScene SC002 DoNothing 2 GotoScene SC003"));
    expect(runClick(p, "POKAZANIE-X", new Map()).scene).toBe("SC001");
  });

  it("destinations: only the deciding variables are kept; the description names them", () => {
    const port = destinations(program, "POKAZANIE-PORT");
    expect(port.deciding).toEqual([]);
    expect(describeDestinations(port)).toBe("SC075 zawsze");

    const label = destinations(program, "POKAZANIE-LABEL.BM");
    expect(label.deciding).toEqual(["ODJECHAL69"]);
    expect(describeDestinations(label)).toBe("SC032 gdy ODJECHAL69 = 0; SC032B gdy ODJECHAL69 = 1");

    const office = destinations(program, "POKAZANIE-OFFICE");
    expect(describeDestinations(office)).toBe("zostaje na mapie gdy LAST ∈ {0, 39, 40}; SC100 gdy LAST = 41");
  });

  it("two deciding variables are listed as combinations", () => {
    const p = compileMcc(bytes("[POKAZANIE-X] If A 1 If B 1 GotoScene S1 EndIf EndIf"));
    const d = destinations(p, "POKAZANIE-X");
    expect(d.deciding).toEqual(["A", "B"]);
    expect(describeDestinations(d)).toBe(
      "zostaje na mapie gdy A = 0, B = 0 lub A = 0, B = 1 lub A = 0, B = 2 lub A = 1, B = 0 lub A = 1, B = 2 lub A = 2, B = 0 lub A = 2, B = 1 lub A = 2, B = 2; S1 gdy A = 1, B = 1",
    );
  });
});

describe("map zones: the page state and table", () => {
  const zones = sceneZones(areas, ["LABEL.BM"], program);
  it("stateControls: the deciding variables first, every tested value", () => {
    expect(stateControls(program, zones)).toEqual([
      { name: "ODJECHAL69", values: [0, 1], deciding: true },
      { name: "LAST", values: [0, 32, 33], deciding: false },
    ]);
  });
  it("zoneRows: the target now (with the switched variables it changes) and the rule; an area without a macro leads nowhere", () => {
    const rows = zoneRows(
      program,
      zones,
      new Map([
        ["LAST", 32],
        ["ODJECHAL69", 1],
      ]),
    );
    expect(rows.map((r) => [r.name, r.kind, r.macro, r.now, r.rule])).toEqual([
      ["PORT", "strefa .ACE", "POKAZANIE-PORT", "SC075", "SC075 zawsze"],
      ["CLUB", "strefa .ACE", "— brak —", "nic (klik idzie dalej, do sprite'ów)", "nigdzie"],
      [
        "LABEL.BM",
        "sprite",
        "POKAZANIE-LABEL.BM",
        "SC032B (LAST → 6)",
        "SC032 gdy ODJECHAL69 = 0; SC032B gdy ODJECHAL69 = 1",
      ],
    ]);
  });
});
