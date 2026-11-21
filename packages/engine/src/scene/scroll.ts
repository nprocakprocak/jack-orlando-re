// Camera following Jack in scenes wider than the 640 px screen. The original scrolls only when a
// script asks for it (commands 0x2a..0x31, 4 px per logic tick); how the real game keeps
// Jack in view is not established [hypothesis: scripts] - this is the demo's own rule built from
// the same primitives (multiples of 4, limits, SCROLL_STEP per tick).
import { alignScroll, MAX_SCROLL_X, SCREEN_W, SCROLL_STEP } from "../render/present";

/** Jack stays inside [SCROLL_MARGIN, SCREEN_W - SCROLL_MARGIN] of the screen; outside it the view re-centres. */
export const SCROLL_MARGIN = 160;

/** Largest scroll of a background `width` px wide (never beyond MAX_SCROLL_X). */
export function maxScrollFor(width: number): number {
  return Math.max(0, Math.min(MAX_SCROLL_X, alignScroll(width - SCREEN_W)));
}

/**
 * Scene_LoadCcg: g_bgScrollMax at scene load. A background marked wide ("NAME.BM+") gets width - 640
 * (down to a multiple of 4, at most 0x178); any other scene keeps 0x178 (it never scrolls: g_bgWide = 0).
 * SETSCROLLX2 may replace it later.
 */
export function initialScrollMax(wide: boolean, width: number): number {
  return wide ? maxScrollFor(width) : MAX_SCROLL_X;
}

/** One logic tick of the follow camera: new scroll position. */
export function followScroll(scrollX: number, jackX: number, width: number): number {
  const max = maxScrollFor(width);
  const rel = jackX - scrollX;
  if (rel >= SCROLL_MARGIN && rel <= SCREEN_W - SCROLL_MARGIN) return scrollX;
  const target = Math.min(max, Math.max(0, alignScroll(Math.round(jackX - SCREEN_W / 2))));
  if (target > scrollX) return Math.min(target, scrollX + SCROLL_STEP);
  if (target < scrollX) return Math.max(target, scrollX - SCROLL_STEP);
  return scrollX;
}

/**
 * Game_Run: after a step of a walk the view starts to scroll (direction -1 / +1, kept until
 * a limit is reached or the opposite rule fires) when Jack and the goal of the walk are both
 * outside the margins; `current` is the direction in force.
 */
export function walkScrollDirection(
  current: number, jackX: number, goalX: number, scrollX: number, marginL: number, marginR: number,
): number {
  const left = marginL + scrollX;
  const right = SCREEN_W - marginR + scrollX;
  if (left <= jackX || left <= goalX) return right < jackX && right < goalX ? 1 : current;
  return -1;
}

/**
 * Game_Run (~l. 719), `g_restoreJackPose`: the view after a loaded save. Jack right of x = 650 with the view at 0 →
 * `g_bgScrollStart = bgWidth - 640` (at most 0x178, down to a multiple of 4); Jack left of 650 with the view not at 0 → 0
 * (the scene's start view, e.g. SC006 from the CCG, would otherwise stay on the right). At exactly 650, or when the view is
 * already where the pose needs it, the view is unchanged. The test is on the view, not on the scene's limit.
 */
export function restoredScroll(scrollX: number, jackX: number, bgWidth: number): number {
  if (jackX > 650 && scrollX === 0) return maxScrollFor(bgWidth);
  if (jackX < 650 && scrollX !== 0) return 0;
  return scrollX;
}
