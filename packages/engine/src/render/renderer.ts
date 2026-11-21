// Dirty-rectangle sprite renderer of the original (and the Sprite_* calls).
// Behaviour and addresses:
import {
  blitCopy, blitKeyed, blitScaled, createSurface, renderScaled, softenEdges,
  type Step, type Surface16,
} from "./surface";
import {
  CLIP_BOTTOM, CLIP_RIGHT, DEFAULT_CLIP, keptScale, newSprite, SCALE_KEEP, SpriteList,
  stepForScale, Z_UI, type Rect, type Sprite,
} from "./sprites";

/** Work buffer (Video_SetMode: 640x480 screen, 1024x480 offscreen). */
export const BUFFER_W = 1024;
export const BUFFER_H = 480;
/** 8-bit sprites larger than this are not edge-softened. */
const SOFTEN_MAX_AREA = 100_000;

/** Where and what the sprite being changed is drawn as (globals in the original). */
interface Pending {
  x: number;
  y: number;
  w: number;
  h: number;
  step: Step;
  image: Surface16 | null;
  /** position inside the redraw rectangle when unclipped: / */
  offX: number;
  offY: number;
}

export class Renderer {
  /** The 1024x480 work surface; the screen shows a 640x480 window of it (present.ts). */
  readonly framebuffer: Surface16;
  readonly sprites = new SpriteList();
  /** (initially 1): soften the edges of the sprite being drawn. */
  softEdges = true;
  /** Ids of sprites redrawn on top of the background by the last redraw that drew its current sprite. */
  touched: number[] = [];

  private background: Surface16;
  /** */
  private current = 0;
  /** some edge of the redraw rectangle was cut by the current sprite's clip */
  private clipped = false;
  private pending: Pending | null = null;

  constructor(background: Surface16, framebuffer: Surface16 = createSurface(BUFFER_W, BUFFER_H)) {
    this.background = background;
    this.framebuffer = framebuffer;
  }

  /** set by Scene_Load to the scene background. Does not redraw. */
  setBackground(background: Surface16): void {
    this.background = background;
  }

  /** Sprite_Add. The sprite stays invisible until the first set(). Returns its id. */
  add(image: Surface16, z: number, scale = SCALE_KEEP, clip: Rect = DEFAULT_CLIP, flag = 0): number {
    return this.sprites.insert(newSprite(image, z, scale, clip, flag)).id;
  }

  /** Sprite_AddRaw: a w*h window of a 16-bit buffer, e.g. a GUI window. */
  addRaw(image: Surface16, z: number, w: number, h: number): number {
    return this.sprites.insert({
      ...newSprite(image, z, 1, DEFAULT_CLIP, 0), kind: "raw", w, h, scale: 1,
    }).id;
  }

  sprite(id: number): Sprite | undefined {
    return this.sprites.items[this.sprites.indexOf(id)];
  }

  /**
 * Sprite_Set: new position, image and scale; redraws the old and new rectangles.
 * scale: 16 = unscaled (16-bit sprites) or "keep" (8-bit sprites); negative = mirrored.
 */
  set(id: number, x: number, y: number, image: Surface16, scale = SCALE_KEEP): void {
    const index = this.sprites.indexOf(id);
    if (index < 0) return;
    this.place(index, x, y, image, scale, true);
  }

  /** redraw a sprite in place (used by redrawAll). */
  refresh(index: number): void {
    const sp = this.sprites.items[index];
    if (!sp?.image) return;
    this.place(index, sp.x, sp.y, sp.image, sp.scale, false);
  }

  private place(index: number, x: number, y: number, image: Surface16, scale: number, commit: boolean): void {
    const sp = this.sprites.items[index];
    this.current = index;
    this.touched = [];
    const mirrored = scale < 0;
    let s = Math.fround(Math.abs(scale));
    if (commit) sp.scale = scale;
    if (sp.kind === "pal8" && s === SCALE_KEEP) {
      if (sp.visible) s = keptScale(sp.step);
      else {
        sp.step = { int: 1, frac: 0 };
        s = 1;
      }
    }
    let w: number, h: number;
    if (sp.kind === "pal8") {
      w = Math.trunc(image.width * s);
      h = Math.trunc(image.height * s);
    } else {
      w = image.width;
      h = image.height;
      s = 1;
    }
    let old = { x: sp.x, y: sp.y, w: sp.w, h: sp.h };
    if (!sp.visible) {
      sp.visible = true;
      old = { x, y, w: 0, h: 0 };
    }
    const step = stepForScale(s, mirrored);
    const p: Pending = { x, y, w, h, step, image, offX: x - old.x, offY: y - old.y };
    this.pending = p;
    this.clipped = false;
    const union = this.clampRect(Math.min(old.x, x), Math.min(old.y, y), Math.max(old.x + old.w, x + w), Math.max(old.y + old.h, y + h));
    if (!commit || overlaps(old, p)) {
      this.redrawRect(union, true);
    } else {
      p.offX = p.offY = 0;
      this.redrawRect(this.clampRect(Math.min(x, CLIP_RIGHT), Math.min(y, CLIP_BOTTOM), Math.max(x + w, 0), Math.max(y + h, 0)), true);
      this.redrawRect(this.clampRect(Math.min(old.x, CLIP_RIGHT), Math.min(old.y, CLIP_BOTTOM), Math.max(old.x + old.w, 0), Math.max(old.y + old.h, 0)), false);
    }
    if (commit) Object.assign(sp, { x, y, w, h, step, image });
  }

