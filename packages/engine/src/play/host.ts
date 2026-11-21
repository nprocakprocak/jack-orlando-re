// The script host of a running scene: maps the commands of the macro interpreter
// onto the ScenePlayer (Jack, persons, objects, camera), the area flags, the dialog layer
// (TALK, DIALOG, SHOWFACE...), sound and music, films (RUNAVX), .FLX animations, and,
// through ItemPort, the coat. `PAUSE` and any command with no case return "unhandled":
// the interpreter logs it and skips it. A command whose target is missing (no item port,
// no dialog layer for a face command, no person of that name) does the same.
// Without `env.dialog` a talk line waits a fixed number of ticks, and DIALOG takes the
// answer from `env.answer`. No DOM.

import type { Speaker } from "../dialog";
import { Gestures, type JackInfo } from "../gestures";
import type { Command, CommandContext, CommandResult, Interpreter, LogEntry, ScriptHost } from "../script";
import * as animBody from "./host-anim";
import * as areaBody from "./host-areas";
import * as filmBody from "./host-film";
import * as itemBody from "./host-items";
import * as objectBody from "./host-objects";
import * as personBody from "./host-persons";
import * as sceneBody from "./host-scene";
import * as shadowBody from "./host-shadow";
import * as soundBody from "./host-sound";
import type { HostEnv, HostState } from "./host-state";
import * as talkBody from "./host-talk";

export type { HostEnv, ItemPort } from "./host-state";
export { globalFilmTarget } from "./host-film";
export { skippedWhenRestoring, syncJackVars } from "./host-persons";
export { TALK_TICKS } from "./host-talk";

/** The variables the clock writes (`Variables` of the interpreter; positions = VARIABLE.ALL order = `g_varValues` indices). */
export interface ClockVars {
  get(name: string): number;
  set(name: string, v: number): void;
  entries(): IterableIterator<[string, number]>;
}

/** Logic ticks between two increments: `(g_autoIncTicks & 0x3f) == 0` in Game_TimerTick. */
export const AUTOINC_PERIOD = 64;
/** Game_Run (l. 382): the range every chapter-3 scene starts with, before [PRE]. */
export const CHAPTER3_CLOCK = { name: "OCHR", min: 0, max: 0x3c } as const;

/**
 * AUTOINCRANGE: one global clock that raises one script variable. State = `g_autoIncMin`,
 * `g_autoIncMax`, `g_autoIncVar` (an index into `g_varValues`, -1 = off; the three are the save tail)
 * and the tick counter `g_autoIncTicks` (not saved, not reset by AUTOINCRANGE or a load).
 * - Script_ExecStep case 0x5b (word 0x5c): `var = min` and the three fields are overwritten - one range at a time;
 * - Game_TimerTick, every 15 ms logic tick while `g_logicFrozen == 0`: with `var >= 0` the counter grows; at a
 * multiple of 64 it is zeroed, `var += 1` (a short) and `var > max` -> `var = min` (so the variable runs min..max);
 * - Game_Run (every scene start, before [PRE]): in chapter 3 (`== 3`) the range becomes OCHR 0..60
 * (the value of OCHR is kept); the prolog (once per run) sets `var = -1`.
 * The game owns it (it outlives the scene host); the host runs the command and ticks it.
 */
export class AutoIncClock {
  min = 0;
  max = 0;
  /** index into VARIABLE.ALL, -1 = off */
  variable = -1;
  /** `g_autoIncTicks` */
  ticks = 0;

  /** AUTOINCRANGE: the fields only (the interpreter sets the variable to `min`). */
  start(variable: number, min: number, max: number): void {
    this.min = min;
    this.max = max;
    this.variable = variable;
  }

  /** One logic tick (the caller skips it while the logic is frozen). */
  tick(vars: ClockVars): void {
    if (this.variable < 0) return;
    if (++this.ticks % AUTOINC_PERIOD !== 0) return;
    this.ticks = 0;
    const name = varNameAt(vars, this.variable);
    if (name === null) return;
    const v = vars.get(name) + 1;
    vars.set(name, v); // stored as a short
    if (vars.get(name) > this.max) vars.set(name, this.min);
  }

