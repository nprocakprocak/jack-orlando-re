// "O grze" credits scroller: Credits_DrawLine and Credits_ScrollTick ported literally.
import type { Font } from "../formats/fnt";
import { textWidth } from "../formats/fnt";
import type { CreditLine } from "../formats/text";
import { CREDIT_ROW_HEIGHT } from "../formats/text";
import type { Surface16 } from "../render/surface";
import { createSurface } from "../render/surface";
import { encodeMazovia } from "../dialog/caption";
import { darkenRect } from "./darken";
import { centerOffset, COLOR_OUTLINE_BLACK, COLOR_WHITE, COLOR_YELLOW, drawText } from "./draw";

export const CREDITS_W = 400;
/** Visible rows; the buffer keeps 32 more below, where the next line is drawn (y = 160). */
export const CREDITS_H = 160;
const BUFFER_ROWS = 192;
/** The scroll tick runs every 5 ms; the buffer moves 2 rows every 5th tick (= every 25 ms, 80 px/s). */
export const TICK_MS = 5;
export const TICKS_PER_STEP = 5;
export const STEP_ROWS = 2;
/** Pause at the start and after a `!` line, in ticks (1.5 s). */
export const PAUSE_TICKS = 300;
const INITIAL_LINES = 8;
const NEW_LINE_Y = 160;
const COPY_ROWS = 0xbc;
const TOP_FADE = [12, 10, 8, 6, 4, 2];
const BOTTOM_FADE_FIRST_ROW = 0x9b;
const BOTTOM_FADE = [4, 8, 12, 16, 20];

export class CreditsScroller {
  private readonly buf = createSurface(CREDITS_W, BUFFER_ROWS);
  /** 8 undarkened rows kept so the bottom fade does not accumulate */
  private readonly helper = createSurface(CREDITS_W, 8);
  private pos = 0;
  private pause = PAUSE_TICKS;
  private sub = 0;
  private shifts = 0;
  private lastHeight = 0;
  /** the credits loop has started (the first RunWindow only shows the window) */
  running = false;

  constructor(
    private readonly lines: readonly CreditLine[],
    private readonly fonts: { big: Font; small: Font },
  ) {
    let y = 0;
    for (let i = 0; i < INITIAL_LINES; i++) {
      const h = this.drawLine(y);
      y += 2 * h;
      this.lastHeight = h;
    }
  }

  /** The 400 x 160 visible part (shares the pixels with the buffer). */
  view(): Surface16 {
    return { width: CREDITS_W, height: CREDITS_H, pixels: this.buf.pixels };
  }

  get pausedTicks(): number {
    return this.pause;
  }

  /** Credits_DrawLine: next line of TEKST.COD (looping), centered in 400 px; returns its row height. */
  private drawLine(y: number): number {
    if (this.pos >= this.lines.length) this.pos = 0;
    const line = this.lines[this.pos++];
    const big = line.kind === "=";
    if (!big && line.style === "!") this.pause = PAUSE_TICKS;
    const font = big ? this.fonts.big : this.fonts.small;
    const text = encodeMazovia(line.text);
    drawText(
      this.buf,
      font,
      text,
      centerOffset(CREDITS_W, textWidth(font, text)),
      y,
      COLOR_OUTLINE_BLACK,
      line.style === "1" ? COLOR_YELLOW : COLOR_WHITE,
    );
    return CREDIT_ROW_HEIGHT[line.kind];
  }

  /** One 5 ms tick of Credits_ScrollTick. */
  tick(): void {
    if (!this.running) return;
    if (this.pause > 0) this.pause--;
    if (this.pause !== 0) return;
    if (++this.sub <= TICKS_PER_STEP - 1) return;
    this.sub = 0;
    const b = this.buf;
    b.pixels.copyWithin(0, STEP_ROWS * CREDITS_W, (STEP_ROWS + COPY_ROWS) * CREDITS_W);
    TOP_FADE.forEach((level, y) => darkenRect(b, 0, y, CREDITS_W, 1, level, true));
    // helper rows 6..7 <- buffer rows 158..159; buffer rows 153..158 <- helper rows 0..5; helper rows 0..5 <- 2..7
    this.helper.pixels.set(b.pixels.subarray(0x9e * CREDITS_W, 0xa0 * CREDITS_W), 6 * CREDITS_W);
    b.pixels.set(this.helper.pixels.subarray(0, 6 * CREDITS_W), 0x99 * CREDITS_W);
    this.helper.pixels.copyWithin(0, 2 * CREDITS_W, 8 * CREDITS_W);
    BOTTOM_FADE.forEach((level, i) => darkenRect(b, 0, BOTTOM_FADE_FIRST_ROW + i, CREDITS_W, 1, level, true));
    if (this.shifts === this.lastHeight) {
      this.lastHeight = this.drawLine(NEW_LINE_Y);
      this.shifts = 0;
    }
    this.shifts++;
  }
}
