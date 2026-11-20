// Jack's turning animation: which frames, in what order, how long, and what happens at the end.
// No DOM; the walk side (when a turn starts) is walk/turn.ts.
import { pad2 } from "../core/pad";
import type { HotSpot } from "../formats/global";
import { f32, ftol, type Facing } from "./jack";

/**
 * Turn animations (index): 0..10 turn while walking (OBPL/PROPRO/OBPLBF/OBPLFB),
 * 13..20 turn on the spot (ROTP, ROTW in uniform). 11 and 12 are never started.
 * Frames and hot spots are loaded by Jack_LoadWalkFrames / Jack_LoadWalkFramesUniform.
 */
export type TurnAnim = number;

/** One entry of the sequence passed to Turn_Start: (anim, first frame, mirror of the frames). */
export interface TurnStep {
  anim: TurnAnim;
  frame: number;
  facing: Facing;
}

/** Frames after which an animation ends while g_jackWalking is set — 15 and 16 are cut short. */
export const TURN_FRAMES_WALKING = [4, 4, 4, 4, 4, 4, 4, 4, 8, 8, 8, 8, 8, 4, 4, 2, 3, 4, 4, 4, 4] as const;
/** The same when Jack is not walking: LOOKTO / ROTATETO / STAY. */
export const TURN_FRAMES_STANDING = [4, 4, 4, 4, 4, 4, 4, 4, 8, 8, 8, 8, 8, 4, 4, 4, 4, 4, 4, 4, 4] as const;

/**
 * Per-frame size factor of the turn frames: g_jackScale · this, clamped to 1 by
 * (table pointer =, in uniform ; 8 floats per animation, 4 used except 8..10).
 */
export const TURN_SCALE: readonly (readonly number[])[] = [
  [1, 1, 1, 1],
  [1, 1.02, 1.04, 1.08],
  [1.05, 1.06, 1.07, 1.08],
  [1.02, 1.03, 1.04, 1.05],
  [1, 1, 1, 1],
  [1.02, 1.02, 1.02, 1.02],
  [1.045, 1.02, 1, 0.98],
  [1, 0.99, 0.98, 0.97],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [1, 1, 1, 1],
  [0.98, 0.98, 0.975, 0.97],
  [0.97, 0.98, 0.975, 0.97],
  [0.977, 0.977, 0.977, 0.977],
  [0.985, 0.987, 0.99, 0.99],
  [0.99, 0.98, 0.97, 0.97],
  [0.97, 0.98, 0.99, 1],
  [1, 1, 1, 1],
].map((r) => r.map((v) => f32(v)));

/** Uniform: only the on-the-spot animations differ in use (13..20). */
export const TURN_SCALE_UNIFORM: readonly (readonly number[])[] = [
  ...TURN_SCALE.slice(0, 13),
  [0.98, 0.98, 0.985, 0.99],
  [0.98, 0.98, 0.975, 0.97],
  [0.96, 0.955, 0.95, 0.945],
  [0.98, 0.98, 0.98, 0.98],
  [1, 1, 1, 1],
  [0.97, 0.97, 0.97, 0.97],
  [0.97, 0.977, 0.98, 0.99],
  [0.98, 0.976, 0.976, 1],
].map((r) => r.map((v) => f32(v)));

/** Frame delay multiplier: the counter is reloaded with ftol(g_insFrameDelay · 1.3 − WalkSpeed). */
export const TURN_DELAY_MUL = 1.3;

/**
 * Logic ticks per turn frame: ftol(insFrameDelay · 1.3) − WalkSpeed
 * (the subtraction is done on the FPU before truncation), at least 1; with JACKTEMPO
 * ftol(insFrameDelay · 1.3) without the option and without the minimum. Default 5 → 5 ticks (75 ms).
 */
export function turnFrameTicks(walkSpeedOption: number, insFrameDelay = 5, jackTempo = false): number {
  const base = insFrameDelay * TURN_DELAY_MUL;
  if (jackTempo) return ftol(base);
  return Math.max(1, ftol(base - walkSpeedOption));
}

