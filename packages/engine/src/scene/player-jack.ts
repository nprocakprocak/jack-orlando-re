// Jack walking, turning, idle, and insertions.

import {
  findInsertion,
  globalInsertion,
  idleChoice,
  WALK_FRAME_AFTER_STAND,
  type Facing,
  type IdleChoice,
  type JackDir,
  type JackPose,
  type JackUpdate,
  type ShadowSprite,
} from "../anim";
import { turnSequence, TurnPlayer } from "../anim/turn";
import { f32, facingForAngle, jackScale, planWalk, type WalkPlan } from "../walk";
import { followPlanTurning, turnTo } from "../walk/turn";
import { jackImage } from "./decode";
import type { ScenePlayerState } from "./player-state";
import { arrangeJack } from "./player-persons";
import { drawJackShadow } from "./player-shadow";

/** Game_Run: the idle check fires when `g_idleFrames > 1500` (`0x5dc`) */
export const IDLE_LIMIT = 1500;
/** Game_Run: the counter after an idle insertion; the next one comes 800 frames later */
export const IDLE_AFTER = 700;
/**
 * [engine; browser limit] `g_idleFrames` counts Game_Run frames, which the original caps at one per 2 timer ticks of 5 ms
 * (`Timer_WaitSinceFrameStart`) - 100 frames/s, so 1500 frames = 15 s. The browser runs one frame per
 * display refresh (60 Hz would make it 25 s), so the engine counts the frames of the capped original per 15 ms logic tick.
 */
export const IDLE_FRAMES_PER_TICK = 1.5;

/** The facing a STAY name stands for (g_jackDir / g_jackFacing; an unknown name is D). */
export function stayFacing(name: string): { dir: number; mirror: 1 | -1 } {
  switch (name) {
    case "L":
      return { dir: 1, mirror: 1 };
    case "R":
      return { dir: 1, mirror: -1 };
    case "U":
      return { dir: 2, mirror: 1 };
    case "LU":
      return { dir: 4, mirror: -1 };
    case "RU":
      return { dir: 4, mirror: 1 };
    case "LD":
      return { dir: 3, mirror: 1 };
    case "RD":
      return { dir: 3, mirror: -1 };
    default:
      return { dir: 0, mirror: 1 };
  }
}

/** Jack's pose from the walker (the walker owns position, direction and scale). */
export function pose(this: ScenePlayerState): JackPose {
    const w = this.walker;
    return { x: w.x, y: w.y, dir: w.dir as JackDir, facing: w.mirror, scale: w.scale };
}

// --- the demo's click (M1) --------------------------------------------------------------------

/**
 * Left click at world coordinates (screen + scroll). Returns true when Jack starts walking;
 * clicks outside the walk area, inside an object quad, or next to Jack are ignored
 * (planWalk / startSegment).
 */
export function click(this: ScenePlayerState, x: number, y: number): boolean {
    const plan = planWalk(this.world, this.walker, { x: Math.trunc(x), y: Math.trunc(y) });
    if (!plan) return false;
    return this.walkPlan(plan);
}

/** Starts following a plan; false when Jack is where he wants to be already. */
export function walkPlan(this: ScenePlayerState, plan: WalkPlan, forced: number | null = null): boolean {
    const wasWalking = this.walker.walking;
    this.walker.forced = forced;
    this.jackAvoiding = false;
    followPlanTurning(this.tj, plan);
    if (!this.walker.walking) return false;
    // Jack_WalkToPoint: a new walk clears g_turnMacroWaits, the macro of a running ROTATETO / STAY is never released
    this.turnFromScript = false;
    this.jackHidden = false;
    this.jack.walk();
    // the step timer is 0 after a click: the first step comes in the frame of the command (firstSteps)
    if (!wasWalking) {
      this.jack.delay = 0;
      this.jackFresh = true;
    }
    return true;
}

/**
 * WALKTO JACK x y: a goal outside the walk area gives no path; Jack walks straight to it. Returns false when there is
 * nothing to walk (already there, or the scene has no walk area).
 */
export function walkJackTo(this: ScenePlayerState, x: number, y: number, forcedDir: number | null = null): boolean {
    if (!this.hasWalkArea) return false;
    const t = { x: Math.trunc(x), y: Math.trunc(y) };
    // the goal is NOT moved into the area (Script_ExecStep case 6, Jack_WalkTo): Walk_FindPath
    // finds no path to a goal outside, Walk_NearestWalkable moves only the START, and the walk ends as a straight
    // line to the goal itself (Jack_WalkToPoint) - SC009 TO_IN walks on past the area's edge to the street
    const plan =
      planWalk(this.world, this.walker, t, { anyGoal: true }) ??
      ({ path: [{ x: Math.trunc(this.walker.x), y: Math.trunc(this.walker.y) }, t], direct: true, fromOutside: false } as WalkPlan);
    return this.walkPlan(plan, forcedDir);
}

