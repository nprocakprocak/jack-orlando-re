// Timing of the main menu (Launcher_Run) and its blocking screen effects.
// and 4.
import { WIPE_PIXELS, wipeOrder } from "../launcher/wipe";
import type { Surface16 } from "../render/surface";

/** Timer_Start(1, 0x11, Launcher_TimerTick, 1): a multimedia timer every 17 ms. */
export const TICK_MS = 17;
/**
 * Video_PresentIfDue presents at most once per monitor refresh. 60 Hz is an assumption
 * [engine]: the original follows the monitor.
 */
export const PRESENT_MS = 1000 / 60;

/** Timer_Sleep(ms) waits for more than ms/5 ticks of the 5 ms clock. */
export function sleepMs(ms: number): number {
  return (Math.floor(ms / 5) + 1) * 5;
}

/** One step of a music fade: Timer_Sleep(10) = 3 ticks = 15 ms. */
export const MUSIC_STEP_MS = sleepMs(10);
/** Timer_Sleep(5) in the screen effects = 10 ms. */
export const EFFECT_SLEEP_MS = sleepMs(5);

/** Default music volume of the config (`musicVol` 0x23, settings/config.ts). */
export const DEFAULT_MUSIC_VOLUME = 0x23;

/** Fade-in: volume 0, 1... vol-1, a step each, then vol. */
export function fadeInSteps(volume: number): number {
  return Math.max(0, volume);
}

/** Fade-out of (2): vol, vol-2... while the next value stays above 0, then stop. */
export function fadeOutSteps(volume: number, step = 2): number {
  let n = 0;
  for (let v = volume; v - step > 0; v -= step) n++;
  return n;
}

// --- interlaced blackening: (start of Launcher_Run) = Launcher_CloseAnim (quit) ---------

export const INTERLACE_ROWS = 240;
/** Timer_Sleep(5) after rows 0, 6... 234: 40 sleeps. */
export const INTERLACE_SLEEPS = 40;
/** Timer_Sleep(0x32) at the end. */
export const INTERLACE_TAIL_MS = sleepMs(0x32);
export const INTERLACE_TOTAL_MS = INTERLACE_SLEEPS * EFFECT_SLEEP_MS + INTERLACE_TAIL_MS;

/** Loop iterations `r` done after `ms`: each blackens row 2r and row 479 - 2r; a sleep follows every r % 6 == 0. */
export function interlaceRowsAt(ms: number): number {
  const sleeps = Math.min(INTERLACE_SLEEPS, Math.floor(Math.max(0, ms) / EFFECT_SLEEP_MS));
  return Math.min(INTERLACE_ROWS, 6 * sleeps + 1);
}

/** Blackens screen rows of iterations [from, to) in place (640 x 480). */
export function interlaceRows(s: Surface16, from: number, to: number): void {
  for (let r = from; r < to; r++) {
    s.pixels.fill(0, 2 * r * 640, 2 * r * 640 + 640);
    const y = 479 - 2 * r;
    s.pixels.fill(0, y * 640, y * 640 + 640);
  }
}

// --- reveal of the background: --------------------------------------------------------------------

/** Pixels per Timer_Sleep(5) of the reveal (0x1900; the stripe blackout of has 0xf00). */
export const REVEAL_CHUNK = 0x1900;
export const REVEAL_SLEEPS = WIPE_PIXELS / REVEAL_CHUNK;
export const REVEAL_TOTAL_MS = REVEAL_SLEEPS * EFFECT_SLEEP_MS;

/** Pixels revealed after `ms`: pixel i is copied after ceil(i / 0x1900) sleeps (a sleep follows i % 0x1900 == 0). */
export function revealPixelsAt(ms: number): number {
  const sleeps = Math.floor(Math.max(0, ms) / EFFECT_SLEEP_MS);
  return Math.min(WIPE_PIXELS, sleeps * REVEAL_CHUNK + 1);
}

/** Copies the background pixels [from, to) of the stripe order (the same as the blackout, wipe.ts) to `screen`. */
export function revealPixels(screen: Surface16, background: Surface16, from: number, to: number): void {
  const o = wipeOrder();
  for (let i = from; i < to; i++) screen.pixels[o[i]] = background.pixels[o[i]];
}
