// The script host of a running scene: maps the commands of the macro interpreter
// onto the ScenePlayer (Jack, persons, objects, camera), the area flags, the dialog layer
// (TALK, DIALOG, SHOWFACE...), sound and music, films (RUNAVX), .FLX animations, and,
// through ItemPort, the coat. `PAUSE` and any command with no case return "unhandled":
// the interpreter logs it and skips it. A command whose target is missing (no item port,
// no dialog layer for a face command, no person of that name) does the same.
// Without `env.dialog` a talk line waits a fixed number of ticks, and DIALOG takes the
// answer from `env.answer`. No DOM.
import type { AnimaArgs } from "../anim";
import { applyAreaCommand, resolveAreaRef, type AreaState } from "../areas";
import type { DialogController, Speaker } from "../dialog";
import { findDialog } from "../formats/dialog";
import type { Command, CommandContext, CommandResult, Interpreter, LogEntry, ScriptHost } from "../script";
import { Gestures, type JackInfo } from "../gestures";
import { gotoSceneName, JACK } from "../script";
import type { ScenePlayer } from "../scene";
import { areaContains, findWalkTriangle } from "../walk";
import { objectAt } from "../walk/objects";
import { setPointRotate } from "../walk/turn";
import type { PlayAudio } from "./audio";

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

/** Logic ticks (15 ms) a talk line lasts when there is no sound or subtitle to time it (docs: 3 * length + 200 ms). */
export const TALK_TICKS = 100;

/** Commands that wait for the line to be spoken (WAIT_KIND "talk"). */
const TALK_CODES = new Set([0x0b, 0x21, 0x88]);
/** Speaker codes the compiler leaves in `a[2]` of TALK (script/compiler.ts SPEAKERS). */
const SPEAKER_LEFT = -10;
const SPEAKER_RIGHT = -11;
const SPEAKER_POS = -12;

/**
 * The inventory commands of the scripts: the coat, the item in hand, the revolver
 * and the uniform live in the game, not in the scene. Without it (`HostEnv.items` absent) the commands are "unhandled".
 */
export interface ItemPort {
  /** HAVETOOL object (`Inventory_Add`): the object's image into the first free slot of the active region */
  haveTool(object: string): void;
  /** NOHAVETOOL name (`Script_ExecStep` case 0x46): the item in hand with that name, else the first slot with it */
  noHaveTool(name: string): void;
  /** NOHAVE (`Cursor_ResetMode`): the item in hand is gone, the cursor is the pointer again */
  noHave(): void;
  /** TAKE object (case 0x21): the object's image into the hand; false = the object has no image */
  take(object: string): boolean;
  /** MOUSETOTOOL (`Item_PutBackToBar`): what is in the hand goes to the coat */
  mouseToTool(): void;
  /** ITEMPRESENT (`Inventory_Has`): in a slot (the hand does not count) */
  itemPresent(name: string): boolean;
  /** EXTRA 11 (SC105): the slots 66..83 move to 0..65 */
  moveBigRegion(): void;
  /** HAVEGUN / NOHAVEGUN: `Cursor_LoadSet2` + `GUN = 1` / `Cursor_LoadSet1` + `GUN = 0` (mode 3 → 0) */
  setGun(on: boolean): void;
  /** EXTRA 6 / 8: `g_jackUniform` (the version of the coat) */
  setUniform(on: boolean): void;
}

export interface HostEnv {
  scene: ScenePlayer;
  areas: AreaState;
  /** GOTOSCENE: name of the next scene (without extension) */
  gotoScene(name: string): void;
  /** REFRESHSCREEN: the next scene change fades (Scene_RefreshBackground, g_mixingPending) */
  requestFade(): void;
  /** DIALOG when the dialog layer is off: the answer for dialog `id`. `asked` is how often it has been asked. */
  answer(id: number, asked: number): number;
  /** x of the last click in scene coordinates (IFMOUSEXM / IFMOUSEXW) */
  clickX(): number;
  log(entry: LogEntry): void;
  /** The dialog layer. When set, TALK / DIALOG / SHOWFACE run on it. When absent, a talk line waits a fixed number of ticks and DIALOG uses `answer`. */
  dialog?: DialogController;
  /** Sound, music and speech ; without it effects and music commands are skipped. */
  audio?: PlayAudio;
  /** RUNAVX film scene: the game plays the film at the end of the frame (Game_Run, 4852) and loads `scene` */
  runMovie?(film: string, scene: string): void;
  /**
 * RUNFILMP film x y mode: `Film_Play` plays the `.FCM` film of the scene in a window and returns when it has
 * ended; the game does nothing else meanwhile (the scene stands, the scripts wait). The game plays it after this frame's commands.
 */
  runFilm?(film: string, x: number, y: number, mode: number, global?: boolean): void;
  /** The inventory commands: the coat, the hand, the revolver */
  items?: ItemPort;
  /** The AUTOINCRANGE clock (owned by the game: it outlives the scene); without it the command only sets the variable. */
  autoInc?: AutoIncClock;
}

/**
 * RUNGLOBALFILMP's place (Script_ExecStep case 0x6d, instructions): `x = y = -100` means "at Jack":
 * x = ftol(g_jackX), y = ftol(g_jackY - 100) (a short each), otherwise the script's numbers.
 */