  /**
 * Game_Run, l. 382: a scene of chapter 3 starts the OCHR clock (an OCHR missing from the table -> index 0, the
 * search's start value). Called before [PRE], so a PRE with its own AUTOINCRANGE wins.
 */
  sceneStart(chapter: number, vars: ClockVars): void {
    if (chapter !== 3) return;
    const i = varIndex(vars, CHAPTER3_CLOCK.name);
    this.start(i < 0 ? 0 : i, CHAPTER3_CLOCK.min, CHAPTER3_CLOCK.max);
  }

  /** The save tail (`Save_WriteState`). */
  state(): { min: number; max: number; variable: number } {
    return { min: this.min, max: this.max, variable: this.variable };
  }

  /** `Save_LoadState` reads the three fields; the tick counter runs on. */
  restore(s: { min: number; max: number; variable: number }): void {
    this.start(s.variable, s.min, s.max);
  }
}

/** Position of `name` in the variable table (VARIABLE.ALL order), -1 when missing. */
export function varIndex(vars: ClockVars, name: string): number {
  let i = 0;
  for (const [n] of vars.entries()) {
    if (n === name) return i;
    i++;
  }
  return -1;
}

function varNameAt(vars: ClockVars, index: number): string | null {
  let i = 0;
  for (const [n] of vars.entries()) if (i++ === index) return n;
  return null;
}

export class SceneHost implements ScriptHost {
  interpreter!: Interpreter;
  /** LOCKWALK / UNLOCKWALK: the player may walk by clicking */
  walkAllowed = true;
  readonly skipped = new Map<string, number>();
  readonly executed = new Map<string, number>();
  /** SAVEABLE n (1 at the scene start): the save menu is not there yet, the flag is kept for it */
  saveable = true;
  /**
 * SETPOSSCROLL L|R x y (-1000 = unset at the scene start, Game_Run): the
 * points Jack walks to when the cursor is at the left / right screen edge.
 */
  /** the view scrolled in the last tick (set by the game after the scene tick; Game_Tick14ms). */
  viewScrolling = false;
  readonly scrollPoints: { L: { x: number; y: number }; R: { x: number; y: number } } = { L: { x: -1000, y: -1000 }, R: { x: -1000, y: -1000 } };
  /** POINTROTATE n (kept in too): 1 = Jack walks to a point without the turning animation */
  pointRotate = 0;
  /**
 * ACTIVEMACROANIMA macro anim rec image (case 0x72, up to 300 images per animation): the macro
 * started when the .FLX animation shows `image` in record `rec` (Game_Run, FLX branch, not played).
 */
  readonly animaMacros: { macro: string; anim: string; rec: number; image: number }[] = [];
  /** the macro waiting for the line being spoken (a TALK with `-`) */
  private talkWaiter: number | null = null;
  /** SETPOSXY x y: the point `TALK POS` puts its caption at */
  posXY = { x: 0, y: 0 };
  /**
 * Who is told when an operation ends: the macro that started it last (the game keeps one
 * macro slot per actor, walks / insertions: a second start overwrites it).
 */
  private readonly slots = new Map<string, number>();
  /** the state of Jack's gestures ; a host lives for one scene, the game resets it at the scene start */
  readonly gestures = new Gestures();
  private timers: { ticks: number; macro: number }[] = [];
  private rng = 12345;
  private readonly dialogsAsked = new Map<number, number>();
  constructor(private readonly env: HostEnv, private readonly talkTicks = talkBody.TALK_TICKS) {
    // The group files read these. A reference keeps the private names in use.
    void [this.talkTicks, this.dialogsAsked, this.setJackVars, this.wait, this.waitAlways, this.fallbackTalk, this.speaker, this.noteSkipped];
  }

