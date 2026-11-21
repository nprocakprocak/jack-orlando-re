// Scene cross-fade of Scene_RefreshBackground.
import { createSurface, strideOf, type Surface16 } from "./surface";

/** The mix runs on the 640x480 screen area, always from (0, 0) of the work surface. */
export const FADE_W = 640;
export const FADE_H = 480;
/** Number of mixing passes (`local_e < 0x20`); enough for every channel to reach its target. */
export const FADE_STEPS = 32;
/**
 * One red step. adds `g_targetPitch` (pixels per row of the work surface, 1024) twice
 * as a 16-bit value: 2 * 1024 = 0x800 = the lowest red bit of RGB565. It only works because the
 * work surface is 1024 wide.
 */
export const RED_STEP = 0x800;
/** Timer_WaitSinceFrameStart(100): waits for more than 100 / 5 ticks of 5 ms, i.e. 21 ticks. */
export const STEP_MS = 105;
/** Same for scene 0xc9, which also draws a picture over each step (wait of 50 -> 11 ticks). */
export const STEP_MS_SCENE_C9 = 55;

/**
 * One pass: moves every pixel of `cur` one step toward `target`, in place.
 * Red and blue by 1 (5-bit units), green by 1 when 1 away and by 2 otherwise (6-bit units).
 * Both arrays hold `count` RGB565 pixels, rows packed without stride.
 * Returns the number of pixels that were not yet equal to the target.
 */
export function mixStep(cur: Uint16Array, target: Uint16Array, count = cur.length, redStep = RED_STEP): number {
  let changed = 0;
  for (let i = 0; i < count; i++) {
    let p = cur[i];
    const t = target[i];
    if (p === t) continue;
    changed++;
    const tr = t & 0xf800;
    const r = p & 0xf800;
    if (r < tr) p = (p + redStep) & 0xffff;
    else if (r !== tr) p = (p - redStep) & 0xffff;
    const g = p & 0x7e0;
    const tg = t & 0x7e0;
    if (g < tg) p += g + 0x20 < tg ? 0x40 : 0x20;
    else if (g !== tg) p -= tg < g - 0x20 ? 0x40 : 0x20;
    const b = p & 0x1f;
    const tb = t & 0x1f;
    if (b < tb) p++;
    else if (b !== tb) p--;
    cur[i] = p;
  }
  return changed;
}

export interface TransitionOptions {
  /** Milliseconds per pass; default STEP_MS. */
  stepMs?: number;
  /**
   * The original reads the target as a flat array of 640*480 pixels from the start of the new
   * scene image, ignoring its row width. For a background wider than 640 (most scenes are 1016
   * wide) that gives a skewed target. false (default) takes the left 640x480 columns instead;
   * true reproduces the original.
   */
  flatTarget?: boolean;
}

/**
 * The 32-pass fade as a state machine driven by time. The first pass happens on the first
 * `advance` (the original mixes, shows and only then waits), the following ones `stepMs` apart.
 * The game logic is frozen during the original fade (it only pumps messages), so a caller should
 * not run scripts or draw Jack and the cursor until `finished`.
 */
export class SceneTransition {
  /** The image shown during the fade (640x480); copy it to the screen after each `advance`. */
  readonly current: Surface16;
  readonly stepMs: number;
  private readonly target: Uint16Array;
  private nextAt = 0;
  private elapsed = 0;
  /** Passes done so far, 0..FADE_STEPS. */
  step = 0;

  /** `from`: what is on screen now (640x480 from the buffer origin); `to`: the new scene image. */
  constructor(from: Surface16, to: Surface16, opts: TransitionOptions = {}) {
    this.stepMs = opts.stepMs ?? STEP_MS;
    this.current = createSurface(FADE_W, FADE_H);
    copyArea(from, this.current);
    if (opts.flatTarget) {
      this.target = new Uint16Array(FADE_W * FADE_H);
      this.target.set(to.pixels.subarray(0, Math.min(to.pixels.length, this.target.length)));
    } else {
      this.target = createSurface(FADE_W, FADE_H).pixels;
      copyArea(to, { width: FADE_W, height: FADE_H, pixels: this.target });
    }
  }

  /** True once all passes are done and the last wait has elapsed. */
  get finished(): boolean {
    return this.step >= FADE_STEPS && this.elapsed >= FADE_STEPS * this.stepMs;
  }

  /** Moves time forward and runs the passes that became due. Returns true if `current` changed. */
  advance(dtMs: number): boolean {
    this.elapsed += dtMs;
    let ran = false;
    while (this.step < FADE_STEPS && this.elapsed >= this.nextAt) {
      mixStep(this.current.pixels, this.target);
      this.step++;
      this.nextAt += this.stepMs;
      ran = true;
    }
    return ran;
  }
}

/** Copies the top-left part of `src` into `dst` (missing area stays as it was). */
function copyArea(src: Surface16, dst: Surface16): void {
  const w = Math.min(src.width, dst.width);
  const h = Math.min(src.height, dst.height);
  const ss = strideOf(src);
  const ds = strideOf(dst);
  for (let y = 0; y < h; y++) {
    dst.pixels.set(src.pixels.subarray(y * ss, y * ss + w), y * ds);
  }
}
