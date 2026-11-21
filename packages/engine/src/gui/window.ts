// GUI window: scene snapshot + frame, buttons, sliders, Yes/No toggles and the event-driven equivalent
// of Gui_RunWindow.
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../core/constants";
import type { Font } from "../formats/fnt";
import { textWidth } from "../formats/fnt";
import type { Surface16 } from "../render/surface";
import { blitCopy, blitKeyed, createSurface } from "../render/surface";
import { encodeMazovia } from "../dialog/caption";
import {
  centerOffset,
  COLOR_BLUE,
  COLOR_WHITE,
  copyRect,
  drawButtonFrame,
  drawText,
  drawTextShadowed,
  drawWindowFrame,
} from "./draw";

export { SCREEN_HEIGHT as SCREEN_H, SCREEN_WIDTH as SCREEN_W };
/** Slider geometry (Gui_AddSlider): the thumb travels 170 px from x + 23. */
export const SLIDER_TRAVEL = 170;
export const SLIDER_X0 = 23;
export const THUMB_W = 14;
export const THUMB_H = 29;
export const THUMB_DY = -8;
/** RAMA.BM (the track) is 230 px wide; grabs the slider anywhere on it, with this much room above and below the thumb. */
export const TRACK_W = 230;
export const GRAB_MARGIN_Y = 6;
export const TOGGLE_W = 52;
export const TOGGLE_H = 28;

export interface WindowAssets {
  fontBig: Font;
  fontSmall: Font;
  /** RAMA.BM, 230 x 13 */
  track: Surface16;
  /** SUWAK.BM, 14 x 29 */
  thumb: Surface16;
}

export type GuiEvent =
  /** a button was released over itself, a toggle changed (`value` 0/1), Enter pressed button 1 */
  | { kind: "press"; name: string; value?: number }
  /** the slider value changed while dragging (`final` = drag ended) */
  | { kind: "slide"; name: string; value: number; final: boolean }
  /** Esc: Gui_RunWindow returns "/0" */
  | { kind: "escape" };

interface Control {
  type: "button" | "toggle" | "slider";
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  big: boolean;
  centered: boolean;
  /** button: label; toggle: [label of state 0 ("Nie"), label of state 1 ("Tak")] */
  labels: Uint8Array[];
  /** toggle: 0/1; slider: current value */
  value: number;
  /** slider: maximum value and current thumb x */
  max: number;
  thumbX: number;
}

/** Gui_AddSlider: thumb x for a value (integer division). */
export function sliderThumbX(x: number, value: number, max: number): number {
  return x + SLIDER_X0 + Math.trunc((value * SLIDER_TRAVEL) / max);
}

/** Value for a thumb x while dragging: ftol((x - min) / 170 * max), truncated toward zero. */
export function sliderValue(thumbX: number, min: number, max: number): number {
  return Math.trunc(((thumbX - min) / SLIDER_TRAVEL) * max);
}

/** The pointing hand (cursor mode 0) is drawn centred on the mouse; its tip (the click point g_clickX/Y) is at mouse + (-9, -12). */
export const HAND_TIP = { dx: -9, dy: -12 } as const;

export class GuiWindow {
  /**
   * shift from the mouse the window is told about to the point it tests. The original tests the raw mouse
   * (g_mouseX in Gui_RunWindow and Gui_ButtonUnderMouse), i.e. the centre of the hand image, so a control
   * reacted while the tip was 9 px left of and 12 px above it. The user took that for a bug: a host that draws
   * the hand cursor sets HAND_TIP here so that a control reacts exactly under the tip; the start screen (system cursor) and the tests keep 0.
   */
  static tipShift: { readonly dx: number; readonly dy: number } = { dx: 0, dy: 0 };
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** window pixels: darkened snapshot + frame + labels + images + slider tracks */
  private readonly base: Surface16;
  /** undarkened scene under the window (buttons are redrawn on it) */
  private readonly scene: Surface16;
  private readonly controls: Control[] = [];
  private pressed = -1;
  private pressedOver = false;
  private enterHeld = false;
  private drag: { idx: number; grab: number } | null = null;

  /**
   * Gui_CreateWindow: odd width -> +1; `center` puts it in the middle of the 640x480 screen.
   * `scene` is the screen view at the time of opening; the window ignores windows opened before it.
   */
  constructor(
    private readonly assets: WindowAssets,
    scene: Surface16,
    x: number,
    y: number,
    w: number,
    h: number,
    center: boolean,
  ) {
    if (w % 2) w++;
    if (center) {
      x = centerOffset(SCREEN_WIDTH, w);
      y = centerOffset(SCREEN_HEIGHT, h);
    }
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
    this.scene = createSurface(w, h);
    blitCopy(scene, x, y, w, h, this.scene, 0, 0);
    this.base = createSurface(w, h);
    blitCopy(this.scene, 0, 0, w, h, this.base, 0, 0);
    drawWindowFrame(this.base, w, h);
  }

