// Jack's walk: planning a walk after a click, starting a
// segment (direction, velocity) and the walk step.
// Positions are floats like the game's.
import { f32, findWalkTriangle, ftol, GAME_PI, iabs, jackScale, s16, type Point } from "./geometry";
import { findPath, type SearchOptions } from "./pathfind";
import { nearestWalkable, smoothPath, type SmoothStats, type WalkWorld } from "./smooth";

/** Walk speed (set to 12 when a scene starts, ; scripts may change it). */
export const WALK_SPEED = 12;
/** Vertical squash of the floor: angles use dy / 0.3, vertical speed is multiplied by 0.3. */
export const Y_SQUASH = f32(0.3);
/** Direction sector bounds in degrees (0 = right, 90 = down). */
export const DIR_BOUNDS = [22, 67, 112, 157, 202, 248, 292, 338];
/** "prev distance" marker / after a segment starts. */
const FAR = 10000;

/**
 * g_jackDir values and the animation they select (core.tsv);
 * `mirror` -1 flips the frames horizontally.
 */
export const DIR_TOWARDS = 0;
export const DIR_SIDE = 1;
export const DIR_AWAY = 2;
export const DIR_DIAG_DOWN = 3;
export const DIR_DIAG_UP = 4;

export interface Facing {
  dir: number;
  mirror: 1 | -1;
}

/** facing for a walk angle in whole degrees 0..359 (sectors `bounds`). */
export function facingForAngle(deg: number, bounds: readonly number[] = DIR_BOUNDS): Facing {
  const [t0, t1, t2, t3, t4, t5, t6, t7] = bounds;
  if (deg >= t0 && deg <= t1) return { dir: DIR_DIAG_DOWN, mirror: -1 };
  if (t1 < deg && deg < t2) return { dir: DIR_TOWARDS, mirror: 1 };
  if (deg >= t2 && deg <= t3) return { dir: DIR_DIAG_DOWN, mirror: 1 };
  if (deg >= t3 && deg <= t4) return { dir: DIR_SIDE, mirror: 1 };
  if (deg >= t4 && deg <= t5) return { dir: DIR_DIAG_UP, mirror: -1 };
  if (deg >= t5 && deg <= t6) return { dir: DIR_AWAY, mirror: 1 };
  if (deg >= t6 && deg <= t7) return { dir: DIR_DIAG_UP, mirror: 1 };
  return { dir: DIR_SIDE, mirror: -1 };
}

/** with the forced direction (set, value from a script). */
export function forcedFacing(v: number): Facing {
  switch (v) {
    case -3:
      return { dir: 3, mirror: -1 };
    case 0:
      return { dir: 0, mirror: 1 };
    case 3:
      return { dir: 3, mirror: 1 };
    case 1:
      return { dir: 1, mirror: 1 };
    case -4:
      return { dir: 4, mirror: -1 };
    case 2:
      return { dir: 2, mirror: 1 };
    case 4:
      return { dir: 4, mirror: 1 };
    default:
      return { dir: 1, mirror: -1 };
  }
}

/** Angle of travel from (x, y) to (tx, ty) as computed by, radians (float) and whole degrees. */
export function walkAngle(x: number, y: number, tx: number, ty: number): { rad: number; deg: number } {
  let rad = f32(Math.atan((ty - y) / Y_SQUASH / (tx - x)));
  if (tx < x) rad = f32(rad + GAME_PI);
  let deg = s16(ftol((rad * f32(180)) / GAME_PI));
  if (deg > 360) deg -= 360;
  if (deg < 0) deg += 360;
  return { rad, deg };
}

export interface Walker {
  /** position (floats) */
  x: number;
  y: number;
  /** g_jackScale */
  scale: number;
  dir: number;
  mirror: 1 | -1;
  walking: boolean;
  /** points; path[index] is the current segment target */
  path: Point[];
  index: number;
  target: Point;
  /** per-step velocity at scale 1 */
  vx: number;
  vy: number;
  prevDx: number;
  prevDy: number;
  /** step timer, decremented every logic tick */
  timer: number;
  /** forced facing, null = from the angle */
  forced: number | null;
  speed: number;
}

export function createWalker(x: number, y: number, world: WalkWorld, facing: Facing = { dir: 0, mirror: 1 }): Walker {
  return {
    x: f32(x),
    y: f32(y),
    scale: jackScale(world.perspective, f32(y)),
    dir: facing.dir,
    mirror: facing.mirror,
    walking: false,
    path: [],
    index: 0,
    target: { x: ftol(x), y: ftol(y) },
    vx: 0,
    vy: 0,
    prevDx: FAR,
    prevDy: FAR,
    timer: 0,
    forced: null,
    speed: WALK_SPEED,
  };
}

/**
 * (tx, ty): new segment target, facing and velocity. Returns true when the target
 * is already "reached" (|dx| < 15·scale and |dy| < 6·scale): Jack is put on it, keeps the old
 * facing and does not start walking.
 */
export function startSegment(w: Walker, t: Point): boolean {
  const old: Facing = { dir: w.dir, mirror: w.mirror };
  w.target = { x: t.x, y: t.y };
  const { rad, deg } = walkAngle(w.x, w.y, t.x, t.y);
  const f = w.forced === null ? facingForAngle(deg) : forcedFacing(w.forced);
  w.dir = f.dir;
  w.mirror = f.mirror;
  w.vx = f32(w.speed * Math.cos(rad));
  w.vy = f32(Math.sin(rad) * w.speed * Y_SQUASH);
  const dx = iabs(ftol(t.x - w.x));
  const dy = iabs(ftol(t.y - w.y));
  if (dx < f32(15) * w.scale && dy < f32(6) * w.scale) {
    w.prevDx = 0;
    w.prevDy = 0;
    w.x = f32(t.x);
    w.y = f32(t.y);
    w.dir = old.dir;
    w.mirror = old.mirror;
    return true;
  }
  w.prevDx = FAR;
  w.prevDy = FAR;
  w.walking = true;
  return false;
}

