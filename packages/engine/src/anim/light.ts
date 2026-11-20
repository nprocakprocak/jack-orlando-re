// Jack's brightness from the scene lights ([swiatlo] .CCG): (walk),
// (insertions), (standing).
import { viewOf } from "../formats/bytes";
import { f32, ftol } from "./jack";

/** Distance at which a light stops brightening Jack, at scale 1 (= 300.0). */
export const LIGHT_RANGE = 300;
/** Vertical distances count three times (= 3.0). */
export const LIGHT_Y_WEIGHT = 3;
/** Start of the minimum search (= 1000). */
export const LIGHT_FAR = 1000;
/** Colours of an unpacked .PBM palette the game rescales: words 2..0x81 = the 128 entries (8-bit pixels use them). */
export const PALETTE_ENTRIES = 128;

/**
 * Brightness factor: base (script command Brightness) plus up to 1 near the
 * closest light. The game rescales Jack's palette only when the factor is below 1.
 */
export function jackBrightness(x: number, y: number, lights: readonly (readonly number[])[], scale: number, base: number): number {
  let near = LIGHT_FAR;
  for (const [lx, ly] of lights) {
    const dx = ftol(x - lx);
    const dy = ftol((y - ly) * LIGHT_Y_WEIGHT);
    const d = ftol(Math.sqrt(dx * dx + dy * dy));
    if (d < near) near = d;
  }
  const range = ftol(f32(scale) * LIGHT_RANGE);
  return near < range ? f32((range - near) / range + base) : f32(base);
}

/** One RGB565 colour rescaled like the game: each channel times the factor, truncated, at least 1; 0 stays 0. */
export function scaleColor(c: number, factor: number): number {
  if (c === 0) return 0;
  const r = Math.max(1, ftol((c >> 11) * factor));
  const g = Math.max(1, ftol(((c >> 5) & 0x3f) * factor));
  const b = Math.max(1, ftol((c & 0x1f) * factor));
  return (r << 11) | (g << 5) | b;
}

/**
 * Copy of a .PBM file with its palette (bytes 4..0x103) rescaled, as the game does on the
 * loaded frame before Pbm_Unpack; factors >= 1 leave it unchanged. Decode the copy with decodePbm.
 */
export function brightenPbm(data: Uint8Array, factor: number): Uint8Array {
  const out = data.slice();
  if (factor >= 1 || out.length < 4 + 2 * PALETTE_ENTRIES) return out;
  const view = viewOf(out);
  for (let i = 0; i < PALETTE_ENTRIES; i++) {
    const off = 4 + 2 * i;
    view.setUint16(off, scaleColor(view.getUint16(off, true), factor), true);
  }
  return out;
}
