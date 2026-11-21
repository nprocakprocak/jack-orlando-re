// Shadows of scene persons. No DOM, no renderer: the host composes the
// backdrop, this module decides what to draw (Person_DrawShadow) and darkens it (Blit_ShadowDarken).
import { SHADOW_OFFSET_ROUND, SHADOW_SCALE_MAX } from "../anim/jack";
import type { Image16 } from "../formats/bm";
import { ftol } from "../walk/geometry";

const f32 = Math.fround;

/** Default shadow strength (colour table level) after scene start (Game_Main area). */
export const DEFAULT_STRENGTH = 8;
/** `ftol(65535 / s)` splits into the integer and fractional source step (= 65535.0). */
const STEP_BASE = 65535;
/** Anchor of the shadow image relative to the person's feet, scaled by the shadow scale (bytes). */
export const PERSON_SHADOW_ANCHOR = SHADOW_OFFSET_ROUND;

/** Anchor of `ShowShadow` (floats at and). */
export const SHOW_SHADOW_ANCHOR: readonly [number, number] = [60, 15];

/**
 * Colour tables: three lookups (blue byte table, green and red word tables) per level, 33 levels. Same
 * data as the dialog window remap (`play/facewin.tsRemap`), which is structurally compatible.
 */
export interface ShadowTables {
  /** byte per blue value (5 bit), 0x80 per level */
  blue: ArrayLike<number>;
  /** word per green value (6 bit), 64 per level */
  green: ArrayLike<number>;
  /** word per red value (5 bit), 64 per level */
  red: ArrayLike<number>;
}

/** one RGB565 pixel through the tables of `level`. */
export function darkenPixel(p: number, level: number, t: ShadowTables): number {
  return t.blue[level * 0x80 + (p & 0x1f)] | t.green[level * 64 + ((p >> 5) & 0x3f)] | t.red[level * 64 + ((p >> 11) & 0x1f)];
}

/**
 * Whether a person has a shadow at all, from the `[NAME]` header field `mode` (`.PCS` field 3): mode < 2 is the flag
 * itself (12000-byte buffer), mode 2 means no shadow, any larger mode has a shadow and a buffer of `mode * 2` bytes.
 */
export function shadowEnabledByMode(mode: number): boolean {
  return mode < 2 ? mode !== 0 : mode !== 2;
}

/** Pixels the mask buffer (4-byte header + RGB565) can hold; the game never checks it. */
export function maskBufferPixels(mode: number): number {
  return ((mode < 2 ? 12000 : mode * 2) - 4) >> 1;
}

/** What the host has to compose and darken for one call of Person_DrawShadow. */
export interface ShadowDraw {
  /** shadow scale: `* [* fade]`, at most 0.99 */
  scale: number;
  /** top left of the shadow rectangle on the screen (before the clamp of the backdrop copy) */
  x: number;
  y: number;
  /** size of the rectangle and of the sprite: mask size * scale, truncated */
  width: number;
  height: number;
  /** colour table level of the darkening (reduced while fading out) */
  level: number;
  /** source step per destination pixel: `stepInt + stepFrac / 65536` */
  stepInt: number;
  stepFrac: number;
  /**
 * Render_ComposeRegionNoFlag arguments: the backdrop is copied from `(srcX, y)` with `srcWidth` columns into the
 * buffer at column `dstX` (the part left of the screen stays empty), `height` rows, buffer width `width`.
 */
  backdrop: { srcX: number; srcWidth: number; dstX: number };
}

export interface ShadowInput {
  /** `Person_DrawShadow` arguments 3 and 4: the foot point after `ftol(x + dx*scale)` */
  x: number;
  y: number;
  /** person scale */
  personScale: number;
  /** PCS field 4, (also multiplies the light range) */
  lightScale: number;
  /**
 * factor of the fade-out level: 1 for persons (Person_DrawShadow); Jack_DrawShadow also multiplies it by
 * g_jackShadowScale
 */
  levelScale?: number;
  /** size of the mask image (round `CIEN1.BM` or the image of `SETSPECSHADOW`) */
  maskWidth: number;
  maskHeight: number;
}

export type ShadowEvent = "none" | "removed";

/**
 * Per-person shadow state of the script commands and of Person_DrawShadow. `reset()` is the state at scene start
 * (area clears the fades and the custom mask flag, Game_Main `= 8`).
 */
export class PersonShadow {
  /** shadow exists and is visible */
  enabled: boolean;
  /** colour table level */
  strength = DEFAULT_STRENGTH;
  /** `SETSPECSHADOW` gave the person an object image as mask */
  customMask = false;
  /** / /: `MINSHADOW` (fade out) */
  fadingOut = false;
  outCounter = 0;
  outStep = 0;
  /** / / /: `MAXSHADOW` (fade in) */
  fadingIn = false;
  inCounter = 0;
  inLimit = 0;
  inStep = 0;

  constructor(private readonly mode: number) {
    this.enabled = shadowEnabledByMode(mode);
  }

  /** Scene start: the header decides `enabled`, everything else returns to its default. */
  reset(): void {
    this.enabled = shadowEnabledByMode(this.mode);
    this.strength = DEFAULT_STRENGTH;
    this.customMask = false;
    this.fadingOut = false;
    this.fadingIn = false;
  }

  /**
 * `SETSHADOW p n` (opcode 0x13): cancels a fade; n = 0 switches the shadow off (and the game removes its sprite when
 * shadows are on), otherwise on with strength n (stored as a signed byte).
 */
  setShadow(n: number): ShadowEvent {
    this.fadingOut = false;
    this.fadingIn = false;
    if (n === 0) {
      this.enabled = false;
      return "removed";
    }
    this.enabled = true;
    this.strength = (n << 24) >> 24;
    return "none";
  }