  private font(big: boolean): Font {
    return big ? this.assets.fontBig : this.assets.fontSmall;
  }

  /** Gui_AddLabel: text with shadow; `center` centers it in the window width. */
  addLabel(text: string, center: boolean, x: number, y: number, outline: number, fill: number, big = true): void {
    const bytes = encodeMazovia(text);
    if (center) x = centerOffset(this.w, textWidth(this.font(big), bytes));
    drawTextShadowed(this.base, this.font(big), bytes, x, y, outline, fill);
  }

  /** Gui_AddImage: keyed paste into the window. */
  addImage(img: Surface16, x: number, y: number): void {
    blitKeyed(img, 0, 0, img.width, img.height, this.base, x, y);
  }

  /** Gui_AddButton. Buttons are numbered from 1 in creation order (Enter presses button 1). */
  addButton(
    name: string,
    label: string,
    x: number,
    y: number,
    w: number,
    h: number,
    centered = true,
    big = true,
  ): void {
    this.controls.push({
      type: "button",
      name,
      x,
      y,
      w,
      h,
      big,
      centered,
      labels: [encodeMazovia(label)],
      value: 0,
      max: 0,
      thumbX: 0,
    });
  }

  /** Gui_AddToggle: 52 x 28, label "Nie" in state 0 and "Tak" in state 1. */
  addToggle(name: string, x: number, y: number, value: number, labelNo: string, labelYes: string): void {
    this.controls.push({
      type: "toggle",
      name,
      x,
      y,
      w: TOGGLE_W,
      h: TOGGLE_H,
      big: true,
      centered: true,
      labels: [encodeMazovia(labelNo), encodeMazovia(labelYes)],
      value: value ? 1 : 0,
      max: 0,
      thumbX: 0,
    });
  }

  /** Gui_AddSlider: track pasted at (x, y), thumb at x + 23 + value * 170 / max. */
  addSlider(name: string, x: number, y: number, max: number, value: number): void {
    blitKeyed(this.assets.track, 0, 0, this.assets.track.width, this.assets.track.height, this.base, x, y);
    this.controls.push({
      type: "slider",
      name,
      x,
      y,
      w: THUMB_W,
      h: THUMB_H,
      big: true,
      centered: false,
      labels: [],
      value,
      max,
      thumbX: sliderThumbX(x, value, max),
    });
  }

  /** Current value of a slider or toggle (Gui_GetValue). */
  getValue(name: string): number {
    const c = this.controls.find((k) => k.name === name);
    if (!c) throw new Error(`no control ${name}`);
    return c.value;
  }

  /** Thumb x of a slider, window coordinates. */
  thumbX(name: string): number {
    const c = this.controls.find((k) => k.name === name);
    if (!c) throw new Error(`no control ${name}`);
    return c.thumbX;
  }

  /**
   * Control rectangle in window coordinates. The original's slider hit is its thumb sprite, 14 x 29;
   * (deliberate improvement): the whole track `RAMA.BM` (230 wide) and `GRAB_MARGIN_Y` above and below the thumb's band.
   */
  private rectOf(c: Control): { x: number; y: number; w: number; h: number } {
    return c.type === "slider"
      ? { x: c.x, y: c.y + THUMB_DY - GRAB_MARGIN_Y, w: TRACK_W, h: THUMB_H + 2 * GRAB_MARGIN_Y }
      : c;
  }

  /** Index of the control under a screen position (-1 = none), like Gui_ButtonUnderMouse. */
  hit(sx: number, sy: number): number {
    const mx = sx - this.x;
    const my = sy - this.y;
    for (let i = this.controls.length - 1; i >= 0; i--) {
      const r = this.rectOf(this.controls[i]);
      if (mx >= r.x && mx < r.x + r.w && my >= r.y && my < r.y + r.h) return i;
    }
    return -1;
  }

  /** Mouse button pressed at a screen position. */
  pointerDown(sx: number, sy: number): GuiEvent[] {
    sx += GuiWindow.tipShift.dx;
    sy += GuiWindow.tipShift.dy;
    const i = this.hit(sx, sy);
    if (i < 0) return [];
    const c = this.controls[i];
    if (c.type === "slider") {
      // a press on the thumb keeps the grab point; a press elsewhere on the track centres the thumb under the mouse
      const mx = sx - this.x;
      const onThumb = mx >= c.thumbX && mx < c.thumbX + THUMB_W;
      this.drag = { idx: i, grab: onThumb ? mx - c.thumbX : THUMB_W >> 1 };
      return onThumb ? [] : this.dragTo(sx, false);
    }
    this.pressed = i;
    this.pressedOver = true;
    if (c.type === "toggle") c.value = c.value === 0 ? 1 : 0;
    return [];
  }

