// The diagonal black-stripe blackout.
// Logic only: StripeWipe turns elapsed time into "how many pixels are black by now".
import type { Surface16 } from "../render/surface";

export const WIPE_W = 640;
export const WIPE_H = 480;
/** `local_10 < 0x4b000`: one pixel per index, i.e. every pixel of the 640x480 screen exactly once. */
export const WIPE_PIXELS = 0x4b000;
/** `local_10 % 0xf00 == 0`: a Timer_Sleep(5) after this many pixels (and after the first one). */
export const WIPE_CHUNK = 0xf00;
/** Timer_Sleep(5): 5 / 5 = 1 -> returns when the 5 ms tick counter exceeds start + 1 -> 2 ticks = 10 ms. */
export const WIPE_SLEEP_MS = 10;
/** The closing Timer_Sleep(0x32): 50 / 5 = 10 -> 11 ticks. */
export const WIPE_TAIL_MS = 55;
export const WIPE_SLEEPS = WIPE_PIXELS / WIPE_CHUNK;
export const WIPE_TOTAL_MS = WIPE_SLEEPS * WIPE_SLEEP_MS + WIPE_TAIL_MS;

/**
 * Index i -> screen position (as y * 640 + x): n = i * 0x31; y = n / 640 (mod 480 when it exceeds 0x1df), x = n % 640.
 * Consecutive pixels are 49 columns apart and wrap to the next row every ~13 pixels, which makes slanted stripes.
 */
export function wipePixel(i: number): number {
  const n = i * 0x31;
  let y = Math.floor(n / WIPE_W);
  if (y > 0x1df) y %= 0x1e0;
  return y * WIPE_W + (n % WIPE_W);
}

let order: Uint32Array | null = null;
/** The whole order (cached); it is a permutation of 0 307199. */
export function wipeOrder(): Uint32Array {
  if (!order) {
    order = new Uint32Array(WIPE_PIXELS);
    for (let i = 0; i < WIPE_PIXELS; i++) order[i] = wipePixel(i);
  }
  return order;
}

/** Pixels black `ms` after the start: pixel i is drawn after ceil(i / 0xf00) sleeps (the first one after pixel 0). */
export function pixelsAt(ms: number): number {
  const sleeps = Math.floor(Math.max(0, ms) / WIPE_SLEEP_MS);
  return Math.min(WIPE_PIXELS, sleeps * WIPE_CHUNK + 1);
}

/** Paints the screen black stripe by stripe; `surface` is changed in place. Time comes from `advance` (game time). */
export class StripeWipe {
  private ms = 0;
  private painted = 0;

  constructor(readonly surface: Surface16) {
    if (surface.width !== WIPE_W || surface.height !== WIPE_H) throw new Error("wipe needs a 640x480 surface");
  }

  get done(): boolean {
    return this.ms >= WIPE_TOTAL_MS;
  }
  get elapsedMs(): number {
    return this.ms;
  }
  get paintedPixels(): number {
    return this.painted;
  }

  advance(dtMs: number): void {
    this.ms = Math.min(WIPE_TOTAL_MS, this.ms + Math.max(0, dtMs));
    const upTo = pixelsAt(this.ms);
    const o = wipeOrder();
    const px = this.surface.pixels;
    for (; this.painted < upTo; this.painted++) px[o[this.painted]] = 0;
  }
}