  /** move without changing image, size or step. */
  move(id: number, x: number, y: number): void {
    const index = this.sprites.indexOf(id);
    if (index < 0) return;
    const sp = this.sprites.items[index];
    this.current = index;
    this.touched = [];
    const old = sp.visible ? { x: sp.x, y: sp.y, w: sp.w, h: sp.h } : { x, y, w: 0, h: 0 };
    const p: Pending = { x, y, w: sp.w, h: sp.h, step: sp.step, image: sp.image, offX: x - old.x, offY: y - old.y };
    this.pending = p;
    this.clipped = false;
    const union = this.clampRect(Math.min(old.x, x), Math.min(old.y, y), Math.max(old.x + old.w, x + p.w), Math.max(old.y + old.h, y + p.h));
    if (overlaps(old, p)) {
      this.redrawRect(union, true);
    } else {
      // unlike Sprite_Set, both rectangles are passed without clamping
      p.offX = p.offY = 0;
      this.redrawRect({ left: x, top: y, right: x + p.w, bottom: y + p.h }, true);
      this.redrawRect({ left: old.x, top: old.y, right: old.x + old.w, bottom: old.y + old.h }, false);
    }
    sp.visible = true;
    sp.x = x;
    sp.y = y;
  }

  /**
 * Sprite_MoveBack repeated by the distance (Script_ExecStep 0x14/0x15, Game_Run): the sprite
 * goes down the list until it lies directly under `other`. Nothing happens when it is under already.
 */
  placeUnder(id: number, other: number): boolean {
    return this.placeAgainst(id, other, -1);
  }

  /** Sprite_MoveFront repeated: the sprite goes up the list until it lies directly over `other`. */
  placeOver(id: number, other: number): boolean {
    return this.placeAgainst(id, other, 1);
  }

  private placeAgainst(id: number, other: number, dir: -1 | 1): boolean {
    let i = this.sprites.indexOf(id);
    const to = this.sprites.indexOf(other);
    if (i < 0 || to < 0 || (to - i) * dir <= 0) return false;
    while (i !== to) {
      this.sprites.swapWithNeighbour(i, dir);
      i += dir;
    }
    // the rectangle of the moved sprite contains the whole overlap with the sprites it passed
    if (this.sprites.items[i].visible) this.show(id);
    return true;
  }

  /** Sprite_Remove: hide; the sprite stays in the list. */
  hide(id: number): void {
    const index = this.sprites.indexOf(id);
    if (index < 0) return;
    this.redrawWithout(index);
    this.sprites.items[index].visible = false;
  }

  /** show a hidden sprite again where it was. */
  show(id: number): void {
    const index = this.sprites.indexOf(id);
    if (index < 0) return;
    const sp = this.sprites.items[index];
    this.current = index;
    this.touched = [];
    this.pending = { x: sp.x, y: sp.y, w: sp.w, h: sp.h, step: sp.step, image: sp.image, offX: 0, offY: 0 };
    this.clipped = false;
    sp.visible = true;
    this.redrawRect(this.clampRect(Math.min(sp.x, CLIP_RIGHT), Math.min(sp.y, CLIP_BOTTOM), Math.max(sp.x + sp.w, 0), Math.max(sp.y + sp.h, 0)), true);
  }

  /** hide (if visible) and delete from the list. */
  remove(id: number): void {
    const index = this.sprites.indexOf(id);
    if (index < 0) return;
    if (this.sprites.items[index].visible) this.redrawWithout(index);
    this.sprites.removeAt(index);
  }

  private redrawWithout(index: number): void {
    const sp = this.sprites.items[index];
    this.current = index;
    this.pending = null;
    this.clipped = false;
    this.redrawRect(this.clampRect(Math.min(sp.x, CLIP_RIGHT), Math.min(sp.y, CLIP_BOTTOM), Math.max(sp.x + sp.w, 0), Math.max(sp.y + sp.h, 0)), false);
  }

  /**
 * background to (0, 0), then every visible sprite with z < zLimit + 2000 is
 * redrawn in list order (each one as a dirty rectangle of its own).
 */
  redrawAll(zLimit = 0): void {
    blitCopy(this.background, 0, 0, this.background.width, this.background.height, this.framebuffer, 0, 0);
    for (let i = 0; i < this.sprites.count; i++) {
      const sp = this.sprites.items[i];
      if (sp.image && sp.visible && sp.z < zLimit + Z_UI) this.refresh(i);
    }
  }

