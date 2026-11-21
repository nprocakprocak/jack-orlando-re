// Macro interpreter after Script_ExecStep, driven from outside by a host.
// ("Wykonanie", "Interfejs hosta").
// The interpreter owns what the game keeps per macro (table: active flag, program
// counter, wait state) and the game variables, and runs the control commands itself
// (Let/Inc/If /EndIf/ActiveMacro/DoNothing/WaitWhile). Every other command goes to the
// host, which says whether it is done, started something that ends later, or must be
// tried again on the next tick; commands the engine does not implement yet are "unhandled"
// — logged and skipped, never blocking the script.
import { ENDIF, IF_CODES, NAMES, type Command, type Program } from "./compiler";
import {
  CO_RESET, CO_START, Variables,
  type CommandContext, type CommandResult, type LogEntry, type MacroState, type ScriptHost,
} from "./interpreter-state";
export {
  CO_RESET, CO_START, Variables,
  type CommandContext, type CommandResult, type LogEntry, type MacroState, type ScriptHost,
} from "./interpreter-state";

const SYNC_STEP_LIMIT = 100000;

export class Interpreter {
  readonly macros: MacroState[];
  readonly vars: Variables;
  /** answers of DIALOG by dialog id */
  readonly answers = new Map<number, number>();
  /** */
  coCounter = CO_START;
  /** ACTIVEMACROAT: macro started after `frames` ticks */
  private delayed: { name: string; frames: number; counter: number } | null = null;
  private running = -1;
  private synchronous = false;
  /** g_macroStarted: the macro started last; [PRE]'s loop steps this one (see `runSynchronous`) */
  private syncCurrent = -1;

  constructor(
    readonly program: Program,
    readonly host: ScriptHost,
    variables: Variables | ReadonlyMap<string, number> = new Map(),
  ) {
    this.vars = variables instanceof Variables ? variables : new Variables(variables);
    this.macros = program.macros.map((m) => ({
      name: m.name, start: m.start, count: m.count, active: false, pc: m.start, blocked: false,
      pending: 0, locked: false, wait: -1, unlock: false, out: false, destructor: null, last: null,
    }));
  }

  // --- macro control ---------------------------------------------------------------------

  /** Script_StartMacro / Script_FindMacro: the first macro of that name that
 * is not BLOCKMACRO-ed starts from its first command (also when it is already running). */
  start(name: string): number {
    const i = this.macros.findIndex((m) => m.name === name && !m.locked);
    if (i < 0) {
      this.syncCurrent = -1; // g_macroStarted = -1
      this.emit({ kind: "missing-macro", macro: name, text: `no macro [${name}]` });
      return -1;
    }
    const m = this.macros[i];
    m.active = true;
    m.pc = m.start;
    m.pending = 0;
    m.blocked = false;
    this.syncCurrent = i; // Script_FindMacro: g_macroStarted = the macro started last
    this.emit({ kind: "start", macro: name, text: `start [${name}]` });
    return i;
  }

  isActive(name: string): boolean {
    return this.macros.some((m) => m.name === name && m.active);
  }

  /** Script_AnyMacroActive is about TAKE ; this is the plain question. */
  anyActive(): boolean {
    return this.macros.some((m) => m.active);
  }

  /** The host's async operation started by macro i has ended (count−1, at 0 the
 * macro runs again). */
  complete(i: number): void {
    const m = this.macros[i];
    if (!m) return;
    m.pending = Math.max(0, m.pending - 1);
    if (m.pending === 0) m.blocked = false;
  }

  /**
 * Game_Run: [PRE] runs to its end at once, before the first frame. Waits are ignored (only the active
 * flag is checked); a "repeat" there would hang the game (the host must finish such commands itself, e.g. the music fade).
 * The loop is `while (macroActive[g_macroStarted]) Script_ExecStep(g_macroStarted)` (bytes `66 a1 78 f6 88 00 50 e8`:
 * `g_macroStarted` is re-read each pass), and `Script_FindMacro` sets it on every start - so an `ACTIVEMACRO`
 * inside [PRE] hands the loop over to the new macro, which then runs to its end before [PRE]'s own remaining commands
 * (those continue later in the frames, [PRE] stays active). A missing macro sets -1 and ends the loop.
 */
  runSynchronous(name = "PRE"): void {
    const first = this.start(name);
    if (first < 0) return;
    this.synchronous = true;
    try {
      for (let n = 0; this.syncCurrent >= 0 && this.macros[this.syncCurrent].active; n++) {
        if (n >= SYNC_STEP_LIMIT) {
          const m = this.macros[this.syncCurrent];
          this.emit({ kind: "hang", macro: m.name, text: `[${m.name}] does not end (the game hangs here)` });
          m.active = false;
          break;
        }
        this.step(this.syncCurrent);
      }
    } finally {
      this.synchronous = false;
    }
  }

