// The coat, the hand, the revolver, and EXTRA.

import type { Command, CommandContext, CommandResult } from "../script";
import type { HostState } from "./host-state";

export function itemCommand(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
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

export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
  const sc = this.env.scene;
  const a = cmd.a;
  switch (cmd.code) {
    case 0x43: // HAVEGUN (does not touch g_jackUniform, which the stand scale reads)
      this.env.items?.setGun(true);
      return "done";
    case 0x44: // NOHAVEGUN
      this.env.items?.setGun(false);
      return "done";
    case 0x22: // TAKE object
      return this.env.items?.take(cmd.n1) ? "done" : "unhandled";
    case 0x85: // CLEARMENUBAR: an empty branch in the exe
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
      if (sc.turning.uniform === (a[0] === 6)) return "done"; // the case 0x24 tests g_jackUniform first
      if (this.env.dialog) this.env.dialog.jackUniform = a[0] === 6;
      this.env.items?.setUniform(a[0] === 6);
      sc.turning.uniform = a[0] === 6;
      if (sc.jack) sc.jack.uniform = a[0] === 6; // (the fake scenes of m3.test.ts have no animator)
      ctx.vars.set("JACKISWOJ", a[0] === 6 ? 1 : 0);
      return "done";
    default:
      return "unhandled";
  }
}
