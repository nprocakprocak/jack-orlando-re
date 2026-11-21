// Talk lines, faces, and the answer menu.

import type { Speaker } from "../dialog";
import { findDialog } from "../formats/dialog";
import type { Command, CommandContext, CommandResult } from "../script";
import { JACK } from "../script";
import type { HostState } from "./host-state";

/** Logic ticks (15 ms) a talk line lasts when there is no sound or subtitle to time it (docs: 3 * length + 200 ms). */
export const TALK_TICKS = 100;

/** Commands that wait for the line to be spoken (WAIT_KIND "talk"). */
const TALK_CODES = new Set([0x0b, 0x21, 0x88]);
/** Speaker codes the compiler leaves in `a[2]` of TALK (script/compiler.ts SPEAKERS). */
const SPEAKER_LEFT = -10;
const SPEAKER_RIGHT = -11;
const SPEAKER_POS = -12;

/** Before the dialog layer: a line with `-` waits `talkTicks` ticks. */
export function fallbackTalk(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
    if (!TALK_CODES.has(cmd.code) || cmd.c !== "-") return "unhandled";
    this.timers.push({ ticks: this.talkTicks, macro: ctx.macro });
    this.noteSkipped(cmd);
    return "async";
}

export function noteSkipped(this: HostState, cmd: Command): void {
    this.skipped.set(cmd.word, (this.skipped.get(cmd.word) ?? 0) + 1);
    this.env.log({ kind: "unhandled", macro: this.interpreter.macros.find((m) => m.active)?.name ?? "", command: cmd, text: `${cmd.word} (line ${cmd.line}) played as a ${this.talkTicks}-tick pause` });
}

/** Who speaks (a[2] from the compiler): the window of a side, a point above Jack / a person, or `SETPOSXY`. */
export function speaker(this: HostState, cmd: Command): Speaker | null {
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
export function talk(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
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

export function run(this: HostState, cmd: Command, ctx: CommandContext): CommandResult {
    const a = cmd.a;
    switch (cmd.code) {
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
      case 0x33: // SETPOSXY x y
        this.posXY = { x: a[0], y: a[1] };
        return "done";
      case 0x0c: { // DIALOG speaker dialog: the answer menu ; without a dialog layer an answer by `env.answer`
        if (this.env.dialog) return this.env.dialog.startDialog(cmd.n1, a[0], ctx.macro) ? "block" : "unhandled";
        const asked = (this.dialogsAsked.get(a[0]) ?? 0) + 1;
        this.dialogsAsked.set(a[0], asked);
        this.interpreter.answers.set(a[0], this.env.answer(a[0], asked));
        return "unhandled";
      }
      default:
        return "unhandled";
    }
}