  /**, called by the click handlers (Area_ClickMacro): every
 * running OUTMACRO macro other than `except` stops and its destructor starts — the macro
 * named by MACRODESTRUCTOR, else "~NAME". */
  interruptOutMacros(except = -1): void {
    this.macros.forEach((m, i) => {
      if (!m.out || !m.active || i === except) return;
      m.active = false;
      m.out = false;
      this.start(m.destructor ?? `~${m.name}`);
    });
  }

  /** True while a running macro has no UNLOCK: Game_Run then sets
 * and the player's clicks wait. */
  playerLocked(): boolean {
    return this.macros.some((m) => m.active && !m.unlock);
  }

  /** Game_TimerTick: one logic tick (15 ms). */
  logicTick(): void {
    this.coCounter--;
  }

  /** One frame of Game_Run: timed macros, then one command of every active,
 * not waiting macro in table order. */
  tick(): void {
    if (this.coCounter < 0) {
      this.start("CO60");
      this.coCounter = CO_RESET;
    }
    if (this.coCounter % 1000 === 0) this.start("CO30");
    if (this.coCounter % 300 === 0) this.start("CO10");
    if (this.delayed && ++this.delayed.counter === this.delayed.frames) {
      const name = this.delayed.name;
      this.delayed = null;
      this.start(name);
    }
    for (let i = 0; i < this.macros.length; i++) {
      const m = this.macros[i];
      if (m.active && !m.blocked) this.step(i);
    }
  }

  // --- execution -------------------------------------------------------------------------

  /** Script_ExecStep: one command of macro i, then pc+1. */
  step(i: number): void {
    const m = this.macros[i];
    const cmds = this.program.commands;
    if (m.pc - m.start >= m.count) {
      m.active = false;
      this.emit({ kind: "end", macro: m.name, text: `end [${m.name}]` });
      this.host.macroEnded?.(m.name, m.last);
      return;
    }
    const cmd = cmds[m.pc];
    if (cmd.code !== ENDIF && cmd.code !== 0x1b) m.last = cmd;
    this.running = i;
    const ctx = this.context(i, cmd);
    switch (cmd.code) {
      case 0x0d: // ACTIVEMACRO
        this.start(cmd.n1);
        break;
      case 0x0e: // IFANSWER answer dialog
        if (cmd.a[0] !== (this.answers.get(cmd.a[2]) ?? -1)) this.skipBlock(m, true);
        break;
      case ENDIF:
        break;
      case 0x1a: // LET var value
        this.setVar(cmd, 1, ctx.arg(0));
        break;
      case 0x1b: // IF var value
        if (cmd.a[0] !== ctx.arg(2)) this.skipBlock(m, false);
        break;
      case 0x2d: // IFMOUSEXM x: body when click x <= x
        if (cmd.a[0] < (this.host.clickX?.() ?? 0)) this.skipBlock(m, false);
        break;
      case 0x2e: // IFMOUSEXW x: body when click x >= x
        if ((this.host.clickX?.() ?? 0) < cmd.a[0]) this.skipBlock(m, false);
        break;
      case 0x3d: // DEACTIVESELF
        m.active = false;
        break;
      case 0x45: // ACTIVEMACROAT name frames
        this.delayed = { name: cmd.n1, frames: cmd.a[0], counter: 0 };
        break;
      case 0x48: // INC var
        this.setVar(cmd, 1, ctx.arg(1) + 1);
        break;
      case 0x49: // WAITWHILE var value
        if (ctx.arg(1) === cmd.a[0]) m.pc--;
        break;
      case 0x52: // UNLOCK
        m.unlock = true;
        break;
      case 0x59: // OUTMACRO
        m.out = true;
        m.unlock = true;
        break;
      case 0x5a: // NORMALMACRO
        m.out = false;
        m.unlock = false;
        break;
      case 0x5b: {
        // IFF var op value: op 0 ">", 1 "=", 2 "<"
        const v = ctx.arg(2), x = cmd.a[0], op = cmd.a[3];
        const ok = (op === 0 && v > x) || (op === 1 && v === x) || (op === 2 && v < x);
        if (!ok) this.skipBlock(m, false);
        break;
      }
      case 0x5c: // AUTOINCRANGE var start ... (the range itself is the host's)
        this.setVar(cmd, 2, cmd.a[0]);
        this.host.command(cmd, ctx);
        break;
      case 0x5e: // LOCK
        m.unlock = false;
        break;
      case 0x64: // INCC var n
        this.setVar(cmd, 1, ctx.arg(1) + cmd.a[0]);
        break;
      case 0x6f: // DONOTHING n: wait n ticks
        if (m.wait < 0) m.wait = cmd.a[0];
        if (m.wait < 1) m.wait = -1;
        else {
          m.pc--;
          m.wait--;
        }
        break;
      case 0x78: // MACRODESTRUCTOR name
        m.destructor = cmd.n1;
        this.host.command(cmd, ctx);
        break;
      case 0x79: // BLOCKMACRO name|ALL
      case 0x7a: // UNBLOCKMACRO name|ALL
        for (const x of this.macros) if (cmd.n1 === "ALL" || x.name === cmd.n1) x.locked = cmd.code === 0x79;
        break;
      case 0x7d: {
        // RANDOM var lo hi
        const r = this.host.random?.() ?? Math.floor(Math.random() * 0x8000);
        this.setVar(cmd, 0, (r % (cmd.a[2] - cmd.a[1] + 1)) + cmd.a[1]);
        break;
      }
      case 0x7e: // DEACTIVEMACRO name
        for (const x of this.macros) if (x.name === cmd.n1) x.active = false;
        break;
      case 0x95: // REACTIVESELF: again from the first command
        m.pc = m.start - 1;
        m.pending = 0;
        break;
      default:
        this.hostCommand(m, cmd, ctx);
    }
    m.pc++;
    this.running = -1;
  }

