// Item sprites on the coat grid: a keyed copy, and the pale shadow under an item.

import type { Surface16 } from "../render/surface";
import { strideOf } from "../render/surface";
import { GRID_X0, GRID_X1, GRID_Y0, GRID_Y1 } from "./layout";

/** Keyed copy clipped to the grid rectangle (the item sprites' clip rectangle (0x56,0xae,0xe6,0x1b2)). */
export function clippedKeyed(dst: Surface16, src: Surface16, x: number, y: number): void {
  const ss = strideOf(src);
  const ds = strideOf(dst);
  for (let sy = 0; sy < src.height; sy++) {
    const py = y + sy;
    if (py < GRID_Y0 || py >= GRID_Y1) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const px = x + sx;
      if (px < GRID_X0 || px >= GRID_X1) continue;
      const v = src.pixels[sy * ss + sx];
      if (v) dst.pixels[py * ds + px] = v;
    }
  }
}

/**
 * The shadow pixel of `Item_BuildShadowImage`: `(background, 0, 0.5f)` (per channel
 * `ftol((a * (2 - t) + b * t) / 2)`, here a = background, b = 0, t = 0.5, so a channel keeps 3/4 of its value, not half —
 * the pale, see-through shadows of the original, user's screenshot).
 */
export function shadowPixel(p: number): number {
  const ch = (a: number) => Math.trunc((a * 1.5) / 2);
  return ((ch((p >> 11) & 0x1f) << 11) | (ch((p >> 5) & 0x3f) << 5) | ch(p & 0x1f)) & 0xffff;
}

/** Shadow: where the item is opaque, the background at that place at half brightness (clipped like the item). */
export function clippedShadow(dst: Surface16, bg: Surface16, src: Surface16, x: number, y: number): void {
  const ss = strideOf(src);
  const ds = strideOf(dst);
  for (let sy = 0; sy < src.height; sy++) {
    const py = y + sy;
    if (py < GRID_Y0 || py >= GRID_Y1 || py < 0 || py >= bg.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const px = x + sx;
      if (px < GRID_X0 || px >= GRID_X1 || px < 0 || px >= bg.width) continue;
      if (!src.pixels[sy * ss + sx]) continue;
      const shade = shadowPixel(bg.pixels[py * strideOf(bg) + px]);
      if (shade) dst.pixels[py * ds + px] = shade; // colour 0 is the key of the shadow sprite: transparent, no fallback colour
    }
  }
}
