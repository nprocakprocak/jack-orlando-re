// Object animations and the macro an animation frame starts.

import type { AnimaArgs } from "../anim";
import type { Command, CommandContext, CommandResult } from "../script";
import type { HostState } from "./host-state";

/** ACTIVEMACROANIMA: one macro per animation and image (table `[image + anim * 300]`, a later one replaces). */
export function registerAnimaMacro(this: HostState, cmd: Command): void {
  const e = { macro: cmd.n1, anim: cmd.n2, rec: cmd.a[2], image: cmd.a[0] };
  const i = this.animaMacros.findIndex((m) => m.anim === e.anim && m.image === e.image);
  if (i >= 0) this.animaMacros[i] = e;
  else this.animaMacros.push(e);
}

export function anima(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
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
  const args: AnimaArgs = {
    mode: mode as 1 | 2 | 3 | 4,
    delay: cmd.a[1],
    backward: cmd.a[0] !== 0,
    rec: cmd.a[4],
  };
  try {
    sc.startObjectAnim(cmd.n1, args);
  } catch {
    return "unhandled";
  }
  // the modes that end (1, 3) count as an operation the "-" flag waits for
  if (mode === 1 || mode === 3) return this.wait(`anim:${cmd.n1}`, ctx);
  return "done";
}

export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
  const sc = this.env.scene;
  const a = cmd.a;
  switch (cmd.code) {
    case 0x1c: // SHOWANIMAFRAME anim n
      sc.showAnimFrame(cmd.n1, a[0]);
      return "done";
    case 0x68: // SETDARKNESSANIMA anim f
      sc.setAnimDarkness(cmd.n1, cmd.f ?? 1);
      return "done";
    case 0x82: // CLEARANIMABUFFER anim
      sc.clearAnimBuffer(cmd.n1);
      return "done";
    case 0x05: // ANIMA
      return anima.call(this, cmd, ctx);
    case 0x06: // STOPANIMA
      sc.objectAnim(cmd.n1)?.stop();
      return "done";
    case 0x5d: {
      // CONTINUEANIMA
      const an = sc.objectAnim(cmd.n1);
      if (an) an.active = true;
      return "done";
    }
    case 0x3b: {
      // STOPANIMANEG
      const an = sc.objectAnim(cmd.n1);
      if (an) an.stopAtMarker = true;
      return "done";
    }
    case 0x3c: // SETANIMAFRAME anim rec frame
      sc.objectAnim(cmd.n1)?.setFrame(a[0], a[1]);
      return "done";
    case 0x4d: // WAITWHILEANIMA
      return sc.objectAnim(cmd.n1)?.active ? "repeat" : "done";
    case 0x56: {
      // WAITTOANIMAFRAME anim image
      const an = sc.objectAnim(cmd.n1);
      return an?.active && an.index !== a[0] ? "repeat" : "done";
    }
    case 0x7c: {
      // ANIMADELAY
      const an = sc.objectAnim(cmd.n1);
      if (an) an.delay = a[1];
      return "done";
    }
    case 0x73: // ACTIVEMACROANIMA macro anim rec image
      registerAnimaMacro.call(this, cmd);
      return "done";
    default:
      return "unhandled";
  }
}
