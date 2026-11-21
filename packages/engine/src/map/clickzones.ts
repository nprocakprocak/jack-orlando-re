// (approved deviation from the original): the click zones of the city map SC000D are exactly the rectangles in which
// its CZYxxx macros light the label. Pure logic, no DOM.
import type { Area } from "../formats/scene";
import type { Program } from "../script";
import type { Rect } from "./zones";

const IFF = 0x5b;

/** The hover macro of each place -> the click target it lights (area name, or the sprite name of STAD13.BM). */
export const HOVER_TARGETS: Readonly<Record<string, string>> = {
  CZYHAF: "HAFFEN",
  CZYJACK: "JACKH",
  CZYSTAD: "STAD13.BM",
};

/** The `.ACE` area the original used for the place that has no area macro (its click went through the sprite STAD13.BM). */
const SPRITE_PLACE_AREA = "COCL";

/**
 * The box of a hover macro: `IfF MOUSEX < a`, `IfF MOUSEX > b`, `IfF MOUSEY < c`, `IfF MOUSEY > d` (strict comparisons on
 * integer cursor points) -> the points b+1..a-1 x d+1..c-1. Returned as an inclusive pixel rectangle; null when the macro
 * has no complete box.
 */
export function hoverBox(program: Program, macro: string): Rect | null {
  const m = program.macros.find((mm) => mm.name === macro);
  if (!m) return null;
  let xMax: number | null = null,
    xMin: number | null = null,
    yMax: number | null = null,
    yMin: number | null = null;
  for (const c of program.commands.slice(m.start, m.start + m.count)) {
    if (c.code !== IFF) continue;
    const v = c.refs.find((r) => r[0] === 2 && r[1] === "var")?.[2];
    const lt = c.n2 === "<";
    if (v === "MOUSEX") {
      if (lt) xMax = c.a[0];
      else xMin = c.a[0];
    } else if (v === "MOUSEY") {
      if (lt) yMax = c.a[0];
      else yMin = c.a[0];
    }
  }
  if (xMax === null || xMin === null || yMax === null || yMin === null) return null;
  return { x0: xMin + 1, x1: xMax - 1, y0: yMin + 1, y1: yMax - 1 };
}

/**
 * Two triangles whose `Area_Contains` (the half-plane test of `insideTriangleSides`) hits exactly the integer points
 * of `r` (inclusive). The left vertices lie one pixel left and the bottom ones one lower (the original test is exclusive there); checked by brute force in the tests.
 */
export function rectTriangles(r: Rect): number[][] {
  // found by brute force: the side tests are exclusive on the left edge and at the bottom, inclusive on the right and at the top
  const x0 = r.x0 - 1,
    x1 = r.x1,
    y0 = r.y0,
    y1 = r.y1 + 1;
  return [
    [x0, y0, x0, y1, x1, y1],
    [x0, y0, x1, y1, x1, y0],
  ];
}

/**
 * The areas of the map with the click zones of the three places replaced by the hover rectangles. `HAFFEN` and `JACKH` keep
 * their name (macros `POKAZANIE-HAFFEN`, `POKAZANIE-JACKH`); the club place is the area `COCL` renamed to `STAD13.BM`, so that
 * the same click finds `POKAZANIE-STAD13.BM`. An area that is not one of the places is left as it was.
 */
export function mapClickAreas(areas: readonly Area[], program: Program): Area[] {
  const out: Area[] = areas.map((a) => ({ ...a }));
  for (const [macro, target] of Object.entries(HOVER_TARGETS)) {
    const box = hoverBox(program, macro);
    if (!box) continue;
    const from = target === "STAD13.BM" ? SPRITE_PLACE_AREA : target;
    const i = out.findIndex((a) => a.name === from);
    if (i < 0) continue;
    out[i] = { ...out[i], name: target, triangles: rectTriangles(box) };
  }
  return out;
}
