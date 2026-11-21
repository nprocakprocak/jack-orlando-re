// The notice strip (Notice_Show, Notice_Unroll, Notice_RollUp): a line of text that fades
// in over the scene and out again. State machine apart from drawing.
import type { Font } from "../formats/fnt";
import { renderText, textWidth } from "../formats/fnt";
import { centerOffset, drawText } from "../gui/draw";
import { blend565 } from "../render/rgb565";
import type { Surface16 } from "../render/surface";
import { blitCopy, createSurface } from "../render/surface";

/** Height of the strip (= 0xf) and screen width it is centred in (`Gui_CenterOffset(0x280, w)`). */
export const NOTICE_HEIGHT = 15;
export const NOTICE_SCREEN_WIDTH = 640;
/** Fade level at which the unrolling ends (the step stops when `wipe + 2 > 0x20`). */
export const NOTICE_WIPE_MAX = 0x20;
/** Text colours of the text bitmap: `Text_PrintfAt(0, 0, 1, 0xffff...)` = black outline (1), white fill. */
export const NOTICE_OUTLINE = 1;
export const NOTICE_FILL = 0xffff;
/** Positions used by the game: quick save and the coat's item names (`Notice_Show(0x1cc / 400...)`). */
export const NOTICE_Y_QUICKSAVE = 0x1cc;
export const NOTICE_Y_COAT = 400;

/** `g_noticeAnim0x `: what the per-frame step (Game_Run step 6) does. */
export const ANIM_NONE = 0;
export const ANIM_UNROLL = 1;
export const ANIM_ROLLUP = 2;

/** `g_noticeState`: 0 no strip, 1 unrolling, 2 fully unrolled. */
export const STATE_NONE = 0;
export const STATE_UNROLLING = 1;
export const STATE_UNROLLED = 2;

export class NoticeStrip {
  /** `g_noticeShown` */
  shown = false;
  /** `g_noticeAnim`: set to ANIM_ROLLUP by callers that fold the strip from the per-frame step (the coat does) */
  anim = ANIM_NONE;
  /** `g_noticeState` */
  state = STATE_NONE;
  /** `g_noticeWipe`: fade level 0..32 (blend of the text over the scene = level / 32) */
  wipe = 0;
  /** `g_noticeAuto`: the F5 path drives the strip itself until it is gone */
  auto = false;
  /** `g_noticeSlot`: coat cell whose name is shown (`g_invHoverSlot`), 0xffff = none */
  slot = 0xffff;
  /** Row of the top edge */
  y = 0;
  /** Even width of the strip */
  width = 0;
  private text: Uint16Array = new Uint16Array(0);
  private textHeight = 0;
  private textWidthPx = 0;
  /** The shadow is drawn only into the first picture (the unroll step composes the scene again and blends only the text) */
  private fresh = false;
  private font: Font | undefined;
  private bytes: Uint8Array = new Uint8Array(0);

  /** Notice_Show: builds the strip for `bytes` (Mazovia) at row `y`; fade level starts at 1. `slot` = `g_invHoverSlot`. */
  show(y: number, bytes: Uint8Array, font: Font, slot = 0xffff): void {
    this.y = y;
    this.font = font;
    this.bytes = bytes;
    let w = textWidth(font, bytes);
    if (w & 1) w++;
    this.width = w;
    const img = renderText(font, bytes, NOTICE_OUTLINE, NOTICE_FILL);
    this.text = img.pixels;
    this.textHeight = img.height;
    this.textWidthPx = img.width;
    this.anim = ANIM_UNROLL;
    this.wipe = 1;
    this.state = STATE_UNROLLING;
    this.shown = true;
    this.slot = slot;
    this.fresh = true;
  }

  /** The F5 path (`g_noticeAuto = 1; Notice_Show(0x1cc...)`): only when no strip is shown. */
  showAuto(y: number, bytes: Uint8Array, font: Font): void {
    if (this.shown) return;
    this.auto = true;
    this.show(y, bytes, font);
  }

  /** Notice_Unroll: one step, +2 to the fade level. Returns true when the picture changes (level still <= 0x20). */
  unrollStep(): boolean {
    this.wipe += 2;
    this.fresh = false;
    if (this.wipe <= NOTICE_WIPE_MAX) return true;
    this.anim = ANIM_NONE;
    this.state = STATE_UNROLLED;
    return false;
  }

  /** Notice_RollUp: one step, -1 from the fade level; at 0 the strip is gone. Returns true when the picture changes. */
  rollUpStep(): boolean {
    this.wipe -= 1;
    this.fresh = false;
    if (this.wipe >= 1) return true;
    this.slot = 0xffff;
    this.shown = false;
    this.anim = ANIM_NONE;
    this.state = STATE_NONE;
    this.text = new Uint16Array(0);
    return false;
  }

  /** Game_Run step 6: `g_noticeAnim` 1 unrolls, 2 rolls up. */
  tickAnim(): boolean {
    if (this.anim === ANIM_UNROLL) return this.unrollStep();
    if (this.anim === ANIM_ROLLUP) return this.rollUpStep();
    return false;
  }

  /** The `g_noticeAuto` block after F5: unrolls, then in the same frame rolls up again, until state 0. */
  tickAuto(): void {
    if (!this.auto) return;
    if (this.state === STATE_UNROLLING) this.unrollStep();
    if (this.state === STATE_UNROLLED) this.rollUpStep();
    if (this.state === STATE_NONE) this.auto = false;
  }

  /** Left edge in the scene (`Gui_CenterOffset(0x280, w) + g_scrollX`). */
  x(scrollX: number): number {
    return centerOffset(NOTICE_SCREEN_WIDTH, this.width) + scrollX;
  }

  /**
 * The strip's picture for the current fade level: the scene underneath (copied again every step), the text bitmap
 * blended over it by `wipe / 32` (non-zero text pixels only). Right after show() it is the scene with the shadow
 * (darkened, +1/+1, `Text_PrintfAtRemapAlt(1, 1, 10, 6)`) and no text yet. Null when no strip is shown.
 */
  picture(scene: Surface16, scrollX: number): Surface16 | null {
    if (!this.shown || !this.font) return null;
    const out = createSurface(this.width, NOTICE_HEIGHT);
    blitCopy(scene, this.x(scrollX), this.y, this.width, NOTICE_HEIGHT, out, 0, 0);
    if (this.fresh) {
      drawText(out, this.font, this.bytes, 1, 1, 0, 0, [10, 6]);
      return out;
    }
    const level = Math.min(this.wipe, NOTICE_WIPE_MAX);
    for (let ty = 0; ty < Math.min(this.textHeight, NOTICE_HEIGHT); ty++) {
      for (let tx = 0; tx < this.textWidthPx; tx++) {
        const src = this.text[ty * this.textWidthPx + tx];
        if (src === 0) continue;
        const at = ty * this.width + tx;
        out.pixels[at] = blend565(out.pixels[at], src, level);
      }
    }
    return out;
  }
}
