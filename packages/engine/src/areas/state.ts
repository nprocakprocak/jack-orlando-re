// Per-scene enable flags of the .ACE areas and name resolution for the area commands.
import type { Area } from "../formats/scene";

/** Game_Run: the three flag arrays are filled for the first 30 areas only. */
export const AREA_FLAG_SLOTS = 30;

/**
 * (SETAREA), (SETSPECAREA), (IGNOREAREA). Game_Run sets
 * `enabled = special = 1`, `ignore = 0` for areas 0..29 before the scene's [PRE] ;
 * every other slot stays 0 (BSS) — so an area with index ≥ 30 is never enabled. Nothing resets
 * the flags on a scene change except that same loop.
 */
export class AreaState {
  readonly enabled = new Uint8Array(256);
  readonly special = new Uint8Array(256);
  readonly ignore = new Uint8Array(256);

  constructor() {
    this.reset();
  }

  reset(): void {
    this.enabled.fill(0);
    this.special.fill(0);
    this.ignore.fill(0);
    for (let i = 0; i < AREA_FLAG_SLOTS; i++) {
      this.enabled[i] = 1;
      this.special[i] = 1;
    }
  }

  /** SETAREA (0x55, Script_ExecStep case 0x54): `(char)state` — only the low byte is kept. */
  setArea(index: number, state: number): void {
    if (index >= 0 && index < this.enabled.length) this.enabled[index] = state & 0xff;
  }

  /** SETSPECAREA (0x76, case 0x75). */
  setSpecArea(index: number, state: number): void {
    if (index >= 0 && index < this.special.length) this.special[index] = state & 0xff;
  }

  /** IGNOREAREA (0xa0, case 0x9f): always sets 1; there is no way back. */
  ignoreArea(index: number): void {
    if (index >= 0 && index < this.ignore.length) this.ignore[index] = 1;
  }
}

/**
 * Scene_LoadAce (g_areaDupIndex): for every area, how many earlier areas have
 * the same name. A name can be used by several entries (areas of one object split in parts).
 */
export function dupIndices(areas: readonly Area[]): number[] {
  return areas.map((a, i) => {
    let n = 0;
    for (let j = 0; j < i; j++) if (areas[j].name === a.name) n++;
    return n;
  });
}

/**
 * Script_CompileMacros case 0x55 / 0x76 / 0xa0: "SETAREA NAME dup state" — the area is the first
 * entry (from 0) whose name matches and whose duplicate index equals `dup`. -1 = not found (the
 * compiler then leaves the slot as the number read from the text).
 */
export function resolveAreaRef(areas: readonly Area[], name: string, dup: number): number {
  const d = dupIndices(areas);
  for (let i = 0; i < areas.length; i++) if (areas[i].name === name && d[i] === dup) return i;
  return -1;
}

/** Minimal shape of a compiled command (script/compiler.ts `Command`) used by `applyAreaCommand`. */
export interface AreaCommand {
  word: string;
  n1: string;
  a: number[];
}

/**
 * Executes SETAREA / SETSPECAREA / IGNOREAREA on `state`. `a[0]` is the duplicate index from the
 * text (`resolveAreaRef` turns name + dup into the area index), `a[1]` the new state. Returns false
 * for any other command.
 */
export function applyAreaCommand(state: AreaState, areas: readonly Area[], cmd: AreaCommand): boolean {
  if (cmd.word !== "SETAREA" && cmd.word !== "SETSPECAREA" && cmd.word !== "IGNOREAREA") return false;
  const i = resolveAreaRef(areas, cmd.n1, cmd.a[0] ?? 0);
  if (i < 0) return true; // unresolved reference: the game would write to the raw number
  if (cmd.word === "SETAREA") state.setArea(i, cmd.a[1] ?? 0);
  else if (cmd.word === "SETSPECAREA") state.setSpecArea(i, cmd.a[1] ?? 0);
  else state.ignoreArea(i);
  return true;
}
