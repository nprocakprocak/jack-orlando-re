// The coat screen (F1): state and input of the loop, drawing. No DOM: the host feeds
// pointer/key events and one tick() per frame and draws the result. -6.
import type { Font } from "../formats/fnt";
import { NoticeStrip, NOTICE_Y_COAT, ANIM_ROLLUP } from "../keys/notice";
import type { Surface16 } from "../render/surface";
import { blitCopy, blitKeyed, createSurface } from "../render/surface";
import { clippedKeyed, clippedShadow } from "./screen-blit";
export { shadowPixel } from "./screen-blit";
import {
  CELL_CX,
  CELL_CY,
  CELL_H,
  CLOSE_X,
  COLS,
  CELL_W,
  DOWN_ARROW,
  MAX_SCROLL_ROW,
  OPT,
  REGION_B_ROW,
  ROWS,
  SHADOW_DX,
  SHADOW_DY,
  UP_ARROW,
  cellAt,
  ctrlPointAt,
  inBox,
  slotOfCell,
} from "./layout";
import type { Inventory, Item } from "./model";

/** Images of one coat version (`INV_C` civilian / `INV_M` uniform; strips A_UP2/A_DN2/OPT2 are the pressed sprites). */
export interface CoatImages {
  /** INV_C / INV_M: does NOT contain the three buttons below */
  background: Surface16;
  /** A_UP1 / A_DN1 / OPT1: copied into the background at entry (`Blit_Copy16` into `g_guiHeap`, Game_Run), always visible */
  up: Surface16;
  down: Surface16;
  opt: Surface16;
  upPressed: Surface16;
  downPressed: Surface16;
  optPressed: Surface16;
}
export interface CoatAssets {
  civilian: CoatImages;
  uniform: CoatImages;
  /** font of the name strip (hypothesis: JACKM) */
  font: Font;
}

/** Why the coat closed (what the game does next). */
export type CoatExit =
  | { kind: "close" }
  /** options button released: the game opens the options menu (F4) */
  | { kind: "options" }
  /** a combine macro `<held>-<slot>` was found and started; the coat closes, the macro runs in the scene */
  | { kind: "macro"; name: string }
  /** hidden Ctrl point 1..4 (TOPWARE+MONEY / OUTRO / city map / JACKISMENU toggle), debug features of the original */
  | { kind: "ctrl"; point: number };

export interface CoatHost {
  /** Script_StartMacro: true = a macro of this name exists and was started. */
  startMacro(name: string): boolean;
  /** Item_LookupName: display name (Mazovia bytes) for the item file, null = no record ("???" is shown). */
  itemName(file: string): Uint8Array | null;
  onExit(exit: CoatExit): void;
}

export const DIK_COAT = {
  ESC: 0x01,
  F1: 0x3b,
  HOME: 0xc7,
  UP: 0xc8,
  PGUP: 0xc9,
  END: 0xcf,
  DOWN: 0xd0,
  PGDN: 0xd1,
} as const;
export const SCROLL_FRAMES = 8;
/** Pixel offset of the scroll animation per frame (`t = 0, 7, 49`), the last frame lands on a full row. */
export const SCROLL_OFFSETS = [0, 7, 14, 21, 28, 35, 42, 49];
const UNKNOWN_NAME = Uint8Array.from("???", (c) => c.charCodeAt(0));

export interface ScrollAnim {
  dir: 1 | -1;
  frame: number;
}

export class CoatScreen {
  isOpen = false;
  uniform = false;
  readonly notice = new NoticeStrip();
  mouseX = 0;
  mouseY = 0;
  /** Cursor mode the coat wants (4 hand over the grid, 0 elsewhere, 5 item in hand). */
  cursorMode = 4;
  /** `g_cursorIdle`: 0 over an occupied cell (the hand animates), else 1. The cursor itself is drawn by the host's cursor module. */
  cursorIdle = true;
  anim: ScrollAnim | null = null;
  private armed = true;
  private pressed: "up" | "down" | "opt" | null = null;
  private hoverSlot = -1;
  private bg: Surface16 = createSurface(640, 480);

  constructor(
    readonly inv: Inventory,
    private readonly assets: CoatAssets,
    private readonly host: CoatHost,
  ) {}

  private get images(): CoatImages {
    return this.uniform ? this.assets.uniform : this.assets.civilian;
  }

  /** Region B (MARZECZY = 0) shows a fixed 5x3 view from row 22 and does not scroll. */
  get scrollable(): boolean {
    return this.inv.marzeczy !== 0;
  }

  /** First visible row of the grid. */
  get viewRow(): number {
    return this.scrollable ? this.inv.scrollRow : REGION_B_ROW;
  }

