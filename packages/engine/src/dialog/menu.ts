// The answer menu of DIALOG (builds it, handles the mouse).

import type { DcnEntry } from "../formats/dialog";
import { LINE_HEIGHT, type Measure } from "./caption";

export const MENU_SLOTS = 8;
export const MENU_X = 6;
export const ROW_PITCH = 0x18;
/** y of the first row for `visible` options: 0x1d3 - 25 * visible (case 0xb of Script_ExecStep). */
export const menuTop = (visible: number) => 0x1d3 - LINE_HEIGHT * visible;
/** "no option" marker of the sort array (an option hidden by SETDIALOG goes to the end). */
const HIDDEN_WIDTH = 10000;

export interface MenuRow {
  /** index of the option in its dialog block = the answer stored for IFANSWER */
  index: number;
  text: string;
  /** width of the row's box: text width + 4, rounded up to even */
  width: number;
  /** left / top in world pixels */
  x: number;
  y: number;
}

/**
 * the visible options (hidden flag 0) sorted by ascending box width - a bubble sort
 * with a strict `<`, so equal widths keep the file order. Row k is at y + 24 * k. At most 8 options
 * (the game's arrays); more are ignored here, the game would overwrite its stack.
 */
export function buildMenu(options: DcnEntry[], hidden: boolean[], measure: Measure, scrollX: number, scrollY: number, top: number): MenuRow[] {
  const items = options.slice(0, MENU_SLOTS).map((e, index) => {
    if (hidden[index]) return { index: -1, width: HIDDEN_WIDTH };
    const w = measure(e.text) + 4;
    return { index, width: w & 1 ? w + 1 : w };
  });
  while (items.length < MENU_SLOTS) items.push({ index: -1, width: HIDDEN_WIDTH });
  for (let pass = 0; pass < MENU_SLOTS; pass++) {
    for (let j = 0; j < MENU_SLOTS - 1; j++) {
      if (items[j + 1].width < items[j].width) [items[j], items[j + 1]] = [items[j + 1], items[j]];
    }
  }
  return items
    .filter((it) => it.index >= 0)
    .map((it, k) => ({ index: it.index, text: options[it.index].text, width: it.width, x: MENU_X + scrollX, y: k * ROW_PITCH + scrollY + top }));
}

/** Number of options shown: those without the hidden flag. */
export const visibleCount = (hidden: boolean[], count: number) => {
  let n = 0;
  for (let i = 0; i < count; i++) if (!hidden[i]) n++;
  return n;
};

export interface PointerResult {
  /** row under the mouse, or -1 */
  hover: number;
  /** pressed (highlighted) row, or -1 */
  pressed: number;
  /** the chosen option index when the button was released over the pressed row */
  chosen?: number;
}

/**
 * as a state machine. A row is highlighted while the button is held over it
 * (`down`), un-highlighted when the mouse leaves it with the button held, and chosen when the
 * button is released over the highlighted row. `pressed` is the row's position in `rows`.
 */
export class MenuPointer {
  pressed = -1;
  constructor(readonly rows: MenuRow[]) {}

  /**
 * Position of the row under (x, y) in world pixels, or -1. (x, y) is the click point g_clickX/g_clickY
 * (mouse + the cursor's hotspot offset), which compares - not the mouse position.
 */
  hit(x: number, y: number): number {
    // rows overlap by 1 px (pitch 24, height 25): the later row is drawn on top
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + LINE_HEIGHT) return i;
    }
    return -1;
  }

  update(x: number, y: number, down: boolean): PointerResult {
    const hover = this.hit(x, y);
    if (hover >= 0 && this.pressed < 0 && down) this.pressed = hover;
    else if (this.pressed >= 0 && hover !== this.pressed && down) this.pressed = -1;
    else if (hover >= 0 && hover === this.pressed && !down) {
      const chosen = this.rows[hover].index;
      this.pressed = -1;
      return { hover, pressed: -1, chosen };
    }
    return { hover, pressed: this.pressed };
  }
}

/**
 * How a row is drawn: normal = text at the row origin with the shadow at (+1, +1);
 * pressed (button held over it) = no shadow, text white and moved to (+1, +1), i.e. onto the shadow
 * (state 0/1 and ; the white of the pressed colour pair is a hypothesis matching the user's observation).
 */
export function rowStyle(pressed: boolean, normalFill: number): { dx: number; dy: number; shadow: boolean; fill: number } {
  return pressed ? { dx: 1, dy: 1, shadow: false, fill: 0xffff } : { dx: 0, dy: 0, shadow: true, fill: normalFill };
}

/**
 * Game_Run calls only while `g_clickArmed != 0` (about line 16677 of the export). The click that interrupted a line clears
 * it and `g_mouseLeftDown == 0` sets it again, so a button still held when the menu opens neither highlights nor chooses a row.
 * The gate hides the button from the menu until it has gone up once since the menu opened.
 */
export class ReleaseGate {
  private was = false;
  private armed = true;

  /** `open` = the menu is open in this frame; returns the `down` the menu may see. */
  update(open: boolean, down: boolean): boolean {
    if (!open) {
      this.was = false;
      return down;
    }
    if (!this.was) this.armed = !down;
    else if (!down) this.armed = true;
    this.was = true;
    return down && this.armed;
  }
}
