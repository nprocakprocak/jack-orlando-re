// Turning in the walk: when Jack_WalkToPoint starts a turn, how the turn holds the walk
// step back, and what happens when it ends.
import { TurnPlayer, turnSequence, type TurnStep, type TurnTick } from "../anim/turn";
import type { Facing as Mirror } from "../anim/jack";
import { f32, jackScale, type Point } from "./geometry";
import type { WalkWorld } from "./smooth";
import { followPlanTail, startSegment, walkStep, type Facing, type StepEvent, type WalkPlan, type Walker } from "./walker";

/** A walker with the turn state of the original. */
export interface TurningJack {
  walker: Walker;
  /** running Turn_Start sequence; non-null = flag */
  turn: TurnPlayer | null;
  /** set by every walk segment, cleared by Jack_Stand / / LOOKTO / ROTATETO */
  moving: boolean;
  /**
 * on-the-spot frames even while walking. Set by POINTROTATE, and — saving the old value
 * in pointRotateSaved — by every click/walk whose path has more than 2 points (Jack_WalkTo,
 * Game_Run click); restored on arrival (Game_Run step code, last point) and by Script_InterruptOutMacros.
 */
  pointRotate: boolean;
  /** POINTROTATE value to restore */
  pointRotateSaved: boolean;
  /** g_jackUniform: on-the-spot frames (ROTW) even while walking */
  uniform: boolean;
  /** g_jackWalkFrame set by the end of a walking turn (0..10), null = untouched */
  walkFrame: number | null;
}

export function turningJack(walker: Walker, opts: { uniform?: boolean; pointRotate?: boolean } = {}): TurningJack {
  const pr = opts.pointRotate ?? false;
  return { walker, turn: null, moving: false, pointRotate: pr, pointRotateSaved: pr, uniform: opts.uniform ?? false, walkFrame: null };
}

/** POINTROTATE n (Script_ExecStep, opcode 0x6d): sets and. */
export function setPointRotate(tj: TurningJack, on: boolean): void {
  tj.pointRotate = on;
  tj.pointRotateSaved = on;
}

/** =: on arrival and in Script_InterruptOutMacros (a click). */
export function restorePointRotate(tj: TurningJack): void {
  tj.pointRotate = tj.pointRotateSaved;
}

/** bVar1: the turn uses the "while walking" frames. */
function walkingFrames(tj: TurningJack): boolean {
  return (tj.walker.walking || tj.moving) && !tj.pointRotate && !tj.uniform;
}

/**
 * Turn_Start: a non-empty sequence (re)starts the animation; an empty one leaves a
 * running animation alone (no rule matched, so is not called).
 */
function startTurn(tj: TurningJack, steps: TurnStep[]): void {
  if (steps.length > 0) tj.turn = new TurnPlayer(steps, tj.uniform);
}

/**
 * Jack_WalkToPoint with its turn: startSegment(), then — unless Jack is already there —
 * = 1 and the turn from the old to the new facing. Returns startSegment's "already there".
 */
export function startSegmentTurning(tj: TurningJack, t: Point): boolean {
  const w = tj.walker;
  const walking = walkingFrames(tj);
  const old: Facing = { dir: w.dir, mirror: w.mirror };
  if (startSegment(w, t)) return true;
  tj.moving = true;
  startTurn(tj, turnSequence(old.dir, old.mirror, w.dir, w.mirror, walking));
  return false;
}

/**
 * followPlan() with Jack_WalkToPoint's turn (the click, Game_Run ; Jack_WalkTo).
 * A path with more than 2 points forces on-the-spot turns for the whole walk (= 1), so
 * corners always play ROTP; the walking-turn frames are left for a 2-point or direct walk started
 * while Jack is already moving.
 */
export function followPlanTurning(tj: TurningJack, plan: WalkPlan): void {
  try {
    followPlanTurningInner(tj, plan);
  } finally {
    // WALKTODIR (Script_ExecStep case 0x16) sets g_walkDirForced only around its first Jack_WalkToPoint and clears it
    // right after; the call at the end of the turn animation and later points compute the facing from the
    // angle. SC033 LAST=63 forces 4 (right-up) for a walk to the left-up: the turn plays, then the facing becomes left-up.
    tj.walker.forced = null;
  }
}

function followPlanTurningInner(tj: TurningJack, plan: WalkPlan): void {
  const w = tj.walker;
  // both callers run Script_InterruptOutMacros first (=), then save and force
  restorePointRotate(tj);
  if (!plan.direct && plan.path.length > 2) {
    tj.pointRotateSaved = tj.pointRotate;
    tj.pointRotate = true;
  }
  followPlanTail(w, plan, (point) => startSegmentTurning(tj, point));
}

