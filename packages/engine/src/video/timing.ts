// Movie timing: pure arithmetic of Media_Step / Media_QueueSound /
// Media_DecodeVideo. src/video/README.md.

import { AVX_GAP, TICK_MS } from "../formats/media";

export { TICK_MS };

/** Media_Open sets the frame time to 10 ticks until the first segment header is read. */
export const INITIAL_FRAME_TICKS = 10;
/** PCM bytes in the ring buffer before the first record: 2.5 s of preroll + 8 bytes (AVX_GAP). */
export const PREROLL_PCM_BYTES = 0x6baa0;
export const RING_START = PREROLL_PCM_BYTES + AVX_GAP;
/** Media_QueueSound: wanted lead of the write position over the play position, in 2000-byte units. */
export const WANTED_LEAD = 0xdc;
export const LEAD_UNIT = 2000;
/** PCM bytes per tick of 5 ms (44100 Hz, stereo, 16 bit = 176400 B/s). */
export const BYTES_PER_TICK = 882;
/** Media_Step: a frame later than this (ticks) means the data did not arrive in time. */
export const STALL_TICKS = -600;

/** Media_DecodeVideo: `200 / fps` as an integer division; fps 0 would crash the game (division by zero). */
export function movieFrameTicks(fps: number): number {
  if (!fps) throw new RangeError("movie segment with fps 0");
  return Math.trunc(200 / fps);
}

/**
 * Media_QueueSound: adjustment of the frame clock for one frame. `written` and `played` are
 * absolute byte positions in the PCM stream (the game works in a 5 s ring, the difference is the
 * same). Positive result = frame clock grows (the next frame comes later).
 */
export function syncAdjust(written: number, played: number): number {
  const lead = Math.trunc((written - played) / LEAD_UNIT);
  const delta = Math.abs(WANTED_LEAD - lead);
  if (lead < WANTED_LEAD) return -delta;
  if (lead > WANTED_LEAD) return delta;
  return 0;
}

/**
 * OUTRO (mode 2), last segment: `Snd_SetVolume(1, ftol(level * (frames - counter) / frames))`,
 * level = `<< 1` (call site 4671b2). `counter` is the 1-based frame counter.
 */
export function outroVolume(level: number, frames: number, counter: number): number {
  return Math.trunc((level * (frames - counter)) / frames);
}
