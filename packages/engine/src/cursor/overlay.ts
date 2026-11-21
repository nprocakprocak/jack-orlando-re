// Draws the cursor on top of an already presented frame (the original draws it after the scene,
// Sprite_SetOverlay + Render_RedrawRectOverlay, keyed on colour 0).
import type { Image16 } from "../formats/bm";
import { rgb565ToRgba } from "../formats/bm";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import type { CursorDraw } from "./cursor";
import { renderLens, zoomImage } from "./lens";

/**
 * Mask of the lens image for a mode-1 cursor image (Cursor_UpdateHotspot): `LUPAnn` (motion
 * frame) uses `MASKAnn`, the reaction frames `BLIR0k` use `M0k`; null for every other image.
 */
export function lensMaskName(image: string): string | null {
  const m = /^(LUPA|BLIR)(\d\d)\.BM$/i.exec(image);
  if (!m) return null;
  return m[1].toUpperCase() === "LUPA" ? `MASKA${m[2]}.BM` : `M${m[2]}.BM`;
}

/** The masks of the lens by file name (see `lensMaskName`); a missing one makes the cursor fall back to the plain frame. */
export type LensMasks = ReadonlyMap<string, Image16>;

/** The screen as RGB565 (the lens works on the scene as the original has it, 16 bit). */
function rgbaTo565(rgba: Uint8ClampedArray, width: number, height: number): Uint16Array {
  const out = new Uint16Array(width * height);
  for (let i = 0; i < out.length; i++) {
    out[i] = ((rgba[4 * i] >> 3) << 11) | ((rgba[4 * i + 1] >> 2) << 5) | (rgba[4 * i + 2] >> 3);
  }
  return out;
}

/**
 * Blits `img` (RGB565, 0 = transparent) onto an RGBA screen buffer of 640x480 at the draw's
 * position minus the scroll, clipped to the screen. While the mode-switch zoom runs
 * (`draw.scale` < 1) the image is first scaled with the original's box filter (`zoomImage`,
 * Cursor_BoxScale). With `masks` and a mode-1 image (`LUPA`/`BLIR`) at full size, the
 * magnifier is composed from the screen buffer as it is - it must not contain the cursor yet -
 * under the glass (`renderLens`: the background 1:1, tinted; the mouse is the centre of the image).
 */
export function drawCursor(
  rgba: Uint8ClampedArray,
  img: Image16,
  draw: CursorDraw,
  scrollX = 0,
  scrollY = 0,
  width = SCREEN_WIDTH,
  height = SCREEN_HEIGHT,
  masks?: LensMasks,
): void {
  const ox = draw.x - scrollX;
  const oy = draw.y - scrollY;
  if (draw.scale !== 1) {
    const z = zoomImage(img, draw.scale);
    if (!z) return;
    img = z;
  } else if (masks) {
    const maskName = lensMaskName(draw.image);
    const mask = maskName ? masks.get(maskName) : undefined;
    if (mask) img = renderLens(rgbaTo565(rgba, width, height), width, ox + (img.width >> 1), oy + (img.height >> 1), mask, img);
  }
  const px = rgb565ToRgba(img.pixels);
  for (let y = 0; y < img.height; y++) {
    const sy = oy + y;
    if (sy < 0 || sy >= height) continue;
    for (let x = 0; x < img.width; x++) {
      const sx = ox + x;
      if (sx < 0 || sx >= width) continue;
      const s = (y * img.width + x) * 4;
      if (px[s + 3] === 0) continue;
      const d = (sy * width + sx) * 4;
      rgba[d] = px[s];
      rgba[d + 1] = px[s + 1];
      rgba[d + 2] = px[s + 2];
      rgba[d + 3] = 255;
    }
  }
}
