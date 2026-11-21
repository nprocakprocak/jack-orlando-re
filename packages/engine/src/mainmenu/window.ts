// The window of the main menu: a GUI window (Gui_CreateWindow) tinted blue (->
// Blit_TintRect16), a title and four buttons, opened and closed by blending.
import type { Font } from "../formats/fnt";
import { textWidth } from "../formats/fnt";
import { blend565 } from "../render/rgb565";
import { darkenRect } from "../gui/darken";
import {
  centerOffset,
  COLOR_BLUE,
  COLOR_OUTLINE_BLACK,
  COLOR_WHITE,
  COLOR_YELLOW,
  drawButtonFrame,
  drawText,
  drawWindowFrame,
} from "../gui/draw";
import type { Surface16 } from "../render/surface";
import { blitCopy, createSurface, strideOf } from "../render/surface";
import { menuBytes, type MainMenuTexts } from "./texts";

/** Gui_CreateWindow(0xcd, 0xbe, 0xe6, 0xeb, 0) in Launcher_Run. */
export const WINDOW_X = 0xcd;
export const WINDOW_Y = 0xbe;
export const WINDOW_W = 0xe6;
export const WINDOW_H = 0xeb;
/** (window, 0x1f, 2): every non-zero pixel moves 2/32 of the way to pure blue. */
export const TINT_COLOR = 0x001f;
export const TINT_LEVEL = 2;
/** Gui_AddLabel(window, center 1, x 0, y 0x10, outline 1, fill 0xffe0, big font). */
export const TITLE_Y = 0x10;
/** Gui_AddLabel: field height 22 with the big font. */
export const LABEL_H = 22;
/** Gui_AddButton(window, Gui_CenterOffset(0xe6, 0xb4) - 1, y, 0xb4, 0x22, centered, big font, label, name). */
export const BUTTON_X = centerOffset(WINDOW_W, 0xb4) - 1;
export const BUTTON_W = 0xb4;
export const BUTTON_H = 0x22;
export const BUTTON_YS = [0x3c, 0x62, 0x88, 0xae] as const;
/** Button names as Launcher_Run tests them (Gui_NameIs) — in creation order. */
export const BUTTON_NAMES = ["Intro", "Start", "Load", "Quit"] as const;
export type ButtonName = (typeof BUTTON_NAMES)[number];
/** The loops of Launcher_Run: open levels 0, 3... 30 (`< 0x21`), close 30, 27... 0. */
export const BLEND_STEP = 3;
export const BLEND_MAX = 30;
export const BLEND_STEPS = BLEND_MAX / BLEND_STEP + 1;

/**
 * Blit_TintRect16: the rectangle's non-zero pixels move `level`/32 of the way to `color` (the tables of
 * / blend565). tints (0, 0, w - 4, h - 4) of the window — 4 px short of the right and
 * bottom edges (the size of the launcher-only branch of Gui_CreateWindow, which the menu does not take).
 */
export function tintRect(s: Surface16, x: number, y: number, w: number, h: number, color: number, level: number): void {
  const stride = strideOf(s);
  for (let yy = y; yy < y + h; yy++) {
    for (let xx = x; xx < x + w; xx++) {
      const i = yy * stride + xx;
      if (s.pixels[i]) s.pixels[i] = blend565(s.pixels[i], color, level);
    }
  }
}

/** (level, copy, buffer): buffer pixels move `level`/32 of the way to the copy where it is non-zero. */
export function blendToward(dst: Uint16Array, src: Uint16Array, level: number): void {
  for (let i = 0; i < src.length; i++) if (src[i]) dst[i] = blend565(dst[i], src[i], level);
}

export class MenuWindow {
  /** undarkened background under the window (Render_ComposeRegion of the snapshot and of each button) */
  private readonly scene: Surface16;
  /** the window sprite's own buffer as it was built: frame, tint, title (buttons are separate sprites) */
  readonly built: Surface16;
  /** what the window sprite shows now (open/close blends) */
  readonly body: Surface16;
  private readonly labels: Uint8Array[];
  /** pixels of the four button sprites, raised and sunken */
  private readonly raised: Surface16[];
  private readonly sunken: Surface16[];

