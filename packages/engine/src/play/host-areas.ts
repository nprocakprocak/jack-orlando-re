// Area commands and the point tests that write a variable.

import { applyAreaCommand, resolveAreaRef } from "../areas";
import type { Command, CommandContext, CommandResult } from "../script";
import { JACK } from "../script";
import { areaContains, findWalkTriangle } from "../walk";
import { objectAt } from "../walk/objects";
import type { HostState } from "./host-state";

// SETAREA / SETSPECAREA / IGNOREAREA
export function apply(this: HostState, cmd: Command): CommandResult {
    const sc = this.env.scene;
    applyAreaCommand(this.env.areas, sc.scene.areas, cmd);
    return "done";
}

export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
    const sc = this.env.scene;
    switch (cmd.code) {
      case 0x7b: // PINAREA
        return personInArea.call(this, cmd, ctx);
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
      default:
        return "unhandled";
    }
}

function personInArea(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
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
