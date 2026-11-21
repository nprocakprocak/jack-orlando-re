// The "flag" pass of the sprite hit tests (pass 1 of Sprite_ClickMacro / Cursor_HitTestSprites):
// a sprite counts as hit when it has an opaque pixel anywhere in the rectangle the cursor image redraws, not only under
// the hotspot. This is what makes small things easy to catch with the hand.

export interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The rectangle Sprite_SetOverlay hands to Render_RedrawRectOverlay (world coordinates):
 * the cursor image at `mouse − size/2`; when the previous rectangle is no further away than its own size
 * (`|dx| <= oldW`, `|dy| <= oldH`) the union of both, otherwise only the new one (the old spot is cleaned in a second
 * call that records no sprites). The width is then made even (right edge + 1) and at least 4.
 */
export function cursorHitRect(mouseX: number, mouseY: number, w: number, h: number, prev: HitRect | null): HitRect {
  const x = mouseX - (w >> 1);
  const y = mouseY - (h >> 1);
  let x0 = x,
    y0 = y,
    x1 = x + w,
    y1 = y + h;
  if (prev && prev.w > 0 && prev.h > 0 && Math.abs(x - prev.x) <= prev.w && Math.abs(y - prev.y) <= prev.h) {
    x0 = Math.min(x0, prev.x);
    y0 = Math.min(y0, prev.y);
    x1 = Math.max(x1, prev.x + prev.w);
    y1 = Math.max(y1, prev.y + prev.h);
  }
  let rw = x1 - x0;
  if (rw & 1) rw++;
  if (rw < 4) rw = 4;
  return { x: x0, y: y0, w: rw, h: y1 - y0 };
}

/** The part of a sprite the flag looks: its box and the pixel at a point of that box (null = transparent / outside). */
export interface FlagSprite {
  x: number;
  y: number;
  w: number;
  h: number;
  /** is the sprite's pixel at (dx, dy), 0 <= dx < w, 0 <= dy < h, opaque */
  opaque(dx: number, dy: number): boolean;
}

/**
 * The flag of one sprite: some opaque pixel lies inside `rect` (the blit of the redraw writes a pixel over a non-zero one).
 * [hypothesis] the pixel under a sprite pixel is taken to be non-zero (the original ORs the destination, so an opaque pixel over
 * pure black would not count); the clip box of the sprite is its own box.
 */
export function spriteFlagged(sp: FlagSprite, rect: HitRect): boolean {
  const x0 = Math.max(rect.x, sp.x);
  const y0 = Math.max(rect.y, sp.y);
  const x1 = Math.min(rect.x + rect.w, sp.x + sp.w);
  const y1 = Math.min(rect.y + rect.h, sp.y + sp.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (sp.opaque(x - sp.x, y - sp.y)) return true;
  return false;
}