export function globalFilmTarget(x: number, y: number, jack: { x: number; y: number }): [number, number] {
  if (x !== -100 || y !== -100) return [x, y];
  const s16 = (v: number) => (Math.trunc(v) << 16) >> 16;
  return [s16(jack.x), s16(jack.y - 100)];
}

/**
 * Operations that end later: the macro index waits in a queue until the scene reports the
 * event (walk arrived, insertion ended, animation ended), then `Interpreter.complete`.
 */
/** SETPOSITION, INITFIRST, RUNINSERTION, WALKTO, WALKTODIR, PUNDERP, PUNDERE (all only for JACK), STAY and ROTATETO (any target: Script_Stay / the Jack turn). */
export function skippedWhenRestoring(cmd: Command): boolean {
  switch (cmd.code) {
    case 0x4a: // STAY (case 0x49)
    case 0x77: // ROTATETO (case 0x76, also needs g_jackShown)
      return true;
    case 0x02:
    case 0x03:
    case 0x07:
    case 0x08:
    case 0x15:
    case 0x16:
    case 0x17:
      return cmd.n1 === "JACK";
    default:
      return false;
  }
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

  constructor(private readonly env: HostEnv, private readonly talkTicks = TALK_TICKS) {}

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
    if (this.restoringPose && ctx.macroName === "INIT" && skippedWhenRestoring(cmd)) return "done";
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

  /** The interpreter counts every "async" as pending; only the flag "-" makes the macro wait for it. */
  private wait(key: string, ctx: CommandContext): "async" {
    this.slots.set(key, ctx.macro);
    return "async";
  }

  /**
 * ROTATETO / STAY with a turn: `runnable = 0` whatever the flag (the commands have none in the
 * data); the interpreter blocks only on "-", so the macro is blocked here ([PRE] runs without waiting).
 */
  private waitAlways(key: string, ctx: CommandContext): "async" {
    if (!ctx.synchronous) this.interpreter.macros[ctx.macro].blocked = true;
    return this.wait(key, ctx);
  }

  // --- the commands -----------------------------------------------------------------------------

  private run(cmd: Command, ctx: CommandContext): CommandResult {
    const sc = this.env.scene;
    const a = cmd.a;
    const isJack = cmd.n1 === "JACK";
    const person = (): number => sc.persons.find(cmd.n1);
    switch (cmd.code) {
      // -- Jack and persons
      case 0x02: // SETPOSITION person x y
        if (isJack) sc.setJackPosition(ctx.arg(0), ctx.arg(1));
        else sc.persons.get(cmd.n1)?.setPosition(ctx.arg(0), ctx.arg(1));
        this.setJackVars(ctx);
        return "done";
      case 0x04: // SETPERSONDATA person n1 f n2 n3
        if (isJack) sc.setJackData(a[0], cmd.f ?? 1, a[1], a[2]);
        else sc.persons.get(cmd.n1)?.setPersonData(a[0], a[1], a[2], cmd.f ?? 1);
        return "done";
      case 0x37: // SETPERSPY
        if (!isJack) sc.persons.get(cmd.n1)?.setHorizon(a[0]);
        else sc.world.perspective.horizonY = a[0];
        return "done";
      case 0x38: // MOVEP person dx dy
        // case 0x37: for Jack only g_jackX / g_jackY change (floats): not g_jackScale, not the walk state, no variables
        if (isJack) {
          sc.walker.x = Math.fround(sc.walker.x + a[0]);
          sc.walker.y = Math.fround(sc.walker.y + a[1]);
        } else sc.persons.get(cmd.n1)?.movePosition(a[0], a[1]);
        return "done";
      case 0x07: // WALKTO person x y
      case 0x17: // WALKTODIR person x y dir
        return this.walk(cmd, ctx, cmd.code === 0x17 ? a[2] : null);
      case 0x03: // INITFIRST person insertion dir
      case 0x08: // RUNINSERTION person insertion f dir
        return this.insertion(cmd, ctx);
      case 0x0a: // HIDE
        if (isJack) sc.hideJack();
        else if (person() >= 0) sc.hidePerson(person());
        return "done";
      case 0x4a: // STAY direction: Script_Stay (the name is the facing); a turn from the old facing holds the macro like ROTATETO
        return sc.stayJack(cmd.n1) ? this.waitAlways("jack:turn", ctx) : "done";
      case 0x51: // STAYDEF
        sc.standJack();
        return "done";
      case 0x27: // SETFRAME person frame mode
        if (!isJack) sc.persons.get(cmd.n1)?.setFrame(a[0], a[1] === 2 ? 2 : a[1] === 4 ? 4 : 0);
        return "done";
      case 0x10: // SHOWFRAME person frame
        if (!isJack) sc.persons.get(cmd.n1)?.show(a[0]);
        return "done";
      case 0x6a: { // SETDIRWALK person v
        const p = sc.persons.get(cmd.n1);
        if (p) p.reverse = a[0] !== 0;
        return "done";
      }
      case 0x34: { // SETCHKPRIOR person v (JACK:, Script_ExecStep case 0x33)
        if (isJack) {
          sc.jackCheckDepth = a[0] !== 0;
          return "done";
        }
        const p = sc.persons.get(cmd.n1);
        if (p) p.checkDepth = a[0] !== 0;
        return "done";
      }
      case 0x97: { // CHKDISTANCE person v (Jack steps aside: ScenePlayer.checkAvoid)
        const p = sc.persons.get(cmd.n1);
        if (p) p.checkDistance = a[1] !== 0;
        return "done";
      }
      // -- shadows: the state and the drawing are the scene's
      case 0x13: // SETSHADOW person n
        if (!isJack && person() < 0) return "unhandled";
        sc.setShadow(isJack ? null : person(), a[0]);
        return "done";
      case 0x8b: // MINSHADOW person n [which]: Jack's second shadow with which = 1
        if (!isJack && person() < 0) return "unhandled";
        sc.fadeShadowOut(isJack ? null : person(), a[0], a[2]);
        return "done";
      case 0x8c: // MAXSHADOW person n [which]
        if (!isJack && person() < 0) return "unhandled";
        sc.fadeShadowIn(isJack ? null : person(), a[0], a[2]);
        return "done";
      case 0x8f: { // SHIFTSHADOWP person dx dy
        const p = sc.persons.get(cmd.n1);
        if (!p) return "unhandled";
        p.shadowDx = a[1];
        p.shadowDy = a[2];
        return "done";
      }
      case 0x9a: { // SETSPECSHADOW person object: both names are read into n1, the person stays in the refs
        const who = sc.persons.find((cmd.refs.find((r) => r[1] === "person")?.[2] as string | undefined) ?? "");
        return who >= 0 && sc.setSpecShadow(who, cmd.n1) ? "done" : "unhandled";
      }
      case 0x9b: // SHOWSHADOW person x y scale (EXTRA = -1: the extra sprite's shadow)
        if (a[0] < 0) {
          sc.showExtraShadow(a[1], a[2], cmd.f ?? 1);
          return "done";
        }
        if (person() < 0) return "unhandled";
        sc.showShadow(person(), a[1], a[2], cmd.f ?? 1);
        return "done";
      case 0x9c: // SHADOWSTATUS person 0|1
        if (person() < 0) return "unhandled";
        sc.setShadowStatus(person(), a[1] === 1);
        return "done";
      case 0x9d: // HIDESHADOW person
        if (a[0] < 0) {
          sc.showExtraShadow(0, 500, 1);
          return "done";
        }
        if (person() < 0) return "unhandled";
        sc.hideShadow(person());
        return "done";
      // -- shadows of objects
      case 0x12: // SHADOWBY object dx dy level: the object's image baked into the background as a shadow
        return sc.shadowBy(cmd.n1, a[0], a[1], a[2]) ? "done" : "unhandled";
      case 0x8d: // PUTSHADOW x y f: the round shadow baked into the background
        sc.putShadowOnBackground(a[0], a[1], cmd.f ?? 1);
        return "done";
      case 0x8e: { // ANIMASHADOW anim person shadow|NULL n: Jack's shadow follows the points while the FLX anim runs
        const anim = cmd.refs.find((r) => r[1] === "anim")?.[2] as string | undefined;
        const shadow = cmd.n1 === "NULL" ? null : /^SHAD(\d+)$/.exec(cmd.n1)?.[1];
        if (!anim || shadow === undefined) return "unhandled";
        return sc.setAnimShadow(anim, a[1] === 0x66 ? null : a[1], shadow === null ? null : Number(shadow), a[3] !== 0) ? "done" : "unhandled";
      }
      case 0x9e: // SHADOWONE object: persons' shadows are composed with the sprites up to the object's layer
        return sc.setShadowOne(cmd.n1) ? "done" : "unhandled";
      case 0x61: // LOOKTO x y: the turn runs, the macro goes on (and g_turnMacroWaits is cleared)
        sc.lookAt(ctx.arg(0), ctx.arg(1), false);
        return "done";
      case 0x77: // ROTATETO x y: the macro waits for the end of the turn
        return sc.lookAt(ctx.arg(0), ctx.arg(1)) ? this.waitAlways("jack:turn", ctx) : "done";
      case 0x62: // GETPERSONX
      case 0x63: { // GETPERSONY
        const p = isJack ? sc.walker : sc.persons.get(cmd.n1);
        if (p) ctx.vars.set(cmd.n2, Math.trunc(cmd.code === 0x62 ? p.x : p.y));
        return "done";
      }
      case 0x84: // JACKTEMPO DATA|FREE: DATA = a[0] 1
        sc.setJackTempoFixed(a[0] === 1);
        return "done";
      case 0x65:
        this.walkAllowed = false;
        return "done";
      case 0x66:
        this.walkAllowed = true;
        return "done";
      case 0x43: // HAVEGUN (does not touch g_jackUniform, which the stand scale reads)
        this.env.items?.setGun(true);
        return "done";
      case 0x44: // NOHAVEGUN
        this.env.items?.setGun(false);
        return "done";
      // -- the coat and the hand
      case 0x22: // TAKE object
        return this.env.items?.take(cmd.n1) ? "done" : "unhandled";
      case 0x28: // NOHAVE
      case 0x46: // HAVETOOL object
      case 0x47: // NOHAVETOOL name
      case 0x89: // MOUSETOTOOL
      case 0x9f: // ITEMPRESENT name var
        return this.itemCommand(cmd, ctx);
      case 0x85: // CLEARMENUBAR: an empty branch in the exe
        return "done";
      // -- objects and animations
      case 0x2c: // SETPOSITIONE object x y
      case 0x70: // SETPOSITIONEV
        sc.setObjectPosition(cmd.n1, ctx.arg(0), ctx.arg(1));
        return "done";
      case 0x40: // MOVEE object dx dy
        sc.setObjectPosition(cmd.n1, a[0], a[1], true);
        return "done";
      case 0x16: // PUNDERE person object
      case 0x1d: { // POVERE
        const i = cmd.n1 === "JACK" ? null : sc.persons.find(cmd.n1);
        if (i === -1) return "unhandled";
        sc.placeAgainstObject(i, cmd.n2, cmd.code === 0x1d);
        return "done";
      }
      case 0x15: { // PUNDERP person1 person2
        // the second person may be JACK too (SC057 `PUNDERP OCHR JACK`): the first one then goes directly under Jack's sprite
        const other = cmd.n2 === "JACK" ? null : sc.persons.find(cmd.n2);
        const i = isJack ? null : sc.persons.find(cmd.n1);
        if (other === -1 || i === -1) return "unhandled";
        sc.placeUnderPerson(i, other);
        return "done";
      }
      case 0x3e: // EOVERE object1 object2
        sc.placeObjectOver(cmd.n1, cmd.n2);
        return "done";
      case 0x01: // CHWINDOW name left top right bottom (clip rectangle of the sprite); an unknown name does nothing (SC001 CAR1/CAR2)
        sc.setClip(cmd.n1, { left: a[0], top: a[1], right: a[2], bottom: a[3] });
        return "done";
      // -- gestures of Jack: a global insertion, the macro waits for its end (state)
      case 0x90: // PICKUP n
      case 0x92: // GIVE n
      case 0x93: // SHOOTF n
      case 0x94: { // SLAPF n
        const g = this.gestures.command(cmd.code, a[0], this.jackInfo());
        if (!g) return "unhandled";
        if (g.vars) for (const [k, v] of Object.entries(g.vars)) ctx.vars.set(k, v);
        if (g.start) sc.startGlobalInsertion(g.start.name, g.start.facing, g.start.scaleMul);
        return g.result;
      }
      // -- objects and animations: "done" whether or not the name exists
      case 0x1c: // SHOWANIMAFRAME anim n
        sc.showAnimFrame(cmd.n1, a[0]);
        return "done";
      case 0x68: // SETDARKNESSANIMA anim f
        sc.setAnimDarkness(cmd.n1, cmd.f ?? 1);
        return "done";
      case 0x41: // BRIGHTNESSE object f
        sc.brightenObject(cmd.n1, cmd.f ?? 1);
        return "done";
      case 0x82: // CLEARANIMABUFFER anim
        sc.clearAnimBuffer(cmd.n1);
        return "done";
      case 0x4c: // MOVEEP object dx dy
        sc.moveObjectPoint(cmd.n1, a[0], a[1]);
        return "done";
      case 0x8a: // RELATIVEMULP person f
        sc.setPersonLightScale(isJack ? null : person() < 0 ? null : person(), cmd.f ?? 1);
        return "done";
      case 0x29:
        sc.setObjectVisible(cmd.n1, false);
        return "done";
      case 0x2a:
        sc.setObjectVisible(cmd.n1, true);
        return "done";
      case 0x05:
        return this.anima(cmd, ctx);
      case 0x06: // STOPANIMA
        sc.objectAnim(cmd.n1)?.stop();
        return "done";
      case 0x5d: { // CONTINUEANIMA
        const an = sc.objectAnim(cmd.n1);
        if (an) an.active = true;
        return "done";
      }
      case 0x3b: { // STOPANIMANEG
        const an = sc.objectAnim(cmd.n1);
        if (an) an.stopAtMarker = true;
        return "done";
      }
      case 0x3c: // SETANIMAFRAME anim rec frame
        sc.objectAnim(cmd.n1)?.setFrame(a[0], a[1]);
        return "done";
      case 0x4d: // WAITWHILEANIMA
        return sc.objectAnim(cmd.n1)?.active ? "repeat" : "done";
      case 0x56: { // WAITTOANIMAFRAME anim image
        const an = sc.objectAnim(cmd.n1);
        return an?.active && an.index !== a[0] ? "repeat" : "done";
      }
      case 0x7c: { // ANIMADELAY
        const an = sc.objectAnim(cmd.n1);
        if (an) an.delay = a[1];
        return "done";
      }
      case 0x96: // SETPOSSCROLL L|R x y (a[2] = 0 for L)
        this.scrollPoints[a[2] === 0 ? "L" : "R"] = { x: a[0], y: a[1] };
        return "done";
      case 0x6d: // POINTROTATE n
        this.pointRotate = a[0];
        setPointRotate(this.env.scene.tj, a[0] !== 0);
        return "done";
      case 0xa1: // SAVEABLE n
        this.saveable = a[0] !== 0;
        return "done";
      case 0x73: // ACTIVEMACROANIMA macro anim rec image
        this.registerAnimaMacro(cmd);
        return "done";
      case 0x74: // PAUSE
        return "unhandled";
      // -- dialogs, faces
      case 0x0b: // TALK
      case 0x21: // TALKRANDOM
      case 0x88: // TALKRANDOMINDEX
        return this.talk(cmd, ctx);
      case 0x18: { // SHOWFACE face L|R [*]
        const d = this.env.dialog;
        if (!d) return "unhandled";
        // Script_ExecStep case 0x17 (009822..): while the view scrolled in the last 14 ms tick SHOWFACE does nothing and
        // its macro counter steps back - the command is tried again next tick. So a face (and the TALK after it) waits for the end of the scroll.
        if (this.viewScrolling && !ctx.synchronous) return "repeat";
        return d.showFace(cmd.n1, cmd.c === "R" ? "R" : "L", a[1] === 1) ? "done" : "unhandled";
      }
      case 0x19: // HIDEFACE L|R
        if (!this.env.dialog) return "unhandled";
        this.env.dialog.hideFace(cmd.c === "R" ? "R" : "L");
        return "done";
      case 0x5f: // HIDEFACEAT L|R: hidden when the current line ends (Script_ExecStep case 0x5e, Talk_FaceStep)
        if (!this.env.dialog) return "unhandled";
        this.env.dialog.hideFaceAt(cmd.c === "R" ? "R" : "L");
        return "done";
      case 0x3a: // SETDIALOG dialog option state
        if (!this.env.dialog) return "unhandled";
        this.env.dialog.setDialogOption(a[0], a[1], a[2]);
        return "done";
      case 0x25: // EXTRA n: 1 = the colt, 6 / 8 = the uniform of Jack on / off, 10 = music off, 11 = the big region of the coat (the rest is not played)
        if (a[0] === 1 && this.env.items) {
          this.env.items.setGun(true); // Cursor_LoadSet2 (the cursors and the bullet icon follow GUN here), like HAVEGUN
          return "done";
        }
        if (a[0] === 10 && this.env.audio) {
          this.env.audio.music.stop(); // Music_Stop, and the track name is cleared: the next MUSIC starts anew
          this.env.audio.music.trackName = "";
          return "done";
        }
        if (a[0] === 11 && this.env.items) {
          this.env.items.moveBigRegion();
          return "done";
        }
        if ((!this.env.dialog && !this.env.items) || (a[0] !== 6 && a[0] !== 8)) return "unhandled";
        // 6: Jack_LoadWalkFramesUniform (only when not yet in the uniform), 8: Jack_LoadWalkFrames (only when
        // in it): the walk/stand/turn frame sets, the stand scale, the turn table, JACKISWOJ (the script's own LET
        // follows in SC105) and g_jackUniform (the face JACKWOJ, the coat INV_M, the gestures DM/SW). The shown sprite changes
        // with Jack's next frame.
        if (sc.tj.uniform === (a[0] === 6)) return "done"; // the case 0x24 tests g_jackUniform first
        if (this.env.dialog) this.env.dialog.jackUniform = a[0] === 6;
        this.env.items?.setUniform(a[0] === 6);
        sc.tj.uniform = a[0] === 6;
        if (sc.jack) sc.jack.uniform = a[0] === 6; // (the fake scenes of m3.test.ts have no animator)
        ctx.vars.set("JACKISWOJ", a[0] === 6 ? 1 : 0);
        return "done";
      case 0x33: // SETPOSXY x y
        this.posXY = { x: a[0], y: a[1] };
        return "done";
      // -- sound and music
      case 0x1e: // EFFECT
      case 0x20: // EFFECTVOLUME
      case 0x67: // WAITWHILEEFFECT
      case 0x86: // UNLOCKCANAL
      case 0x42: // WALKEFFECT
      case 0x54: // ANIMAEFFECT
        return this.sound(cmd, ctx);
      case 0x3f: { // MUSIC name fadeOut fadeIn
        const audio = this.env.audio;
        if (!audio) return "unhandled";
        const track = audio.track(cmd.n1);
        if (!track) {
          // a track that was not read (a missing file) plays nothing; the name is remembered as without sound
          audio.music.trackName = cmd.n1;
          return "done";
        }
        let r = audio.music.command(cmd.n1, a[0], a[1], () => track);
        if (r === "retry" && ctx.synchronous) {
          // [PRE] steps this macro in a loop with the 14 ms timer (Game_Tick14ms) running meanwhile: the fade-out
          // of the old track is over before the scene is shown. Here the loop has no clock, so the fade ticks are run at once.
          for (let n = 0; n < 10000 && audio.music.fadingOut; n++) audio.music.tick14ms();
          r = audio.music.command(cmd.n1, a[0], a[1], () => track);
        }
        return r === "retry" ? "repeat" : "done";
      }
      case 0x91: // MUSICVOLUME f
        if (!this.env.audio) return "unhandled";
        this.env.audio.setMusicScale(cmd.f ?? 1);
        return "done";
      case 0x23: // RUNFILMP film x y mode (Film_Play: blocks the whole game, the script goes on afterwards)
        if (!this.env.runFilm) return "unhandled";
        this.env.runFilm(cmd.n1, ctx.arg(0), ctx.arg(1), ctx.arg(2));
        return "done";
      case 0x6e: {
        // RUNGLOBALFILMP film x y mode (Script_ExecStep case 0x6d -> Film_Play(1): the film is a section of GLOBAL.FCM)
        if (!this.env.runFilm) return "unhandled";
        const [x, y] = globalFilmTarget(ctx.arg(0), ctx.arg(1), this.env.scene.pose());
        this.env.runFilm(cmd.n1, x, y, ctx.arg(2), true);
        return "done";
      }
      case 0x83: // RUNAVX film scene
        if (!this.env.runMovie) return "unhandled";
        this.env.runMovie(cmd.n1, cmd.n2);
        return "done";
      // -- camera
      case 0x2b:
        sc.setScroll(a[0]);
        return "done";
      case 0x2f:
        sc.scrollDir = -1;
        return "done";
      case 0x30:
        sc.scrollDir = 1;
        return "done";
      case 0x31:
        sc.setScrollLimits(a[0], null);
        return "done";
      case 0x32:
        sc.setScrollLimits(null, a[0]);
        return "done";
      case 0x57:
        sc.marginL = a[0];
        return "done";
      case 0x58:
        sc.marginR = a[0];
        return "done";
      case 0x99:
        sc.bgWide = a[0] !== 0;
        return "done";
      case 0x36:
        sc.brightness = cmd.f ?? 1;
        return "done";
      // -- areas
      case 0x55:
      case 0x76:
      case 0xa0:
        applyAreaCommand(this.env.areas, sc.scene.areas, cmd);
        return "done";
      case 0x7b:
        return this.personInArea(cmd, ctx);
      case 0x87: { // POINTINSECAREA x y var: var = Object_FindAtPoint(x, y) (1 when a valid object quad contains the point, else 0)
        const out = cmd.refs.find((r) => r[0] === 2 && r[1] === "var")?.[2] as string | undefined;
        if (out) ctx.vars.set(out, objectAt(sc.world.objects, { x: ctx.arg(0), y: ctx.arg(1) }) >= 0 ? 1 : 0);
        return "done";
      }
      case 0x98: { // POINTINWALKAREA x y var
        const out = cmd.refs.find((r) => r[0] === 2 && r[1] === "var")?.[2] as string | undefined;
        if (out) ctx.vars.set(out, findWalkTriangle(sc.world.walk, ctx.arg(0), ctx.arg(1)) >= 0 ? 1 : 0);
        return "done";
      }
      case 0x0c: { // DIALOG speaker dialog: the answer menu ; without a dialog layer an answer by `env.answer`
        if (this.env.dialog) return this.env.dialog.startDialog(cmd.n1, a[0], ctx.macro) ? "block" : "unhandled";
        const asked = (this.dialogsAsked.get(a[0]) ?? 0) + 1;
        this.dialogsAsked.set(a[0], asked);
        this.interpreter.answers.set(a[0], this.env.answer(a[0], asked));
        return "unhandled";
      }
      // -- scene
      case 0x81:
        this.env.requestFade();
        return "done";
      case 0x14:
        this.env.gotoScene(gotoSceneName(cmd.n1));
        return "done";
      case 0x5c: {
        // AUTOINCRANGE var min max (case 0x5b): the interpreter set `var = min`; the clock takes the range
        const i = varIndex(this.interpreter.vars, cmd.n1);
        if (i >= 0) this.env.autoInc?.start(i, cmd.a[0], cmd.a[1]);
        return "done";
      }
      case 0x78: // MACRODESTRUCTOR is bookkeeping in the interpreter
        return "done";
      default:
        return "unhandled";
    }
  }

  private itemCommand(cmd: Command, ctx: CommandContext): CommandResult {
    const items = this.env.items;
    if (!items) return "unhandled";
    switch (cmd.code) {
      case 0x28:
        items.noHave();
        break;
      case 0x46:
        items.haveTool(cmd.n1);
        break;
      case 0x47:
        items.noHaveTool(cmd.n1);
        break;
      case 0x89:
        items.mouseToTool();
        break;
      default:
        ctx.vars.set(cmd.n2, items.itemPresent(cmd.n1) ? 1 : 0);
    }
    return "done";
  }

  /** Before the dialog layer: a line with `-` waits `talkTicks` ticks. */
  private fallbackTalk(cmd: Command, ctx: CommandContext): CommandResult {
    if (!TALK_CODES.has(cmd.code) || cmd.c !== "-") return "unhandled";
    this.timers.push({ ticks: this.talkTicks, macro: ctx.macro });
    this.noteSkipped(cmd);
    return "async";
  }

  /** ACTIVEMACROANIMA: one macro per animation and image (table `[image + anim * 300]`, a later one replaces). */
  private registerAnimaMacro(cmd: Command): void {
    const e = { macro: cmd.n1, anim: cmd.n2, rec: cmd.a[2], image: cmd.a[0] };
    const i = this.animaMacros.findIndex((m) => m.anim === e.anim && m.image === e.image);
    if (i >= 0) this.animaMacros[i] = e;
    else this.animaMacros.push(e);
  }

  /** Who speaks (a[2] from the compiler): the window of a side, a point above Jack / a person, or `SETPOSXY`. */
  private speaker(cmd: Command): Speaker | null {
    const sc = this.env.scene;
    switch (cmd.a[2]) {
      case SPEAKER_LEFT:
        return "LEFT";
      case SPEAKER_RIGHT:
        return "RIGHT";
      case SPEAKER_POS:
        return { ...this.posXY };
      case JACK:
        return sc.speakerPoint(null);
      default: {
        const i = sc.persons.find(cmd.n1);
        return i < 0 ? null : sc.speakerPoint(i);
      }
    }
  }

  /**
 * TALK / TALKRANDOM / TALKRANDOMINDEX (Script_ExecStep case 10): the line runs on the dialog layer; with `-` the
 * macro waits (`async`, released by `DialogHost.resume`), with `+` it goes on.
 */
  private talk(cmd: Command, ctx: CommandContext): CommandResult {
    const d = this.env.dialog;
    if (!d) return this.fallbackTalk(cmd, ctx);
    const speaker = this.speaker(cmd);
    if (!speaker) return "unhandled";
    const wait = cmd.c === "-" ? "-" : "+";
    const channel = cmd.a[1];
    const replaced = d.talking ? this.talkWaiter : null;
    let ok = false;
    if (cmd.code === 0x0b) ok = d.talk(speaker, cmd.a[0], channel, wait, ctx.macro);
    else if (d.dcn) {
      const k = findDialog(d.dcn, cmd.a[0]);
      if (k >= 0) {
        const count = Math.max(1, d.dcn.dialogs[k].count);
        const index = cmd.code === 0x21 ? this.random() % count : cmd.a[3];
        if (cmd.code === 0x21 && ctx.vars.has("RAND")) ctx.vars.set("RAND", index);
        ok = d.talkOption(speaker, cmd.a[0], index, channel, wait, ctx.macro);
      }
    }
    if (!ok) return "unhandled";
    if (typeof speaker === "string") this.env.audio?.duckMusic(true);
    // The game keeps one slot for the macro that waits for a line: a line started over a running one
    // leaves the first macro waiting for ever. Here it is released (**deviation**, only reachable when the timing of
    // the lines differs from the original, e.g. without sound).
    if (replaced !== null) this.interpreter.complete(replaced);
    this.talkWaiter = wait === "-" ? ctx.macro : null;
    return wait === "-" ? "async" : "done";
  }

  /** The dialog layer reports the end of a line whose macro waits for it. */
  talkEnded(macro: number): void {
    if (this.talkWaiter === macro) this.talkWaiter = null;
    this.interpreter.complete(macro);
  }

  /** The sound commands of SfxPlayer (EFFECT...) with the names of this scene. */
  private sound(cmd: Command, ctx: CommandContext): CommandResult {
    const audio = this.env.audio;
    if (!audio) return "unhandled";
    const sc = this.env.scene;
    const r = audio.sfx.command(cmd, {
      person: (n) => sc.persons.find(n),
      anim: (n) => sc.scene.objectAnims.findIndex((x) => x.name === n),
      arg: (i) => ctx.arg(i),
    });
    // the persons module plays the footsteps of the persons from its own table (persons.ts `setWalkEffect`)
    if (cmd.code === 0x42 && cmd.a[3] !== JACK) {
      const p = sc.persons.get(cmd.n1);
      const ref = cmd.refs.find((x) => x[1] === "sound");
      const sound = ref ? (audio.sfx.sounds?.find(String(ref[2])) ?? -1) : -1;
      p?.setWalkEffect(ctx.arg(0), ctx.arg(2) >= 1 ? sound : -1, ctx.arg(5));
    }
    return r === "repeat" ? "repeat" : "done";
  }

  private noteSkipped(cmd: Command): void {
    this.skipped.set(cmd.word, (this.skipped.get(cmd.word) ?? 0) + 1);
    this.env.log({ kind: "unhandled", macro: this.interpreter.macros.find((m) => m.active)?.name ?? "", command: cmd, text: `${cmd.word} (line ${cmd.line}) played as a ${this.talkTicks}-tick pause` });
  }

  private setJackVars(ctx: CommandContext): void {
    syncJackVars(ctx.vars, this.env.scene.walker);
  }

  private walk(cmd: Command, ctx: CommandContext, forced: number | null): CommandResult {
    const sc = this.env.scene;
    const x = ctx.arg(0);
    const y = ctx.arg(1);
    if (cmd.n1 === "JACK") sc.faceBeforeWalk(x, y); // g_jackShown == 0: Jack_FaceTowards first, no turn
    if (cmd.n1 === "JACK" && forced !== null) {
      // WALKTODIR JACK (case 0x16): no Walk_FindPath, Jack_WalkToPoint straight to the point, and the macro
      // is counted whether or not he moved. Jack already at the point does not walk, no step ends the wait: the macro hangs
      // until it is restarted (a bug of the original)
      sc.walkPlan(
        {
          path: [{ x: Math.trunc(sc.walker.x), y: Math.trunc(sc.walker.y) }, { x: Math.trunc(x), y: Math.trunc(y) }],
          direct: true,
          fromOutside: false,
        },
        forced,
      );
      return this.wait("jack:walk", ctx);
    }
    if (cmd.n1 === "JACK") {
      // case 6: without a walk area Walk_FindPath finds no path and Jack_WalkToPoint takes him
      // straight to the point (SC005 JACKGOHOME: the street has no walk area, Jack walks off to the stairs)
      const started = sc.hasWalkArea
        ? sc.walkJackTo(x, y, forced)
        : sc.walkPlan(
            {
              path: [{ x: Math.trunc(sc.walker.x), y: Math.trunc(sc.walker.y) }, { x: Math.trunc(x), y: Math.trunc(y) }],
              direct: true,
              fromOutside: false,
            },
            forced,
          );
      if (!started) return "done";
      return this.wait("jack:walk", ctx);
    }
    const i = sc.persons.find(cmd.n1);
    if (i < 0) return "unhandled";
    sc.persons.persons[i].startWalk(x, y, forced ?? undefined);
    return this.wait(`person:${i}:walk`, ctx);
  }

  private insertion(cmd: Command, ctx: CommandContext): CommandResult {
    const sc = this.env.scene;
    const first = cmd.code === 0x03;
    const dir = cmd.a[0];
    const name = cmd.n2;
    if (cmd.n1 === "JACK") {
      if (!sc.jackInsertion(name, dir)) return "unhandled";
      // INITFIRST: no counter, no wait; the flag stops the first insertion that draws a frame, and
      // g_jackInsMacro is not set (the slot keeps the macro of the last RUNINSERTION JACK)
      if (first) {
        sc.insReleaseEarly = true;
        return "done";
      }
      return this.wait("jack:ins", ctx);
    }
    const i = sc.persons.find(cmd.n1);
    if (i < 0) return "unhandled";
    const d = dir === 0 ? 0 : dir === 1 ? 1 : 2;
    if (!sc.personInsertion(i, name, d, undefined, first)) return "unhandled";
    if (first) {
      // [p] = this macro (it is released by the flag, never counted), g_personTimer = 0
      sc.insReleaseEarly = true;
      this.slots.set(`person:${i}:ins`, ctx.macro);
      return "done";
    }
    return this.wait(`person:${i}:ins`, ctx);
  }

  private anima(cmd: Command, ctx: CommandContext): CommandResult {
    const sc = this.env.scene;
    const an = sc.objectAnim(cmd.n1);
    if (!an) return "unhandled";
    const mode = cmd.a[2];
    if (mode === 5 || mode === 6) {
      // .FLX animation: a[1] delay, a[4] record = index of the file in the .ACI section
      if (!sc.startFlxAnim(cmd.n1, mode, cmd.a[1], cmd.a[4])) return "unhandled";
      return mode === 5 ? this.wait(`anim:${cmd.n1}`, ctx) : "done";
    }
    if (mode < 1 || mode > 4) return "unhandled";
    const args: AnimaArgs = { mode: mode as 1 | 2 | 3 | 4, delay: cmd.a[1], backward: cmd.a[0] !== 0, rec: cmd.a[4] };
    try {
      sc.startObjectAnim(cmd.n1, args);
    } catch {
      return "unhandled";
    }
    // the modes that end (1, 3) count as an operation the "-" flag waits for
    if (mode === 1 || mode === 3) return this.wait(`anim:${cmd.n1}`, ctx);
    return "done";
  }

  private personInArea(cmd: Command, ctx: CommandContext): CommandResult {
    const sc = this.env.scene;
    const area = cmd.refs.find((r) => r[1] === "area")?.[2] as string | undefined;
    const out = cmd.refs.find((r) => r[1] === "var")?.[2] as string | undefined;
    if (!area || !out) return "unhandled";
    // a[0] is the person index the compiler resolved (102 = JACK, JACK in persons.ts is 0x66)
    const p = cmd.a[0] === JACK ? sc.walker : sc.persons.persons[cmd.a[0]];
    const idx = resolveAreaRef(sc.scene.areas, area, cmd.a[1] ?? 0);
    if (!p || idx < 0) {
      ctx.vars.set(out, 0);
      return "done";
    }
    ctx.vars.set(out, areaContains(sc.scene.areas[idx], { x: Math.trunc(p.x), y: Math.trunc(p.y) }) ? 1 : 0);
    return "done";
  }
}

/**
 * JACKX / JACKY (script variables) = the integer part of Jack's position. Written by SETPOSITION JACK and, in the
 * original, at every step of Jack's walk: the pigeons of SC003 wait on `IFF JACKX > 320`.
 */
export function syncJackVars(vars: { has(n: string): boolean; set(n: string, v: number): void }, w: { x: number; y: number }): void {
  if (vars.has("JACKX")) vars.set("JACKX", Math.trunc(w.x));
  if (vars.has("JACKY")) vars.set("JACKY", Math.trunc(w.y));
}
