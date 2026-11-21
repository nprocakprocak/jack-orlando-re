import { describe, expect, it } from "vitest";
import { BUFFER_H, BUFFER_W, Renderer } from "./renderer";
import { CLIP_RIGHT, SpriteError } from "./sprites";
import { stepForScale } from "./sprites";
import { blitKeyed, blitScaled, createSurface, type Surface16 } from "./surface";

const W = 64;
const H = 32;

/** Background with a distinct value per pixel (never 0). */
function background(w = W, h = H): Surface16 {
  const s = createSurface(w, h);
  for (let i = 0; i < s.pixels.length; i++) s.pixels[i] = 0x8000 | (i & 0x7fff);
  return s;
}

function solid(w: number, h: number, color: number, holes: [number, number][] = []): Surface16 {
  const s = createSurface(w, h);
  s.pixels.fill(color);
  for (const [x, y] of holes) s.pixels[y * w + x] = 0;
  return s;
}

function at(s: Surface16, x: number, y: number): number {
  return s.pixels[y * s.width + x];
}

function make(bg = background()): Renderer {
  const r = new Renderer(bg, createSurface(W, H));
  r.softEdges = false;
  r.redrawAll();
  return r;
}

/** Painter's algorithm over the visible list: what any sequence of updates should end with. */
function naive(r: Renderer, bg: Surface16): Surface16 {
  const out = createSurface(r.framebuffer.width, r.framebuffer.height);
  blitKeyed(bg, 0, 0, bg.width, bg.height, out, 0, 0);
  for (const s of r.sprites.items) {
    if (!s.visible || !s.image) continue;
    const x0 = Math.max(s.x, s.clip.left);
    const y0 = Math.max(s.y, s.clip.top);
    const x1 = Math.min(s.x + s.w, s.clip.right);
    const y1 = Math.min(s.y + s.h, s.clip.bottom);
    // a mirrored blit takes its x offset from the right edge
    const sx = s.kind === "pal8" && s.step.int < 0 ? s.x + s.w - x1 : x0 - s.x;
    if (s.kind === "pal8") blitScaled(s.image, s.step, sx, y0 - s.y, x1 - x0, y1 - y0, out, x0, y0);
    else blitKeyed(s.image, x0 - s.x, y0 - s.y, x1 - x0, y1 - y0, out, x0, y0);
  }
  return out;
}

describe("Renderer: drawing order", () => {
  it("draws sprites over the background in z order", () => {
    const r = make();
    const top = r.add(solid(4, 4, 0x1111), 20);
    const bottom = r.add(solid(4, 4, 0x2222), 10);
    r.set(top, 10, 10, solid(4, 4, 0x1111));
    r.set(bottom, 12, 12, solid(4, 4, 0x2222));
    expect(at(r.framebuffer, 11, 11)).toBe(0x1111);
    expect(at(r.framebuffer, 13, 13)).toBe(0x1111); // overlap: higher z wins even if drawn later
    expect(at(r.framebuffer, 15, 15)).toBe(0x2222);
    expect(at(r.framebuffer, 16, 16)).toBe(at(background(), 16, 16));
  });

  it("among equal z the sprite added later is below", () => {
    const r = make();
    const a = r.add(solid(4, 4, 0x1111), 10);
    const b = r.add(solid(4, 4, 0x2222), 10);
    r.set(a, 0, 0, solid(4, 4, 0x1111));
    r.set(b, 0, 0, solid(4, 4, 0x2222));
    expect(at(r.framebuffer, 1, 1)).toBe(0x1111);
  });

  it("transparent pixels show what is below", () => {
    const r = make();
    const id = r.add(solid(3, 3, 0x1111, [[1, 1]]), 1);
    r.set(id, 5, 5, solid(3, 3, 0x1111, [[1, 1]]));
    expect(at(r.framebuffer, 6, 6)).toBe(at(background(), 6, 6));
    expect(at(r.framebuffer, 5, 5)).toBe(0x1111);
  });

  it("records the sprites redrawn under and over the moved one", () => {
    const r = make();
    const a = r.add(solid(4, 4, 1), 1);
    const b = r.add(solid(4, 4, 2), 2);
    const c = r.add(solid(4, 4, 3), 3);
    r.set(a, 0, 0, solid(4, 4, 1));
    r.set(c, 30, 0, solid(4, 4, 3));
    r.set(b, 2, 2, solid(4, 4, 2));
    expect(r.touched).toEqual([a]);
  });
});

