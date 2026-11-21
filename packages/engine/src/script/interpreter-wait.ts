// How a command waits, plus the host used when a test wants every command logged.

import type { CommandResult, LogEntry, ScriptHost } from "./interpreter-state";

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

/** Scene name of GOTOSCENE (case 0x14): the extension is cut at the last "." and
 * replaced, so "SC026.CFG" and "SC026" both mean SC026. */
export function gotoSceneName(arg: string): string {
  const i = arg.lastIndexOf(".");
  return (i > 0 ? arg.slice(0, i) : arg).toUpperCase();
}
