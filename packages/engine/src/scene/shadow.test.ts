// Shadow sprites of the scene: composition, placement and the Jack scale flag on invented state.
import { describe, expect, it } from "vitest";
import type { Image16 } from "../formats/bm";
import { darkenPixel, PersonShadow } from "../persons/shadow";
import { approximateShadowTables, composeShadow, drawAt, flipped } from "./shadow";
import { ScenePlayer } from "./player";
import { jackScale } from "../walk/geometry";

const img = (width: number, height: number, f: (x: number, y: number) => number): Image16 => ({
  width,
  height,
  kind: "rgb565",
  pixels: Uint16Array.from({ length: width * height }, (_, i) => f(i % width, Math.trunc(i / width))),
});

describe("drawAt (synthetic)", () => {
  it("is the PersonShadow geometry for the same corner and scale", () => {
    const s = Math.fround(0.7);
    const d = new PersonShadow(1).draw(true, {
      x: 300,
      y: 400,
      personScale: 0.7,
      lightScale: 1,
      maskWidth: 100,
      maskHeight: 40,
    })!;
    expect(drawAt(d.x, d.y, s, 100, 40, 8)).toEqual(d);
  });

  it("a corner left of the screen leaves the first columns empty", () => {
    const d = drawAt(-10, 50, 1, 40, 20, 8);
    expect(d.backdrop).toEqual({ srcX: 0, srcWidth: 30, dstX: 10 });
  });
});

describe("composeShadow (synthetic)", () => {
  const back = img(20, 10, () => 0x001f); // blue 31
  const mask = img(4, 2, (x) => (x < 2 ? 1 : 0));

  it("copies the backdrop under the shadow and darkens it under the non-zero mask pixels", () => {
    const d = drawAt(5, 3, 1, 4, 2, 2);
    const out = composeShadow(back, d, mask, approximateShadowTables())!;
    expect([out.width, out.height]).toEqual([4, 2]);
    expect([...out.pixels]).toEqual([29, 29, 31, 31, 29, 29, 31, 31]); // blue 31 - level 2 under the left half
  });

  it("takes the rows and columns from where the corner is, and leaves what lies off the background empty", () => {
    const b = img(20, 10, (x, y) => 0x0100 + x + y * 20); // distinct pixels, no mask darkening (mask all 0)
    const none = img(4, 2, () => 0);
    const out = composeShadow(b, drawAt(-2, 9, 1, 4, 2, 0), none, approximateShadowTables())!;
    // row 9 exists, row 10 does not; columns -2, -1 are off the left edge
    expect([...out.pixels]).toEqual([0, 0, b.pixels[9 * 20 + 0], b.pixels[9 * 20 + 1], 0, 0, 0, 0]);
  });

  it("an empty shadow (width or height 0) gives no image", () => {
    expect(composeShadow(back, drawAt(5, 3, 0, 4, 2, 2), mask, approximateShadowTables())).toBeNull();
  });

  it("flipped mirrors every row", () => {
    expect([...flipped(img(3, 2, (x, y) => x + 10 * y)).pixels]).toEqual([2, 1, 0, 12, 11, 10]);
  });

  it("the stand-in tables darken like level steps: white loses, level 0 keeps", () => {
    const t = approximateShadowTables();
    expect(darkenPixel(0xffff, 0, t)).toBe(0xffff);
    expect(darkenPixel(0xffff, 8, t)).toBeLessThan(0xffff);
    expect(darkenPixel(0x0000, 8, t)).toBe(0);
  });
});

describe("SETPERSONDATA JACK f (synthetic)", () => {
  /** a ScenePlayer shell with the fields setJackData touches */
  const shell = () =>
    Object.assign(Object.create(ScenePlayer.prototype), {
      jack: { frameDelay: 0, noScale: false },
      world: { perspective: { horizonY: 200, refY: 422, refScale: 0.88 } },
      walker: { y: 391, scale: 0.77, speed: 0 },
      fixedScale: null,
    }) as ScenePlayer;

  it("f = 2 only sets noScale: g_jackScale and g_perspRefScale stay (Script_ExecStep case 3), so the insertion shadows keep the walk scale", () => {
    const p = shell();
    p.setJackData(6, 2, 420, 12);
    expect(p.jack.noScale).toBe(true);
    expect(p.walker.scale).toBe(0.77);
    expect(p.world.perspective.refScale).toBe(0.88);
    expect(p.world.perspective.refY).toBe(420);
  });

  it("another f recomputes the scale from the perspective and clears noScale", () => {
    const p = shell();
    p.jack.noScale = true;
    p.setJackData(6, 0.88, 422, 12);
    expect(p.jack.noScale).toBe(false);
    expect(p.walker.scale).toBe(jackScale(p.world.perspective, 391));
    expect(p.walker.scale).toBeLessThan(1);
  });
});
