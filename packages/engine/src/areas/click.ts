// Clicks on the scene: macro names "<action>-<NAME>", the area click (Area_ClickMacro), the cursor
// hit tests and the order in which Game_Run tries area, sprite and walk. Pure logic, no DOM.
import { CursorMode } from "../cursor/modes";
import type { Area } from "../formats/scene";
import type { Interpreter } from "../script/interpreter";
import type { Point } from "../walk/geometry";
import { isInertMacro } from "./deviations";
import { areaUnder } from "./hit";
import type { AreaState } from "./state";

/** What the click code needs from the script interpreter. */
export interface MacroPort {
  /** Macro_Exists: a compiled macro of that name exists (also when BLOCKMACRO-ed). */
  exists(name: string): boolean;
  /** Script_FindMacro: starts the first macro of that name that is not BLOCKMACRO-ed.
 * Returns its index, -1 when there is none. */
  start(name: string): number;
  /** Script_InterruptOutMacros */
  interruptOutMacros(except: number): void;
}

export function interpreterPort(it: Interpreter): MacroPort {
  return {
    // exists() is used by the cursor tests only; start() still runs the macro as in the original
    exists: (name) => it.macros.some((m) => m.name === name) && !isInertMacro(name, (v) => (it.vars.has(v) ? it.vars.get(v) : undefined)),
    start: (name) => (it.macros.some((m) => m.name === name && !m.locked) ? it.start(name) : -1),
    interruptOutMacros: (except) => it.interruptOutMacros(except),
  };
}

/** Action part of the macro name: the held item's name (!= 0, g_heldItemName), else the verb (g_verbName). */
export interface Action {
  /** POKAZANIE / PATRZENIE / UDERZENIE / STRZELANIE / BRANIE (Cursor.verb) */
  verb: string;
  /** name of the item in hand, null with an empty hand */
  item: string | null;
}

export const FALLBACK_ACTION = "PIERDOLA";

export const macroName = (prefix: string, target: string): string => `${prefix}-${target}`;
export const actionPrefix = (a: Action): string => a.item ?? a.verb;

/** Result of looking for the macro of one target (shared by areas and sprites). */
export interface Reaction {
  /** macro that was started, null when none */
  macro: string | null;
  /** index of the started macro, -1 when none */
  started: number;
  /** an item is in hand and some macro (item or PIERDOLA) was found */
  itemMacroFound: boolean;
  /** an item is in hand and neither "<item>-NAME" nor "PIERDOLA-NAME" exists */
  itemFailed: boolean;
}

/**
 * Area_ClickMacro / after a target was chosen: starts `<action>-<NAME>`; with
 * an item in hand and no such macro tries `PIERDOLA-<NAME>` ("nothing happens" for any item).
 * With an empty hand there is no fallback. A found macro first stops the running OUTMACROs
 * (`interruptOutMacros`) - that is what a click on anything with a reaction does.
 * `fallback = false` is the WALKAREA case (no fallback, no interrupt).
 */
export function startReaction(port: MacroPort, action: Action, target: string, fallback = true): Reaction {
  let macro: string | null = macroName(actionPrefix(action), target);
  let started = port.start(macro);
  let itemMacroFound = action.item !== null && started >= 0;
  if (started < 0) macro = null;
  if (fallback && action.item !== null && started < 0) {
    const m = macroName(FALLBACK_ACTION, target);
    started = port.start(m);
    if (started >= 0) {
      macro = m;
      itemMacroFound = true;
    }
  }
  if (fallback && started >= 0) port.interruptOutMacros(started);
  return { macro, started, itemMacroFound, itemFailed: fallback && action.item !== null && started < 0 };
}

/** Exists-only version for the cursor tests (the area test has no fallback, see `areaReaction`). */
export function reactionExists(port: MacroPort, action: Action, target: string, fallback: boolean): boolean {
  if (port.exists(macroName(actionPrefix(action), target))) return true;
  return fallback && action.item !== null && port.exists(macroName(FALLBACK_ACTION, target));
}

// --- areas --------------------------------------------------------------------------------

export interface AreaClick extends Reaction {
  /** index of the area that was hit, -1 = none */
  area: number;
  name: string;
  /** the area is WALKAREA - the click walk is blocked */
  walkArea: boolean;
  /** return value of Area_ClickMacro: a macro was started (WALKAREA always returns 0) */
  handled: boolean;
}