  // --- ScriptHost -------------------------------------------------------------------------------

  clickX(): number {
    return this.env.clickX();
  }

  random(): number {
    // rand() of the C library: any 0..0x7fff will do (deterministic, so that runs repeat)
    this.rng = (Math.imul(this.rng, 1103515245) + 12345) >>> 0;
    return (this.rng >>> 16) & 0x7fff;
  }

  log(entry: LogEntry): void {
    if (entry.kind === "unhandled" && entry.command) {
      const w = entry.command.word;
      this.skipped.set(w, (this.skipped.get(w) ?? 0) + 1);
    }
    this.env.log(entry);
  }

  macroEnded(_name: string, last: Command | null): void {
    // prologue: a macro whose last command was WALKTO JACK leaves Jack standing
    if (last && last.code === 0x07 && last.n1 === "JACK") this.env.scene.standJack();
  }

  /**
 * `g_restoreJackPose` (a loaded save with pose byte 1; cleared by a scene change): Script_ExecStep skips the commands
 * that place or move Jack when the macro is `INIT` (`bVar9 = strcmp(name, "INIT") != 0`; cases 1, 2, 6, 7, 0x14, 0x15, 0x16, 0x49,
 * 0x76). Jack stays where the save put him; `PRE` and other macros run in full.
 */
  restoringPose = false;

  command(cmd: Command, ctx: CommandContext): CommandResult {
    if (this.restoringPose && ctx.macroName === "INIT" && personBody.skippedWhenRestoring(cmd)) return "done";
    const r = this.run(cmd, ctx);
    if (r !== "unhandled") this.executed.set(cmd.word, (this.executed.get(cmd.word) ?? 0) + 1);
    return r;
  }

  // --- completion (called by the game with the events of ScenePlayer.tick) -----------------------

  /**
 * An object animation shows `image` of record `rec` (event `animFrame`, Game_Run): the ANIMAEFFECT
 * sound of the image plays and the macro registered by ACTIVEMACROANIMA starts.
 */
  animFrame(anim: string, image: number, rec: number): void {
    const sfx = this.env.audio?.sfx;
    if (sfx) sfx.animFrameShown(this.env.scene.scene.objectAnims.findIndex((a) => a.name === anim), image, rec);
    for (const m of this.animaMacros) {
      if (m.anim === anim && m.image === image && m.rec === rec) this.interpreter.start(m.macro);
    }
  }

  /** Jack as the gestures see him: `g_jackDir`, `g_jackFacing`, `g_jackUniform`. */
  private jackInfo(): JackInfo {
    const sc = this.env.scene;
    return { dir: sc.walker.dir as JackInfo["dir"], facing: sc.walker.mirror as JackInfo["facing"], uniform: sc.tj.uniform };
  }

  /**
 * Jack's insertion ended (event `jackInsertionEnded`). A GLOBAL.ICS one (a gesture, a guard, an idle animation: Game_Run
 *, `g_jackInsFromScene == 0`) goes to the gesture state machine and no macro counter is touched; a scene
 * insertion releases the macro of the last RUNINSERTION JACK.
 */
  jackInsertionEnded(global: boolean): void {
    if (!global) {
      this.finish("jack:ins");
      return;
    }
    const e = this.gestures.globalInsertionEnd(this.jackInfo());
    for (const [k, v] of Object.entries(e.vars)) this.interpreter.vars.set(k, v);
    if (e.start) this.env.scene.startGlobalInsertion(e.start.name, e.start.facing, e.start.scaleMul);
  }

  /** One logic tick: the AUTOINCRANGE clock (Game_TimerTick), talk timers. */
  tick(): void {
    this.env.autoInc?.tick(this.interpreter.vars);
    this.timers = this.timers.filter((t) => {
      if (--t.ticks > 0) return true;
      this.interpreter.complete(t.macro);
      return false;
    });
  }

