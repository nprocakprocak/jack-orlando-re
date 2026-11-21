// Shadow sprites of the scene: the glue between the pure shadow logic (persons/shadow.ts: what to draw, Blit_ShadowDarken)
// and the renderer. Like the original (Person_DrawShadow, Jack_DrawShadow) a shadow is an opaque
// w x h sprite: the background under it is copied (Render_ComposeRegionNoFlag) and darkened under the non-zero
// pixels of the mask image.
import type { Image16 } from "../formats/bm";
import { darken, shadowExtent, type ShadowDraw, type ShadowTables } from "../persons/shadow";

/**
 * Stand-in for the colour tables where a player has none (the M1
 * demo, tests): the real tables subtract about `level` from each 5-bit channel and `2 * level` from the 6-bit green.
 */
export function approximateShadowTables(): ShadowTables {
  const blue = new Uint8Array(33 * 0x80);
  const green = new Uint16Array(33 * 64);
  const red = new Uint16Array(33 * 64);
  for (let level = 0; level < 33; level++) {
    for (let v = 0; v < 32; v++) {
      blue[level * 0x80 + v] = Math.max(v - level, 0);
      red[level * 64 + v] = Math.max(v - level, 0) << 11;
    }
    for (let v = 0; v < 64; v++) green[level * 64 + v] = Math.max(v - 2 * level, 0) << 5;
  }
  return { blue, green, red };
}

/**
 * What Jack_DrawShadow has computed already (image size from the mask, the anchor-shifted position and the capped scale)
 * as the `ShadowDraw` the pure code works with; the same sizes and steps as `PersonShadow` (`shape`).
 */
export function drawAt(x: number, y: number, scale: number, maskWidth: number, maskHeight: number, level: number): ShadowDraw {
  return { scale, x, y, level, ...shadowExtent(x, scale, maskWidth, maskHeight) };
}

/** `Image16` flipped left to right (the mirrored shadows of Jack: the game passes a negative column step). */
export function flipped(img: Image16): Image16 {
  const pixels = new Uint16Array(img.pixels.length);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) pixels[y * img.width + x] = img.pixels[y * img.width + img.width - 1 - x];
  }
  return { ...img, pixels };
}

/**
 * The sprite image of one shadow: the background rectangle of `draw` darkened under `mask`. Null when there is nothing to show
 * (width or height < 1: Blit_ShadowDarken returns at once and the sprite is empty). Parts outside the background stay 0.
 */
export function composeShadow(backdrop: Image16, draw: ShadowDraw, mask: Image16, tables: ShadowTables): Image16 | null {
  if (draw.width < 1 || draw.height < 1) return null;
  const buf = new Uint16Array(draw.width * draw.height);
  const { srcX, srcWidth, dstX } = draw.backdrop;
  for (let r = 0; r < draw.height; r++) {
    const sy = draw.y + r;
    if (sy < 0 || sy >= backdrop.height) continue;
    for (let c = 0; c < srcWidth; c++) {
      const sx = srcX + c;
      if (sx >= backdrop.width || dstX + c >= draw.width) break;
      buf[r * draw.width + dstX + c] = backdrop.pixels[sy * backdrop.width + sx];
    }
  }
  darken(buf, draw, mask, tables);
  return { width: draw.width, height: draw.height, kind: "rgb565", pixels: buf };
}

/**
 * `Sprite_Add(z = 0)` of the shadow sprites (`Game_Run`, after the scene objects, which are inserted before the first sprite with
 * `z ≥ their own`): the shadows lie under every object and person and the depth test never moves them. Here objects take
 * `z = 0 n`, so the shadows get a value below all of them.
 */
export const Z_SHADOW = -1;

/** CCG type of a PBM object that `Scene_RefreshBackground` does not place (`g_sceneObjWasPbm16`): only its animation shows it. */
export const TYPE_PBM_ANIMATED = -8;

/**
 * Whether an object's sprite is put on screen at scene start: `Scene_RefreshBackground` skips type −8 objects (SC005 `SZYBY.PBM`, the
 * windows of the inspector's car, which exist only for the animation started when Jack arrives from SC001), and objects outside the screen
 * (the scripts bring them in later).
 */
export function shownAtSceneStart(type: number, y: number): boolean {
  return type !== TYPE_PBM_ANIMATED && y < 480 && y >= -400;
}
