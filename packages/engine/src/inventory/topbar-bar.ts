import type { Font } from "../formats/fnt";
import { ANIM_ROLLUP, NoticeStrip } from "../keys/notice";
import { blitCopy, createSurface, strideOf, type Surface16 } from "../render/surface";
import type { Inventory, Item } from "./model";
import {
  BAR_CLOSE_Y,
  BAR_HIDDEN_Y,
  BAR_OPEN_Y,
  BAR_SHOWN_Y,
  BAR_SLIDE,
  BELKA_W,
  DROP_BOX,
  END_VISIBLE,
  ITEM_CX,
  ITEM_CY,
  LEFT_BOX,
  NOTICE_Y_BAR,
  OPTIONS_BOX,
  RIGHT_BOX,
  SLOT_W,
  STRIP_BOX,
  STRIP_DY,
  STRIP_H,
  STRIP_W,
  STRIP_X,
  inside,
  type BarInput,
  type BarOverlay,
  type BarState,
  type TopBarHost,
  type TopBarImages,
} from "./topbar";

const UNKNOWN_NAME = Uint8Array.from("???", (c) => c.charCodeAt(0));

/**
 * `OPTGR`, `L_ARROW`, `R_ARROW` are the **pressed** states (no text shadow): Game_Run keeps them above the screen
 * (y −0x46 / −0x3c) and puts them on screen only while pressed — the panel `TOPMGR.BM` already shows the released buttons.
 */
/**
 * The code puts them at (0xc, 0x13), (0x96, 10), (0x251, 10) with the panel at y 4, but over the panel all three pressed
 * images fit their released buttons only 1 px further left and 3 px lower (best match of OPTGR / L_ARROW / R_ARROW over
 * TOPMGR.BM, the same offset for all three). The engine draws them aligned **[hypothesis consistent with the user's
 * observation 2026-11-10: the code positions look crooked; where the offset comes from (panel or sprite origin) is unknown]**.
 */
const PRESSED_ALIGN = { dx: -1, dy: 3 };
/**
 * The press itself: the pressed text moves 1 px right and 1 px down, towards the released text's shadow in TOPMGR.BM
 * **[engine, user request 2026-11-10: "the text is pressed in"; +1 px tuned by the user by hand]**.
 */
const PRESS = { dx: 1, dy: 1 };
const at = (x: number, y: number) => ({
  x: x + PRESSED_ALIGN.dx + PRESS.dx,
  y: y + PRESSED_ALIGN.dy + PRESS.dy,
});
const OPTIONS_LIT = at(0xc, 0x13);
const LEFT_PRESSED = at(0x96, 10);
const RIGHT_PRESSED = at(0x251, 10);

export class TopBar {
  state: BarState = "closed";
  /** `g_topBarY` */
  y = BAR_HIDDEN_Y;
  /** strip offset `off0..−max` (px) */
  offset = 0;
  /** `g_barMacroExclusive008f6913`: a combine macro of the bar runs; the bar does not open until it ends (see) */
  exclusive = false;
  /** cursor mode the bar wants: 4 hand over the strip, 0 elsewhere, 5 item in hand */
  cursorMode = 0;
  /** `g_cursorIdle`: false over an occupied slot */
  cursorIdle = true;
  readonly notice = new NoticeStrip();
  mouseX = 0;
  mouseY = 0;
  private armed = true;
  private needLeave = false;
  private macroName: string | null = null;
  private scrollDir: -1 | 0 | 1 = 0;
  private scrollSpeed = 4;
  private optionsDown = false;
  private hoverSlot = -1;

  constructor(
    readonly inv: Inventory,
    private readonly images: TopBarImages,
    private readonly font: Font,
    private readonly host: TopBarHost,
  ) {}

  /** The bar takes the mouse (sliding in, open, sliding out); the scene stands still. */
  get isOpen(): boolean {
    return this.state !== "closed";
  }

  /** Slots of the active region = positions of the strip. [deviation] the original strip held 54 slots; this one the whole region. */
  get positions(): number {
    const [a, b] = this.inv.region();
    return b - a;
  }

