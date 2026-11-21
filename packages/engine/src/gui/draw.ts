// GUI drawing: window frame, button frames, outlined text with shadow. Geometry.
import type { Font } from "../formats/fnt";
import { layoutText, OUTLINE } from "../formats/fnt";
import type { Surface16 } from "../render/surface";
import { blitCopy, strideOf } from "../render/surface";
import { darkenPixel, darkenRect } from "./darken";

export const COLOR_BLUE = 0x001f;
export const COLOR_WHITE = 0xffff;
export const COLOR_YELLOW = 0xffe0;
/** Darkest "almost black" outline of titles (color 1). */
export const COLOR_OUTLINE_BLACK = 1;

/** Gui_CenterOffset: (a - b) / 2 when b < a, else 0. */
export function centerOffset(a: number, b: number): number {
  return b < a ? Math.trunc((a - b) / 2) : 0;
}

function plot(s: Surface16, x: number, y: number, level: number): void {
  if (x < 0 || y < 0 || x >= s.width || y >= s.height) return;
  const i = y * strideOf(s) + x;
  s.pixels[i] = darkenPixel(s.pixels[i], level);
}

/**
 * Frame of a window over its scene snapshot (Gui_DrawWindowFrame): 5 one-pixel rings
 * (top/left level 10, bottom/right 22, the top-right and bottom-left pixels 16; every pixel darkened once) and a half-dark interior (16).
 */
export function drawWindowFrame(s: Surface16, w: number, h: number): void {
  const T = 5;
  for (let c = 0; c < T; c++) {
    for (let x = c; x <= w - 2 - c; x++) plot(s, x, c, 10);
    for (let y = c + 1; y <= h - 2 - c; y++) plot(s, c, y, 10);
    for (let x = c + 1; x <= w - 1 - c; x++) plot(s, x, h - 1 - c, 22);
    for (let y = c + 1; y <= h - 2 - c; y++) plot(s, w - 1 - c, y, 22);
    plot(s, w - 1 - c, c, 16);
    plot(s, c, h - 1 - c, 16);
  }
  darkenRect(s, T, T, w - 2 * T, h - 2 * T, 16);
}

/**
 * Button frame drawn over a fresh copy of the scene in its rectangle (Gui_DrawBtnRaised /
 * Gui_DrawBtnSunken). `rect` is the button in `s`; `scene` has the same size as `s` at the same place.
 */
export function drawButtonFrame(s: Surface16, x: number, y: number, w: number, h: number, pressed: boolean): void {
  const t = pressed ? 2 : 4;
  const [lt, rb, corner, inner] = pressed ? [3, 13, 6, 10] : [0, 13, 6, 6];
  for (let c = 0; c < t; c++) {
    for (let xx = c; xx <= w - 2 - c; xx++) if (lt) plot(s, x + xx, y + c, lt);
    for (let yy = c + 1; yy <= h - 2 - c; yy++) if (lt) plot(s, x + c, y + yy, lt);
    for (let xx = c + 1; xx <= w - 1 - c; xx++) plot(s, x + xx, y + h - 1 - c, rb);
    for (let yy = c + 1; yy <= h - 2 - c; yy++) plot(s, x + w - 1 - c, y + yy, rb);
    plot(s, x + w - 1 - c, y + c, corner);
    plot(s, x + c, y + h - 1 - c, corner);
  }
  darkenRect(s, x + t, y + t, w - 2 * t, h - 2 * t, inner);
}

export function copyRect(scene: Surface16, dst: Surface16, x: number, y: number, w: number, h: number): void {
  blitCopy(scene, x, y, w, h, dst, x, y);
}

/**
 * Text with outline/fill colors; pixel value 1 = outline, other nonzero = fill. With `remap`
 * the glyph does not write colors but darkens what is underneath: outline pixels by `remap[0]`, fill by
 * `remap[1]` (Text_PrintfAtRemap, used for the shadow).
 */
export function drawText(
  s: Surface16, font: Font, text: Uint8Array, x: number, y: number, outline: number, fill: number,
  remap?: readonly [number, number],
): void {
  const stride = strideOf(s);
  for (const { x: gx, glyph } of layoutText(font, text).glyphs) {
    for (let i = 0; i < glyph.pixels.length; i++) {
      const v = glyph.pixels[i];
      if (!v) continue;
      const px = x + gx + (i % glyph.width);
      const py = y + Math.floor(i / glyph.width);
      if (px < 0 || py < 0 || px >= s.width || py >= s.height) continue;
      const at = py * stride + px;
      if (remap) s.pixels[at] = darkenPixel(s.pixels[at], v === OUTLINE ? remap[0] : remap[1]);
      else s.pixels[at] = v === OUTLINE ? outline : fill;
    }
  }
}

/** Shadow (darkened +1,+1: outline 10, fill 6) and the text itself. */
export function drawTextShadowed(
  s: Surface16, font: Font, text: Uint8Array, x: number, y: number, outline: number, fill: number,
): void {
  drawText(s, font, text, x + 1, y + 1, 0, 0, [10, 6]);
  drawText(s, font, text, x, y, outline, fill);
}