  /**
 * INITFIRST's early release: the actor's insertion stopped after its first frame. The macro
 * stored for that actor (Jack: the last RUNINSERTION JACK, a person: the INITFIRST) becomes runnable again (`= 1`)
 * with its counter untouched, and the slot stays (a later end event still finds it).
 */
  release(key: string): void {
    const macro = this.slots.get(key);
    if (macro === undefined) return;
    const m = this.interpreter.macros[macro];
    if (m) m.blocked = false;
  }

  /** The scene reported an event: release the macro that waits for it. */
  finish(key: string): void {
    const macro = this.slots.get(key);
    if (macro === undefined) return;
    this.slots.delete(key);
    this.interpreter.complete(macro);
  }

  /** Forget everything a macro was waiting for (scene change). */
  clear(): void {
    this.slots.clear();
    this.timers = [];
  }
  private setJackVars(ctx: CommandContext): void { personBody.setJackVars.call(this as unknown as HostState, ctx); }
  private wait(key: string, ctx: CommandContext): "async" { return personBody.wait.call(this as unknown as HostState, key, ctx); }
  private waitAlways(key: string, ctx: CommandContext): "async" { return personBody.waitAlways.call(this as unknown as HostState, key, ctx); }
  private fallbackTalk(cmd: Command, ctx: CommandContext): CommandResult { return talkBody.fallbackTalk.call(this as unknown as HostState, cmd, ctx); }
  private speaker(cmd: Command): Speaker | null { return talkBody.speaker.call(this as unknown as HostState, cmd); }
  private noteSkipped(cmd: Command): void { talkBody.noteSkipped.call(this as unknown as HostState, cmd); }

  // -- gestures of Jack: a global insertion, the macro waits for its end (state)
  private gesture(cmd: Command, ctx: CommandContext): CommandResult {
    const sc = this.env.scene;
    const a = cmd.a;
    const g = this.gestures.command(cmd.code, a[0], this.jackInfo());
    if (!g) return "unhandled";
    if (g.vars) for (const [k, v] of Object.entries(g.vars)) ctx.vars.set(k, v);
    if (g.start) sc.startGlobalInsertion(g.start.name, g.start.facing, g.start.scaleMul);
    return g.result;
  }

  /** The dialog layer reports the end of a line whose macro waits for it. */
  talkEnded(macro: number): void {
    if (this.talkWaiter === macro) this.talkWaiter = null;
    this.interpreter.complete(macro);
  }