// --- Jack: commands of the scripts ---------------------------------------------------------

/**
 * SETPOSITION JACK x y / MOVEP JACK dx dy (Script_ExecStep, cases 1 and 0x37): only g_jackX, g_jackY and the
 * scale change, nothing is drawn. Jack's sprite stays where it was until the next frame (insertion, walk step, STAY),
 * so between two insertions no standing frame - at the new scale, with the old noScale - shows up.
 */
export function setJackPosition(this: ScenePlayerState, x: number, y: number): void {
    const w = this.walker;
    w.x = f32(x);
    w.y = f32(y);
    w.walking = false;
    w.scale = this.fixedScale ?? jackScale(this.world.perspective, w.y);
}

/** SETPERSONDATA JACK n1 f n2 n3 */
export function setJackData(this: ScenePlayerState, frameDelay: number, f: number, refY: number, speed: number): void {
    this.jack.frameDelay = frameDelay;
    this.world.perspective.refY = refY;
    this.walker.speed = speed;
    if (f === 3) {
      this.fixedScale = this.walker.scale;
    } else {
      this.fixedScale = null;
      this.jack.noScale = f === 2;
      // Script_ExecStep case 3: f = 2 only sets g_jackNoScale; g_perspRefScale and g_jackScale stay as they were
      // (the shadows of the BOJKA insertions use g_jackScale, so it must not jump to 1)
      if (f !== 2) {
        this.world.perspective.refScale = f32(f);
        this.walker.scale = jackScale(this.world.perspective, this.walker.y);
      }
    }
}

/**
 * JACKTEMPO DATA / FREE (0x84, Game_Run): with DATA (= 1) Jack's step
 * delay is g_insFrameDelay alone, the WalkSpeed option is not subtracted - SC083 and SC084
 * (the gangster's route) use it, so Jack does not outrun the gangster. A new scene resets it.
 */
export function setJackTempoFixed(this: ScenePlayerState, fixed: boolean): void {
    this.jack.walkSpeed = fixed ? 0 : this.walkSpeedOption;
}

/**
 * `g_jackDir` / `g_jackFacing` are globals: only loading a save resets them, a scene change does not.
 * The next scene's first WALKTO therefore turns from the pose Jack left the previous scene in, not from the front.
 */
export function inheritFacing(this: ScenePlayerState, from: { dir: number; mirror: 1 | -1 }): void {
    this.walker.dir = from.dir;
    this.walker.mirror = from.mirror;
}

/** STAY / STAYDEF: Jack stands in his current direction. */
export function standJack(this: ScenePlayerState): void {
    this.jackShown = true;
    this.jackPlaced = true;
    cancelTurn.call(this);
    this.jackHidden = false;
    this.walker.walking = false;
    this.tj.moving = false;
    this.apply(this.jack.stand(this.pose()));
    arrangeJack.call(this);
}

/** HIDE JACK: Sprite_Remove of Jack and his shadows. */
export function hideJack(this: ScenePlayerState): void {
    cancelTurn.call(this);
    this.jackHidden = true;
    this.renderer.hide(this.jackId);
    for (const id of this.shadowIds) this.renderer.hide(id);
}

/** Jack_FaceTowards (noLift = 1): the facing for the walk angle from Jack to the point. */
function facingToward(this: ScenePlayerState, x: number, y: number): { dir: number; mirror: 1 | -1 } {
    const w = this.walker;
    const dx = x - w.x;
    const dy = (y - w.y) / 0.3;
    let deg = Math.trunc((Math.atan(dx === 0 ? (dy < 0 ? -1e9 : 1e9) : dy / dx) * 180) / Math.PI);
    if (dx < 0) deg += 180;
    deg = ((deg % 360) + 360) % 360;
    return facingForAngle(deg);
}

/**
 * WALKTO / WALKTODIR JACK (Script_ExecStep cases 6 and 0x16): while `g_jackShown` is still 0 the command first calls
 * `Jack_FaceTowards(target)` and sets the flag, so `Jack_WalkToPoint` finds the facing unchanged and plays no turn (* SC005B entered from SC011, SC005B INIT `WALKTO JACK 612 385`;).
 */
