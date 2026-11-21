// Drawing order of Jack against scene objects and persons, again after the walk step,
// and the click areas of .ACE.
import type { Area } from "../formats/scene";
import { insideTriangleSides, pointBelowLine, type Point } from "./geometry";
import { corner, type WalkObject } from "./objects";

export type DepthRelation = "behind" | "front" | null;

/**
 * Where Jack's feet (x, y truncated from his float position) are relative to an object's
 * floor quad. Objects with an invalid quad are not compared (null).
 * - every quad corner y >= y: behind;
 * - every quad corner y <= y: in front;
 * - otherwise above some left-to-right edge and not below any right-to-left one (*): behind; the opposite: in front; else unchanged.
 */
export function objectDepth(o: WalkObject, p: Point): DepthRelation {
  if (!o.valid) return null;
  const c = [0, 1, 2, 3].map((k) => corner(o, k));
  if (c.every((q) => q.y >= p.y)) return "behind";
  if (c.every((q) => q.y <= p.y)) return "front";
  const { above, below } = quadEdges(o, p.x, p.y);
  if (above && !below) return "behind";
  if (below && !above) return "front";
  return null;
}

/** Left-to-right edges set `above`, right-to-left edges set `below`. */
export function quadEdges(o: WalkObject, px: number, py: number): { above: boolean; below: boolean } {
  let above = false;
  let below = false;
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) & 3;
    const a = corner(o, k);
    const b = corner(o, n);
    if (o.quad[k * 2] < o.quad[n * 2] && !pointBelowLine(px, py, a.x, a.y, b.x, b.y)) above = true;
    if (o.quad[n * 2] < o.quad[k * 2] && pointBelowLine(px, py, b.x, b.y, a.x, a.y)) below = true;
  }
  return { above, below };
}

/** Another person: compared by the float y of the feet only. */
export function personDepth(jackY: number, personY: number): DepthRelation {
  if (jackY < personY) return "behind";
  if (jackY > personY) return "front";
  return null;
}

/**
 * The game does not sort: for every sprite overlapping Jack it moves Jack's sprite in the
 * sprite list just below ("behind") or just above ("front") that sprite when the order is
 * wrong (step by one slot). Applied here to a draw list of ids
 * (index = drawing order), returns the new list.
 */
export function reorderJack<T>(list: readonly T[], jack: T, other: T, rel: DepthRelation): T[] {
  const out = [...list];
  const j = out.indexOf(jack);
  const o = out.indexOf(other);
  if (j < 0 || o < 0 || rel === null) return out;
  if (rel === "behind" && o < j) {
    out.splice(j, 1);
    out.splice(o, 0, jack);
  } else if (rel === "front" && o > j) {
    out.splice(j, 1);
    out.splice(o, 0, jack);
  }
  return out;
}

/**
 * point in an .ACE area (any of its triangles, half-planes only — no bounding
 * box, unlike the walk area). The game also requires the area to be enabled (* — runtime state of scripts).
 */
export function areaContains(area: Area, p: Point): boolean {
  return area.triangles.some((t) => insideTriangleSides(t, p.x, p.y));
}

/**
 * with the walk cursor (modes 10..19): areas are scanned from the
 * last one down, only exits count. Returns the area index or -1. The click then
 * runs the macro "<cursor action>-<NAME>" (e.g. [POKAZANIE-LEWO]: WalkTo + GoToScene) — exits
 * are triggered by the click, not by Jack stepping into the zone.
 */
export function exitAt(areas: readonly Area[], p: Point): number {
  for (let i = areas.length - 1; i >= 0; i--) if (areas[i].exit && areaContains(areas[i], p)) return i;
  return -1;
}
