// What the game draws over the scene picture besides the cursor: face windows, captions, answer menu rows.
// The page blits them onto the RGBA frame (the original draws them as sprites above the scene). No DOM.
import { rgb565ToRgba } from "../formats/bm";

export interface Overlay {
  /** screen position (the scroll is already subtracted) */
  x: number;
  y: number;
  /** RGB565, 0 = transparent */
  image: { width: number; height: number; pixels: Uint16Array };
}

/** Keyed blits of `overlays` onto a 640x480 RGBA buffer, in order (the later one on top), clipped to the screen. */
export function drawOverlays(rgba: Uint8ClampedArray, overlays: readonly Overlay[], width = 640, height = 480): void {
  for (const o of overlays) {
    const { image } = o;
    const px = rgb565ToRgba(image.pixels);
    for (let y = 0; y < image.height; y++) {
      const dy = o.y + y;
      if (dy < 0 || dy >= height) continue;
      for (let x = 0; x < image.width; x++) {
        const dx = o.x + x;
        if (dx < 0 || dx >= width) continue;
        const s = (y * image.width + x) * 4;
        if (px[s + 3] === 0) continue;
        const d = (dy * width + dx) * 4;
        rgba[d] = px[s];
        rgba[d + 1] = px[s + 1];
        rgba[d + 2] = px[s + 2];
        rgba[d + 3] = 255;
      }
    }
  }
}