export function faceBeforeWalk(this: ScenePlayerState, x: number, y: number): void {
    if (this.jackShown) return;
    this.jackShown = true;
    const f = facingToward.call(this, x, y);
    this.walker.dir = f.dir;
    this.walker.mirror = f.mirror;
}

/**
 * LOOKTO / ROTATETO (Script_ExecStep cases 0x61 / 0x77): Jack_FaceTowards works out the facing from the point;
 * a walking Jack who keeps it just stands (Jack_Stand), otherwise Jack_TurnFromTo plays the on-the-spot turn from the old
 * facing to the new one. Returns true when a turn is running that ROTATETO waits for (its end is a `jackTurnEnded`
 * event); LOOKTO ignores it. A Jack who is not on the scene yet only takes the new facing.
 */
export function lookAt(this: ScenePlayerState, x: number, y: number, wait = true): boolean {
    // ROTATETO (case 0x76) does nothing while g_jackShown == 0; LOOKTO (case 0x60) is not gated
    if (wait && !this.jackShown) return false;
    const w = this.walker;
    const f = facingToward.call(this, x, y);
    if (this.jackHidden || !this.renderer.sprite(this.jackId)?.visible || this.jack.mode === "insertion") {
      w.dir = f.dir;
      w.mirror = f.mirror;
      return false;
    }
    const r = turnTo(this.tj, f);
    if (r.stand) {
      this.standJack();
      return false;
    }
    if (r.steps.length === 0) {
      if (this.jack.mode === "stand" && !this.tj.turn) this.standJack();
      return false;
    }
    // the walk is over: Jack keeps the pose of the last turn frame until something draws him again
    this.jack.mode = "stand";
    this.jack.walkFrame = WALK_FRAME_AFTER_STAND;
    // Jack_TurnFromTo clears g_turnMacroWaits; only ROTATETO sets it again
    this.turnFromScript = r.waits && wait;
    this.jack.delay = 0;
    this.jackFresh = true;
    return r.waits;
}

/**
 * STAY `name` (Script_Stay): `name` is a facing (L R U D LU RU LD RD). With `*` only the facing is set.
 * A Jack not on the scene yet is drawn standing. Otherwise the facing is taken without drawing and Jack_TurnFromTo plays the
 * turn from the old facing; a macro (not the call with 9999) waits for its end like for ROTATETO, the step
 * counter is zeroed. Without a turn Jack is drawn standing only if he was moving. Returns true when the macro waits.
 */
export function stayJack(this: ScenePlayerState, name: string, macro = true): boolean {
    const star = name.endsWith("*");
    const f = stayFacing(star ? name.slice(0, -1) : name);
    const w = this.walker;
    const old = { dir: w.dir, mirror: w.mirror };
    const shown = this.jackShown; // Script_Stay tests g_jackShown before sets it
    this.jackPlaced = true; // sets g_jackPlaced first, also for `*`
    w.dir = f.dir;
    w.mirror = f.mirror;
    this.jackShown = true;
    if (star) return false;
    if (!shown) {
      this.standJack();
      return false;
    }
    const moving = this.tj.moving;
    if (old.dir !== f.dir || old.mirror !== f.mirror) {
      w.walking = false;
      const steps = turnSequence(old.dir, old.mirror, f.dir, f.mirror, false);
      if (steps.length > 0) this.tj.turn = new TurnPlayer(steps, this.tj.uniform);
    }
    if (!this.tj.turn) {
      if (moving) this.standJack();
      return false;
    }
    this.turnFromScript = macro; // the idle check calls Script_Stay with 9999 (push 0x270f): no macro waits
    this.jack.mode = "stand";
    this.jack.walkFrame = WALK_FRAME_AFTER_STAND;
    this.jack.delay = 0;
    this.jackFresh = true;
    return macro;
}

/** One logic tick of the game counted for `g_idleFrames` (only while `g_logicFrozen == 0`; see `IDLE_FRAMES_PER_TICK`). */
export function idleCount(this: ScenePlayerState): void {
    this.idleFrames += IDLE_FRAMES_PER_TICK;
}

/**
 * Game_Run (just before): a mouse button held (`g_mouseLeftDown`, `g_mouseRight`), the mouse moved (`g_mouseX` = screen x + scroll,
 * so a scroll counts too) or a macro holding the player (`g_macroPlayerLocked`) zeroes the counter. Once per frame.
 */
export function idleInput(this: ScenePlayerState, active: boolean): void {
    if (active) this.idleFrames = 0;
}

