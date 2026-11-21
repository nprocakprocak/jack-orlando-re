// Object position, layering, and the clip rectangle.

import type { Command, CommandContext, CommandResult } from "../script";
import type { HostState } from "./host-state";

// SETPOSITIONE object x y / SETPOSITIONEV
export function setObjectPosition(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
  const sc = this.env.scene;
  sc.setObjectPosition(cmd.n1, ctx.arg(0), ctx.arg(1));
  return "done";
}

// PUNDERE person object / POVERE
export function placeAgainst(this: HostState, cmd: Command): CommandResult {
  const sc = this.env.scene;
  const i = cmd.n1 === "JACK" ? null : sc.persons.find(cmd.n1);
  if (i === -1) return "unhandled";
  sc.placeAgainstObject(i, cmd.n2, cmd.code === 0x1d);
  return "done";
}

export function run(this: HostState, cmd: Command): CommandResult {
  const sc = this.env.scene;
  const a = cmd.a;
  const isJack = cmd.n1 === "JACK";
  switch (cmd.code) {
    case 0x40: // MOVEE object dx dy
      sc.setObjectPosition(cmd.n1, a[0], a[1], true);
      return "done";
    case 0x15: {
      // PUNDERP person1 person2
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
    case 0x41: // BRIGHTNESSE object f
      sc.brightenObject(cmd.n1, cmd.f ?? 1);
      return "done";
    case 0x4c: // MOVEEP object dx dy
      sc.moveObjectPoint(cmd.n1, a[0], a[1]);
      return "done";
    case 0x29: // HIDEE
      sc.setObjectVisible(cmd.n1, false);
      return "done";
    case 0x2a: // SHOWE
      sc.setObjectVisible(cmd.n1, true);
      return "done";
    default:
      return "unhandled";
  }
}
