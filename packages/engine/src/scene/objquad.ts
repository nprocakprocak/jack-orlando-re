// The floor quad of an object follows the object: the depth and walk tests add g_sceneObjX/Y (set by SETPOSITIONE /
// MOVEE, Script_ExecStep case 0x2b) to the quad corners (Depth_AboveQuadEdge, Depth_BelowQuadEdge
//, Object_QuadContains), not the x/y from the .CCG.
import type { WalkObject } from "../walk/objects";

/** Moves the quad of object `index` (= its z) to the object's new position. Unknown index: nothing. */
export function moveObjectQuad(objects: readonly WalkObject[], index: number, x: number, y: number): void {
  const q = objects[index];
  if (!q) return;
  q.x = x;
  q.y = y;
}