describe("Renderer: dirty rectangles", () => {
  it("moving a sprite restores the background (overlapping move: one union redraw)", () => {
    const bg = background();
    const r = make(bg);
    const id = r.add(solid(6, 6, 0x1111), 1);
    r.set(id, 4, 4, solid(6, 6, 0x1111));
    r.set(id, 7, 5, solid(6, 6, 0x1111));
    expect(at(r.framebuffer, 4, 4)).toBe(at(bg, 4, 4));
    expect(at(r.framebuffer, 12, 10)).toBe(0x1111);
    expect(r.framebuffer.pixels).toEqual(naive(r, bg).pixels);
  });

  it("moving far away redraws old and new rectangles separately", () => {
    const bg = background();
    const r = make(bg);
    const id = r.add(solid(4, 4, 0x1111), 1);
    r.set(id, 0, 0, solid(4, 4, 0x1111));
    r.set(id, 40, 20, solid(4, 4, 0x1111));
    expect(r.framebuffer.pixels).toEqual(naive(r, bg).pixels);
    expect(r.sprite(id)).toMatchObject({ x: 40, y: 20, w: 4, h: 4 });
  });

  it("only the dirty rectangle is rewritten (width rounded up to even and at least 4)", () => {
    const bg = background();
    const r = make(bg);
    const id = r.add(solid(1, 1, 0x1111), 1);
    r.framebuffer.pixels.fill(7); // anything not redrawn keeps this value
    r.set(id, 10, 10, solid(1, 1, 0x1111));
    expect(at(r.framebuffer, 10, 10)).toBe(0x1111);
    expect([11, 12, 13].map((x) => at(r.framebuffer, x, 10))).toEqual([11, 12, 13].map((x) => at(bg, x, 10)));
    expect(at(r.framebuffer, 14, 10)).toBe(7);
    expect(at(r.framebuffer, 9, 10)).toBe(7);
    expect(at(r.framebuffer, 10, 11)).toBe(7);
  });

  it("hide restores the background, show draws the sprite again, remove deletes it", () => {
    const bg = background();
    const r = make(bg);
    const id = r.add(solid(4, 4, 0x1111), 1);
    r.set(id, 8, 8, solid(4, 4, 0x1111));
    r.hide(id);
    expect(at(r.framebuffer, 9, 9)).toBe(at(bg, 9, 9));
    expect(r.sprites.count).toBe(1);
    r.show(id);
    expect(at(r.framebuffer, 9, 9)).toBe(0x1111);
    r.remove(id);
    expect(at(r.framebuffer, 9, 9)).toBe(at(bg, 9, 9));
    expect(r.sprites.count).toBe(0);
    // unknown ids are ignored like in the original
    r.set(id, 0, 0, solid(1, 1, 1));
    r.hide(id);
    r.show(id);
    r.move(id, 1, 1);
    r.remove(id);
  });

  it("move keeps image and size", () => {
    const bg = background();
    const r = make(bg);
    const id = r.add(solid(4, 4, 0x1111), 1);
    r.set(id, 2, 2, solid(4, 4, 0x1111));
    r.move(id, 4, 3);
    expect(r.framebuffer.pixels).toEqual(naive(r, bg).pixels);
    r.move(id, 50, 20);
    expect(r.framebuffer.pixels).toEqual(naive(r, bg).pixels);
  });

  it("random updates end in the same picture as a full composition", () => {
    const bg = background();
    const r = make(bg);
    let seed = 1;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    const imgs = [
      solid(5, 7, 0x1111, [[2, 3]]),
      solid(9, 4, 0x2222),
      solid(3, 3, 0x3333, [
        [0, 0],
        [2, 2],
      ]),
    ];
    // the topmost sprite is a 16-bit one, so the "last sprite" quirk does not apply
    const ids = [r.add(imgs[0], 5), r.add(imgs[1], 3), r.add(imgs[2], 5), r.add(imgs[1], 9)];
    for (let n = 0; n < 300; n++) {
      const id = ids[rnd(ids.length)];
      const op = rnd(10);
      if (op === 0) r.hide(id);
      else if (op === 1) r.show(id);
      else r.set(id, rnd(W + 8) - 8, rnd(H + 8) - 8, imgs[rnd(imgs.length)]);
      expect(r.framebuffer.pixels).toEqual(naive(r, bg).pixels);
    }
  });

  it("random updates of scaled 8-bit sprites match a full composition", () => {
    const bg = background();
    const r = make(bg);
    let seed = 7;
    const rnd = (n: number) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    const img = createSurface(10, 8);
    img.pixels.forEach((_, i) => (img.pixels[i] = i % 7 === 0 ? 0 : 0x4000 + i));
    const ids = [r.add(img, 1, 1), r.add(img, 2, 0.5), r.add(solid(6, 6, 0x2222), 3)];
    const scales = [1, 0.5, 0.75, -1, -0.75, 16, -16];
    for (let n = 0; n < 300; n++) {
      const id = ids[rnd(2)];
      r.set(id, rnd(W) - 5, rnd(H) - 4, img, scales[rnd(scales.length)]);
      if (n % 10 === 0) r.set(ids[2], rnd(W), rnd(H), solid(6, 6, 0x2222));
      expect(r.framebuffer.pixels).toEqual(naive(r, bg).pixels);
    }
  });
});

