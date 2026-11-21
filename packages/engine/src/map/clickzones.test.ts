// the click zones of the map = the hover rectangles of CZYxxx (synthetic script, no game files).
import { describe, expect, it } from "vitest";
import type { Area } from "../formats/scene";
import { AreaState, areaClick, areaReaction, type MacroPort } from "../areas";
import { compileMcc } from "../script";
import { insideTriangleSides } from "../walk/geometry";
import { hoverBox, mapClickAreas, rectTriangles } from "./clickzones";

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const box = (n: string, x0: number, x1: number, y0: number, y1: number) =>
  `[${n}] UnLock IfF MOUSEX < ${x1} IfF MOUSEX > ${x0} IfF MOUSEY < ${y1} IfF MOUSEY > ${y0} Anima L 0 3 3 0 - EndIf EndIf EndIf EndIf ActiveMacro CALL_${n} `;
const program = compileMcc(
  bytes(
    box("CZYHAF", 590, 770, 2, 75) +
      box("CZYJACK", 541, 641, 254, 314) +
      box("CZYSTAD", 238, 347, 123, 185) +
      "[POKAZANIE-HAFFEN] DoNothing 1 [POKAZANIE-JACKH] DoNothing 1 [POKAZANIE-STAD13.BM] DoNothing 1",
  ),
);
const tri = (x0: number, y0: number, x1: number, y1: number): number[][] => [
  [x0, y1, x0, y0, x1, y1],
  [x0, y0, x1, y1, x1, y0],
];
const areas: Area[] = [
  { name: "HAFFEN", exit: false, triangles: tri(591, 3, 769, 74) },
  { name: "JACKH", exit: false, triangles: tri(541, 254, 641, 314) },
  { name: "COCL", exit: false, triangles: tri(238, 123, 347, 185) },
];
const port: MacroPort = {
  exists: (n) => program.macros.some((m) => m.name === n),
  start: (n) => program.macros.findIndex((m) => m.name === n),
  interruptOutMacros: () => {},
};
const action = { verb: "POKAZANIE", item: null };

describe("hoverBox", () => {
  it("strict comparisons on integer points: MOUSEX > 590 and < 770 means 591..769", () => {
    expect(hoverBox(program, "CZYHAF")).toEqual({ x0: 591, x1: 769, y0: 3, y1: 74 });
    expect(hoverBox(program, "CZYSTAD")).toEqual({ x0: 239, x1: 346, y0: 124, y1: 184 });
  });
  it("null for a missing macro or an incomplete box", () => {
    expect(hoverBox(program, "NOPE")).toBeNull();
    expect(hoverBox(compileMcc(bytes("[CZYX] IfF MOUSEX < 5 EndIf")), "CZYX")).toBeNull();
  });
});

describe("rectTriangles hit exactly the rectangle (Area_Contains half-plane test)", () => {
  for (const r of [
    { x0: 11, x1: 19, y0: 101, y1: 129 },
    { x0: 0, x1: 0, y0: 5, y1: 5 },
    { x0: 239, x1: 346, y0: 124, y1: 184 },
    { x0: 591, x1: 769, y0: 3, y1: 74 },
  ]) {
    it(JSON.stringify(r), () => {
      const t = rectTriangles(r);
      const bad: string[] = [];
      for (let y = r.y0 - 3; y <= r.y1 + 3; y++)
        for (let x = r.x0 - 3; x <= r.x1 + 3; x++) {
          const want = x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
          if (t.some((tt) => insideTriangleSides(tt, x, y)) !== want) bad.push(`${x},${y}`);
        }
      expect(bad).toEqual([]);
    });
  }
});

describe("mapClickAreas: the click lands where the label lights", () => {
  const out = mapClickAreas(areas, program);
  const st = new AreaState();
  const click = (x: number, y: number) => areaClick(out, st, port, { x, y }, 0, action);
  const hand = (x: number, y: number) => areaReaction(out, st, port, { x, y }, 0, action);
  const places: [string, string, number, number, number, number][] = [
    ["HAFFEN", "POKAZANIE-HAFFEN", 591, 769, 3, 74],
    ["JACKH", "POKAZANIE-JACKH", 542, 640, 255, 313],
    ["STAD13.BM", "POKAZANIE-STAD13.BM", 239, 346, 124, 184],
  ];

  it("keeps the area count; COCL becomes the place STAD13.BM", () => {
    expect(out.map((a) => a.name)).toEqual(["HAFFEN", "JACKH", "STAD13.BM"]);
  });

  for (const [name, macro, x0, x1, y0, y1] of places) {
    it(`${name}: every corner runs ${macro} and lights the hand; one pixel outside does nothing`, () => {
      for (const [x, y] of [
        [x0, y0],
        [x1, y0],
        [x0, y1],
        [x1, y1],
        [(x0 + x1) >> 1, (y0 + y1) >> 1],
      ]) {
        expect(click(x, y).macro).toBe(macro);
        expect(hand(x, y)).toMatchObject({ over: true, exists: true, label: macro });
      }
      for (const [x, y] of [
        [x0 - 1, y0],
        [x1 + 1, y0],
        [x0, y0 - 1],
        [x1, y1 + 1],
        [x0 - 1, y1 + 1],
        [x1 + 1, y1 + 1],
      ]) {
        expect(click(x, y)).toMatchObject({ area: -1, handled: false, macro: null });
        expect(hand(x, y).over).toBe(false);
      }
    });
  }

  it("the original oddities are gone: the top strip and the empty left of the map do nothing", () => {
    for (const [x, y] of [
      [300, 40],
      [60, 30],
      [100, 100],
      [100, 400],
      [500, 400],
    ])
      expect(click(x, y).handled).toBe(false);
  });

  it("the lower-left half of the port box, dead in the original, now works", () => {
    expect(click(641, 28).macro).toBe("POKAZANIE-HAFFEN");
  });

  it("without the hover macros the areas stay as they were", () => {
    expect(mapClickAreas(areas, compileMcc(bytes("[X] DoNothing 1")))).toEqual(areas);
  });
});