  /** Enter (F1 / middle or right button with item): the version depends on the uniform at this moment. */
  open(uniform: boolean): void {
    this.uniform = uniform;
    this.isOpen = true;
    this.armed = true;
    this.pressed = null;
    this.anim = null;
    this.hoverSlot = -1;
    this.bg = createSurface(640, 480);
    const im = this.images;
    blitCopy(im.background, 0, 0, 640, 480, this.bg, 0, 0);
    for (const [img, x, y] of [
      [im.up, UP_ARROW.x, UP_ARROW.y],
      [im.down, DOWN_ARROW.x, DOWN_ARROW.y],
      [im.opt, OPT.x, OPT.y],
    ] as const) {
      blitCopy(img, 0, 0, img.width, img.height, this.bg, x, y);
    }
    this.cursorMode = this.inv.held ? 5 : 4;
    this.notice.shown = false;
    this.notice.state = 0;
    this.notice.anim = 0;
    this.notice.slot = 0xffff;
  }

  private exit(e: CoatExit): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.notice.shown = false;
    this.notice.state = 0;
    this.notice.anim = 0;
    this.notice.slot = 0xffff;
    this.pressed = null;
    this.host.onExit(e);
  }

  slotAt(x: number, y: number): number {
    const c = cellAt(x, y);
    return c ? slotOfCell(c.col, c.row, this.viewRow) : -1;
  }

  // --- input --------------------------------------------------------------------------------------------------------

  pointerMove(x: number, y: number): void {
    this.mouseX = x;
    this.mouseY = y;
  }

  /** button: 0 left, 1 middle, 2 right. `ctrl` = Ctrl held. */
  pointerDown(x: number, y: number, button: number, ctrl = false): void {
    if (!this.isOpen) return;
    this.mouseX = x;
    this.mouseY = y;
    if (button !== 0) return this.exit({ kind: "close" });
    if (ctrl && this.ctrlHeld(x, y)) return;
    if (x >= CLOSE_X) return this.exit({ kind: "close" });
    if (this.anim) return;
    if (inBox(OPT, x, y)) {
      this.pressed = "opt";
      return;
    }
    if (inBox(UP_ARROW, x, y)) return this.arrowPress("up");
    if (inBox(DOWN_ARROW, x, y)) return this.arrowPress("down");
    if (!this.armed) return;
    const c = cellAt(x, y);
    if (!c) return;
    this.armed = false;
    this.click(slotOfCell(c.col, c.row, this.viewRow));
  }

  /**
   * Game_Run: with Ctrl down and the left button held (a level, not an edge, every frame, before everything else) a hidden point
   * ends the coat. True when one was hit.
   */
  ctrlHeld(x: number, y: number): boolean {
    if (!this.isOpen) return false;
    const p = ctrlPointAt(x, y, this.uniform);
    if (!p) return false;
    this.exit({ kind: "ctrl", point: p });
    return true;
  }

  pointerUp(x: number, y: number, button = 0): void {
    if (!this.isOpen || button !== 0) return;
    this.mouseX = x;
    this.mouseY = y;
    this.armed = true;
    const was = this.pressed;
    this.pressed = null;
    if (was === "opt" && x > 99 && x < 0xfb && y > 0x42 && y < 0x8a) this.exit({ kind: "options" });
  }

  private arrowPress(which: "up" | "down"): void {
    this.pressed = which;
    if (this.scrollable) this.step(which === "down" ? 1 : -1);
  }

  /**
   * [deviation]: one notch of the mouse wheel = one click of the arrow (same animation, bounds, no pressed sprite).
   * Down = down arrow. Ignored in region B and while a scroll animation runs (no queue). Returns true when the coat
   * takes the wheel (the page then calls preventDefault) — also for a notch that is ignored, so the page does not scroll.
   */
  wheel(dir: 1 | -1): boolean {
    if (!this.isOpen || !this.scrollable) return false;
    this.step(dir);
    return true;
  }

  /** One animated scroll step if the bounds allow it (down: row < 16, up: row > 0). */
  private step(dir: 1 | -1): void {
    if (this.anim) return;
    if (dir > 0 ? this.inv.scrollRow >= MAX_SCROLL_ROW : this.inv.scrollRow <= 0) return;
    this.anim = { dir, frame: 0 };
    this.dropNotice();
  }

  /** Scan codes of Game_Run: arrows animate one row, PgUp/PgDn jump by up to 4, Home/End to the ends. */
  keyDown(code: number): void {
    if (!this.isOpen) return;
    if (code === DIK_COAT.F1 || code === DIK_COAT.ESC) return this.exit({ kind: "close" });
    if (!this.scrollable || this.anim) return;
    const inv = this.inv;
    switch (code) {
      case DIK_COAT.DOWN:
        return this.step(1);
      case DIK_COAT.UP:
        return this.step(-1);
      case DIK_COAT.PGDN:
        inv.scrollRow = Math.min(MAX_SCROLL_ROW, inv.scrollRow + 4);
        return this.dropNotice();
      case DIK_COAT.PGUP:
        inv.scrollRow = Math.max(0, inv.scrollRow - 4);
        return this.dropNotice();
      case DIK_COAT.END:
        inv.scrollRow = MAX_SCROLL_ROW;
        return this.dropNotice();
      case DIK_COAT.HOME:
        inv.scrollRow = 0;
        return this.dropNotice();
    }
  }

  private dropNotice(): void {
    if (this.notice.shown) this.notice.anim = ANIM_ROLLUP;
    this.hoverSlot = -1;
  }

  /** Left click on cell (col,row) holding `slot` (4.2). */
  private click(slot: number): void {
    const inv = this.inv;
    const item = inv.slots[slot];
    if (!inv.held) {
      if (item && inv.pull(slot)) {
        this.cursorMode = 5;
      }
      return;
    }
    if (!item) {
      if (inv.placeAt(slot)) {
        this.cursorMode = 4;
      }
      return;
    }
    const name = `${inv.held.name}-${item.name}`;
    if (this.host.startMacro(name)) {
      inv.limbo = inv.held;
      inv.held = null;
      this.cursorMode = 4;
      this.exit({ kind: "macro", name });
    } // no macro: nothing happens, no refusal, the item stays in the hand
  }

  // --- per frame ----------------------------------------------------------------------------------------------------

  /** One frame of the loop: scroll animation, name strip, cursor mode. Returns true when the picture changed. */
  tick(): boolean {
    if (!this.isOpen) return false;
    let changed = false;
    if (this.anim) {
      this.anim.frame++;
      if (this.anim.frame >= SCROLL_FRAMES) {
        this.inv.scrollRow += this.anim.dir;
        this.anim = null;
      }
      changed = true;
    }
    this.updateHover();
    if (this.notice.tickAnim()) changed = true;
    return changed || this.notice.shown;
  }

  private updateHover(): void {
    const inGrid = !this.anim && !!cellAt(this.mouseX, this.mouseY);
    const slot = inGrid ? this.slotAt(this.mouseX, this.mouseY) : -1;
    const occupied = slot >= 0 && !!this.inv.slots[slot];
    if (!this.inv.held) this.cursorMode = inGrid ? 4 : 0;
    else this.cursorMode = 5;
    this.cursorIdle = !occupied;
    if (!occupied) {
      this.hoverSlot = -1;
      if (this.notice.shown && this.notice.anim !== ANIM_ROLLUP) this.notice.anim = ANIM_ROLLUP;
      return;
    }
    if (slot !== this.hoverSlot && this.notice.shown && this.notice.anim !== ANIM_ROLLUP)
      this.notice.anim = ANIM_ROLLUP;
    this.hoverSlot = slot;
    if (!this.notice.shown && this.notice.state === 0) {
      const file = this.inv.slots[slot]!.name;
      this.notice.show(NOTICE_Y_COAT, this.host.itemName(file) ?? UNKNOWN_NAME, this.assets.font, slot);
    }
  }

  // --- drawing ------------------------------------------------------------------------------------------------------

  private drawItem(dst: Surface16, item: Item, cx: number, cy: number): void {
    const { width: w, height: h } = item.image;
    const x = cx - (w >> 1);
    const y = cy - (h >> 1);
    // shadow = background under the opaque pixels at half brightness (`Item_BuildShadowImage` ; factor 0.5 is a hypothesis)
    clippedShadow(dst, this.bg, item.image, x + SHADOW_DX, y + SHADOW_DY);
    clippedKeyed(dst, item.image, x, y);
  }

  /** Whole screen without the cursor: background, grid items (with the scroll animation), pressed sprites, name strip. */
  draw(dst: Surface16): void {
    if (!this.isOpen) return;
    const im = this.images;
    blitCopy(this.bg, 0, 0, 640, 480, dst, 0, 0);
    const shift = this.anim ? SCROLL_OFFSETS[Math.min(this.anim.frame, SCROLL_FRAMES - 1)] * this.anim.dir : 0;
    const first = this.anim ? -1 : 0;
    const last = this.anim ? ROWS : ROWS - 1;
    for (let row = first; row <= last; row++) {
      for (let col = 0; col < COLS; col++) {
        const slot = slotOfCell(col, row, this.viewRow);
        const item = slot >= 0 && slot < this.inv.slots.length ? this.inv.slots[slot] : null;
        if (!item) continue;
        this.drawItem(dst, item, CELL_CX + col * CELL_W, CELL_CY + row * CELL_H - shift);
      }
    }
    if (this.pressed === "up")
      blitKeyed(im.upPressed, 0, 0, im.upPressed.width, im.upPressed.height, dst, UP_ARROW.x, UP_ARROW.y);
    if (this.pressed === "down")
      blitKeyed(im.downPressed, 0, 0, im.downPressed.width, im.downPressed.height, dst, DOWN_ARROW.x, DOWN_ARROW.y);
    if (this.pressed === "opt")
      blitKeyed(im.optPressed, 0, 0, im.optPressed.width, im.optPressed.height, dst, OPT.x, OPT.y);
    const pic = this.notice.picture(dst, 0);
    if (pic) blitCopy(pic, 0, 0, pic.width, pic.height, dst, this.notice.x(0), this.notice.y);
  }
}
