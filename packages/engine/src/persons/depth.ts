// Drawing order of a person against Jack, other persons and scene objects (Game_Run
// after a walking step, after an insertion step). As for Jack
// the game does not sort: it moves the person's sprite below or above the other sprite when the
// order is wrong. Only persons with SETCHKPRIOR on (default) are arranged.
import { ftol } from "../walk/geometry";
import { quadEdges, type DepthRelation } from "../walk/depth";
import type { WalkObject } from "../walk/objects";

/** Another sprite as seen by the person's order check. */
export type DepthOther<T> =
  { id: T; kind: "jack" | "person"; y: number } | { id: T; kind: "object"; object: WalkObject };

/** Compares float y of the feet: smaller y = further away = behind. */
export function behindByY(selfY: number, otherY: number): DepthRelation {
  if (selfY < otherY) return "behind";
  if (selfY > otherY) return "front";
  return null;
}

/**
 * Person against an object quad: only the two edge tests (Depth_AboveQuadEdge,
 * Depth_BelowQuadEdge) — Jack's extra corner tests are not used.
 * Above a left-to-right edge and not below a right-to-left one: behind; the opposite: in front.
 */
export function personObjectDepth(o: WalkObject, x: number, y: number): DepthRelation {
  const px = ftol(x);
  const py = ftol(y);
  const { above, below } = quadEdges(o, px, py);
  if (above && !below) return "behind";
  if (below && !above) return "front";
  return null;
}

/**
 * Person against an object after an INSERTION frame (Game_Run, disasm;). Unlike the walking step this block
 * calls no edge test: it compares the float y of the feet with the y of quad corner 0 and corner 2 plus the object's y
 * (+ g_sceneObjY): corner 0 below the feet -> behind (Sprite_MoveBack when the person lies above);
 * then, with the indices taken before, corner 2 above the feet -> in front (Sprite_MoveFront when it lies below). An all-zero
 * .CCG quad (most furniture) thus compares with the object's own y: SC117 colonel (y 359) in front of the chair KRZESLO (247).
 * `behind` / `front` may both hold; the caller applies them with the starting order.
 */
export function personObjectDepthInsertion(o: WalkObject, y: number): { behind: boolean; front: boolean } {
  return { behind: o.y + o.quad[1] > y, front: o.y + o.quad[5] < y };
}

/**
 * Applies the person's order checks to a draw list (index = drawing order, last = on top).
 * `others` are checked in the given order against the list as modified so far; the person's sprite
 * moves to the other sprite's slot when it is on the wrong side (Sprite_MoveBack/MoveFront repeated
 * by the distance, so the other sprite shifts by one). Sprites that are not in the list are ignored.
 */
export function arrangePerson<T>(
  list: readonly T[],
  self: T,
  x: number,
  y: number,
  others: readonly DepthOther<T>[],
): T[] {
  const out = [...list];
  for (const o of others) {
    const rel = o.kind === "object" ? personObjectDepth(o.object, x, y) : behindByY(y, o.y);
    const i = out.indexOf(self);
    const j = out.indexOf(o.id);
    if (i < 0 || j < 0 || rel === null || o.id === self) continue;
    if ((rel === "behind" && j < i) || (rel === "front" && j > i)) {
      out.splice(i, 1);
      out.splice(j, 0, self);
    }
  }
  return out;
}