export interface WalkPlan {
  path: Point[];
  /** no path: Jack walks straight to the click */
  direct: boolean;
  /** Jack stood outside the walk area: path[0] is his position, path[1] the nearest walkable point */
  fromOutside: boolean;
}

/**
 * Click on (cx, cy) with the walk cursor (Game_Run ; the same logic is
 * for "walk to an object"). null = the click is ignored (outside the walk area)
 * or cancelled (target inside an object quad).
 */
export function planWalk(
  world: WalkWorld,
  from: { x: number; y: number },
  click: Point,
  opts: SearchOptions & { stats?: SmoothStats; /** WALKTO: a goal outside the area is not refused */ anyGoal?: boolean } = {},
): WalkPlan | null {
  if (!opts.anyGoal && findWalkTriangle(world.walk, click.x, click.y) < 0) return null;
  let start = { x: s16(ftol(from.x)), y: s16(ftol(from.y)) };
  let r = findPath(world.walk, start, click, opts);
  let fromOutside = false;
  if (!r.path.length) {
    const near = nearestWalkable(world.walk, start);
    fromOutside = true;
    if (near) {
      start = near;
      r = findPath(world.walk, start, click, opts);
    }
  }
  if (!r.path.length) return { path: [{ x: s16(ftol(from.x)), y: s16(ftol(from.y)) }, click], direct: true, fromOutside: false };
  const path = smoothPath(world, r.path, 1, opts.stats);
  if (!path.length) return null;
  if (fromOutside) path.unshift({ x: s16(ftol(from.x)), y: s16(ftol(from.y)) });
  return { path, direct: false, fromOutside };
}

/**
 * Starts following a plan: index 1, and one more point when the
 * first one is reached at once. A direct walk is one segment to the click with no path.
 */
export function followPlan(w: Walker, plan: WalkPlan): void {
  if (plan.direct) {
    w.path = [];
    w.index = 0;
    startSegment(w, plan.path[1]);
    return;
  }
  w.path = plan.path;
  w.index = 1;
  if (w.path.length > 1 && startSegment(w, w.path[1]) && w.index < w.path.length - 1) {
    w.index++;
    startSegment(w, w.path[w.index]);
  }
}

export interface StepEvent {
  /** walking ended on the last point this step */
  arrived: boolean;
  /** moved on to the next path point (no movement this step) */
  nextPoint: boolean;
}

/** One walk step. */
export function walkStep(w: Walker, world: WalkWorld): StepEvent {
  const ev: StepEvent = { arrived: false, nextPoint: false };
  const t = w.target;
  const curDx = s16(iabs(ftol(w.x - t.x)));
  const curDy = s16(iabs(ftol(w.y - t.y)));
  const nextDx = s16(iabs(ftol(w.vx * 4 * w.scale + w.x - t.x)));
  const nextDy = s16(iabs(ftol(w.vy * 4 * w.scale + w.y - t.y)));
  if (nextDx > w.prevDx || nextDy > w.prevDy) {
    if (w.index >= w.path.length - 1) {
      w.x = f32(t.x);
      w.y = f32(t.y);
      w.walking = false;
      ev.arrived = true;
    } else {
      w.index++;
      startSegment(w, w.path[w.index]);
      w.timer = 0;
      ev.nextPoint = true;
      return ev;
    }
  }
  w.prevDx = curDx;
  w.prevDy = curDy;
  w.scale = jackScale(world.perspective, w.y);
  if (w.walking) {
    w.x = f32(w.vx * w.scale + w.x);
    w.y = f32(w.vy * w.scale + w.y);
  }
  return ev;
}

/**
 * Ticks between walk steps. g_insFrameDelay is 4 in the data image and set to 5 before any scene,
 * then the WalkSpeed option (config byte +6) is subtracted, with a floor of 1.
 * A script flag keeps the delay at 4; walking to an object uses 2.
 */
export function stepTicks(walkSpeedOption: number, insFrameDelay = 5): number {
  return Math.max(1, insFrameDelay - walkSpeedOption);
}

/**
 * One logic tick (15 ms): the timer counts down and a step happens when it reaches 0.
 * After moving to the next path point the timer is 0, so the next step follows at once
 * (the game does it on the next frame).
 */
export function walkTick(w: Walker, world: WalkWorld, ticksPerStep = stepTicks(1)): StepEvent[] {
  const events: StepEvent[] = [];
  w.timer--;
  while (w.walking && w.timer <= 0) {
    w.timer = ticksPerStep;
    events.push(walkStep(w, world));
  }
  return events;
}

/**
 * Position shift at the end of a turn animation (anim index = 0..10, Game_Run
 *): x += dx·mirror·scale, y += dy·scale. The animations are 's.
 */
export const TURN_SHIFT: readonly [number, number][] = [
  [-40, 2],
  [-38, 14],
  [12, 25],
  [45, 10],
  [43, -6],
  [28, -23],
  [-26, -18],
  [-37, -13],
  [85, 0],
  [-50, -10],
  [50, 5],
];
