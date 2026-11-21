// Mouse wheel -> whole "notches" (deviation from the original, which has no wheel support).
// A mouse gives one event of ~100 px (deltaMode 0) or 3 lines (deltaMode 1) per notch; a touchpad gives many small
// events, which are summed so that one notch of movement scrolls exactly one row / slot.

/** One notch in pixels (the common value of a mouse wheel). */
export const NOTCH_PX = 100;

/** DOM_DELTA_LINE counts as this many pixels per line; DOM_DELTA_PAGE as a page of this many. */
const LINE_PX = NOTCH_PX / 3;
const PAGE_PX = NOTCH_PX * 3;

export class WheelAccumulator {
  private sum = 0;

  /**
 * Adds one wheel event. Returns -1 (up), 0 (below the threshold) or 1 (down) — at most one notch per event, the
 * remainder (|sum| < NOTCH_PX) is kept. A change of direction drops the sum collected the other way.
 */
  add(deltaY: number, deltaMode = 0): -1 | 0 | 1 {
    const px = deltaMode === 1 ? deltaY * LINE_PX : deltaMode === 2 ? deltaY * PAGE_PX : deltaY;
    if (!Number.isFinite(px) || px === 0) return 0;
    if (Math.sign(px) !== Math.sign(this.sum)) this.sum = 0;
    this.sum += px;
    if (Math.abs(this.sum) < NOTCH_PX - 1e-6) return 0;
    const dir = this.sum > 0 ? 1 : -1;
    this.sum = 0;
    return dir;
  }

  reset(): void {
    this.sum = 0;
  }
}