describe("Renderer: scaling and mirroring", () => {
  const img = createSurface(8, 4);
  img.pixels.forEach((_, i) => (img.pixels[i] = 0x100 + i));

  it("8-bit sprites are scaled with the step from Sprite_Set", () => {
    const r = make();
    const id = r.add(img, 1, 0.5);
    r.set(id, 0, 0, img, 0.5);
    expect(r.sprite(id)).toMatchObject({
      w: 4,
      h: 2,
      kind: "pal8",
      step: stepForScale(0.5, false),
    });
    expect(at(r.framebuffer, 1, 1)).toBe(at(img, 2, 2));
  });

  it("scale 16 keeps the previous scale of a visible 8-bit sprite", () => {
    const r = make();
    const id = r.add(img, 1, 0.5);
    r.set(id, 0, 0, img, 0.5);
    r.set(id, 1, 0, img, 16);
    expect(r.sprite(id)).toMatchObject({ w: 4, h: 2 });
    // ... and means 1.0 on a sprite that was never shown
    const fresh = r.add(img, 2, 0.5);
    r.set(fresh, 20, 0, img, 16);
    expect(r.sprite(fresh)).toMatchObject({ w: 8, h: 4 });
  });

  it("negative scale mirrors", () => {
    const r = make();
    const id = r.add(img, 1, 1);
    r.set(id, 0, 0, img, -1);
    expect(at(r.framebuffer, 0, 0)).toBe(at(img, 7, 0));
    expect(at(r.framebuffer, 7, 3)).toBe(at(img, 0, 3));
  });

  it("16-bit sprites ignore the scale", () => {
    const r = make();
    const id = r.add(img, 1);
    r.set(id, 0, 0, img, 0.5);
    expect(r.sprite(id)).toMatchObject({ w: 8, h: 4, kind: "rgb565" });
  });
});