  constructor(
    readonly font: Font,
    background: Surface16,
    texts: MainMenuTexts,
  ) {
    const w = WINDOW_W;
    const h = WINDOW_H;
    this.scene = createSurface(w, h);
    blitCopy(background, WINDOW_X, WINDOW_Y, w, h, this.scene, 0, 0);
    const s = createSurface(w, h);
    blitCopy(this.scene, 0, 0, w, h, s, 0, 0);
    // Gui_CreateWindow -> Gui_DrawWindowFrame, then
    drawWindowFrame(s, w, h);
    tintRect(s, 0, 0, w - 4, h - 4, TINT_COLOR, TINT_LEVEL);
    // Gui_AddLabel: scene -> darken 16 -> shadow -> tint -> text
    const title = menuBytes(texts.title);
    const tw = textWidth(font, title);
    const tx = centerOffset(w, tw);
    blitCopy(this.scene, tx, TITLE_Y, tw, LABEL_H, s, tx, TITLE_Y);
    darkenRect(s, tx, TITLE_Y, tw, LABEL_H, 16);
    drawText(s, font, title, tx + 1, TITLE_Y + 1, 0, 0, [10, 6]);
    tintRect(s, tx, TITLE_Y, tw, LABEL_H, TINT_COLOR, TINT_LEVEL);
    drawText(s, font, title, tx, TITLE_Y, COLOR_OUTLINE_BLACK, COLOR_YELLOW);
    this.built = s;
    this.body = createSurface(w, h);
    this.labels = [texts.intro, texts.newGame, texts.load, texts.quit].map(menuBytes);
    this.raised = BUTTON_YS.map((_, i) => this.button(i, false));
    this.sunken = BUTTON_YS.map((_, i) => this.button(i, true));
    this.showLevel(0);
  }

  /** Gui_DrawButton with the window tint flag set. */
  private button(i: number, sunk: boolean): Surface16 {
    const b = createSurface(BUTTON_W, BUTTON_H);
    blitCopy(this.scene, BUTTON_X, BUTTON_YS[i], BUTTON_W, BUTTON_H, b, 0, 0);
    drawButtonFrame(b, 0, 0, BUTTON_W, BUTTON_H, sunk);
    const label = this.labels[i];
    const tx = centerOffset(BUTTON_W, textWidth(this.font, label));
    const ty = centerOffset(BUTTON_H, 24) + 1;
    if (!sunk) drawText(b, this.font, label, tx + 1, ty + 1, 0, 0, [10, 6]);
    tintRect(b, 0, 0, BUTTON_W, BUTTON_H, TINT_COLOR, TINT_LEVEL);
    if (sunk) drawText(b, this.font, label, tx + 1, ty + 1, COLOR_BLUE, COLOR_WHITE);
    else drawText(b, this.font, label, tx, ty, COLOR_BLUE, COLOR_WHITE);
    return b;
  }

  /** Index of the button under a screen point (the arrow's tip is the mouse position), -1 = none. */
  hit(x: number, y: number): number {
    const mx = x - WINDOW_X - BUTTON_X;
    if (mx < 0 || mx >= BUTTON_W) return -1;
    for (let i = 0; i < BUTTON_YS.length; i++) {
      const my = y - WINDOW_Y - BUTTON_YS[i];
      if (my >= 0 && my < BUTTON_H) return i;
    }
    return -1;
  }

  /** Open step: Render_ComposeRegion (background only, z <= 0x10) then toward the built window. */
  showLevel(level: number, toward: Surface16 = this.built): void {
    this.body.pixels.set(this.scene.pixels);
    blendToward(this.body.pixels, toward.pixels, level);
  }

  /** Launcher_Run copies the window as it is shown (after the open blend) before closing it. */
  snapshot(): Surface16 {
    const c = createSurface(WINDOW_W, WINDOW_H);
    c.pixels.set(this.body.pixels);
    return c;
  }

  drawBody(screen: Surface16): void {
    blitCopy(this.body, 0, 0, WINDOW_W, WINDOW_H, screen, WINDOW_X, WINDOW_Y);
  }

  drawButtons(screen: Surface16, pressed: number): void {
    BUTTON_YS.forEach((y, i) => {
      const b = i === pressed ? this.sunken[i] : this.raised[i];
      blitCopy(b, 0, 0, BUTTON_W, BUTTON_H, screen, WINDOW_X + BUTTON_X, WINDOW_Y + y);
    });
  }
}
