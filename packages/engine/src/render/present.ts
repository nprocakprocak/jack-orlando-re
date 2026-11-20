// Screen window over the work buffer and the scroll rules.
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import { windowToRgba, type Surface16 } from "./surface";

export { SCREEN_HEIGHT as SCREEN_H, SCREEN_WIDTH as SCREEN_W };
/** Largest scroll position (script commands 0x2a/0x31 in): 0x178 = 1016 - 640. */
export const MAX_SCROLL_X = 376;
/** Pixels per game tick when the scene scrolls. */
export const SCROLL_STEP = 4;

/** Video_Present copies the 640x480 window at (scrollX, scrollY) of the work buffer. */
export function presentRgba(
  framebuffer: Surface16, scrollX: number, scrollY = 0,
  out?: Uint8ClampedArray,
): Uint8ClampedArray {
  return windowToRgba(framebuffer, scrollX, scrollY, SCREEN_WIDTH, SCREEN_HEIGHT, out);
}

/** Screen point -> work buffer point (WndProc adds g_scrollX/Y to the mouse position). */
export function screenToBuffer(x: number, y: number, scrollX: number, scrollY = 0): [number, number] {
  return [x + scrollX, y + scrollY];
}

/** Scroll position as set by script command 0x2a: < 0 -> 0, > 376 -> 376, else rounded down to a multiple of 4. */
export function alignScroll(x: number): number {
  if (x < 0) return 0;
  if (x > MAX_SCROLL_X) return MAX_SCROLL_X;
  return x - (x % 4);
}

/** Scroll limits as set by commands 0x30 (min) and 0x31 (max), same rounding as alignScroll. */
export function scrollLimits(min: number, max: number): [number, number] {
  return [min < 0 ? 0 : min - (min % 4), max > MAX_SCROLL_X ? MAX_SCROLL_X : max - (max % 4)];
}

/**
 * One tick of automatic scrolling: direction +1 / -1 (commands 0x2f / 0x2e),
 * 0 = none. Moves by 4 px while strictly inside the limits; the mouse moves with the view.
 */
export function scrollTick(scrollX: number, direction: number, min: number, max: number): number {
  if (direction === 1 && scrollX < max) return scrollX + SCROLL_STEP;
  if (direction === -1 && min < scrollX) return scrollX - SCROLL_STEP;
  return scrollX;
}
