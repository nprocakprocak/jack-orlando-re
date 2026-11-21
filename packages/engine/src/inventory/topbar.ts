// The item bar at the top of the screen (legacy inventory mode): the dead code of Game_Run.
// State machine and input without DOM; the game feeds `frame()` once per frame and draws `overlays()`.
// Description and deviations:, (the bar).
import { readBm } from "../formats/bm";
import type { Pak } from "../formats/pak";
import type { Surface16 } from "../render/surface";

/** Rows the bar slides: it starts at `g_topBarY = -0x4a`, moves 6 px per frame and stops at 4 (13 frames). */
export const BAR_HIDDEN_Y = -0x4a;
export const BAR_SHOWN_Y = 4;
export const BAR_SLIDE = 6;
/** The mouse below this row closes the bar (`mouseY > 0x5a`, Game_Run l. 1374). */
export const BAR_CLOSE_Y = 0x5a;
/** [hypothesis] the bar opens when the pointer touches the top edge of the picture (the code that opened it is missing). */
export const BAR_OPEN_Y = 1;
/** Slot width in the strip (`0x2c`), the centre of an item inside it (`slot·0x2c + 0x1a`, row `0x18`). */
export const SLOT_W = 0x2c;
export const ITEM_CX = 0x1a;
export const ITEM_CY = 0x18;
/** Left edge of the strip window on the screen and its drawn width (clip at `0x249`); items are hit inside `(0xbc, 0x235)`. */
export const STRIP_X = 0xbd;
export const STRIP_W = 0x249 - 0xbd;
export const STRIP_H = 48;
/** Strip offset from the bar's top (`g_topBarY + 0xb`). */
export const STRIP_DY = 0xb;
/** `BELKA.BM` is 792 px wide (18 slots); the strip is that picture repeated. */
export const BELKA_W = 792;
/** Slots visible at the end of the strip: the last offset of the original is `-45·0x2c` of 54 slots. */
export const END_VISIBLE = 9;
/** Row of the notice strip with the item name (`g_barNoticeY`, 0x4b): under the bar, the coat uses 400. */
export const NOTICE_Y_BAR = 0x4b;

/** Click rectangles of Game_Run, screen coordinates; strict inequalities (`Click_InRect`). */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
export const STRIP_BOX: Box = { x0: 0xbc, y0: -0x32, x1: 0x235, y1: 0x32 };
/** items are put down only in the lower part of the strip */
export const DROP_BOX: Box = { x0: 0xbc, y0: 0xa, x1: 0x235, y1: 0x32 };
export const OPTIONS_BOX: Box = { x0: 8, y0: 0, x1: 0x94, y1: 0x45 };
export const LEFT_BOX: Box = { x0: 0x94, y0: 0xb, x1: 0xb8, y1: 0x3d };
export const RIGHT_BOX: Box = { x0: 0x251, y0: 0xb, x1: 0x279, y1: 0x3d };

export const inside = (b: Box, x: number, y: number): boolean => x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1;

export interface TopBarImages {
  /** TOPMGR.BM 640×71 */
  panel: Surface16;
  /** OPTGR.BM 131×34 */
  options: Surface16;
  /** L_ARROW.BM 37×50 */
  left: Surface16;
  /** R_ARROW.BM 41×50 */
  right: Surface16;
  /** BELKA.BM 792×48 */
  strip: Surface16;
  /** RAMKA.BM 48×41: the frame that follows the cursor with an item in hand */
  frame: Surface16;
}

export function loadTopBarAssets(resource: Pak): TopBarImages {
  return {
    panel: readBm(resource, "TOPMGR.BM"),
    options: readBm(resource, "OPTGR.BM"),
    left: readBm(resource, "L_ARROW.BM"),
    right: readBm(resource, "R_ARROW.BM"),
    strip: readBm(resource, "BELKA.BM"),
    frame: readBm(resource, "RAMKA.BM"),
  };
}

export interface TopBarHost {
  /** Script_StartMacro: true = a macro of this name exists and was started. */
  startMacro(name: string): boolean;
  /** is the macro of this name still running (clears `g_barMacroExclusive`) */
  macroActive(name: string): boolean;
  /** Item_LookupName: display name (Mazovia bytes) for the item file, null = no record. */
  itemName(file: string): Uint8Array | null;
  /** the options button was released over itself: the game opens the F4 menu in this frame */
  requestOptions(): void;
}

/** What the page gives per frame. */
export interface BarInput {
  x: number;
  y: number;
  /** left button is down / went down in this frame */
  down: boolean;
  pressed: boolean;
  /** right button is down / went down in this frame (the arrows scroll twice as fast with it) */
  right: boolean;
  rightPressed: boolean;
  inWindow: boolean;
}

export type BarState = "closed" | "opening" | "open" | "closing";

/** An image for the page to blit over the scene (same shape as play/overlay.ts `Overlay`). */
export interface BarOverlay {
  x: number;
  y: number;
  image: { width: number; height: number; pixels: Uint16Array };
}

export { TopBar } from "./topbar-bar";
