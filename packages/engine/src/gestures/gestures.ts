// Jack's gestures PICKUP / GIVE / SHOOTF / SLAPF.
// Script_ExecStep cases 0x8f (PICKUP, code 0x90), 0x91 (GIVE, 0x92), 0x92 (SHOOTF, 0x93),
// 0x93 (SLAPF, 0x94) start a GLOBAL.ICS insertion of Jack (Ins_StartGlobal, scale
// multiplier 1.0) and repeat themselves (pc - 1) until the gesture state says the
// insertion ended. The end of every global insertion of Jack (Game_Run ..., at
// "cur + 1 > end") clears the variables SLAP and SHOOT and either restarts the fist guard loop
// (state 3) or sets state 2. This module is the pure logic; the host plays the insertions.

import type { Facing, JackDir } from "../anim/jack";

/** Script command codes (compiler.ts). */
export const GESTURE_CODES = { PICKUP: 0x90, GIVE: 0x92, SHOOTF: 0x93, SLAPF: 0x94 } as const;

/** 0 = idle, 1 = insertion playing, 2 = insertion ended (seen by the next repeat),
 * 3 = SLAPF 1: the guard loop BOPRO1/BO34P1/BO34T1 restarts at every end. */
export type GestureState = 0 | 1 | 2 | 3;

/** What the command needs to know about Jack. */
export interface JackInfo {
  /** g_jackDir */
  dir: JackDir;
  /** g_jackFacing */
  facing: Facing;
  /** g_jackUniform: Jack wears the uniform */
  uniform: boolean;
}

/** Ins_StartGlobal(name, facing, scaleMul): one GLOBAL.ICS section as Jack's insertion. */
export interface GlobalInsertionRequest {
  name: string;
  /** g_jackInsDir: g_jackFacing, or always 1 for SHOOTF (the name carries the side) */
  facing: Facing;
  /** always 1.0 for gestures (push, also in Game_Run) */
  scaleMul: 1;
}

/** Result of one execution of a gesture command. */
export interface GestureStep {
  /** "repeat": pc - 1, the macro runs the same command on the next tick; "done": next command */
  result: "repeat" | "done";
  /** insertion the host starts now (replaces whatever Jack plays) */
  start?: GlobalInsertionRequest;
  /** game variables to set (SLAPF: SLAP = 1) */
  vars?: Readonly<Record<string, number>>;
}

/** Result of the end of a global insertion of Jack. */
export interface GlobalInsertionEnd {
  /** always { SLAP: 0, SHOOT: 0 } (...: g_varValues[], []) */
  vars: Readonly<Record<string, number>>;
  /** state 3: the guard loop starts again */
  start?: GlobalInsertionRequest;
}

const DIR_PICKUP_CIVIL = ["PP_D", "PP_L", "PP_U", "SC34P", "PP_RU"] as const;
const DIR_PICKUP_UNIFORM = ["PM_D", "PM_L", "PM_U", "PM_LD", "PM_RU"] as const;
const DIR_GIVE = ["D", "L", "U", "LD", "RU"] as const;
const GIVE_PHASES = ["DAJE_DO_WYC", "CHOWA_WYC", "STAY_DO_WYC"] as const;
const GIVE_LAST = "OPUSZCZA_WYC";

function req(name: string, facing: Facing): GlobalInsertionRequest {
  return { name, facing, scaleMul: 1 };
}

/** PICKUP n (case 0x8f): n == 0 -> "...0" (bend down), any other n -> "...1" (stand up). */
export function pickupInsertion(arg: number, jack: JackInfo): GlobalInsertionRequest {
  const base = (jack.uniform ? DIR_PICKUP_UNIFORM : DIR_PICKUP_CIVIL)[jack.dir];
  return req(`${base}${arg === 0 ? 0 : 1}`, jack.facing);
}

/** GIVE n (case 0x91): 0 DAJE_DO_WYC, 1 CHOWA_WYC, 2 STAY_DO_WYC, other OPUSZCZA_WYC; _DP_ civil, _DM_ uniform. */
export function giveInsertion(arg: number, jack: JackInfo): GlobalInsertionRequest {
  const phase = arg >= 0 && arg <= 2 ? GIVE_PHASES[arg] : GIVE_LAST;
  return req(`${phase}_${jack.uniform ? "DM" : "DP"}_${DIR_GIVE[jack.dir]}`, jack.facing);
}

/** SHOOTF / SLAPF only act when g_jackDir is 1 (profile), 3 or 4 (three-quarter views). */
export function weaponDir(dir: JackDir): boolean {
  return dir === 1 || dir === 3 || dir === 4;
}

/** SHOOTF n (case 0x92): only n 0 / 1 start anything. The side is in the name and the insertion
 * direction is always 1. Profile (dir 1) and dir 3: facing 1 -> "L", else "P"; dir 4 the other
 * way round (facing 1 -> "P") - as in the code. Null: no insertion (other dir or n). */
export function shootInsertion(arg: number, jack: JackInfo): GlobalInsertionRequest | null {
  if (!weaponDir(jack.dir) || (arg !== 0 && arg !== 1)) return null;
  const pre = jack.uniform ? "SW" : "SP";
  const right = jack.facing === 1;
  const name =
    jack.dir === 1 ? `${pre}PR${right ? "L" : "P"}` : jack.dir === 3 ? `${pre}SP${right ? "L" : "P"}` : `${pre}ST${right ? "P" : "L"}`;
  return req(`${name}${arg}`, 1);
}

