// The part of a sprite that falls inside both its clip and a redraw rectangle.

import { blitKeyed, blitScaled, type Step, type Surface16 } from "./surface";
import type { Rect, Sprite } from "./sprites";

/** Draws the part of a sprite rectangle inside both its clip and the redraw rectangle. */
export function drawClipped(
  kind: Sprite["kind"],
  at: { x: number; y: number; w: number; h: number },
  step: Step,
  img: Surface16,
  clip: Rect,
  r: Rect,
  scratch: Surface16,
  isCurrent: boolean,
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

/** Sprite_Set's test whether one redraw of the union is enough (else old and new separately). */
export function overlaps(
  old: { x: number; y: number; w: number; h: number },
  n: { x: number; y: number; w: number; h: number },
): boolean {
  const ow = n.x < old.x ? n.w : old.w;
  const oh = n.y < old.y ? n.h : old.h;
  return Math.abs(n.x - old.x) <= ow && Math.abs(n.y - old.y) <= oh;
}