/**
 * Area_ClickMacro. The first area (from the last) that contains the point and, in the
 * zone modes 10..19, is an enabled exit, is the target - even when it has no macro (the click then
 * falls through to sprites and walking). `cursorMode` is g_cursorMode.
 */
export function areaClick(
  areas: readonly Area[], st: AreaState, port: MacroPort, p: Point, cursorMode: number, action: Action,
): AreaClick {
  const none: AreaClick = {
    area: -1, name: "", walkArea: false, handled: false,
    macro: null, started: -1, itemMacroFound: false, itemFailed: false,
  };
  const i = areaUnder(areas, st, p, cursorMode);
  if (i < 0) return none;
  const name = areas[i].name;
  if (name === "WALKAREA") {
    const r = startReaction(port, action, name, false);
    return { ...r, itemFailed: false, area: i, name, walkArea: true, handled: false };
  }
  const r = startReaction(port, action, name, true);
  return { ...r, area: i, name, walkArea: false, handled: r.started >= 0 };
}

export interface AreaReaction {
  area: number;
  name: string;
  /** g_cursorOverReaction |= 1: a non-ignored area is under the hotspot (macro or not) */
  over: boolean;
  /** return value: the macro "<action>-<NAME>" exists (no PIERDOLA here) */
  exists: boolean;
  /** text the game writes to the status line: "<action>-<NAME>" */
  label: string;
}

/**
 * Cursor_HitTestAreas (every frame). IGNOREAREA-d areas are skipped in cursor mode 0 - the
 * scan goes on to the areas below; they still react to a click.
 */
export function areaReaction(
  areas: readonly Area[], st: AreaState, port: MacroPort, p: Point, cursorMode: number, action: Action,
): AreaReaction {
  const i = areaUnder(areas, st, p, cursorMode, true);
  if (i < 0) return { area: -1, name: "", over: false, exists: false, label: "" };
  const name = areas[i].name;
  const label = macroName(actionPrefix(action), name);
  return { area: i, name, over: true, exists: port.exists(label), label };
}

// --- sprites ------------------------------------------------------------------------------

/** One sprite of the scene's draw list as the click code sees it. */
export interface SpriteCandidate {
  /** the part after the dash: "JACK", a person's name or a scene object's name */
  name: string;
  /** a non-transparent pixel of the sprite is under the hotspot (pass 0) */
  pixelHit: boolean;
  /** [i] != 0 (pass 1; meaning unknown) */
  flagged: boolean;
  /** Jack's sprite - never a target */
  excluded?: boolean;
}

/** Passes over the draw list: click tries a second pass for modes other than 0, 1; the
 * cursor test for every mode but 1. Pass 0 = pixels, pass 1 = the flag. */
export function spritePasses(cursorMode: number, forClick: boolean): number {
  if (forClick) return cursorMode !== 0 && cursorMode !== 1 ? 2 : 1;
  return cursorMode !== 1 ? 2 : 1;
}

/** One pass over the draw list, topmost first. `stop` ends the scan on the sprite it accepts. */
function scanSprites(
  list: readonly SpriteCandidate[],
  passes: number,
  stop: (c: SpriteCandidate, index: number) => boolean,
): number {
  for (let pass = 0; pass < passes; pass++) {
    for (let i = list.length - 1; i >= 0; i--) {
      const c = list[i];
      const hit = pass === 0 ? c.pixelHit : c.flagged;
      if (!hit || c.excluded) continue;
      if (stop(c, i)) return i;
    }
  }
  return -1;
}

/**
 * the topmost sprite (list in drawing order, last = on top) that is hit. Returns the
 * index or -1. The original stops at the first hit sprite even if that one has no macro.
 *
 * (approved deviation from the original): with `hasMacro` the click scans like
 * Cursor_HitTestSprites - sprites without a macro (the table STOL.PBM under the spoon) are skipped, so the click
 * lands where the hand lights up. When no hit sprite has a macro the result is the original's (the topmost hit sprite), because
 * the tail of Game_Run (the refusal of an item with no reaction) depends on a hit.
 */