/**
 * Position shift applied when a walking turn (0..10) ends, Game_Run switch:
 * x += dx·facing·scale, y += dy·scale (facing of the turn step), and the next walk frame.
 * walkFrame null = "9, or 3 when facing is −1" (cases 1 and 5).
 */
export const TURN_END: readonly { dx: number; dy: number; walkFrame: number | null }[] = [
  { dx: -40, dy: 2, walkFrame: 3 },
  { dx: -38, dy: 14, walkFrame: null },
  { dx: 12, dy: 25, walkFrame: 9 },
  { dx: 45, dy: 10, walkFrame: 9 },
  { dx: 43, dy: -6, walkFrame: 3 },
  { dx: 28, dy: -23, walkFrame: null },
  { dx: -26, dy: -18, walkFrame: 9 },
  { dx: -37, dy: -13, walkFrame: 3 },
  { dx: 85, dy: 0, walkFrame: 6 },
  { dx: -50, dy: -10, walkFrame: 0 },
  { dx: 50, dy: 5, walkFrame: 0 },
];

export function turnEndWalkFrame(anim: TurnAnim, facing: Facing): number | null {
  const e = TURN_END[anim];
  if (!e) return null;
  return e.walkFrame ?? (facing === -1 ? 3 : 9);
}

/**
 * Number 1..17 of the ROTP/ROTW/SHROT image for an on-the-spot frame. 13..16 run backwards
 * (13: 16..13, 14: 12..9, 15: 8..5, 16: 4..1), 17..20 forwards (17: 2..5 20: 14..17);
 * 1 = facing the player, 9 = profile, 17 = back (Jack_LoadWalkFrames, loops).
 */
export function rotNumber(anim: TurnAnim, frame: number): number {
  if (anim >= 13 && anim <= 16) return 16 - 4 * (anim - 13) - frame;
  if (anim >= 17 && anim <= 20) return 2 + 4 * (anim - 17) + frame;
  throw new RangeError(`anim ${anim} is not an on-the-spot turn`);
}

/** RESOURCE.PAK image of a turn frame. */
export function turnFrameFile(anim: TurnAnim, frame: number, uniform = false): string {
  if (anim >= 0 && anim <= 7) return `OBPL${pad2(anim * 4 + frame + 1)}.PBM`;
  if (anim === 8) return `PROPRO${frame + 1}.PBM`;
  if (anim === 9) return `OBPLBF${frame + 1}.PBM`;
  if (anim === 10) return `OBPLFB${frame + 1}.PBM`;
  return `${uniform ? "ROTW" : "ROTP"}${pad2(rotNumber(anim, frame))}.PBM`;
}

/** Hot spot table and entry of a turn frame (+ anim·0x30 + frame·6: xRight, xLeft, y). */
export function turnHotSpotRef(anim: TurnAnim, frame: number, uniform = false): { file: string; index: number } {
  if (anim >= 0 && anim <= 7) return { file: `OBPL_${anim}.SFB`, index: frame };
  if (anim === 8) return { file: "PROPRO.SFB", index: frame };
  if (anim === 9) return { file: "OBPLBF.SFB", index: frame };
  if (anim === 10) return { file: "OBPLFB.SFB", index: frame };
  return { file: uniform ? "ROTW.SFB" : "ROTP.SFB", index: rotNumber(anim, frame) - 1 };
}

/** Shadow image of an on-the-spot frame (SHROT01..17 loaded by Game_Main). */
export function turnShadowFile(anim: TurnAnim, frame: number): string {
  return `SHROT${pad2(rotNumber(anim, frame))}.PBM`;
}

/**
 * Shadow anchor offsets used while turning. Walking turns:
 * x ± [anim][frame]·s, y + [anim][frame]·s (sign of x = turn facing), drawn with
 * the walk direction/facing and "still" frame 3 (6 for anim 8). On-the-spot turns: y + [anim]·s
 * and x ± byte [anim] — an index into zeroed memory, so 0 (see).
 */
