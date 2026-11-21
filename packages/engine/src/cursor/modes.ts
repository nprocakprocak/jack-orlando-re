// Cursor modes of the original (g_cursorMode, 008f68f6), their image sets and hotspots.
// Description and evidence.

import { pad2 } from "../core/pad";

/** Verb modes 0-4 (switched from the verb menu), 5 = item in hand, 10-21 = zone/edge cursors. */
export const CursorMode = {
  /** "POKAZANIE" - the pointing hand (default). */
  Point: 0,
  /** "PATRZENIE" - magnifier. */
  Look: 1,
  /** "UDERZENIE" - fist. */
  Hit: 2,
  /** "STRZELANIE" - crosshair (KOLT). */
  Shoot: 3,
  /** "BRANIE" - grabbing hand (HAN). */
  Take: 4,
  /** Item in hand: the cursor image is the item sprite. */
  Item: 5,
  /** Zone cursors (10-19, see isZoneMode); the set names are facts, the meanings are guesses. */
  ZoneLeft: 10,
  ZoneRight: 11,
  ZoneDown: 13,
  ZoneIn: 14,
  ZoneUp: 15,
  ZoneOut: 17,
  /** Screen-edge scroll cursors (outside 10-19, so the plain hotspot). */
  ScrollLeft: 20,
  ScrollRight: 21,
} as const;

/** Cursor_IsMode10to19: modes that make area hit-tests accept exit areas only. */
export function isZoneMode(mode: number): boolean {
  return mode >= 10 && mode <= 19;
}

/** Verb modes 0-4: the ones with a verb name and a "reaction" check (Cursor_SetVerbName). */
export function isVerbMode(mode: number): boolean {
  return mode >= 0 && mode <= 4;
}

/** Cursor_SetVerbName: the verb prefix of the VERB-NAME macros; unknown modes -> POKAZANIE. */
export function verbName(mode: number): string {
  switch (mode) {
    case CursorMode.Look: return "PATRZENIE";
    case CursorMode.Hit: return "UDERZENIE";
    case CursorMode.Shoot: return "STRZELANIE";
    case CursorMode.Take: return "BRANIE";
    default: return "POKAZANIE";
  }
}

/**
 * Offset of the click point from the mouse position (Cursor_UpdateHotspot:
 * g_clickX = mouseX + dx, g_clickY = mouseY + dy). `flag` is 006bc294, which the code never
 * sets (always 0 in the shipped exe) - kept because it changes modes 4 and the default.
 */
export function hotspotOffset(mode: number, flag = false): { dx: number; dy: number } {
  switch (mode) {
    case CursorMode.Point: return { dx: -9, dy: -12 };
    case CursorMode.Look: return { dx: -4, dy: -4 };
    case CursorMode.Hit: return { dx: -7, dy: -10 };
    case CursorMode.Shoot: return { dx: 0, dy: 0 };
    case CursorMode.Take: return flag ? { dx: -9, dy: -12 } : { dx: -10, dy: 8 };
    default:
      return isZoneMode(mode) || flag ? { dx: -9, dy: -12 } : { dx: 0, dy: 0 };
  }
}

/** The image is drawn centred on the mouse: top-left = mouse - (w/2, h/2), integer halves. */
export function imageOrigin(mouseX: number, mouseY: number, w: number, h: number): { x: number; y: number } {
  return { x: mouseX - (w >> 1), y: mouseY - (h >> 1) };
}

/** Hotspot as a pixel inside the image: where the click point lies in the drawn image. */
export function hotspotInImage(mode: number, w: number, h: number, flag = false): { x: number; y: number } {
  const { dx, dy } = hotspotOffset(mode, flag);
  return { x: (w >> 1) + dx, y: (h >> 1) + dy };
}

/** Frame file name of a mode ("" when the mode has no animated set). Indices are 0-based frame numbers. */
export function frameName(mode: number, frame: number): string {
  switch (mode) {
    case 0: return `WSK${pad2(frame)}.BM`;
    case 1: return `LUPA${pad2(frame + 1)}.BM`;
    case 2: return `FIS${pad2(frame)}.BM`;
    case 3: return `KOLT${pad2(frame + 1)}.BM`;
    case 4: return `HAN${pad2(frame + 1)}.BM`;
    case 10: return `LEFT0${pad2(frame + 1)}.BM`;
    case 11: return `RIGHT${pad2(frame + 1)}.BM`;
    case 13: return `STDN00${pad2(frame + 1)}.BM`;
    case 14: return `TOIN00${pad2(frame + 1)}.BM`;
    case 15: return `STUP00${pad2(frame + 1)}.BM`;
    case 17: return `TOUT00${pad2(frame + 1)}.BM`;
    case 20: return `SCLF00${pad2(frame + 1)}.BM`;
    case 21: return `SCRG00${pad2(frame + 1)}.BM`;
    default: return "";
  }
}

/** Magnifier "hot" frames BLIR00..BLIR04 (g_cursorLensFrame 9..13 in the original). */
export function lensHotName(lensFrame: number): string {
  return `BLIR${pad2(lensFrame - 9)}.BM`;
}

/**
 * Waiting cursor while a scene loads: the original loads CD00, CD02 CD38 (even numbers only,
 * Game_Main) into consecutive slots and cycles the first 10 of them: CD00 CD18.
 */
export function busyName(frame: number): string {
  return `CD${pad2((((frame % 10) + 10) % 10) * 2)}.BM`;
}

/** Mask files of the lens (see lensMaskName in overlay.ts): MASKA01..09 for LUPA01..09, M00..M04 for BLIR00..04. */
export function lensMaskFiles(): string[] {
  const out: string[] = [];
  for (let i = 1; i <= 9; i++) out.push(`MASKA0${i}.BM`);
  for (let i = 0; i <= 4; i++) out.push(`M0${i}.BM`);
  return out;
}

/** All image files the cursor can show (PAK: Resource/Resource.pak), for preloading. */
export function allCursorFiles(): string[] {
  const out: string[] = [];
  const counts: [number, number][] = [[0, 9], [1, 9], [2, 10], [3, 4], [4, 10], [10, 15], [11, 15], [13, 15], [14, 15], [15, 15], [17, 15], [20, 15], [21, 15]];
  for (const [mode, n] of counts) for (let i = 0; i < n; i++) out.push(frameName(mode, i));
  for (let i = 9; i <= 13; i++) out.push(lensHotName(i));
  for (let i = 0; i < 10; i++) out.push(busyName(i));
  return out;
}
