// Pixel helpers of the object commands BRIGHTNESSE / SETDARKNESSANIMA (Script_ExecStep cases 0x40, 0x67;
// the drawing step of Game_Run).
import type { Image16 } from "../formats/bm";
import { scaleColor } from "../anim/light";
import { blend565 } from "../cursor/lens";

/** The colour a type -8 object is blended in before SETDARKNESSANIMA (is initialised to 0xffff at the animation's creation). */
export const GLASS_WHITE = 0xffff;

/**
 * `(c1, c2, t)`: per channel `ftol((a * (2 - t) + b * t) / 2)` (the float code was read from the instructions, see
 * `mixColour` in play/film.ts, which has the same formula; copied here to keep the scene code free of the game layer).
 * SETDARKNESSANIMA stores `mixColour(0xffff, 0, f)`: f = 0 white, f = 2 black.
 */
export function mixColour(c1: number, c2: number, t: number): number {
  const ch = (a: number, b: number) => Math.trunc((a * (2 - t) + b * t) / 2);
  const r = ch((c1 >> 11) & 0x1f, (c2 >> 11) & 0x1f);
  const g = ch((c1 >> 5) & 0x3f, (c2 >> 5) & 0x3f);
  const b = ch(c1 & 0x1f, c2 & 0x1f);
  return ((r << 11) | (g << 5) | b) & 0xffff;
}

/**
 * BRIGHTNESSE (case 0x40): every non-zero palette colour of the 8-bit image has its channels multiplied by `factor` (truncated,
 * at least 1). The decoded image has the palette applied, so the same function is applied to the pixels - equal for any
 * paletted image because the result depends on the colour only. Returns a copy; 16-bit images (no palette in the original, where
 * the loop would overwrite 126 pixels) are returned unchanged.
 */
export function brightenImage(img: Image16, factor: number): Image16 {
  if (img.kind === "rgb565") return img;
  const pixels = new Uint16Array(img.pixels.length);
  const memo = new Map<number, number>();
  for (let i = 0; i < pixels.length; i++) {
    const c = img.pixels[i];
    if (c === 0) continue;
    let v = memo.get(c);
    if (v === undefined) memo.set(c, (v = scaleColor(c, factor)));
    pixels[i] = v;
  }
  return { ...img, pixels };
}

/**
 * The type -8 drawing branch of Game_Run (the `else` of `g_sceneObjWasPbm16 == 0`): the picture is a mask - the
 * blue part of every pixel (0..31) is the level by which the scene pixel moves toward `colour` through the blend tables
 * (level 0 leaves it). The result is an opaque rectangle of the scene (`backdrop` at the object's place, 0 outside it).
 */
export function blendOverBackdrop(mask: Image16, backdrop: Image16, x: number, y: number, colour: number): Image16 {
  const pixels = new Uint16Array(mask.width * mask.height);
  for (let r = 0; r < mask.height; r++) {
    const sy = y + r;
    if (sy < 0 || sy >= backdrop.height) continue;
    for (let c = 0; c < mask.width; c++) {
      const sx = x + c;
      if (sx < 0 || sx >= backdrop.width) continue;
      const bg = backdrop.pixels[sy * backdrop.width + sx];
      const level = mask.pixels[r * mask.width + c] & 0x1f;
      pixels[r * mask.width + c] = level ? blend565(bg, colour, level) : bg;
    }
  }
  return { width: mask.width, height: mask.height, kind: "rgb565", pixels };
}
