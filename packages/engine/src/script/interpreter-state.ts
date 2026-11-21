import { s16 } from "../formats/global";
import type { Command } from "./compiler";

/** What the host did with a command. */
export type CommandResult =
  /** finished now */
  | "done"
  /** started something that ends later (walk, animation, insertion, talk); the host calls
 * `complete(macro)` at its end. With the flag "-" the macro waits for it (count
 * + = 0 in the game); with "+" it goes on. */
  | "async"
  /** the macro waits until `complete(macro)` whatever the flag (DIALOG) */
  | "block"
  /** not yet: the same command runs again on the next tick (pc-- in the game) */
  | "repeat"
  /** not implemented by this host: logged and skipped */
  | "unhandled";

export interface CommandContext {
  readonly macro: number;
  readonly macroName: string;
  /** true while [PRE] runs synchronously before the first frame */
  readonly synchronous: boolean;
  /** value of argument slot: a[slot], or the variable named in refs for that slot ("*VAR") */
  arg(slot: number): number;
  readonly vars: Variables;
}

export interface LogEntry {
  kind: "unhandled" | "start" | "end" | "missing-macro" | "missing-var" | "hang";
  macro: string;
  command?: Command;
  text: string;
}

export interface ScriptHost {
  /** Runs one command that is not a control command of the interpreter. */
  command(cmd: Command, ctx: CommandContext): CommandResult;
  /** x of the last mouse click in scene coordinates (IFMOUSEXM / IFMOUSEXW). */
  clickX?(): number;
  /** rand() of the C library, 0..0x7fff (RANDOM, TALKRANDOM). */
  random?(): number;
  /** A macro ran past its last command. The game calls Jack_Stand when the last command
 * was a WALKTO of JACK (prologue). */
  macroEnded?(name: string, last: Command | null): void;
  log?(entry: LogEntry): void;
}

/** Game variables (VARIABLE.ALL, int16 values, looked up by name like Var_Get). */
export class Variables {
  private readonly values = new Map<string, number>();
  readonly missing = new Set<string>();

  constructor(initial: ReadonlyMap<string, number> = new Map()) {
    for (const [k, v] of initial) this.values.set(k, v);
  }

  has(name: string): boolean {
    return this.values.has(name);
  }

  /** A variable that is not in VARIABLE.ALL reads as 0 (the game reads garbage). */
  get(name: string): number {
    const v = this.values.get(name);
    if (v === undefined) {
      this.missing.add(name);
      return 0;
    }
    return v;
  }

  /** Writes to an unknown variable are dropped (the game writes to a stale index). */
  set(name: string, v: number): void {
    if (!this.values.has(name)) {
      this.missing.add(name);
      return;
    }
    this.values.set(name, s16(v));
  }

  entries(): IterableIterator<[string, number]> {
    return this.values.entries();
  }
}

/** Per-macro state of the game's table and its side arrays. */
export interface MacroState {
  readonly name: string;
  readonly start: number;
  readonly count: number;
  /** +0x42: running */
  active: boolean;
  /** +0x40: absolute index of the next command */
  pc: number;
  /** [i] == 0: waits for complete() */
  blocked: boolean;
  /** [i]: async operations started and not finished */
  pending: number;
  /** [i]: BLOCKMACRO — cannot be started */
  locked: boolean;
  /** [i]: DONOTHING countdown, -1 = idle */
  wait: number;
  /** +0x43 / +0x44: UNLOCK/LOCK and OUTMACRO/NORMALMACRO flags (read by Game_Run) */
  unlock: boolean;
  out: boolean;
  /** [i]: macro named by MACRODESTRUCTOR */
  destructor: string | null;
  /** last command executed (not set by If/EndIf) */
  last: Command | null;
}

/** CO60/CO30/CO10: Game_Run starts them from the counter, which
 * Game_TimerTick decrements every logic tick (15 ms). */
export const CO_RESET = 3000;
export const CO_START = 2999;
