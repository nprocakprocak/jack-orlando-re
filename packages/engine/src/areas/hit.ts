// Hit tests of the .ACE areas: which area is under the click point, which macro it runs, which
// cursor mode the exit areas select.
import type { Area } from "../formats/scene";
import { areaContains } from "../walk/depth";
import type { Point } from "../walk/geometry";
import type { AreaState } from "./state";

/** Cursor_IsMode10to19. */
export function isZoneMode(mode: number): boolean {
  return mode >= 10 && mode <= 19;
}

/** Cursor modes of the exit areas: name → mode. 12, 16, 18, 19 are never set. */
export const EXIT_CURSOR_MODE: Readonly<Record<string, number>> = {
  LEWO: 10, PRAWO: 11, DOL: 13, TO_IN: 14, UP: 15, TO_OUT: 17,
};

/** Cursor modes of the scroll edges. */
export const MODE_SCROLL_LEFT = 20;
export const MODE_SCROLL_RIGHT = 21;

/**
 * Area_Contains: the geometric test (half-planes, no bounding box) behind the gate
 * `(enabled[a] || cursorMode != 0) && special[a]`. So SETSPECAREA 0 hides an area from every
 * cursor, SETAREA 0 only while the cursor is the plain pointer (mode 0).
 */
export function areaHit(areas: readonly Area[], st: AreaState, index: number, p: Point, cursorMode: number): boolean {
  if (!(st.enabled[index] !== 0 || cursorMode !== 0)) return false;
  if (st.special[index] === 0) return false;
  return areaContains(areas[index], p);
}

/** Area_IsEnabledExit: an exit-named area with SETAREA ≠ 0. */
export function isEnabledExit(areas: readonly Area[], st: AreaState, index: number): boolean {
  return areas[index].exit && st.enabled[index] !== 0;
}

/**
 * The scan shared by Area_ClickMacro and Cursor_HitTestAreas: areas from the
 * last one down; the first one that contains the point wins. In the zone modes 10..19 only
 * enabled exits count. `skip` lets the cursor test pass over IGNOREAREA-d areas.
 */
export function areaUnder(
  areas: readonly Area[], st: AreaState, p: Point, cursorMode: number, skipIgnored = false,
): number {
  for (let i = areas.length - 1; i >= 0; i--) {
    if (!areaHit(areas, st, i, p, cursorMode)) continue;
    if (isZoneMode(cursorMode) && !isEnabledExit(areas, st, i)) continue;
    if (skipIgnored && st.ignore[i] !== 0 && cursorMode === 0) continue;
    return i;
  }
  return -1;
}

/** name of the enabled exit area under the click point, "" when there is none. */
export function exitNameAt(areas: readonly Area[], st: AreaState, p: Point, cursorMode: number): string {
  for (let i = areas.length - 1; i >= 0; i--) {
    if (areaHit(areas, st, i, p, cursorMode) && isEnabledExit(areas, st, i)) return areas[i].name;
  }
  return "";
}

export interface ZoneModeEnv {
  /** g_cursorMode */
  mode: number;
  /** the mode picked in the verb menu; the exit arrows exist only for the pointer (0) */
  verbMode: number;
  /** g_clickX/Y */
  click: Point;
  /** ≠ 0: set once during the frame at (meaning unknown) */
  suspended?: boolean;
  /** ≠ 0 */
  busy?: boolean;
}

/**
 * Game_Run, every frame: the cursor takes the mode of the exit area under the
 * hotspot (LEWO 10, PRAWO 11, DOL 13, TO_IN 14, UP 15, TO_OUT 17), otherwise falls back to the
 * menu mode. Skipped (mode unchanged) while or is set, with another verb than
 * the pointer chosen, while an item is in hand (mode 5) and during the scroll-edge cursors.
 */
export function zoneCursorMode(areas: readonly Area[], st: AreaState, env: ZoneModeEnv): number {
  const { mode } = env;
  if (env.suspended || env.verbMode !== 0 || mode === MODE_SCROLL_LEFT || mode === MODE_SCROLL_RIGHT) return mode;
  if (mode === 5 || env.busy) return mode;
  const name = exitNameAt(areas, st, env.click, mode);
  return EXIT_CURSOR_MODE[name] ?? env.verbMode;
}

export interface EdgeScrollEnv {
  mode: number;
  /** the mouse x in scene coordinates (— scroll included) */
  mouseX: number;
  /** left edge of the view */
  scrollX: number;
  /** / */
  scrollMin: number;
  scrollMax: number;
}

/** Width of the scroll edge zones (0x1e from the left edge, from 0x262 to the right edge). */
export const EDGE_LEFT = 0x1e;
export const EDGE_RIGHT = 0x262;

/**
 * Game_Run: the cursor turns into the scroll arrow (20/21) in the 30 px at the
 * left edge of the view when the scene can still scroll that way, resp. right of x = scrollX + 610.
 * Returns the new mode and the mode to restore — the previous one. The exit from the
 * arrow happens when the pointer leaves the zone or scrolling stops: the saved
 * mode comes back (0 when that flag is set). The "scrolling stopped" part,
 * written by Game_Tick14ms, is not modelled — `canScroll` stands for it.
 */
export function edgeScrollMode(env: EdgeScrollEnv, saved: number, canScroll = true): { mode: number; saved: number } {
  const { mode, mouseX, scrollX } = env;
  if (mode !== MODE_SCROLL_LEFT && mode !== MODE_SCROLL_RIGHT) {
    if (mouseX < scrollX + EDGE_LEFT && scrollX > env.scrollMin) return { mode: MODE_SCROLL_LEFT, saved: mode };
    if (mouseX > scrollX + EDGE_RIGHT && scrollX < env.scrollMax) return { mode: MODE_SCROLL_RIGHT, saved: mode };
  }
  if (mode === MODE_SCROLL_LEFT && (mouseX > scrollX + EDGE_LEFT || !canScroll)) return { mode: saved, saved };
  if (mode === MODE_SCROLL_RIGHT && (mouseX < scrollX + EDGE_RIGHT || !canScroll)) return { mode: saved, saved };
  return { mode, saved };
}