  /** Smallest offset: the last `END_VISIBLE` positions at the right edge (−45·0x2c = −0x7bc with the original 54 slots). */
  get minOffset(): number {
    return -Math.max(0, this.positions - END_VISIBLE) * SLOT_W;
  }

  /** Inventory slot at the pointer, −1 outside the strip or beyond the region. */
  slotAt(x: number, y: number): number {
    if (!inside(STRIP_BOX, x, y)) return -1;
    const i = Math.floor((x - this.offset - STRIP_BOX.x0) / SLOT_W);
    if (i < 0 || i >= this.positions) return -1;
    return this.inv.region()[0] + i;
  }

  /**
   * One frame. `free` = the game may let the bar open (scene playing, no script holds the player, no dialog, no menu).
   * Closed: opens on the top edge; open: drives the strip, the notice and the clicks.
   */
  frame(input: BarInput, free: boolean): void {
    this.mouseX = input.x;
    this.mouseY = input.y;
    if (this.macroName && !this.host.macroActive(this.macroName)) {
      this.macroName = null;
      this.exclusive = false;
    }
    if (!input.down && !input.pressed) this.armed = true;
    if (input.y > 8) this.needLeave = false;
    switch (this.state) {
      case "closed":
        if (free && !this.exclusive && !this.needLeave && input.inWindow && input.y <= BAR_OPEN_Y) this.begin();
        return;
      case "opening":
        this.slide(BAR_SLIDE);
        this.noticeTick();
        if (input.y > BAR_CLOSE_Y) this.startClosing();
        return;
      case "closing":
        this.slide(-BAR_SLIDE);
        this.noticeTick();
        return;
      case "open":
        this.openFrame(input);
        return;
    }
  }

  private begin(): void {
    this.state = "opening";
    this.y = BAR_HIDDEN_Y;
    this.offset = 0;
    this.scrollDir = 0;
    this.optionsDown = false;
    this.hoverSlot = -1;
    this.armed = false;
    this.cursorMode = this.inv.held ? 5 : 0;
    this.cursorIdle = true;
  }

  private slide(dy: number): void {
    this.y += dy;
    if (dy > 0 && this.y >= BAR_SHOWN_Y) {
      this.y = BAR_SHOWN_Y;
      this.state = "open";
    } else if (dy < 0 && this.y <= BAR_HIDDEN_Y) this.closeNow();
  }

  /** [hypothesis] the original leaves the bar down (nothing cleans `g_topBarY`): it rolls back 6 px per frame. */
  private startClosing(): void {
    this.state = "closing";
    this.scrollDir = 0;
    this.optionsDown = false;
    this.hoverSlot = -1;
    this.cursorIdle = true;
    if (this.notice.shown) this.notice.anim = ANIM_ROLLUP;
  }

  /** Back to the folded state at once (the options menu opens in the same frame; the end of the slide). */
  closeNow(): void {
    this.state = "closed";
    this.y = BAR_HIDDEN_Y;
    this.scrollDir = 0;
    this.optionsDown = false;
    this.hoverSlot = -1;
    this.needLeave = this.mouseY <= 8;
    this.cursorMode = 0;
    this.cursorIdle = true;
    const n = this.notice;
    n.shown = false;
    n.state = 0;
    n.anim = 0;
    n.slot = 0xffff;
  }

  private noticeTick(): void {
    if (this.notice.shown) this.notice.tickAnim();
  }

