// Path post-processing and its helpers: dropping nearly collinear points,
// moving end points out of objects, detours around object quads, line-of-sight shortcuts.
// Also the nearest walkable point.
import {
  f32,
  findWalkTriangle,
  ftol,
  iabs,
  offLine,
  perspThird,
  s16,
  type Point,
  type WalkPerspective,
} from "./geometry";
import { corner, edgeCrossing, escapePoint, objectAt, type WalkObject } from "./objects";

type Tris = readonly (readonly number[])[];

/** 00503bac: a middle point closer than this to the line through its neighbours is dropped. */
export const NEAR_LINE = 6;
/** detour corners and entry/exit points are pushed out by 50 * Persp_ScaleAtY */
export const DETOUR_PUSH = 50;

export interface WalkWorld {
  walk: Tris;
  objects: readonly WalkObject[];
  perspective: WalkPerspective;
}

/**
 * nearest walkable point by rays from p in 16 directions (0, 23..., 345
 * degrees; x = sin, y = cos), 5 px steps, at most 200 steps; the first direction with the
 * fewest steps wins. null when no ray hits (the game then reads an uninitialised angle).
 */
export function nearestWalkable(walk: Tris, p: Point): Point | null {
  let bestR = 200;
  let bestA = -1;
  for (let a = 0; a < 360; a += 23) {
    const rad = (a * 3.141592) / 180;
    const sx = f32(Math.sin(rad) * 5);
    const sy = f32(Math.cos(rad) * 5);
    for (let r = 0; r < bestR; r++) {
      if (findWalkTriangle(walk, ftol(p.x + r * sx), ftol(p.y + r * sy)) >= 0) {
        bestR = r;
        bestA = a;
        break;
      }
    }
  }
  if (bestA < 0) return null;
  const rad = (bestA * 3.141592) / 180;
  const sx = f32(Math.sin(rad) * 5);
  const sy = f32(Math.cos(rad) * 5);
  return { x: s16(ftol(p.x + bestR * sx)), y: s16(ftol(p.y + bestR * sy)) };
}

/** repeatedly drops the first middle point within NEAR_LINE px of its neighbours' line. */
export function dropNearLine(path: Point[]): void {
  for (;;) {
    let i = 0;
    while (i < path.length - 2 && offLine(path[i + 1], path[i], path[i + 2]) >= NEAR_LINE) i++;
    if (i >= path.length - 2) return;
    path.splice(i + 1, 1);
  }
}

interface Entry {
  obj: number;
  edge: number;
  point: Point;
}

/**
 * crossing of segment i with any object quad edge (all objects, also those with
 * an invalid quad) nearest to path[i], skipping object `skip`; the entry point is pushed 50·s px
 * back towards path[i] in x and 50·s·|round(slope)| px in y.
 */
export function findEntry(world: WalkWorld, path: Point[], i: number, skip: number): Entry | null {
  let best = 2000;
  let res: Entry | null = null;
  world.objects.forEach((o, obj) => {
    for (let k = 0; k < 4; k++) {
      const c = edgeCrossing(o, k, path[i], path[i + 1]);
      if (!c || obj === skip) continue;
      const dx = path[i].x - c.x;
      const dy = path[i].y - c.y;
      const slope = f32(dy / dx);
      const d = ftol(Math.sqrt(dx * dx + dy * dy) + 0.5);
      if (d >= best) continue;
      const s = perspThird(world.perspective, c.y);
      const fx = f32(DETOUR_PUSH - (dx > 0 ? 100 : 0));
      const fy = f32(DETOUR_PUSH - (dy > 0 ? 100 : 0));
      const my = f32(iabs(ftol(slope + 0.5)) * fy);
      res = {
        obj,
        edge: k,
        point: { x: s16(ftol(f32(c.x) - s * fx + 0.5)), y: s16(ftol(f32(c.y) - s * my + 0.5)) },
      };
      best = s16(d);
    }
  });
  return res;
}

interface Exit {
  seg: number;
  edge: number;
  point: Point;
}

/**
 * first crossing of object `obj` on segments i, i+1... other than the entry
 * edge on segment i; the exit point is pushed 50·s px further along the segment.
 */
export function findExit(world: WalkWorld, path: Point[], i: number, obj: number, entryEdge: number): Exit | null {
  const o = world.objects[obj];
  for (let j = i; j < path.length - 1; j++) {
    for (let k = 0; k < 4; k++) {
      const c = edgeCrossing(o, k, path[j], path[j + 1]);
      if (!c || (j === i && k === entryEdge)) continue;
      const dx = s16(path[j].x - c.x);
      const dy = s16(path[j].y - c.y);
      const slope = f32(dy / dx);
      const s = perspThird(world.perspective, c.y);
      const fx = f32(DETOUR_PUSH - (dx > 0 ? 100 : 0));
      const my = f32(Math.imul(DETOUR_PUSH - (dy > 0 ? 100 : 0), iabs(ftol(slope))));
      return {
        seg: j,
        edge: k,
        point: { x: s16(ftol(f32(c.x) + s * fx)), y: s16(ftol(f32(c.y) + s * my)) },
      };
    }
  }
  return null;
}