/**
 * Jack_TurnFromTo as LOOKTO / ROTATETO use it (Script_ExecStep, cases 0x61 / 0x77):
 * the caller has computed the new facing (the walk sectors). If Jack walks and the
 * facing is unchanged the script calls Jack_Stand instead ("stand"). Otherwise a change stops the
 * walk (g_jackWalking = 0) and plays the on-the-spot turn; is cleared either way.
 * `waits`: a turn is running, so ROTATETO (and STAY) holds its macro until it ends ; LOOKTO never waits.
 */
export function turnTo(tj: TurningJack, to: Facing): { stand: boolean; waits: boolean; steps: TurnStep[] } {
  const w = tj.walker;
  const changed = w.dir !== to.dir || w.mirror !== to.mirror;
  if (w.walking && !changed) return { stand: true, waits: false, steps: [] };
  const old: Facing = { dir: w.dir, mirror: w.mirror };
  w.dir = to.dir;
  w.mirror = to.mirror;
  let steps: TurnStep[] = [];
  if (changed) {
    w.walking = false;
    steps = turnSequence(old.dir, old.mirror, to.dir, to.mirror, false);
    startTurn(tj, steps);
  }
  tj.moving = false;
  return { stand: false, waits: tj.turn !== null, steps };
}

/** What one logic tick did. */
export interface TurningTick {
  walk: StepEvent[];
  turn: TurnTick | null;
  /** a walk segment started while ending the turn (Jack_WalkToPoint again) or at a path corner */
  turnStarted: boolean;
}

/** The turn branch of one tick. The walk does not step. Writes `out` and returns it. */
function tickTurn(tj: TurningJack, world: WalkWorld, out: TurningTick, ticksPerFrame: number): TurningTick {
  const w = tj.walker;
  if (w.timer > 0) return out;
  w.timer = ticksPerFrame;
  const r = tj.turn!.step(w.walking, w.scale);
  out.turn = r;
  if (r.ended) {
    if (r.ended.shift) {
      w.x = f32(w.x + w.scale * r.ended.shift.dx * r.ended.facing);
      w.y = f32(w.y + w.scale * r.ended.shift.dy);
    }
    if (r.ended.walkFrame !== null) tj.walkFrame = r.ended.walkFrame;
    w.scale = jackScale(world.perspective, w.y);
  }
  if (r.done) {
    tj.turn = null;
    // Jack_WalkToPoint(target) again — new velocity from the shifted position, maybe another turn
    if (w.walking) {
      startSegmentTurning(tj, w.target);
      // (after the call, `g_jackTurning = 0` unconditionally): a turn that this call starts is never played, only the
      // new facing stays; Jack walks on at once and no shift of that turn is applied (SC033 LAST=63)
      tj.turn = null;
      out.turnStarted = false;
    }
  }
  return out;
}

/** The walk branch of one tick, after the timer was decremented. Writes `out`. */
function tickWalk(tj: TurningJack, world: WalkWorld, out: TurningTick, ticksPerStep: number, standOnArrival: boolean): void {
  const w = tj.walker;
  while (w.walking && w.timer <= 0) {
    w.timer = ticksPerStep;
    const old: Facing = { dir: w.dir, mirror: w.mirror };
    const walking = walkingFrames(tj);
    const ev = walkStep(w, world);
    out.walk.push(ev);
    if (ev.nextPoint) {
      // walkStep ran startSegment for the next point ; add its turn
      if (w.dir !== old.dir || w.mirror !== old.mirror) {
        tj.moving = true;
        startTurn(tj, turnSequence(old.dir, old.mirror as Mirror, w.dir, w.mirror, walking));
        if (tj.turn) {
          out.turnStarted = true;
          break;
        }
      }
    }
    if (ev.arrived) {
      restorePointRotate(tj);
      if (standOnArrival) tj.moving = false;
    }
  }
}

/**
 * One logic tick (15 ms) of Jack's timer g_jackInsDelay (walker.timer): while a turn runs it gets
 * the timer and the walk does not step (Game_Run: the turn branch, else the step).
 * `ticksPerFrame` = turnFrameTicks(), `ticksPerStep` = stepTicks(). An insertion (g_jackInsActive)
 * blocks both — the caller does not call this then. `standOnArrival`: Game_Run calls Jack_Stand on
 * arrival unless a macro holds the player, which clears.
 */
export function turningTick(tj: TurningJack, world: WalkWorld, ticksPerStep: number, ticksPerFrame: number, standOnArrival = true): TurningTick {
  const w = tj.walker;
  const out: TurningTick = { walk: [], turn: null, turnStarted: false };
  w.timer--;
  if (tj.turn) return tickTurn(tj, world, out, ticksPerFrame);
  tickWalk(tj, world, out, ticksPerStep, standOnArrival);
  return out;
}