  private openFrame(input: BarInput): void {
    const { x, y } = input;
    if (y > BAR_CLOSE_Y) return this.startClosing();
    this.scroll(input);
    const inv = this.inv;
    const over = this.scrollDir === 0 ? this.slotAt(x, y) : -1;
    const occupied = over >= 0 && !!inv.slots[over];
    this.cursorMode = inv.held ? 5 : inside(STRIP_BOX, x, y) ? 4 : 0;
    this.cursorIdle = !occupied;
    this.hover(input, over, occupied);
    // the options button: pressed on it, released over it
    if (this.optionsDown && !input.down) {
      this.optionsDown = false;
      if (inside(OPTIONS_BOX, x, y)) {
        this.closeNow();
        this.host.requestOptions();
        return;
      }
    }
    if (input.pressed && inside(OPTIONS_BOX, x, y)) this.optionsDown = true;
    if (input.pressed && this.scrollDir === 0) {
      if (inside(LEFT_BOX, x, y)) return this.startScroll(1, 4);
      if (inside(RIGHT_BOX, x, y)) return this.startScroll(-1, 4);
    }
    if (input.rightPressed && this.scrollDir === 0) {
      if (inside(LEFT_BOX, x, y)) return this.startScroll(1, 8);
      if (inside(RIGHT_BOX, x, y)) return this.startScroll(-1, 8);
    }
    if (input.pressed && this.armed) this.click(over, x, y);
  }

  /**
   * [deviation]: one notch of the mouse wheel = one click of an arrow at speed 4 (scrolls on to the slot boundary).
   * Down = the right arrow (towards the later slots). Only with the bar fully open; ignored while it scrolls and at the
   * ends. Returns true when the bar takes the wheel (the page then calls preventDefault).
   */
  wheel(dir: 1 | -1): boolean {
    if (this.state !== "open") return false;
    if (this.scrollDir !== 0) return true;
    const sdir = dir > 0 ? -1 : 1;
    if (sdir > 0 ? this.offset >= 0 : this.offset <= this.minOffset) return true;
    this.startScroll(sdir, 4);
    return true;
  }

  private startScroll(dir: 1 | -1, speed: number): void {
    this.scrollDir = dir;
    this.scrollSpeed = speed;
    this.dropNotice();
  }

  /** `off` moves 4 px (8 with the right button) per frame towards the arrow's end, on until it sits on a slot boundary. */
  private scroll(input: BarInput): void {
    if (this.scrollDir === 0) return;
    const dir = this.scrollDir;
    const min = this.minOffset;
    this.offset = Math.max(min, Math.min(0, this.offset + dir * this.scrollSpeed));
    const atEnd = dir > 0 ? this.offset >= 0 : this.offset <= min;
    const held = this.scrollSpeed === 8 ? input.right : input.down;
    if (atEnd || (this.offset % SLOT_W === 0 && !held)) this.scrollDir = 0;
  }

  private dropNotice(): void {
    if (this.notice.shown && this.notice.anim !== ANIM_ROLLUP) this.notice.anim = ANIM_ROLLUP;
    this.hoverSlot = -1;
  }

  /** The name of the occupied slot under the pointer (hand empty), rolled up when the pointer leaves or moves to another slot. */
  private hover(_input: BarInput, slot: number, occupied: boolean): void {
    const n = this.notice;
    if (n.shown) this.noticeTick();
    if (this.inv.held || !occupied) {
      this.hoverSlot = -1;
      if (n.shown && n.anim !== ANIM_ROLLUP) n.anim = ANIM_ROLLUP;
      return;
    }
    if (slot !== this.hoverSlot && n.shown && n.anim !== ANIM_ROLLUP) n.anim = ANIM_ROLLUP;
    this.hoverSlot = slot;
    if (!n.shown && n.state === 0) {
      const file = this.inv.slots[slot]!.name;
      n.show(NOTICE_Y_BAR, this.host.itemName(file) ?? UNKNOWN_NAME, this.font, slot);
    }
  }

  /** A left click on the strip: take an item, put it into an empty slot, or combine it with the item there. */
  private click(slot: number, x: number, y: number): void {
    const inv = this.inv;
    if (slot < 0) return;
    if (!inv.held) {
      if (inv.slots[slot] && inv.pull(slot)) {
        this.armed = false;
        this.cursorMode = 5;
        this.dropNotice();
      }
      return;
    }
    if (!inside(DROP_BOX, x, y)) return;
    const there = inv.slots[slot];
    if (!there) {
      if (inv.placeAt(slot)) {
        this.armed = false;
        this.cursorMode = 4;
      }
      return;
    }
    const name = `${inv.held.name}-${there.name}`;
    if (this.host.startMacro(name)) {
      inv.limbo = inv.held;
      inv.held = null;
      this.armed = false;
      this.exclusive = true;
      this.macroName = name;
      this.cursorMode = 4;
      this.startClosing();
    } // no macro: the code has no branch, the item stays in the hand
  }