  /** / / /: clamp to the current sprite's clip, remember cuts. */
  private clampRect(left: number, top: number, right: number, bottom: number): Rect {
    const c = this.sprites.items[this.current].clip;
    const cut = (v: number, lim: number, below: boolean) => {
      if (below ? v < lim : v > lim) {
        this.clipped = true;
        return lim;
      }
      return v;
    };
    return { left: cut(left, c.left, true), top: cut(top, c.top, true), right: cut(right, c.right, false), bottom: cut(bottom, c.bottom, false) };
  }

  /**
 * Render_RedrawRect: background + sprites below the current one + the current
 * one at its new place (drawCurrent) + sprites above, composed in a scratch buffer and
 * copied to the work surface.
 */
  private redrawRect(r: Rect, drawCurrent: boolean): void {
    let { left, top, right, bottom } = r;
    let w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return;
    if (w & 1) {
      w++;
      right++;
    }
    while (w < 4) {
      w++;
      right++;
    }
    w = Math.min(w, this.background.width);
    const rect = { left, top, right, bottom };
    const scratch = createSurface(w, h);
    const items = this.sprites.items;
    const cur = this.current;
    // the original skips this for an invisible raw current sprite and keeps stale scratch contents
    blitCopy(this.background, left, top, w, h, scratch, 0, 0);
    for (let i = 0; i < cur; i++) this.drawOther(items[i], rect, scratch, drawCurrent, true);
    if (drawCurrent && this.pending) this.drawCurrent(items[cur], this.pending, rect, scratch);
    for (let i = cur + 1; i < items.length - 1; i++) this.drawOther(items[i], rect, scratch, drawCurrent, false);
    // the topmost sprite is drawn only when it is a 16-bit image
    const last = items.length - 1;
    if (cur !== last && items[last].kind === "rgb565") this.drawOther(items[last], rect, scratch, drawCurrent, false);
    blitCopy(scratch, 0, 0, w, h, this.framebuffer, left, top);
  }

  private drawOther(sp: Sprite, r: Rect, scratch: Surface16, record: boolean, allowRaw: boolean): void {
    if (!sp.visible || !sp.image) return;
    if (sp.kind === "raw" && !allowRaw) return;
    if (!this.drawClipped(sp.kind, sp, sp.step, sp.image, sp.clip, r, scratch, false)) return;
    if (record) this.touched.push(sp.id);
  }

  private drawCurrent(sp: Sprite, p: Pending, r: Rect, scratch: Surface16): void {
    const img = p.image;
    if (!img) return;
    if (this.clipped) {
      this.drawClipped(sp.kind, p, p.step, img, sp.clip, r, scratch, true);
      return;
    }
    if (sp.kind === "pal8") {
      blitScaled(img, p.step, 0, 0, p.w, p.h, scratch, p.offX, p.offY);
      if (this.softEdges && p.w * p.h < SOFTEN_MAX_AREA) softenEdges(renderScaled(img, p.step, p.w, p.h), scratch, p.offX, p.offY);
    } else {
      blitKeyed(img, 0, 0, p.w, p.h, scratch, p.offX, p.offY);
      if (this.softEdges && sp.kind === "rgb565") softenEdges(img, scratch, p.offX, p.offY);
    }
  }

  /** Draws the part of a sprite rectangle inside both its clip and the redraw rectangle. */
  private drawClipped(
    kind: Sprite["kind"], at: { x: number; y: number; w: number; h: number }, step: Step, img: Surface16,
    clip: Rect, r: Rect, scratch: Surface16, isCurrent: boolean,
  ): boolean {
    const x0 = Math.max(at.x, clip.left);
    const x1 = Math.min(at.x + at.w, clip.right);
    const y0 = Math.max(at.y, clip.top);
    const y1 = Math.min(at.y + at.h, clip.bottom);
    if (!(x0 < r.right && r.left < x1 && y0 < r.bottom && r.top < y1)) return false;
    const ix = Math.max(r.left, x0);
    const iy = Math.max(r.top, y0);
    const vr = Math.min(x1, r.right);
    const vw = vr - ix;
    const vh = Math.min(y1, r.bottom) - iy;
    const dx = ix - r.left;
    const dy = iy - r.top;
    if (kind === "pal8") {
      // for the current sprite the original picks the mirrored offset when int < 1, else when int < 0
      const mirroredOffset = isCurrent ? step.int < 1 : step.int < 0;
      const sx = mirroredOffset ? at.x + at.w - vr : ix - at.x;
      blitScaled(img, step, sx, iy - at.y, vw, vh, scratch, dx, dy);
    } else {
      blitKeyed(img, ix - at.x, iy - at.y, vw, vh, scratch, dx, dy);
    }
    return true;
  }
}

/** Sprite_Set's test whether one redraw of the union is enough (else old and new separately). */
function overlaps(old: { x: number; y: number; w: number; h: number }, n: { x: number; y: number; w: number; h: number }): boolean {
  const ow = n.x < old.x ? n.w : old.w;
  const oh = n.y < old.y ? n.h : old.h;
  return Math.abs(n.x - old.x) <= ow && Math.abs(n.y - old.y) <= oh;
}