export const TURN_SHADOW_DX: readonly (readonly number[])[] = [
  [-7, -18, -35, -47],
  [-8, -16, -30, -36],
  [2, 4, 7, 10],
  [10, 20, 30, 40],
  [10, 20, 30, 40],
  [6, 12, 18, 22],
  [-4, -9, -17, -22],
  [-9, -18, -25, -30],
  [15, 20, 44, 55, 75, 85, 80, 75],
  [-5, -10, -18, -22, -30, -38, -45, -50],
  [5, 10, 18, 22, 30, 38, 45, 50],
];
export const TURN_SHADOW_DY: readonly (readonly number[])[] = [
  [0, 0, 0, 0],
  [1, 3, 5, 7],
  [5, 10, 15, 20],
  [2, 4, 6, 8],
  [-1, -2, -3, -4],
  [-5, -10, -10, -15],
  [-4, -8, -12, -14],
  [-3, -6, -8, -10],
  [0, -1, -2, -2, -2, -2, -2, -1],
  [0, -8, -15, -22, -27, -20, -17, -10],
  [8, 14, 18, 23, 25, 19, 11, 5],
];
/** + anim for anims 13..20. */
export const ROT_SHADOW_DY = [0, 0, 10, 12, 12, 10, 0, 0] as const;

/** Jack_DrawShadow arguments while a turn frame is shown. */
export interface TurnShadow {
  /** "walk": like a still walk shadow (dir/facing of the walk, frame 3 or 6); "rot": SHROT image */
  kind: "walk" | "rot";
  x: number;
  y: number;
  /** "walk": param_6 (3, or 6 for PROPRO); "rot": the SHROT image */
  frame: number;
  file: string | null;
  /** "rot": facing passed as param_2 (the turn step's), dir 0 */
  facing: Facing;
}

export function turnShadow(anim: TurnAnim, frame: number, facing: Facing, x: number, y: number, scale: number): TurnShadow | null {
  if (anim < 11) {
    const dx = TURN_SHADOW_DX[anim][frame] ?? 0;
    const dy = TURN_SHADOW_DY[anim][frame] ?? 0;
    return {
      kind: "walk",
      x: ftol(f32(x + facing * dx * scale)),
      y: ftol(f32(dy * scale + y)),
      frame: anim === 8 ? 6 : 3,
      file: null,
      facing,
    };
  }
  if (anim >= 13 && anim <= 20) {
    return { kind: "rot", x: ftol(x), y: ftol(f32(ROT_SHADOW_DY[anim - 13] * scale + y)), frame, file: turnShadowFile(anim, frame), facing };
  }
  return null;
}

/** What to draw for one turn frame (with g_jackSprite). */
export interface TurnFrame {
  anim: TurnAnim;
  frame: number;
  facing: Facing;
  file: string;
  hotSpot: { file: string; index: number };
  /** g_jackScale · TURN_SCALE, clamped to 1 */
  scale: number;
}

/** Top-left corner like the walk frames: ftol(x − hot·s), ftol(y − hotY·s); hot X by facing. */
export function placeTurnFrame(x: number, y: number, hot: HotSpot, facing: Facing, scale: number): [number, number] {
  const hx = facing === 1 ? hot[0] : hot[1];
  return [ftol(f32(x - hx * scale)), ftol(f32(y - hot[2] * scale))];
}

/**
 * Turn_Start rule tables, shared by Jack_WalkToPoint (when the walk direction
 * changes) and Jack_TurnFromTo (LOOKTO, ROTATETO, STAY). Every `if` is tested and each
 * matching one restarts the sequence, so the LAST matching rule wins. `walking` = the "turn while
 * walking" frames (bVar1); is always called with 0 → on the spot.
 * Facing values: `n` = new facing, `o` = old facing, `-n`/`-o` negated, `1`/`-1` literal.
 */
type F = "n" | "o" | "-n" | "-o" | 1 | -1;
interface Rule {
  from: number;
  to: number;
  /** product old·new facing required, if any */
  prod?: 1 | -1;
  /** old/new facing required (for 1 → 1) */
  oldF?: Facing;
  newF?: Facing;
  /** sequence when turning on the spot / while walking; one array = same for both */
  spot: [number, F][];
  walk?: [number, F][];
}