  private run(cmd: Command, ctx: CommandContext): CommandResult {
    const self = this as unknown as HostState;
    switch (cmd.code) {
      case 0x02: case 0x04: case 0x37: case 0x38:
        return personBody.run.call(self, cmd, ctx);
      case 0x07: // WALKTO person x y
      case 0x17: // WALKTODIR person x y dir
        return personBody.walkTo.call(self, cmd, ctx, cmd.code === 0x17 ? cmd.a[2] : null);
      case 0x03: // INITFIRST person insertion dir
      case 0x08: // RUNINSERTION person insertion f dir
        return personBody.insertion.call(self, cmd, ctx);
      case 0x0a: case 0x4a: case 0x51: case 0x27: case 0x10: case 0x6a: case 0x34: case 0x97:
        return personBody.run.call(self, cmd, ctx);
      case 0x13: case 0x8b: case 0x8c: case 0x8f: case 0x9a: case 0x9b: case 0x9c: case 0x9d:
      case 0x12: case 0x8d: case 0x8e: case 0x9e:
        return shadowBody.run.call(self, cmd);
      case 0x61: case 0x77:
        return personBody.run.call(self, cmd, ctx);
      case 0x62: // GETPERSONX
      case 0x63: // GETPERSONY
        return personBody.getPersonCoord.call(self, cmd, ctx);
      case 0x84: case 0x65: case 0x66:
        return personBody.run.call(self, cmd, ctx);
      case 0x43: case 0x44: case 0x22:
        return itemBody.run.call(self, cmd, ctx);
      case 0x28: // NOHAVE
      case 0x46: // HAVETOOL object
      case 0x47: // NOHAVETOOL name
      case 0x89: // MOUSETOTOOL
      case 0x9f: // ITEMPRESENT name var
        return itemBody.itemCommand.call(self, cmd, ctx);
      case 0x85:
        return itemBody.run.call(self, cmd, ctx);
      case 0x2c: // SETPOSITIONE object x y
      case 0x70: // SETPOSITIONEV
        return objectBody.setObjectPosition.call(self, cmd, ctx);
      case 0x40:
        return objectBody.run.call(self, cmd);
      case 0x16: // PUNDERE person object
      case 0x1d: // POVERE
        return objectBody.placeAgainst.call(self, cmd);
      case 0x15: case 0x3e: case 0x01:
        return objectBody.run.call(self, cmd);
      case 0x90: // PICKUP n
      case 0x92: // GIVE n
      case 0x93: // SHOOTF n
      case 0x94: // SLAPF n
        return this.gesture(cmd, ctx);
      case 0x1c: case 0x68:
        return animBody.run.call(self, cmd, ctx);
      case 0x41:
        return objectBody.run.call(self, cmd);
      case 0x82:
        return animBody.run.call(self, cmd, ctx);
      case 0x4c:
        return objectBody.run.call(self, cmd);
      case 0x8a:
        return personBody.run.call(self, cmd, ctx);
      case 0x29: case 0x2a:
        return objectBody.run.call(self, cmd);
      case 0x05: case 0x06: case 0x5d: case 0x3b: case 0x3c: case 0x4d: case 0x56: case 0x7c:
        return animBody.run.call(self, cmd, ctx);
      case 0x96: case 0x6d: case 0xa1:
        return sceneBody.run.call(self, cmd);
      case 0x73:
        return animBody.run.call(self, cmd, ctx);
      case 0x74: // PAUSE
        return "unhandled";
      case 0x0b: // TALK
      case 0x21: // TALKRANDOM
      case 0x88: // TALKRANDOMINDEX
        return talkBody.talk.call(self, cmd, ctx);
      case 0x18: case 0x19: case 0x5f: case 0x3a:
        return talkBody.run.call(self, cmd, ctx);
      case 0x25:
        return itemBody.run.call(self, cmd, ctx);
      case 0x33:
        return talkBody.run.call(self, cmd, ctx);
      case 0x1e: // EFFECT
      case 0x20: // EFFECTVOLUME
      case 0x67: // WAITWHILEEFFECT
      case 0x86: // UNLOCKCANAL
      case 0x42: // WALKEFFECT
      case 0x54: // ANIMAEFFECT
        return soundBody.sound.call(self, cmd, ctx);
      case 0x3f: case 0x91:
        return soundBody.run.call(self, cmd, ctx);
      case 0x23: case 0x6e: case 0x83:
        return filmBody.run.call(self, cmd, ctx);
      case 0x2b: case 0x2f: case 0x30: case 0x31: case 0x32: case 0x57: case 0x58: case 0x99: case 0x36:
        return sceneBody.run.call(self, cmd);
      case 0x55: case 0x76: case 0xa0:
        return areaBody.apply.call(self, cmd);
      case 0x7b: case 0x87: case 0x98:
        return areaBody.run.call(self, cmd, ctx);
      case 0x0c:
        return talkBody.run.call(self, cmd, ctx);
      case 0x81: case 0x14: case 0x78:
        return sceneBody.run.call(self, cmd);
      case 0x5c: {
        // AUTOINCRANGE var min max (case 0x5b): the interpreter set `var = min`; the clock takes the range
        const i = varIndex(this.interpreter.vars, cmd.n1);
        if (i >= 0) this.env.autoInc?.start(i, cmd.a[0], cmd.a[1]);
        return "done";
      }
      default:
        return "unhandled";
    }
  }
}
