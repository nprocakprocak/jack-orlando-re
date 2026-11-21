// Darkening tables (Blit_Darken16, tables): the "translucent" GUI is a scene
// snapshot darkened per channel, not alpha blending.
import type { Surface16 } from "../render/surface";
import { strideOf } from "../render/surface";

/** Darkening levels 0..32; the brightness left is (32 - level) / 32. */
export const LEVELS = 33;

export interface DarkenTables {
  /** [level][value]: 32 entries for B and R, 64 for G (component values, not shifted) */
  b: Uint8Array[];
  g: Uint8Array[];
  r: Uint8Array[];
}

const scaled = (v: number, level: number) => Math.floor((v * (32 - level)) / 32 + 0.49);

/**
 * The tables by formula: floor(v * (32 - L) / 32 + 0.49), B never 0 (0 is the color key).
 * 18 of 4224 entries differ by 1 from the exact tables. The game path installs those.
 */
export function formulaTables(): DarkenTables {
  const mk = (n: number, min: number) =>
    Array.from({ length: LEVELS }, (_, l) => Uint8Array.from({ length: n }, (_, v) => Math.max(min, scaled(v, l))));
  return { b: mk(32, 1), g: mk(64, 0), r: mk(32, 0) };
}

/** Exact darken tables. */
import { DARKEN_B, DARKEN_G, DARKEN_R } from "./darken-tables";
export { DARKEN_B, DARKEN_G, DARKEN_R } from "./darken-tables";

export function bundledDarkenTables(): DarkenTables {
  const rows = (src: readonly (readonly number[])[]) => src.map((row) => Uint8Array.from(row));
  return { b: rows(DARKEN_B), g: rows(DARKEN_G), r: rows(DARKEN_R) };
}

let tables = formulaTables();
export function setDarkenTables(t: DarkenTables): void {
  tables = t;
}

/** Darkens one RGB565 pixel by `level` (0..32). */
export function darkenPixel(p: number, level: number): number {
  return (tables.r[level][p >> 11] << 11) | (tables.g[level][(p >> 5) & 0x3f] << 5) | tables.b[level][p & 0x1f];
}

/**
 * Darkens a rectangle in place. `keepKey` leaves color-0 pixels alone, as Blit_Darken16Strip does
 * ; otherwise they become the darkest blue like the window blit.
 */
export function darkenRect(
  s: Surface16,
  x: number,
  y: number,
  w: number,
  h: number,
  level: number,
  keepKey = false,
): void {
  const stride = strideOf(s);
  for (let yy = Math.max(0, y); yy < Math.min(s.height, y + h); yy++) {
    for (let xx = Math.max(0, x); xx < Math.min(s.width, x + w); xx++) {
      const i = yy * stride + xx;
      if (keepKey && s.pixels[i] === 0) continue;
      s.pixels[i] = darkenPixel(s.pixels[i], level);
    }
  }
}
