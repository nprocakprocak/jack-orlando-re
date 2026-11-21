// Caption text: word wrap, centering and placement of a spoken line.
// Pure logic, no drawing.

import { MAZOVIA } from "../formats/textcrypt";

/** Width in pixels of a text in the caption font (Text_PrintfWidth with font 0 = JACK). */
export type Measure = (text: string) => number;

/** Caption lines are at most 5 (the line buffer has 5 x 0x50 bytes). */
export const MAX_LINES = 5;
/** Height of one caption row (0x19); rows are drawn 24 px apart (`c - 1`). */
export const LINE_HEIGHT = 25;
export const LINE_PITCH = 24;
export const SCREEN_W = 640;
/** The captions keep inside y < 0x1df. */
export const BOTTOM = 0x1df;

const REVERSE = new Map<string, number>(MAZOVIA.map((c, i) => [c, i] as [string, number]).reverse());

/**
 * Text from a .DCN (Mazovia-decoded) back to the game's bytes, for the font.
 * `é` (byte 0x82) has no glyph in the Resource.pak fonts, so it is drawn as `e`.
 */
export function encodeMazovia(text: string): Uint8Array {
  return Uint8Array.from(text, (c) => (c === "é" ? 0x65 : REVERSE.get(c) ?? 0x3f));
}

/**
 * The wrapping of (the same loop as the line counter): the text is cut
 * into chunks that end after a space; a chunk joins the current line when the line plus the chunk
 * is strictly narrower than `maxWidth` (the trailing space counts), otherwise the line is closed
 * (its last space removed) and the chunk starts the next one. After 5 lines the rest is dropped.
 * A chunk wider than the box skips lines (they stay empty), as in the game.
 * Returns the lines; their count is what returns.
 */
export function wrapCaption(measure: Measure, text: string, maxWidth: number): string[] {
  const lines: string[] = [""];
  let li = 0;
  let rest = text;
  for (;;) {
    const sp = rest.indexOf(" ");
    const chunk = sp >= 0 ? rest.slice(0, sp + 1) : rest;
    for (;;) {
      if (li >= MAX_LINES) return lines.slice(0, MAX_LINES);
      const joined = lines[li] + chunk;
      if (measure(joined) < maxWidth) {
        lines[li] = joined;
        break;
      }
      if (lines[li].endsWith(" ")) lines[li] = lines[li].slice(0, -1);
      lines[++li] = "";
    }
    if (sp < 0) return lines;
    rest = rest.slice(chunk.length);
  }
}

export interface PlacedLine {
  text: string;
  /** left edge of the line, in world pixels */
  x: number;
  y: number;
}

export interface Caption {
  /** box in world pixels (the text is centered inside it) */
  x: number;
  y: number;
  width: number;
  height: number;
  lines: PlacedLine[];
  /** RGB565: the glyph outline and fill */
  outline: number;
  fill: number;
}

export interface CaptionColors {
  outline: number;
  fill: number;
}

function layout(measure: Measure, text: string, boxW: number, x0: number, y: number, c: CaptionColors): Caption {
  const lines = wrapCaption(measure, text, boxW);
  return {
    x: x0,
    y,
    width: boxW,
    height: lines.length * LINE_HEIGHT,
    lines: lines.map((t, i) => ({ text: t, x: x0 + Math.trunc((boxW - measure(t)) / 2), y: y + i * LINE_PITCH })),
    outline: c.outline,
    fill: c.fill,
  };
}

/** Clamp of the center `x` to the screen (shared by and). `left` = the left-edge branch. */
function clampX(x: number, w: number, scrollX: number): { x: number; left: boolean } {
  const half = Math.trunc(w / 2);
  if (x - half < scrollX) return { x: scrollX + 1 + half, left: true };
  if (x + half > scrollX + SCREEN_W) return { x: scrollX - half + SCREEN_W - 1, left: false };
  return { x, left: false };
}

export interface CaptionInput {
  measure: Measure;
  text: string;
  /** the width stored with the line (3rd field of the .DCN) */
  width: number;
  scrollX: number;
  /** colour of the speaker of the left / right window (already looked up; see DialogTables) */
  leftColor: CaptionColors;
  rightColor: CaptionColors;
}

/**
 * (x, y, width, text): caption of the LEFT / RIGHT speaker. `x` is the center of the box
 * (TALK uses scrollX for LEFT and scrollX + 0x280 for RIGHT, y = 0x8c). A box that would cross the
 * left edge of the screen is moved to it and takes the left window's colour; every other box takes
 * the right window's colour (also one that is moved off the right edge).
 */
export function placeCaption(i: CaptionInput, x: number, y: number): Caption {
  const { x: cx, left } = clampX(x, i.width, i.scrollX);
  const n = wrapCaption(i.measure, i.text, i.width).length;
  let top = y;
  if (top < 0) top = 1;
  else if (top + n * LINE_PITCH > BOTTOM) top = BOTTOM - n * LINE_PITCH;
  return layout(i.measure, i.text, i.width, cx - Math.trunc(i.width / 2), top, left ? i.leftColor : i.rightColor);
}

/**
 * (x, y, width, text): caption above a person or Jack (`x` = center of the sprite, `y`
 * = its top - 10). The vertical clamp is as in the game, which looks wrong: the corrected top
 * `y` is clamped, then the box is drawn at `y - lines*24` anyway (so a clamped caption lands
 * above the screen) - see.
 */
export function placePersonCaption(i: Omit<CaptionInput, "leftColor" | "rightColor">, x: number, y: number, c: CaptionColors): Caption {
  const { x: cx } = clampX(x, i.width, i.scrollX);
  const n = wrapCaption(i.measure, i.text, i.width).length;
  let ty = y;
  if (y - n * LINE_PITCH < 0) ty = 1;
  else if (y > BOTTOM) ty = BOTTOM - n * LINE_PITCH;
  return layout(i.measure, i.text, i.width, cx - Math.trunc(i.width / 2), ty - n * LINE_PITCH, c);
}