/**
 * The idle check of Game_Run, once per frame after `idleInput`: past `IDLE_LIMIT` frames, outside a scene
 * without control (`g_sceneNoControl`) and while Jack is not turning, Jack gets the reaction of `idleChoice`. An insertion
 * (or nothing, in the uniform with dir 2 / facing -1 - unreachable) sets `g_jackIdleIns` and the counter to `IDLE_AFTER`;
 * `STAY LD`/`RD` (uniform) leaves the counter, so after the turn the next check sees the new pose (`dir 3` -> `MOW34`, the coin
 * toss in the uniform). Facing back (dir 2) is always facing 1 (all writers of `g_jackFacing`), so in the uniform it is `STAY LD`. Nothing looks at Jack being hidden, walking or in
 * an insertion. `random` is the C library's rand(), called only where the game calls it (civilian, dir 0 / 3); `gun` is `GUN`.
 */
export function idleCheck(this: ScenePlayerState, noControl: boolean, random: () => number, gun: () => number): IdleChoice | null {
    if (this.idleFrames <= IDLE_LIMIT || noControl || this.tj.turn) return null;
    const w = this.walker;
    const dir = w.dir as JackDir;
    const uniform = this.tj.uniform;
    const rand = !uniform && (dir === 0 || dir === 3) ? random() : 0;
    const c = idleChoice(dir, w.mirror, uniform, rand, !uniform && dir === 0 && rand % 2 === 0 ? gun() : 0);
    if (c?.stay) {
      this.stayJack(c.stay, false);
      return c;
    }
    this.idleIns = true;
    if (c?.section) this.startGlobalInsertion(c.section, c.facing as Facing, c.scaleMul);
    this.idleFrames = IDLE_AFTER;
    return c;
}

/** The running turn stops (STAY, HIDE, an insertion): a macro waiting for it is released at the next tick. */
function cancelTurn(this: ScenePlayerState): void {
    if (this.tj.turn && this.turnFromScript) this.turnEndedPending = true;
    this.tj.turn = null;
    this.turnFromScript = false;
}

/** RUNINSERTION JACK / INITFIRST JACK: scene insertion first, else GLOBAL.ICS. dir 0 right, 1 left, else as he looks. */
export function jackInsertion(this: ScenePlayerState, name: string, dir: number, count?: number): boolean {
    const facing = dir === 0 ? 1 : dir === 1 ? -1 : this.walker.mirror;
    const ins =
      findInsertion(this.insertions, name, facing) ??
      (this.globalIcs ? globalInsertion(this.globalIcs, name, facing) : null);
    if (!ins) return false;
    cancelTurn.call(this);
    this.tj.moving = false;
    this.jackHidden = false;
    this.walker.walking = false;
    this.jack.startInsertion(count === undefined ? ins : { ...ins, count: Math.min(count, ins.count) });
    // Script_ExecStep INITFIRST / RUNINSERTION: g_jackInsDelay = 0, so the first frame comes on the next
    // tick (Ins_StartGlobal alone waits a full delay) - no gap after a HIDE of the previous sprite
    if (!ins.global) {
      this.jack.delay = 0;
      this.jackFresh = true;
    }
    return true;
}

/**
 * A gesture of Jack (`Ins_StartGlobal`): a GLOBAL.ICS section with a full first delay. Unlike RUNINSERTION it
 * never looks at the scene's insertions. False when GLOBAL.ICS has no such section.
 */
export function startGlobalInsertion(this: ScenePlayerState, name: string, facing: 1 | -1, scaleMul = 1): boolean {
    const ins = this.globalIcs ? globalInsertion(this.globalIcs, name, facing, scaleMul) : null;
    if (!ins) return false;
    cancelTurn.call(this);
    this.tj.moving = false;
    this.jackHidden = false;
    this.walker.walking = false;
    this.jack.startInsertion(ins);
    return true;
}

export function apply(this: ScenePlayerState, u: JackUpdate): void {
    if (u.sprite) {
      const img = jackImage.call(this, u.sprite.source, u.sprite.file);
      this.renderer.set(this.jackId, u.sprite.x, u.sprite.y, img, u.sprite.mirrored ? -u.sprite.scale : u.sprite.scale);
    }
    u.shadows?.forEach((s: ShadowSprite | null | undefined, i) => {
      if (s === undefined) return;
      if (s === null) this.renderer.hide(this.shadowIds[i]);
      else drawJackShadow.call(this, i as 0 | 1, s);
    });
}