  private hostCommand(m: MacroState, cmd: Command, ctx: CommandContext): void {
    const r = this.host.command(cmd, ctx);
    switch (r) {
      case "async":
        m.pending++;
        if (cmd.c === "-" && !this.synchronous) m.blocked = true;
        break;
      case "block":
        if (!this.synchronous) m.blocked = true;
        break;
      case "repeat":
        m.pc--;
        break;
      case "unhandled":
        this.emit({ kind: "unhandled", macro: m.name, command: cmd, text: `${NAMES[cmd.code] ?? cmd.word} (line ${cmd.line}) skipped` });
        break;
      default:
    }
  }

  /** A false condition: skip to the matching ENDIF counting the block openers of IF_CODES.
 * IFANSWER's loop (case 0xd) tests three of them on a stale local, so there only IFANSWER
 * and IF nest (a bug of the game). */
  private skipBlock(m: MacroState, ifAnswer: boolean): void {
    const cmds = this.program.commands;
    let depth = 1;
    while (depth > 0 && m.pc + 1 < cmds.length) {
      m.pc++;
      const code = cmds[m.pc].code;
      const opens = ifAnswer ? code === 0x0e || code === 0x1b : IF_CODES.includes(code);
      if (opens) depth++;
      if (code === ENDIF) depth--;
    }
  }

  private setVar(cmd: Command, slot: number, v: number): void {
    const ref = cmd.refs.find((r) => r[0] === slot && r[1] === "var");
    if (!ref) return;
    const name = ref[2] as string;
    if (!this.vars.has(name)) this.emit({ kind: "missing-var", macro: this.currentName(), command: cmd, text: `no variable ${name}` });
    this.vars.set(name, v);
  }

  private context(i: number, cmd: Command): CommandContext {
    const vars = this.vars;
    return {
      macro: i,
      macroName: this.macros[i].name,
      synchronous: this.synchronous,
      vars,
      arg(slot: number): number {
        const ref = cmd.refs.find((r) => r[0] === slot && r[1] === "var");
        return ref ? vars.get(ref[2] as string) : cmd.a[slot];
      },
    };
  }

  private currentName(): string {
    return this.running >= 0 ? this.macros[this.running].name : "";
  }

  private emit(e: LogEntry): void {
    this.host.log?.(e);
  }
}

/** How the game waits on a command (for hosts): "async" — counted operation, the flag "-"
 * waits for its end; "talk" — "-" waits for the end of the line; "block" — always waits;
 * "poll" — the command repeats every tick until its condition holds. */
export const WAIT_KIND: Readonly<Record<number, "async" | "talk" | "block" | "poll">> = {
  0x05: "async", // ANIMA (counted for modes 1, 3, 5)
  0x07: "async", // WALKTO
  0x08: "async", // RUNINSERTION
  0x0b: "talk", // TALK
  0x0c: "block", // DIALOG
  0x17: "async", // WALKTODIR
  0x18: "poll", // SHOWFACE
  0x21: "talk", // TALKRANDOM
  0x3f: "poll", // MUSIC (while the old track fades)
  0x49: "poll", // WAITWHILE
  0x4d: "poll", // WAITWHILEANIMA
  0x56: "poll", // WAITTOANIMAFRAME
  0x67: "poll", // WAITWHILEEFFECT
  0x6f: "poll", // DONOTHING
  0x74: "poll", // PAUSE
  0x77: "async", // ROTATETO
  0x88: "talk", // TALKRANDOMINDEX
  0x90: "poll", // PICKUP
  0x92: "poll", // GIVE
  0x93: "poll", // SHOOTF
  0x94: "poll", // SLAPF
};

/** A host that implements nothing: every command is logged as unhandled. */
export class LoggingHost implements ScriptHost {
  readonly entries: LogEntry[] = [];
  command(): CommandResult {
    return "unhandled";
  }
  log(e: LogEntry): void {
    this.entries.push(e);
  }
}

/** Scene name of GOTOSCENE (case 0x13): the extension is cut at the last "." and
 * replaced, so "SC026.CFG" and "SC026" both mean SC026. */
export function gotoSceneName(arg: string): string {
  const i = arg.lastIndexOf(".");
  return (i > 0 ? arg.slice(0, i) : arg).toUpperCase();
}