  pointerMove(sx: number, sy: number): GuiEvent[] {
    sx += GuiWindow.tipShift.dx;
    sy += GuiWindow.tipShift.dy;
    if (this.drag) return this.dragTo(sx, false);
    if (this.pressed >= 0) {
      const over = this.hit(sx, sy) === this.pressed;
      const c = this.controls[this.pressed];
      // a toggle returns its name as soon as the mouse leaves it ; a button just un-presses
      if (c.type === "toggle" && !over) return this.release(c);
      this.pressedOver = over;
    }
    return [];
  }

  pointerUp(sx: number, sy: number): GuiEvent[] {
    sx += GuiWindow.tipShift.dx;
    sy += GuiWindow.tipShift.dy;
    if (this.drag) return this.dragTo(sx, true);
    if (this.pressed < 0) return [];
    const c = this.controls[this.pressed];
    const over = this.hit(sx, sy) === this.pressed;
    if (c.type === "toggle") return this.release(c);
    this.pressed = -1;
    this.pressedOver = false;
    return over ? [{ kind: "press", name: c.name }] : [];
  }

  private release(c: Control): GuiEvent[] {
    this.pressed = -1;
    this.pressedOver = false;
    return [{ kind: "press", name: c.name, value: c.value }];
  }

  /**
   * Slider drag. The original (Gui_RunWindow type 2) moves the thumb by the mouse's dx and ends the drag when the mouse
   * leaves a narrow rectangle.: the thumb follows the mouse absolutely (minus the grab point),
   * clamped to the track (value 0..max), and the drag lasts until the button is released, wherever the mouse is.
   */
  private dragTo(sx: number, release: boolean): GuiEvent[] {
    const d = this.drag!;
    const c = this.controls[d.idx];
    const events: GuiEvent[] = [];
    const min = c.x + SLIDER_X0;
    const nx = Math.max(min, Math.min(min + SLIDER_TRAVEL, sx - this.x - d.grab));
    if (nx !== c.thumbX) {
      c.thumbX = nx;
      c.value = sliderValue(nx, min, c.max);
      events.push({ kind: "slide", name: c.name, value: c.value, final: false });
    }
    if (release) {
      this.drag = null;
      events.push({ kind: "slide", name: c.name, value: c.value, final: true });
    }
    return events;
  }

  keyDown(key: string): GuiEvent[] {
    if (key === "Escape") return [{ kind: "escape" }];
    if (key === "Enter" && !this.enterHeld && this.controls.length > 0 && this.controls[0].type === "button") {
      this.enterHeld = true;
      this.pressed = 0;
      this.pressedOver = true;
    }
    return [];
  }

  /** Enter released: "button 1" returns its name. */
  keyUp(key: string): GuiEvent[] {
    if (key !== "Enter" || !this.enterHeld) return [];
    this.enterHeld = false;
    this.pressed = -1;
    this.pressedOver = false;
    return [{ kind: "press", name: this.controls[0].name }];
  }

  /** Window pixels: base + buttons/toggles (scene + frame + text) + slider thumbs. */
  render(): Surface16 {
    const out = createSurface(this.w, this.h);
    blitCopy(this.base, 0, 0, this.w, this.h, out, 0, 0);
    this.controls.forEach((c, i) => {
      if (c.type === "slider") return;
      const sunk = c.type === "toggle" ? c.value === 1 : this.pressed === i && this.pressedOver;
      copyRect(this.scene, out, c.x, c.y, c.w, c.h);
      drawButtonFrame(out, c.x, c.y, c.w, c.h, sunk);
      const font = this.font(c.big);
      const label = c.labels[c.type === "toggle" ? c.value : 0];
      const tx = c.centered ? centerOffset(c.w, textWidth(font, label)) : 8;
      const ty = centerOffset(c.h, c.big ? 24 : 16) + 1;
      if (sunk) drawText(out, font, label, c.x + tx + 1, c.y + ty + 1, COLOR_BLUE, COLOR_WHITE);
      else drawTextShadowed(out, font, label, c.x + tx, c.y + ty, COLOR_BLUE, COLOR_WHITE);
    });
    for (const c of this.controls) {
      if (c.type === "slider") blitKeyed(this.assets.thumb, 0, 0, THUMB_W, THUMB_H, out, c.thumbX, c.y + THUMB_DY);
    }
    return out;
  }

  /** Draws the window over `screen`. */
  draw(screen: Surface16): void {
    const r = this.render();
    blitCopy(r, 0, 0, this.w, this.h, screen, this.x, this.y);
  }
}
