// Scene animations .FLX (ANIMA modes 5 and 6): the frame stepper of Game_Run (the code
// around `g_flxData`/`g_flxPos`). The game runs it once per animation tick (the delay of ANIMA /
// ANIMADELAY), so timing belongs to the caller; this class decodes one frame per step() and says
// where the sprite goes. src/video/README.md

import { FrameBuffer } from "../formats/media";
import type { Flx, FlxFrame, FlxHeader } from "../formats/media";

/** Sprite of one frame: w x h RGB565 (0 = transparent) at `object position + (x, y)`. */
export interface FlxSprite {
  x: number;
  y: number;
  width: number;
  height: number;
  pixels: Uint16Array;
}

export interface FlxStep {
  /** index of the frame just shown (the value of before the step: macros fire at it) */
  index: number;
  /** null: no image chunk (kind 0) or an empty rectangle — the previous sprite stays */
  sprite: FlxSprite | null;
  /** the rectangle of chunk 3 as last seen (the game keeps it between frames) */
  rect: [number, number, number, number];
  /** mode 5: that was the last frame (animation inactive, macro released); mode 6 wraps around */
  finished: boolean;
}

export class FlxAnimation {
  readonly header: FlxHeader;
  /** frames shown since the start or the last wrap */
  counter = 0;
  /** mode 6: how many times it wrapped */
  loops = 0;
  rect: [number, number, number, number] = [0, 0, 0, 0];
  private readonly fb: FrameBuffer;
  private flx: Flx;
  private gen: Generator<FlxFrame>;
  private done = false;

  /**
 * @param flx the animation (record `rec` of the object)
 * @param loop ANIMA mode 6 (cycles) instead of 5 (once)
 * @param restart the FLX a mode 6 loop restarts with: the game takes record 0 of the object
 * (`[anim * 300]`) whatever record was playing — pass it to reproduce that
 */
  constructor(
    flx: Flx,
    readonly loop: boolean,
    private readonly restart: Flx = flx,
  ) {
    this.flx = flx;
    this.header = flx.header;
    // Script_ExecStep: g_bigBlock is zeroed, Delta_Apply16 writes palette[index] (0 = transparent)
    this.fb = new FrameBuffer(flx.header.width, flx.header.height);
    this.gen = flx.frames(this.fb);
  }

  get isFinished(): boolean {
    return this.done;
  }

  step(): FlxStep {
    if (this.done) throw new Error("animation finished");
    const r = this.gen.next();
    if (r.done) throw new Error("FLX ended before its frame count");
    const { index, frame } = r.value;
    const h = this.flx.header;
    if (frame.rect) this.rect = frame.rect;
    const sprite = frame.kind === 1 || frame.kind === 2 ? this.cut(h) : null;
    this.counter++;
    let finished = false;
    if (this.counter === h.frames) {
      if (this.loop) {
        // Game_Run: g_flxData = record 0, counter = 0, position 0x14; the picture buffer is kept
        this.loops++;
        this.counter = 0;
        this.flx = this.restart;
        this.fb.resize(this.flx.header.width, this.flx.header.height);
        this.gen = this.flx.frames(this.fb);
      } else {
        this.done = true;
        finished = true;
      }
    }
    return { index, sprite, rect: this.rect, finished };
  }

  /**
 * Blit_Copy16 of Game_Run: mode 2 cuts (0, 0, w, h) of the buffer (the frame is cropped to the
 * rectangle), other modes cut (x, y, w, h); the sprite sits at the rectangle's (x, y) either way.
 * A rectangle reaching 1 column past the width (31_SAM3) reads on into the next row.
 */
  private cut(h: FlxHeader): FlxSprite | null {
    const [x, y, w, hh] = this.rect;
    if (w <= 0 || hh <= 0) return null;
    const src = this.fb.pixels;
    const sx = h.mode === 2 ? 0 : x;
    const sy = h.mode === 2 ? 0 : y;
    const pixels = new Uint16Array(w * hh);
    for (let r = 0; r < hh; r++) {
      const from = (sy + r) * h.width + sx;
      for (let c = 0; c < w; c++) {
        const i = from + c;
        pixels[r * w + c] = i >= 0 && i < src.length ? src[i] : 0;
      }
    }
    return { x, y, width: w, height: hh, pixels };
  }
}
