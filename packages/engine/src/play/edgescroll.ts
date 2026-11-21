// Scrolling the scene by the mouse at the screen edge.
// Pure logic: the game loop (game.ts) feeds it the state of the frame and applies the result.
import { edgeScrollMode } from "../areas/hit";
import { SCREEN_WIDTH } from "../core/constants";
import { CursorMode } from "../cursor/modes";

export const MODE_SCROLL_LEFT = 20; // 0x14
export const MODE_SCROLL_RIGHT = 21; // 0x15
/** SETPOSSCROLL not set (the exe starts both points at -1000) */
export const NO_SCROLL_POINT = -1000;

export interface ScrollPoint {
  x: number;
  y: number;
}

export interface EdgeState {
  /** g_cursorMode */
  mode: number;
  /** g_cursorModeSaved: the mode to come back to */
  saved: number;
  /** the "view scrolled" flag as it was in the last frame that ran the edge code (it is not refreshed otherwise) */
  prevScrolling: boolean;
}

export interface EdgeInput {
  /** the mouse x on the screen (0..639); the exe compares g_mouseX with the scroll added */
  mouseX: number;
  scrollX: number;
  scrollMin: number;
  scrollMax: number;
  /** g_bgWide */
  bgWide: boolean;
  /** the scene is SC000D / SC008B (g_sceneNoControl, line 700): no edge cursor there */
  noControl: boolean;
  /** an answer menu (g_menuOpen) or a spoken line is up */
  menuOrText: boolean;
  /** the view scrolled in the last 14 ms tick */
  scrolling: boolean;
  /** g_cursorEnabled */
  cursorEnabled: boolean;
  /** left button down and g_clickArmed */
  clickArmed: boolean;
  /** g_jackTurning */
  jackTurning: boolean;
  jackX: number;
  points: { L: ScrollPoint; R: ScrollPoint };
}

export interface EdgeResult extends EdgeState {
  /** new scroll direction when the click set one */
  dir: -1 | 1 | null;
  /** Jack_WalkTo target when the click sends Jack to a SETPOSSCROLL point */
  walkTo: ScrollPoint | null;
}

/**
 * One frame of the edge cursor. Entry (not while an item is in hand, a menu / line is up, in no-control scenes): the
 * mouse within 30 px of the left edge with room to scroll left, or right of x = 610 with room to scroll right; the mode
 * then stays until the mouse leaves the zone or scrolling stops (the flag was set and is not any more).
 * A click in the zone (not on the frame the mode is left) calls `edgeClick`.
 */
export function edgeFrame(st: EdgeState, inp: EdgeInput): EdgeResult {
  let { mode, saved } = st;
  const out: EdgeResult = { mode, saved, prevScrolling: st.prevScrolling, dir: null, walkTo: null };
  const inZone = mode === MODE_SCROLL_LEFT || mode === MODE_SCROLL_RIGHT;
  const env = { mode, mouseX: inp.mouseX + inp.scrollX, scrollX: inp.scrollX, scrollMin: inp.scrollMin, scrollMax: inp.scrollMax };
  if (!inZone && mode !== CursorMode.Item && !inp.noControl && inp.bgWide && !inp.menuOrText) {
    ({ mode, saved } = edgeScrollMode(env, saved));
    env.mode = mode;
  }
  if (mode === MODE_SCROLL_LEFT || mode === MODE_SCROLL_RIGHT) {
    const stopped = st.prevScrolling && !inp.scrolling;
    const r = edgeScrollMode(env, saved, !stopped);
    if (r.mode !== mode) mode = r.mode;
    else if (inp.cursorEnabled && inp.clickArmed) Object.assign(out, edgeClick(mode === MODE_SCROLL_LEFT, inp));
    out.prevScrolling = inp.scrolling;
  }
  out.mode = mode;
  out.saved = saved;
  return out;
}

/**
 * (left) / (right): with no menu or line up, Jack walks to the L point when the click is on the
 * left and he is right of the R point (resp. to R when he is left of L) and no turn runs; the direction is set either way.
 */
export function edgeClick(left: boolean, inp: EdgeInput): Pick<EdgeResult, "dir" | "walkTo"> {
  if (inp.menuOrText) return { dir: null, walkTo: null };
  const { L, R } = inp.points;
  let walkTo: ScrollPoint | null = null;
  if (!inp.jackTurning && L.x > NO_SCROLL_POINT && R.x > NO_SCROLL_POINT) {
    if (left && R.x < inp.jackX) walkTo = L;
    if (!left && inp.jackX < L.x) walkTo = R;
  }
  return { dir: left ? -1 : 1, walkTo };
}

/** Pixels from the screen edge that scroll a scene with no edge cursor (0x14). */
const NO_CONTROL_MARGIN = 0x14;

/** Game_Run, after the answer-menu step (g_sceneNoControl scenes): the mouse within 20 px of the screen edge scrolls, with no cursor change. */
export function noControlDir(mouseX: number, cursorEnabled: boolean): -1 | 1 | null {
  if (!cursorEnabled) return null;
  if (mouseX < NO_CONTROL_MARGIN) return -1;
  if (mouseX > SCREEN_WIDTH - NO_CONTROL_MARGIN) return 1;
  return null;
}