function slapBase(dir: JackDir, uniform: boolean): string | null {
  const pre = uniform ? "BW" : "BO";
  return dir === 1 ? `${pre}PRO` : dir === 3 ? `${pre}34P` : dir === 4 ? `${pre}34T` : null;
}

/** SLAPF n (case 0x93): n 0 raise the fist, 1 guard (loops while state 3), 2 lower; other n: none. */
export function slapInsertion(arg: number, jack: JackInfo): GlobalInsertionRequest | null {
  const base = slapBase(jack.dir, jack.uniform);
  if (!base || arg < 0 || arg > 2) return null;
  return req(`${base}${arg}`, jack.facing);
}

/** All GLOBAL.ICS sections the gestures can ask for (102). */
export function allGestureInsertions(): string[] {
  const out = new Set<string>();
  for (const uniform of [false, true])
    for (const dir of [0, 1, 2, 3, 4] as JackDir[])
      for (const facing of [1, -1] as Facing[]) {
        const j = { dir, facing, uniform };
        for (const n of [0, 1, 2, 3]) {
          if (n < 2) out.add(pickupInsertion(n, j).name);
          out.add(giveInsertion(n, j).name);
          const s = shootInsertion(n, j);
          if (s) out.add(s.name);
          const b = slapInsertion(n, j);
          if (b) out.add(b.name);
        }
      }
  return [...out].sort();
}

/**
 * Gesture state with the four commands and the end hook. One per game: Game_Run sets
 * the state to 0 when a scene starts (`reset`). The host:
 * - on PICKUP / GIVE / SHOOTF / SLAPF calls `command(code, arg, jack)`, starts `start` with
 * Ins_StartGlobal semantics, sets `vars`, returns `result` to the interpreter;
 * - when any GLOBAL.ICS insertion of Jack ends (also an idle one), calls `globalInsertionEnd(jack)`
 * and does the same with its `start` / `vars`. Scene insertions (RUNINSERTION) do not call it.
 */
export class Gestures {
  state: GestureState = 0;
  /** false (default): engine fix - only a gesture's own insertion (state 1) sets state 2, so an
 * idle insertion that ends no longer makes the next gesture skip its animation (user decision
 * 2026-11-07). true: the original - every global insertion end sets state 2. */
  readonly originalIdleBug: boolean;

  constructor(opts: { originalIdleBug?: boolean } = {}) {
    this.originalIdleBug = opts.originalIdleBug ?? false;
  }

  /** Game_Run start of a scene (= 0). */
  reset(): void {
    this.state = 0;
  }

  /** Runs one gesture command; undefined for other codes. */
  command(code: number, arg: number, jack: JackInfo): GestureStep | undefined {
    switch (code) {
      case GESTURE_CODES.PICKUP:
        return this.simple(() => pickupInsertion(arg, jack));
      case GESTURE_CODES.GIVE:
        return this.simple(() => giveInsertion(arg, jack));
      case GESTURE_CODES.SHOOTF:
        if (!weaponDir(jack.dir)) return { result: "done" };
        return this.simple(() => shootInsertion(arg, jack));
      case GESTURE_CODES.SLAPF:
        return this.slap(arg, jack);
      default:
        return undefined;
    }
  }

  /** PICKUP, GIVE, SHOOTF: 1 -> wait; 0 -> start, state 1, wait; 2 -> state 0, go on. A null
 * insertion (SHOOTF n > 1) still sets state 1, and nothing will ever end it: the macro hangs. */
  private simple(pick: () => GlobalInsertionRequest | null): GestureStep {
    let repeat = this.state === 1;
    let start: GlobalInsertionRequest | undefined;
    if (this.state === 0) {
      start = pick() ?? undefined;
      repeat = true;
      this.state = 1;
    }
    if (this.state === 2) this.state = 0;
    return start ? { result: repeat ? "repeat" : "done", start } : { result: repeat ? "repeat" : "done" };
  }

  /** SLAPF (case 0x93), only for dir 1/3/4: 1 -> wait; 0 or 3 -> SLAP = 1, state 1, start
 * phase n; n == 1: pc + 1 and state 3 (the command does not wait, the guard loops); else wait;
 * 2 -> state 0, go on. */
  private slap(arg: number, jack: JackInfo): GestureStep {
    if (!weaponDir(jack.dir)) return { result: "done" };
    let repeat = this.state === 1;
    let start: GlobalInsertionRequest | undefined;
    let vars: Record<string, number> | undefined;
    if (this.state === 0 || this.state === 3) {
      vars = { SLAP: 1 };
      this.state = 1;
      start = slapInsertion(arg, jack) ?? undefined;
      if (arg === 1) this.state = 3;
      repeat = arg !== 1; // pc + 1 then pc - 1 for n == 1
    }
    if (this.state === 2) this.state = 0;
    const step: GestureStep = { result: repeat ? "repeat" : "done" };
    if (start) step.start = start;
    if (vars) step.vars = vars;
    return step;
  }

  /** End of a GLOBAL.ICS insertion of Jack (Game_Run, g_jackInsFromScene == 0). */
  globalInsertionEnd(jack: JackInfo): GlobalInsertionEnd {
    const vars = { SLAP: 0, SHOOT: 0 };
    if (this.state !== 3) {
      // original: state 2 whatever started the insertion; engine fix: only when a gesture waits
      if (this.originalIdleBug || this.state === 1) this.state = 2;
      return { vars };
    }
    const start = slapInsertion(1, jack);
    return start ? { vars, start } : { vars };
  }
}
