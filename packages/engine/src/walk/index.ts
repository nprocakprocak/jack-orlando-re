// Walking: path finding over the walk triangles, path smoothing around object quads, the walk
// step and Jack's facing, drawing order against objects. Pure logic, no DOM.
export * from "./depth";
export * from "./geometry";
export * from "./objects";
export * from "./pathfind";
export * from "./smooth";
export * from "./walker";

import type { Scene } from "../formats/scene";
import { f32 } from "./geometry";
import { walkObjects } from "./objects";
import type { WalkWorld } from "./smooth";

/** Walk data of a parsed scene; null for scenes without perspective. */
export function walkWorld(scene: Scene): WalkWorld | null {
  const p = scene.ccg.perspective;
  if (!p) return null;
  return {
    walk: scene.ccg.walk,
    objects: walkObjects(scene),
    perspective: { horizonY: p.horizonY, refY: p.refY, refScale: f32(p.refScale / 1e6) },
  };
}
