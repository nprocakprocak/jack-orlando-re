// CHKDISTANCE: Jack steps out of the way of a walking person (Jack_AvoidPerson).
// Pure logic, no DOM.
import { f32, ftol, s16, type Point } from "../walk/geometry";
import { findWalkTriangle } from "../walk/geometry";
import { objectAt, type WalkObject } from "../walk/objects";
import { followPlan, planWalk, type Walker } from "../walk/walker";
import type { WalkWorld } from "../walk/smooth";

/** Radius factor of the trigger: Jack's scale * 200. */
export const TRIGGER_RADIUS = 200;
/** Offset of the two sideways candidates: Jack's scale * 250. */
export const SIDE_STEP = 250;
/** The y delta of the trigger distance and of the perpendicular candidates is /3. */
export const Y_FACTOR = 3;

/** What the check reads about the person (fields of `Person`) at the call: position after the step. */
export interface AvoidPerson {
  /** float feet position */
  x: number;
  y: number;
  /** */
  scale: number;
  /** SETSHADOW offsets / (multiplied by the scale: the reference point is the shadow) */
  shadowDx: number;
  shadowDy: number;
  /** per-step velocity at scale 1: / (cos * speed, sin * speed * 0.3) */
  velX: number;
  velY: number;
}

export interface AvoidJack {
  x: number;
  y: number;
  /** g_jackScale */
  scale: number;
}

/** One of the four escape candidates (3 shorts at + 6 * i). */
export interface Candidate {
  x: number;
  y: number;
  /** the sort key: the distance to the person; the two side points use the constant 250 * scale */
  rank: number;
}

export type AvoidResult =
  | { kind: "none" }
  /** the person goes away from Jack: Jack_Stand(g_jackDir), the walk ends where he is */
  | { kind: "stand" }
  /** Jack_WalkTo(x, y) + flag = 1 (at most once per Jack walk) */
  | { kind: "walk"; target: Point; candidates: Candidate[] };

/** truncated distance with the y delta times 3. */
export function dist3(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = (by - ay) * Y_FACTOR;
  return s16(ftol(Math.sqrt(dx * dx + dy * dy)));
}

/** Geom_Dist: truncated Euclidean distance. */
export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return s16(ftol(Math.sqrt(dx * dx + dy * dy)));
}

/** Geom bubble sort: descending by rank, equal ranks keep their order. */
export function sortCandidates(c: Candidate[]): void {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) {
      if (c[j + 1].rank > c[j].rank) [c[j], c[j + 1]] = [c[j + 1], c[j]];
    }
  }
}

/**
 * The four candidate points, sorted: two points at distance
 * `radius` from Jack perpendicular to the person's step (y squashed by 3) and two points
 * 250 * scale to the left/right of Jack. Farthest from the person first.
 */
export function escapeCandidates(jack: AvoidJack, person: AvoidPerson, px: number, py: number): Candidate[] {
  const radius = f32(jack.scale * TRIGGER_RADIUS);
  const nz = (v: number): number => (v === 0 ? 1 : v);
  let ax = s16(ftol(-person.velY));
  let ay = s16(ftol(person.velX));
  ax = nz(ax);
  ay = nz(ay);
  const norm = f32(Math.sqrt(ax * ax + ay * ay));
  const mk = (cx: number, cy: number): Candidate => ({ x: cx, y: cy, rank: dist2(cx, cy, px, py) });
  const c0 = mk(s16(ftol((ax * radius) / norm + jack.x)), s16(ftol((ay * radius) / (norm * Y_FACTOR) + jack.y)));
  ax = nz(s16(ftol(person.velY)));
  ay = nz(s16(ftol(-person.velX)));
  const c1 = mk(s16(ftol((ax * radius) / norm + jack.x)), s16(ftol((ay * radius) / (norm * Y_FACTOR) + jack.y)));
  const side = ftol(f32(SIDE_STEP) * jack.scale);
  const c2: Candidate = {
    x: s16(ftol(jack.x - f32(SIDE_STEP) * jack.scale)),
    y: s16(ftol(jack.y)),
    rank: s16(side),
  };
  const c3: Candidate = {
    x: s16(ftol(f32(SIDE_STEP) * jack.scale + jack.x)),
    y: s16(ftol(jack.y)),
    rank: s16(side),
  };
  const out = [c0, c1, c2, c3];
  sortCandidates(out);
  return out;
}

/**
 * Jack_AvoidPerson(x, y, p): called after each step of a person with CHKDISTANCE (not while a
 * script locks the player) with the integer position `x, y` of the person (ftol of the floats).
 * `busy` is flag (an avoid walk is already under way).
 */
export function avoidPerson(
  jack: AvoidJack,
  person: AvoidPerson,
  world: { walk: readonly (readonly number[])[]; objects: readonly WalkObject[] },
  busy: boolean,
): AvoidResult {
  const x = s16(ftol(person.x));
  const y = s16(ftol(person.y));
  const dx = f32(person.shadowDx * person.scale);
  const dy = f32(person.shadowDy * person.scale);
  const radius = f32(jack.scale * TRIGGER_RADIUS);
  const jx = s16(ftol(jack.x));
  const jy = s16(ftol(jack.y));
  const px = s16(ftol(x + dx));
  const py = s16(ftol(y + dy));
  if (!(dist3(px, py, jx, jy) < radius) || busy) return { kind: "none" };
  const now = dist2(px, py, jx, jy);
  const next = dist2(s16(ftol(x + person.velX + dx)), s16(ftol(y + person.velY + dy)), jx, jy);
  if (now < next) return { kind: "stand" };
  const candidates = escapeCandidates(jack, person, px, py);
  for (const c of candidates) {
    if (objectAt(world.objects, c) >= 0) continue;
    if (findWalkTriangle(world.walk, c.x, c.y) < 0) continue;
    return { kind: "walk", target: { x: c.x, y: c.y }, candidates };
  }
  return { kind: "none" };
}

/**
 * Applies a "walk" result as Jack_WalkTo does (the same path as a click: planWalk + followPlan).
 * Returns false when the plan is cancelled; the caller still sets the busy flag in the original.
 */
export function startAvoidWalk(w: Walker, world: WalkWorld, target: Point): boolean {
  const plan = planWalk(world, w, target);
  if (!plan) return false;
  followPlan(w, plan);
  return true;
}

/** "stand": the walk ends in place (Jack_Stand: walking = 0); the rest of the path is dropped. */
export function applyStand(w: Walker): void {
  w.walking = false;
}
