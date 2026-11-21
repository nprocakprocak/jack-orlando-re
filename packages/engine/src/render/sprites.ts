// Z-sorted sprite list of the original (100 x 0x28 bytes).
import { UNIT_STEP, type Step, type Surface16 } from "./surface";

/** Visible width of the work buffer for sprites: default clip right edge 0x3f8 (Sprite_Add callers). */
export const CLIP_RIGHT = 1016;
export const CLIP_BOTTOM = 480;
/** Sprite list capacity: the list ends where starts, full redraws scan 100 slots. */
export const MAX_SPRITES = 100;
/** `scale` value that selects an unscaled 16-bit sprite in Sprite_Add and "keep scale" in Sprite_Set. */
export const SCALE_KEEP = 16;
/** z from which sprites are UI (frame, cursor): hides only sprites with z < 2000. */
export const Z_UI = 2000;

/** Field +0x0c: 0x10 = 16-bit image, 8 = scaled 8-bit image, 0x12 = raw 16-bit buffer (GUI windows). */
export type SpriteKind = "rgb565" | "pal8" | "raw";

/** Edges inclusive-exclusive, like the original: left <= x < right. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const DEFAULT_CLIP: Readonly<Rect> = {
  left: 0,
  top: 0,
  right: CLIP_RIGHT,
  bottom: CLIP_BOTTOM,
};

export interface Sprite {
  /** +0x00, from the counter */
  id: number;
  /** +0x0a, sort key (ascending = drawn first) */
  z: number;
  kind: SpriteKind;
  /** +0x02..+0x08: rectangle where the sprite was last drawn (w, h after scaling) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** +0x0e: 0 after Sprite_Add and Sprite_Remove, 1 after the first Sprite_Set/Show */
  visible: boolean;
  /** +0x10 (frac), +0x12 (int, negative = mirrored) */
  step: Step;
  /** +0x14..+0x1a */
  clip: Rect;
  /** +0x1e, last Sprite_Add argument; skips sprites with it set when composing */
  flag: number;
  /** +0x20, last scale passed (sign = mirroring) */
  scale: number;
  /** +0x24 */
  image: Surface16 | null;
}

export class SpriteError extends Error {}

export class SpriteList {
  readonly items: Sprite[] = [];
  private nextId = 0;

  get count(): number {
    return this.items.length;
  }

  /**
   * Sprite_Add / Sprite_AddRaw: inserts before the first sprite whose z
   * is >= the new one (so among equal z the newest is drawn first, i.e. lowest).
   */
  insert(fields: Omit<Sprite, "id">): Sprite {
    if (this.items.length >= MAX_SPRITES) throw new SpriteError(`sprite list full (${MAX_SPRITES})`);
    let i = 0;
    while (i < this.items.length && this.items[i].z < fields.z) i++;
    const sprite: Sprite = { ...fields, id: this.nextId };
    this.nextId = (this.nextId + 1) & 0xffff;
    this.items.splice(i, 0, sprite);
    return sprite;
  }

  /** index by id, -1 if absent. */
  indexOf(id: number): number {
    return this.items.findIndex((s) => s.id === id);
  }

  /**
   * Sprite_MoveBack / Sprite_MoveFront: swaps the sprite with its neighbour one slot
   * down / up the list; the z values stay with the slots, so the list stays sorted. No-op at the end.
   */
  swapWithNeighbour(index: number, dir: -1 | 1): boolean {
    const j = index + dir;
    if (index < 0 || j < 0 || j >= this.items.length) return false;
    const a = this.items[index];
    const b = this.items[j];
    this.items[index] = b;
    this.items[j] = a;
    [a.z, b.z] = [b.z, a.z];
    return true;
  }

  removeAt(index: number): void {
    this.items.splice(index, 1);
  }
}

/** Sprite_Add arguments after the image: kind follows from scale like in. */
export function newSprite(image: Surface16, z: number, scale: number, clip: Rect, flag: number): Omit<Sprite, "id"> {
  return {
    z,
    kind: scale === SCALE_KEEP ? "rgb565" : "pal8",
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    visible: false,
    step: { ...UNIT_STEP },
    clip: { ...clip },
    flag,
    scale,
    image,
  };
}

const int16 = (v: number) => (v << 16) >> 16;
/** float 0.05 */
const SCALE_MIN = Math.fround(0.05);

/** Scale of a pal8 sprite reconstructed from its stored step (Sprite_Set, scale == 16 on a visible sprite). */
export function keptScale(step: Step): number {
  // both halves are read with movsx, so a frac >= 0x8000 counts as negative
  const s = Math.fround(65536 / (int16(step.int) * 0x10000 + int16(step.frac)));
  if (!(s <= 1)) return 1;
  return s < 0.05 ? SCALE_MIN : s;
}

/** Step from a positive scale (a float in the original): s = trunc(65535 / scale), split by 0xffff (sic). */
export function stepForScale(scale: number, mirrored: boolean): Step {
  const s = Math.trunc(65535 / Math.fround(scale));
  const int = Math.trunc(s / 0xffff);
  return { int: mirrored ? -int : int, frac: s % 0xffff };
}