const RULES: Rule[] = [
  { from: 0, to: 1, spot: [[17, "n"], [18, "n"]], walk: [[2, "-n"], [3, "-n"]] },
  { from: 2, to: 1, spot: [[13, "n"], [14, "n"]], walk: [[6, "n"], [7, "n"]] },
  { from: 1, to: 2, spot: [[19, "o"], [20, "o"]], walk: [[4, "-o"], [5, "-o"]] },
  { from: 1, to: 0, spot: [[15, "o"], [16, "o"]], walk: [[0, "o"], [1, "o"]] },
  { from: 4, to: 4, prod: -1, spot: [[20, "n"], [13, "o"]], walk: [[5, "o"], [6, "o"]] },
  { from: 3, to: 4, prod: -1, spot: [[18, "-n"], [19, "-n"]], walk: [[3, "n"], [4, "n"]] },
  { from: 4, to: 3, prod: -1, spot: [[14, "n"], [15, "n"]], walk: [[7, "n"], [0, "n"]] },
  { from: 3, to: 3, prod: -1, spot: [[16, "o"], [17, "n"]], walk: [[1, "o"], [2, "o"]] },
  { from: 1, to: 3, spot: [[15, "n"]], walk: [[0, "n"]] },
  { from: 3, to: 0, spot: [[16, "o"]], walk: [[1, "o"]] },
  { from: 0, to: 3, spot: [[17, "n"]], walk: [[2, "-n"]] },
  { from: 3, to: 1, spot: [[18, "n"]], walk: [[3, "-n"]] },
  { from: 1, to: 4, spot: [[19, "-n"]], walk: [[4, "n"]] },
  { from: 4, to: 2, spot: [[20, "-o"]], walk: [[5, "o"]] },
  { from: 2, to: 4, spot: [[13, "-n"]], walk: [[6, "-n"]] },
  // requires prod −1 here, does not; a later rule covers prod +1 in both, so same result
  { from: 4, to: 1, spot: [[14, "n"]], walk: [[7, "n"]] },
  { from: 1, to: 1, oldF: 1, newF: -1, spot: [[15, 1], [16, 1], [17, -1], [18, -1]], walk: [[8, -1]] },
  { from: 1, to: 1, oldF: -1, newF: 1, spot: [[19, -1], [20, -1], [13, 1], [14, 1]], walk: [[8, 1]] },
  { from: 0, to: 2, spot: [[17, 1], [18, 1], [19, 1], [20, 1]], walk: [[10, 1]] },
  { from: 2, to: 0, spot: [[13, 1], [14, 1], [15, 1], [16, 1]], walk: [[9, 1]] },
  // from here on the same frames whether walking or not
  { from: 4, to: 3, prod: 1, spot: [[20, "-n"], [13, "n"], [14, "n"], [15, "n"]] },
  // passes 0xcc (204) as the count when walking; Turn_Start subtracts 200 — same 4 steps
  { from: 3, to: 4, prod: 1, spot: [[16, "n"], [17, "-n"], [18, "-n"], [19, "-n"]] },
  { from: 1, to: 4, prod: 1, spot: [[19, "n"], [20, "n"], [13, "-n"]] },
  { from: 1, to: 3, prod: -1, spot: [[15, "o"], [16, "o"], [17, "n"]] },
  { from: 0, to: 4, spot: [[17, "-n"], [18, "-n"], [19, "-n"]] },
  { from: 2, to: 3, spot: [[13, "n"], [14, "n"], [15, "n"]] },
  { from: 3, to: 2, spot: [[18, "o"], [19, "o"], [20, "o"]] },
  { from: 3, to: 1, prod: -1, spot: [[16, "-n"], [17, "n"], [18, "n"]] },
  { from: 4, to: 1, prod: 1, spot: [[20, "-n"], [13, "n"], [14, "n"]] },
  { from: 4, to: 0, spot: [[14, "-o"], [15, "-o"], [16, "-o"]] },
];

function resolve(f: F, o: Facing, n: Facing): Facing {
  switch (f) {
    case "n": return n;
    case "o": return o;
    case "-n": return (-n) as Facing;
    case "-o": return (-o) as Facing;
    default: return f;
  }
}