export function spriteClickTarget(list: readonly SpriteCandidate[], cursorMode: number, hasMacro?: (name: string) => boolean): number {
  const passes = spritePasses(cursorMode, true);
  let first = -1;
  const found = scanSprites(list, passes, (c, i) => {
    if (!hasMacro) return true;
    if (first < 0) first = i;
    return hasMacro(c.name);
  });
  return found < 0 ? first : found;
}

/** Cursor_HitTestSprites: sprites are scanned until one with an existing macro is found. */
export function spriteReaction(
  list: readonly SpriteCandidate[], port: MacroPort, cursorMode: number, action: Action,
): { over: boolean; exists: boolean; index: number; label: string } {
  let over = false;
  const index = scanSprites(list, spritePasses(cursorMode, false), (c) => {
    over = true;
    return reactionExists(port, action, c.name, true);
  });
  if (index >= 0) return { over, exists: true, index, label: macroName(actionPrefix(action), list[index].name) };
  return { over, exists: false, index: -1, label: "" };
}

// --- the order of a click -------------------------------------------

export interface ClickEnv {
  mode: number;
  /** the click is armed - set while the left button is up, cleared by a click that did something */
  armed: boolean;
  /** `g_cursorEnabled`: the click is ignored while the cursor is off */
  cursorEnabled: boolean;
  /** a running macro without UNLOCK (Interpreter.playerLocked) */
  playerLocked: boolean;
  /** (LOCKWALK / UNLOCKWALK) */
  walkAllowed: boolean;
  /** Jack's turn animation runs; and [ebp-0xd] are not modelled */
  turning?: boolean;
  /** the item in hand */
  itemInHand: boolean;
  /** Area_ClickMacro */
  area(): AreaClick;
  /** (+ macro start): null = no sprite under the hotspot */
  sprite(): Reaction | null;
  /** Walk_FindTriangle != 0 for the click point */
  inWalkArea(): boolean;
}

export type ClickOutcome =
  /** the guards failed - nothing happens and the click stays armed */
  | { kind: "ignored" }
  /** a macro of an area or a sprite was started */
  | { kind: "macro"; source: "area" | "sprite" }
  /** plan a walk to the click point (planWalk in walk); the caller first runs interruptOutMacros(-1) */
  | { kind: "walk" }
  /** Jack says one of three refusals ("So wird das wohl nichts.") - an item was used on something without a reaction */
  | { kind: "refuse" }
  /** the item in hand goes back to the inventory bar (command MOUSETOTOOL) */
  | { kind: "putBack" }
  | { kind: "nothing" };

/**
 * The click part of Game_Run: `env.area()` first, then `env.sprite()`, then the walk. The
 * walk needs LOCKWALK off, a point inside the walk area and cursor mode 0 (so not with an item);
 * the caller must stop the OUTMACROs for it (`Script_InterruptOutMacros(-1)`).
 * `armed` is the new value.
 */
export function resolveClick(env: ClickEnv): { outcome: ClickOutcome; armed: boolean } {
  if (!env.armed || !env.cursorEnabled || env.turning || env.mode === CursorMode.ScrollLeft || env.mode === CursorMode.ScrollRight) {
    return { outcome: { kind: "ignored" }, armed: env.armed };
  }
  let armed: boolean = env.armed;
  let itemFailed = false;
  let itemMacro = false;
  let outcome: ClickOutcome = { kind: "nothing" };
  let done = false;
  if (!env.playerLocked) {
    const a = env.area();
    itemMacro = a.itemMacroFound;
    itemFailed = a.itemFailed;
    if (a.handled) {
      armed = false;
      outcome = { kind: "macro", source: "area" };
      done = true;
    } else if (!a.walkArea) {
      const r = env.sprite();
      if (r) {
        itemMacro = r.itemMacroFound;
        itemFailed = itemFailed || r.itemFailed;
        if (r.started >= 0) {
          armed = false;
          outcome = { kind: "macro", source: "sprite" };
          done = true;
        }
      }
    }
    if (!done && !a.walkArea && env.walkAllowed && env.inWalkArea() && env.mode === CursorMode.Point) {
      return { outcome: { kind: "walk" }, armed: false };
    }
  }
  // tail: refusal / put-back
  if (itemFailed && !itemMacro) return { outcome: { kind: "refuse" }, armed };
  if (env.itemInHand && !itemMacro && !done) return { outcome: { kind: "putBack" }, armed: false };
  return { outcome, armed };
}