  // --- drawing ------------------------------------------------------------------------------------------------------

  /** The strip window (`STRIP_W × 48`): `BELKA.BM` repeated, the items of the region at their positions. */
  stripImage(): Surface16 {
    const out = createSurface(STRIP_W, STRIP_H);
    const belka = this.images.strip;
    // BELKA is 18 slots wide; the strip is shifted by `offset`, the picture repeats
    for (let dx = 0; dx < STRIP_W;) {
      const src = (((dx - this.offset) % BELKA_W) + BELKA_W) % BELKA_W;
      const w = Math.min(STRIP_W - dx, belka.width - src);
      blitCopy(belka, src, 0, w, Math.min(belka.height, STRIP_H), out, dx, 0);
      dx += w;
    }
    const [first] = this.inv.region();
    for (let i = 0; i < this.positions; i++) {
      const item = this.inv.slots[first + i];
      if (!item) continue;
      const cx = i * SLOT_W + ITEM_CX + this.offset;
      if (cx < -64 || cx > STRIP_W + 64) continue;
      drawItem(out, item, cx, ITEM_CY);
    }
    return out;
  }

  /** The bar's pictures at the current height (empty while closed), then the item-name strip over the scene. */
  overlays(scene: Surface16, scrollX: number): BarOverlay[] {
    if (this.state === "closed") return [];
    const im = this.images;
    const y = this.y;
    const lit = this.optionsDown && inside(OPTIONS_BOX, this.mouseX, this.mouseY);
    const out: BarOverlay[] = [{ x: 0, y, image: im.panel }];
    if (lit) out.push({ x: OPTIONS_LIT.x, y: OPTIONS_LIT.y, image: im.options });
    if (this.scrollDir > 0) out.push({ x: LEFT_PRESSED.x, y: LEFT_PRESSED.y, image: im.left });
    if (this.scrollDir < 0) out.push({ x: RIGHT_PRESSED.x, y: RIGHT_PRESSED.y, image: im.right });
    out.push({ x: STRIP_X, y: y + STRIP_DY, image: this.stripImage() });
    const pic = this.notice.picture(scene, scrollX);
    if (pic) out.push({ x: this.notice.x(scrollX) - scrollX, y: this.notice.y, image: pic });
    return out;
  }

  /**
   * `RAMKA.BM` at `(mouseX − 0x18, mouseY − 0x14)` (Game_Run, l. 779–788): drawn only while an item is in hand and
   * `g_cursorIdle == 0` (the item cursor is over something it can be used on — a sprite pixel or an area with the
   * `<item>-<name>` macro), the bar, the answer menu, a caption and the bullet menu are all closed. `active` = the caller's
   * verdict on all of those except the item; elsewhere the frame is parked off screen (`(0, 500)`).
   */
  frameOverlay(x: number, y: number, active = true): BarOverlay | null {
    if (!this.inv.held || !active) return null;
    return { x: x - 0x18, y: y - 0x14, image: this.images.frame };
  }
}

/** The item centred on (cx, cy) of the strip, clipped to it; [hypothesis] no shadow (the coat's `Item_BuildShadowImage` is not known for the bar). */
function drawItem(dst: Surface16, item: Item, cx: number, cy: number): void {
  const { width: w, height: h } = item.image;
  const x0 = cx - (w >> 1);
  const y0 = cy - (h >> 1);
  const ss = strideOf(item.image);
  for (let sy = 0; sy < h; sy++) {
    const py = y0 + sy;
    if (py < 0 || py >= dst.height) continue;
    for (let sx = 0; sx < w; sx++) {
      const px = x0 + sx;
      if (px < 0 || px >= dst.width) continue;
      const v = item.image.pixels[sy * ss + sx];
      if (v) dst.pixels[py * dst.width + px] = v;
    }
  }
}