/**
 * The sequence Turn_Start receives when Jack's (dir, facing) changes from (oldDir, oldFacing)
 * to (newDir, newFacing); [] = no animation (also when nothing changed, or for a change no rule
 * covers, e.g. 0 → 0 with another facing). `walking`: bVar1 of — Jack was already moving
 * (g_jackWalking or), not POINTROTATE and not in uniform (g_jackUniform).
 */
export function turnSequence(oldDir: number, oldFacing: Facing, newDir: number, newFacing: Facing, walking = false): TurnStep[] {
  if (oldDir === newDir && oldFacing === newFacing) return [];
  let out: TurnStep[] = [];
  for (const r of RULES) {
    if (r.from !== oldDir || r.to !== newDir) continue;
    if (r.prod !== undefined && oldFacing * newFacing !== r.prod) continue;
    if (r.oldF !== undefined && (oldFacing !== r.oldF || newFacing !== r.newF)) continue;
    const seq = walking && r.walk ? r.walk : r.spot;
    out = seq.map(([anim, f]) => ({ anim, frame: 0, facing: resolve(f, oldFacing, newFacing) }));
  }
  return out;
}

/** What one turn tick did. */
export interface TurnTick {
  /** frame drawn this tick (null: waiting for the counter) */
  frame: TurnFrame | null;
  /** Jack_PlayStep at frame 2 of the first animation (set by Turn_Start) */
  stepSound: boolean;
  /** an animation ended: its index and step facing; for 0..10 the position shift and next walk frame */
  ended: { anim: TurnAnim; facing: Facing; shift: { dx: number; dy: number } | null; walkFrame: number | null } | null;
  /** the whole sequence is over (flag cleared) */
  done: boolean;
}

/**
 * Plays a Turn_Start sequence. The frame counter is Jack's shared timer (g_jackInsDelay),
 * so tick() takes the timer state from the caller: call it when the timer has run out (≤ 0) and
 * reload the timer with turnFrameTicks() — see walk/turn.ts.
 */
export class TurnPlayer {
  readonly steps: TurnStep[];
  /** */
  index = 0;
  /**, */
  anim: TurnAnim;
  frame: number;
  facing: Facing;
  /** */
  private firstAnim = true;
  done = false;

  constructor(steps: TurnStep[], readonly uniform = false) {
    if (steps.length === 0) throw new RangeError("empty turn sequence");
    this.steps = steps;
    this.anim = steps[0].anim;
    this.frame = steps[0].frame;
    this.facing = steps[0].facing;
  }

  /**
 * One frame step: draw the current frame, then advance. `walking` = g_jackWalking now (it picks
 * the frame-count table), `scale` = g_jackScale for the frame size.
 */
  step(walking: boolean, scale: number): TurnTick {
    if (this.done) return { frame: null, stepSound: false, ended: null, done: true };
    const table = this.uniform ? TURN_SCALE_UNIFORM : TURN_SCALE;
    const mul = table[this.anim]?.[this.frame] ?? 1;
    const frame: TurnFrame = {
      anim: this.anim,
      frame: this.frame,
      facing: this.facing,
      file: turnFrameFile(this.anim, this.frame, this.uniform),
      hotSpot: turnHotSpotRef(this.anim, this.frame, this.uniform),
      scale: Math.min(1, f32(scale * mul)),
    };
    let stepSound = false;
    if (this.frame === 2 && this.firstAnim) {
      stepSound = true;
      this.firstAnim = false;
    }
    this.frame++;
    const count = walking ? TURN_FRAMES_WALKING[this.anim] : TURN_FRAMES_STANDING[this.anim];
    if (this.frame !== count) return { frame, stepSound, ended: null, done: false };
    const e = TURN_END[this.anim];
    const ended = {
      anim: this.anim,
      facing: this.facing,
      shift: e ? { dx: e.dx, dy: e.dy } : null,
      walkFrame: turnEndWalkFrame(this.anim, this.facing),
    };
    this.index++;
    if (this.index < this.steps.length) {
      const s = this.steps[this.index];
      this.anim = s.anim;
      this.frame = s.frame;
      this.facing = s.facing;
    } else {
      this.done = true;
    }
    return { frame, stepSound, ended, done: this.done };
  }
}