/**
 * (forward = true: corners entryEdge+1 exitEdge) and (corners
 * entryEdge, entryEdge-1 exitEdge+1): entry, the corners pushed away from the quad centre
 * by 50·s px, exit. Cost = running truncated length + 2000 per point outside the walk area.
 */
export function detourAround(
  world: WalkWorld,
  obj: number,
  entryEdge: number,
  exitEdge: number,
  entry: Point,
  exit: Point,
  forward: boolean,
): { points: Point[]; cost: number } {
  const o = world.objects[obj];
  const cx = o.x + o.center[0];
  const cy = o.y + o.center[1];
  const points = [entry];
  const stop = forward ? exitEdge : (exitEdge + 1) & 3;
  for (let j = 0; ; j++) {
    const k = forward ? (entryEdge + 1 + j) & 3 : (entryEdge - j + 4) & 3;
    const c = corner(o, k);
    const dX = c.x - cx;
    const dY = c.y - cy;
    const len = ftol(Math.sqrt(dX * dX + dY * dY) + 0.5);
    const s = perspThird(world.perspective, c.y);
    points.push({
      x: s16(ftol((s * f32(dX * DETOUR_PUSH)) / len + f32(c.x))),
      y: s16(ftol((s * f32(dY * DETOUR_PUSH)) / len + f32(c.y))),
    });
    if (k === stop) break;
  }
  points.push(exit);
  let cost = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const dx = points[i + 1].x - points[i].x;
    const dy = points[i + 1].y - points[i].y;
    cost = ftol(Math.sqrt(dx * dx + dy * dy) + cost);
    if (findWalkTriangle(world.walk, points[i + 1].x, points[i + 1].y) < 0) cost = (cost + 2000) | 0;
  }
  return { points, cost };
}

/** points every 4 px from a (not including b) are outside objects and inside the walk area. */
export function segmentClear(world: WalkWorld, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = ftol(Math.sqrt(dx * dx + dy * dy));
  const sx = f32((dx * 4) / len);
  const sy = f32((dy * 4) / len);
  const n = s16(Math.trunc(len / 4));
  for (let k = 0; k < n; k++) {
    const p = { x: ftol(a.x + k * sx), y: ftol(a.y + k * sy) };
    if (objectAt(world.objects, p) >= 0) return false;
    if (findWalkTriangle(world.walk, p.x, p.y) < 0) return false;
  }
  return true;
}

export interface SmoothStats {
  /** detours inserted around object quads */
  detours: number;
  /** detours around objects whose quad is not valid (not convex — usually all zeros) */
  invalidQuadDetours: number;
  /** crossings without an exit: the game would read uninitialised variables; skipped here */
  noExit: number;
  /** points removed by line-of-sight shortcuts */
  shortcuts: number;
}

/**
 * (mode). mode 1 (click in Game_Run): a target inside an object
 * quad cancels the walk (returns []); mode 0 (other callers): the target is moved out of the
 * quad and the original target is appended again at the end.
 */
export function smoothPath(world: WalkWorld, input: readonly Point[], mode: 0 | 1, stats?: SmoothStats): Point[] {
  const path = input.map((p) => ({ ...p }));
  if (!path.length) return path;
  dropNearLine(path);
  const startObj = objectAt(world.objects, path[0]);
  const start = path[0];
  if (startObj >= 0) path[0] = escapePoint(world.objects[startObj], path[0]);
  const last = path.length - 1;
  const endObj = objectAt(world.objects, path[last]);
  const end = path[last];
  if (endObj >= 0) {
    if (mode === 1) return [];
    path[last] = escapePoint(world.objects[endObj], path[last]);
  }
  let skip = -1;
  for (let i = 0; i < path.length - 1; i++) {
    const e = findEntry(world, path, i, skip);
    if (!e) continue;
    const x = findExit(world, path, i, e.obj, e.edge);
    if (!x) {
      if (stats) stats.noExit++;
      continue;
    }
    const fwd = detourAround(world, e.obj, e.edge, x.edge, e.point, x.point, true);
    const back = detourAround(world, e.obj, e.edge, x.edge, e.point, x.point, false);
    const list = fwd.cost < back.cost ? fwd.points : back.points;
    skip = e.obj;
    path.splice(i + 1, x.seg - i, ...list);
    if (stats) {
      stats.detours++;
      if (!world.objects[e.obj].valid) stats.invalidQuadDetours++;
    }
    i += list.length - 1;
  }
  for (let a = 0; a < path.length - 2; a++) {
    let b = a;
    while (b < path.length - 2) {
      if (segmentClear(world, path[a], path[b + 2])) {
        path.splice(a + 1, b - a + 1);
        if (stats) stats.shortcuts += b - a + 1;
        b = a;
      } else b++;
    }
  }
  if (startObj >= 0) path.unshift(start);
  if (endObj >= 0) path.push(end);
  return path;
}