  /** `MINSHADOW n p` (0x8b): fade out over n draws (counter n-1, step 1/n). */
  fadeOut(n: number): void {
    this.fadingOut = true;
    this.outCounter = n - 1;
    this.outStep = f32(1 / n);
  }

  /** `MAXSHADOW n p` (0x8c): fade in over n draws (counter 0 up to n-1). */
  fadeIn(n: number): void {
    this.fadingIn = true;
    this.inCounter = 0;
    this.inLimit = n - 1;
    this.inStep = f32(1 / n);
  }

  /** `SETSPECSHADOW p obj` (0x9a): the image of the object becomes the mask; the host supplies it to `darken`. */
  useObjectMask(): void {
    this.customMask = true;
  }

  /**
 * `ShowShadow p x y scale` (opcode 0x9b): the shadow at a given point and scale, anchor (60, 15)
 * (floats), the scale taken as given (no person scale, no 0.99 cap), strength, no fades.
 * `inp.personScale` and `lightScale` are ignored.
 */
  show(inp: ShadowInput, scale: number): ShadowDraw {
    return shape(inp, f32(scale), this.strength, SHOW_SHADOW_ANCHOR, false);
  }

  /**
 * Person_DrawShadow for `g_shadowsOn`: advances the fades and returns what to draw, or null when nothing is
 * drawn this call (shadow off). The normal and fade-out cases need `enabled && !fadingIn`, the fade-in case
 * `fadingIn` only.
 */
  draw(shadowsOn: boolean, inp: ShadowInput): ShadowDraw | null {
    if (!shadowsOn) return null;
    if (this.enabled && !this.fadingIn) {
      if (!this.fadingOut) return shape(inp, f32(inp.personScale * inp.lightScale), this.strength);
      // the scale shrinks with the counter before it is decremented; the level uses the decremented counter
      const s = f32(inp.personScale * inp.lightScale * this.outCounter * this.outStep);
      this.outCounter--;
      if (this.outCounter < 1) {
        this.fadingOut = false;
        this.enabled = false;
      }
      return shape(inp, s, ftol(this.strength * this.outCounter * this.outStep * (inp.levelScale ?? 1)));
    }
    if (this.fadingIn) {
      const s = f32(inp.personScale * inp.lightScale * this.inCounter * this.inStep);
      this.inCounter++;
      if (this.inCounter >= this.inLimit) {
        this.fadingIn = false;
        this.enabled = true;
      }
      return shape(inp, s, this.strength);
    }
    return null;
  }
}

/** Width, height, source step and backdrop rectangle at `scale`, with the rectangle's left at screen `x`. */
export function shadowExtent(
  x: number,
  scale: number,
  maskWidth: number,
  maskHeight: number,
): Pick<ShadowDraw, "width" | "height" | "stepInt" | "stepFrac" | "backdrop"> {
  const width = ftol(maskWidth * scale) & 0xffff;
  const height = ftol(maskHeight * scale) & 0xffff;
  const left = Math.max(-x, 0);
  const step = ftol(STEP_BASE / scale) >>> 0;
  return {
    width,
    height,
    stepInt: Math.floor(step / STEP_BASE) & 0xffff,
    stepFrac: step % STEP_BASE,
    backdrop: { srcX: Math.max(x, 0), srcWidth: (width - left) & 0xffff, dstX: left },
  };
}

/** Scale cap and anchor; the size and steps are `shadowExtent`. */
function shape(inp: ShadowInput, rawScale: number, level: number, anchor: readonly [number, number] = PERSON_SHADOW_ANCHOR, cap = true): ShadowDraw {
  const scale = cap && rawScale > f32(SHADOW_SCALE_MAX) ? f32(SHADOW_SCALE_MAX) : rawScale;
  const x = (ftol(inp.x - anchor[0] * scale) << 16) >> 16;
  const y = (ftol(inp.y - anchor[1] * scale) << 16) >> 16;
  return { scale, x, y, level, ...shadowExtent(x, scale, inp.maskWidth, inp.maskHeight) };
}

/**
 * Blit_ShadowDarken: `backdrop` (width x height RGB565, the composed background) is darkened in place under the non-zero
 * pixels of `mask`, which is stepped through with the 16.16 steps of `draw` (the 8-bit index test of the game is the non-zero
 * colour here; reads beyond the mask count as zero, the game reads neighbouring memory). Returns false when nothing is done
 * (width or height < 1, as the game's early return).
 */
export function darken(backdrop: Uint16Array, draw: ShadowDraw, mask: Image16, tables: ShadowTables): boolean {
  const { width, height, level, stepInt, stepFrac } = draw;
  if (width < 1 || height < 1) return false;
  const rowAdvance = (stepInt * mask.width) & 0xffff;
  let rowStart = 0;
  let yAcc = 0;
  for (let y = 0; y < height; y++) {
    let xAcc = 0;
    let src = rowStart;
    for (let x = 0; x < width; x++) {
      const v = src < mask.pixels.length ? mask.pixels[src] : 0;
      xAcc += stepFrac;
      const carry = xAcc > 0xffff ? 1 : 0;
      xAcc &= 0xffff;
      src += stepInt + carry;
      if (v !== 0) {
        const i = y * width + x;
        if (i < backdrop.length) backdrop[i] = darkenPixel(backdrop[i], level, tables);
      }
    }
    rowStart += rowAdvance;
    yAcc += stepFrac;
    if (yAcc > 0xffff) {
      yAcc &= 0xffff;
      rowStart += mask.width;
    }
  }
  return true;
}
