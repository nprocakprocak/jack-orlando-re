// Position, walk, insertion, stay, and frame commands for Jack and the other persons.

import type { Command, CommandContext, CommandResult } from "../script";
import type { HostState } from "./host-state";

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

/**
 * JACKX / JACKY (script variables) = the integer part of Jack's position. Written by SETPOSITION JACK and, in the
 * original, at every step of Jack's walk: the pigeons of SC003 wait on `IFF JACKX > 320`.
 */
export function syncJackVars(
  vars: { has(n: string): boolean; set(n: string, v: number): void },
  w: { x: number; y: number },
): void {
  if (vars.has("JACKX")) vars.set("JACKX", Math.trunc(w.x));
  if (vars.has("JACKY")) vars.set("JACKY", Math.trunc(w.y));
}

export function setJackVars(this: HostState, ctx: CommandContext): void {
  syncJackVars(ctx.vars, this.env.scene.walker);
}

/** The interpreter counts every "async" as pending; only the flag "-" makes the macro wait for it. */
export function wait(this: HostState, key: string, ctx: CommandContext): "async" {
  this.slots.set(key, ctx.macro);
  return "async";
}

/**
 * ROTATETO / STAY with a turn: `runnable = 0` whatever the flag (the commands have none in the
 * data); the interpreter blocks only on "-", so the macro is blocked here ([PRE] runs without waiting).
 */
export function waitAlways(this: HostState, key: string, ctx: CommandContext): "async" {
  if (!ctx.synchronous) this.interpreter.macros[ctx.macro].blocked = true;
  return this.wait(key, ctx);
}

// WALKTO person x y / WALKTODIR person x y dir
export function walkTo(this: HostState, cmd: Command, ctx: CommandContext, forced: number | null): CommandResult {
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
        path: [
          { x: Math.trunc(sc.walker.x), y: Math.trunc(sc.walker.y) },
          { x: Math.trunc(x), y: Math.trunc(y) },
        ],
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
            path: [
              { x: Math.trunc(sc.walker.x), y: Math.trunc(sc.walker.y) },
              { x: Math.trunc(x), y: Math.trunc(y) },
            ],
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

// INITFIRST person insertion dir / RUNINSERTION person insertion f dir
export function insertion(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
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

// GETPERSONX / GETPERSONY
export function getPersonCoord(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
  const sc = this.env.scene;
  const isJack = cmd.n1 === "JACK";
  const p = isJack ? sc.walker : sc.persons.get(cmd.n1);
  if (p) ctx.vars.set(cmd.n2, Math.trunc(cmd.code === 0x62 ? p.x : p.y));
  return "done";
}

/** The person and Jack commands whose case labels do not share a body. */
export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
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
    case 0x6a: {
      // SETDIRWALK person v
      const p = sc.persons.get(cmd.n1);
      if (p) p.reverse = a[0] !== 0;
      return "done";
    }
    case 0x34: {
      // SETCHKPRIOR person v (JACK:, Script_ExecStep case 0x33)
      if (isJack) {
        sc.jackCheckDepth = a[0] !== 0;
        return "done";
      }
      const p = sc.persons.get(cmd.n1);
      if (p) p.checkDepth = a[0] !== 0;
      return "done";
    }
    case 0x97: {
      // CHKDISTANCE person v (Jack steps aside: ScenePlayer.checkAvoid)
      const p = sc.persons.get(cmd.n1);
      if (p) p.checkDistance = a[1] !== 0;
      return "done";
    }
    case 0x61: // LOOKTO x y: the turn runs, the macro goes on (and g_turnMacroWaits is cleared)
      sc.lookAt(ctx.arg(0), ctx.arg(1), false);
      return "done";
    case 0x77: // ROTATETO x y: the macro waits for the end of the turn
      return sc.lookAt(ctx.arg(0), ctx.arg(1)) ? this.waitAlways("jack:turn", ctx) : "done";
    case 0x84: // JACKTEMPO DATA|FREE: DATA = a[0] 1
      sc.setJackTempoFixed(a[0] === 1);
      return "done";
    case 0x65: // LOCKWALK
      this.walkAllowed = false;
      return "done";
    case 0x66: // UNLOCKWALK
      this.walkAllowed = true;
      return "done";
    case 0x8a: // RELATIVEMULP person f
      sc.setPersonLightScale(isJack ? null : person() < 0 ? null : person(), cmd.f ?? 1);
      return "done";
    default:
      return "unhandled";
  }
}