describe("Renderer: clipping", () => {
  it("default clip ends at x = 1016", () => {
    const bg = background(BUFFER_W, BUFFER_H);
    const r = new Renderer(bg);
    r.softEdges = false;
    r.redrawAll();
    const id = r.add(solid(20, 4, 0x1111), 1);
    r.set(id, CLIP_RIGHT - 10, 0, solid(20, 4, 0x1111));
    expect(at(r.framebuffer, CLIP_RIGHT - 1, 1)).toBe(0x1111);
    expect(at(r.framebuffer, CLIP_RIGHT, 1)).toBe(at(bg, CLIP_RIGHT, 1));
  });

  it("a custom clip rectangle cuts the sprite", () => {
    const bg = background();
    const r = make(bg);
    const id = r.add(solid(10, 10, 0x1111), 1, 16, { left: 5, top: 5, right: 12, bottom: 9 });
    r.set(id, 0, 0, solid(10, 10, 0x1111));
    expect(at(r.framebuffer, 4, 6)).toBe(at(bg, 4, 6));
    expect(at(r.framebuffer, 5, 5)).toBe(0x1111);
    expect(at(r.framebuffer, 9, 8)).toBe(0x1111);
    expect(at(r.framebuffer, 9, 9)).toBe(at(bg, 9, 9));
    expect(r.framebuffer.pixels).toEqual(naive(r, bg).pixels);
  });

  it("mirrored 8-bit sprite cut by its clip shows the right part of the mirror", () => {
    const img = createSurface(8, 1);
    img.pixels.forEach((_, i) => (img.pixels[i] = 0x100 + i));
    const bg = background();
    const r = make(bg);
    const id = r.add(img, 1, 1, { left: 0, top: 0, right: 5, bottom: H });
    r.set(id, 0, 0, img, -1);
    expect([0, 1, 2, 3, 4].map((x) => at(r.framebuffer, x, 0))).toEqual([7, 6, 5, 4, 3].map((x) => at(img, x, 0)));
    expect(at(r.framebuffer, 5, 0)).toBe(at(bg, 5, 0));
  });

  it("sprites partly off the buffer are cut at its edges", () => {
    const bg = background();
    const r = make(bg);
    const id = r.add(solid(6, 6, 0x1111), 1);
    r.set(id, -3, -3, solid(6, 6, 0x1111));
    expect(at(r.framebuffer, 0, 0)).toBe(0x1111);
    expect(at(r.framebuffer, 2, 2)).toBe(0x1111);
    expect(at(r.framebuffer, 3, 3)).toBe(at(bg, 3, 3));
  });
});

describe("Renderer: quirks of the original", () => {
  it("the topmost sprite is not redrawn over a changed one unless it is 16-bit", () => {
    const img = solid(4, 4, 0x3333);
    const r = make();
    const below = r.add(solid(4, 4, 0x1111), 1);
    const top = r.add(img, 2000, 1); // 8-bit, last in the list
    r.set(top, 0, 0, img, 1);
    r.set(below, 1, 1, solid(4, 4, 0x1111));
    expect(at(r.framebuffer, 2, 2)).toBe(0x1111);
  });

  it("raw sprites are drawn only below the changed sprite", () => {
    const raw = solid(4, 4, 0x3333);
    const r = make();
    const changed = r.add(solid(4, 4, 0x1111), 5);
    const windowId = r.addRaw(raw, 9, 4, 4);
    expect(r.sprite(windowId)?.kind).toBe("raw");
    const filler = r.add(solid(1, 1, 0x7777), 3000);
    r.set(filler, 60, 30, solid(1, 1, 0x7777));
    r.move(windowId, 0, 0);
    expect(at(r.framebuffer, 1, 1)).toBe(0x3333);
    r.set(changed, 1, 1, solid(4, 4, 0x1111));
    expect(at(r.framebuffer, 2, 2)).toBe(0x1111); // the raw window above it is not redrawn
  });

  it("edge softening touches only the sprite being changed", () => {
    const bg = createSurface(W, H);
    bg.pixels.fill(0x001f);
    const r = new Renderer(bg, createSurface(W, H));
    r.redrawAll();
    const img = solid(8, 8, 0xf800);
    const id = r.add(img, 1);
    r.set(id, 10, 10, img);
    // a fully opaque sprite has no edges inside its 2-px margin; a hole has: it gets blended
    const holed = solid(8, 8, 0xf800, [[3, 3]]);
    r.set(id, 10, 10, holed);
    expect(at(r.framebuffer, 13, 13)).not.toBe(0x001f); // the hole was blended
    r.softEdges = false;
    r.set(id, 10, 10, holed);
    expect(at(r.framebuffer, 13, 13)).toBe(0x001f);
  });

  it("the list holds 100 sprites", () => {
    const r = make();
    for (let i = 0; i < 100; i++) r.add(solid(1, 1, 1), i);
    expect(() => r.add(solid(1, 1, 1), 0)).toThrow(SpriteError);
  });
});
