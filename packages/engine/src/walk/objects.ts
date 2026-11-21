// Scene objects as walk obstacles: the floor quads ("footprints") from .CCG and the tests the
// walk code runs on them (Object_QuadContains, Object_FindAtPoint).
import type { Scene } from "../formats/scene";
import { f32, ftol, offLine, pointBelowLine, s16, type Point } from "./geometry";

export interface WalkObject {
  x: number;
  y: number;
  /** P0..P3 relative to (x, y): x0 y0 x1 y1 x2 y2 x3 y3 */
  quad: number[];
  /** diagonal intersection relative to (x, y) */
  center: number[];
  /** convex quad (g_sceneObjQuadValid) */
  valid: boolean;
}

/**
 * Objects the game keeps (g_sceneObjCount, [grafiki] + [elementy]). A missing centre (parallel
 * diagonals, FLX slots) is taken as (0, 0) — [hypothesis]: the game leaves the table entry as is.
 */
export function walkObjects(scene: Scene): WalkObject[] {
  return scene.ccg.objects.slice(0, scene.ccg.count).map((o) => ({
    x: o.x,
    y: o.y,
    quad: o.quad,
    center: o.center ?? [0, 0],
    valid: o.convex ?? false,
  }));
}

/** Corner k of the quad in scene coordinates (short sums as in the game). */
export function corner(o: WalkObject, k: number): Point {
  const i = (k & 3) * 2;
  return { x: s16(o.x + o.quad[i]), y: s16(o.y + o.quad[i + 1]) };
}

/** Object_QuadContains: on the inner side of all four edges. */
export function quadContains(o: WalkObject, p: Point): boolean {
  for (let k = 0; k < 4; k++) {
    const a = corner(o, k);
    const b = corner(o, k + 1);
    if (o.quad[k * 2] < o.quad[((k + 1) & 3) * 2]) {
      if (!pointBelowLine(p.x, p.y, a.x, a.y, b.x, b.y)) return false;
    } else if (pointBelowLine(p.x, p.y, b.x, b.y, a.x, a.y)) return false;
  }
  return true;
}

/** Object_FindAtPoint: first object with a valid quad containing p, or -1. */
export function objectAt(objs: readonly WalkObject[], p: Point): number {
  return objs.findIndex((o) => o.valid && quadContains(o, p));
}

/**
 * Geom_DiagonalsIntersect as a general line intersection (line a-b with line c-d):
 * y = k*x + b with float k, b; a vertical line gets dx + 1. null for parallel lines.
 */
export function lineIntersection(a: Point, b: Point, c: Point, d: Point): Point | null {
  let x2 = b.x;
  if (x2 === a.x) x2++;
  const k1 = f32((b.y - a.y) / (x2 - a.x));
  const b1 = f32(b.y - x2 * k1);
  let x3 = d.x;
  if (x3 === c.x) x3++;
  const k2 = f32((d.y - c.y) / (x3 - c.x));
  const b2 = f32(d.y - x3 * k2);
  if (k1 === k2) return null;
  const x = f32((b2 - b1) / (k1 - k2));
  const y = f32(k1 * x + b1);
  return { x: s16(ftol(x)), y: s16(ftol(y)) };
}

/**
 * a path end point inside object `o` is moved out: the quad edge whose line is
 * closest, the foot of the perpendicular from p onto it, then 5 px outwards on each
 * axis (sign from the edge direction).
 */
export function escapePoint(o: WalkObject, p: Point): Point {
  let best = 0;
  let bestD = 1000;
  for (let k = 0; k < 4; k++) {
    const d = offLine(p, corner(o, k), corner(o, k + 1));
    if (d < bestD) {
      best = k;
      bestD = d;
    }
  }
  const a = corner(o, best);
  const b = corner(o, best + 1);
  const dxE = s16(o.quad[((best + 1) & 3) * 2] - o.quad[best * 2]);
  const dyE = s16(o.quad[((best + 1) & 3) * 2 + 1] - o.quad[best * 2 + 1]);
  const foot = lineIntersection(p, { x: p.x - dyE, y: p.y + dxE }, a, b) ?? p;
  return { x: s16(foot.x - 5 + (dyE > 0 ? 10 : 0)), y: s16(foot.y - 5 + (dxE < 0 ? 10 : 0)) };
}

/**
 * crossing of path segment s-e with quad edge k (both as y = m*x + c lines with
 * float slopes, equal x nudged by 1), accepted when x lies in both x ranges (y is not checked).
 */
export function edgeCrossing(o: WalkObject, k: number, s: Point, e: Point): Point | null {
  const a = corner(o, k);
  const b = corner(o, k + 1);
  let bx = b.x;
  if (bx === a.x) bx = s16(bx + 1);
  const mE = f32((b.y - a.y) / (bx - a.x));
  const cE = f32(b.y - bx * mE);
  let ex = e.x;
  if (ex === s.x) ex = s16(ex + 1);
  const mS = f32((e.y - s.y) / (ex - s.x));
  const cS = f32(e.y - ex * mS);
  const x = f32((cS - cE) / (mE - mS));
  const y = f32(mE * x + cE);
  const [elo, ehi] = a.x < bx ? [a.x, bx] : [bx, a.x];
  const [slo, shi] = s.x < ex ? [s.x, ex] : [ex, s.x];
  if (!(x <= ehi && elo <= x && x <= shi && slo <= x)) return null;
  return { x: s16(ftol(x)), y: s16(ftol(y)) };
}
