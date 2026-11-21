import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLIP,
  keptScale,
  MAX_SPRITES,
  newSprite,
  SCALE_KEEP,
  SpriteError,
  SpriteList,
  stepForScale,
} from "./sprites";
import { createSurface } from "./surface";

const img = createSurface(2, 2);

describe("SpriteList", () => {
  it("keeps the list sorted by z, newest first among equal z", () => {
    const list = new SpriteList();
    const a = list.insert(newSprite(img, 10, SCALE_KEEP, DEFAULT_CLIP, 0));
    const b = list.insert(newSprite(img, 5, SCALE_KEEP, DEFAULT_CLIP, 0));
    const c = list.insert(newSprite(img, 10, SCALE_KEEP, DEFAULT_CLIP, 0));
    const d = list.insert(newSprite(img, 2000, SCALE_KEEP, DEFAULT_CLIP, 0));
    expect(list.items.map((s) => s.id)).toEqual([b.id, c.id, a.id, d.id]);
    expect([a.id, b.id, c.id, d.id]).toEqual([0, 1, 2, 3]);
  });

  it("finds sprites by id", () => {
    const list = new SpriteList();
    list.insert(newSprite(img, 3, SCALE_KEEP, DEFAULT_CLIP, 0));
    const s = list.insert(newSprite(img, 1, SCALE_KEEP, DEFAULT_CLIP, 0));
    expect(list.indexOf(s.id)).toBe(0);
    expect(list.indexOf(99)).toBe(-1);
    list.removeAt(0);
    expect(list.indexOf(s.id)).toBe(-1);
    expect(list.count).toBe(1);
  });

  it("is limited to 100 sprites", () => {
    const list = new SpriteList();
    for (let i = 0; i < MAX_SPRITES; i++) list.insert(newSprite(img, i, SCALE_KEEP, DEFAULT_CLIP, 0));
    expect(() => list.insert(newSprite(img, 0, SCALE_KEEP, DEFAULT_CLIP, 0))).toThrow(SpriteError);
  });

  it("new sprites are invisible, kind follows from scale", () => {
    const s16 = newSprite(img, 0, 16, DEFAULT_CLIP, 0);
    const s8 = newSprite(img, 0, 1, { left: 1, top: 2, right: 3, bottom: 4 }, 7);
    expect([s16.kind, s16.visible, s16.clip]).toEqual(["rgb565", false, DEFAULT_CLIP]);
    expect([s8.kind, s8.flag, s8.clip.right]).toEqual(["pal8", 7, 3]);
  });
});

describe("scale and step", () => {
  it("stepForScale", () => {
    expect(stepForScale(1, false)).toEqual({ int: 1, frac: 0 });
    expect(stepForScale(1, true)).toEqual({ int: -1, frac: 0 });
    expect(stepForScale(0.5, false)).toEqual({ int: 2, frac: 0 });
    expect(stepForScale(2, false)).toEqual({ int: 0, frac: 32767 });
    // 0.05 is a float: 65535 / 0.0500000007 = 1310699.98 -> 19 * 0xffff + 65534
    expect(stepForScale(0.05, false)).toEqual({ int: 19, frac: 65534 });
  });

  it("keptScale inverts the step", () => {
    expect(keptScale({ int: 1, frac: 0 })).toBe(1);
    expect(keptScale({ int: 2, frac: 0 })).toBe(0.5);
    expect(keptScale({ int: 1, frac: 21845 })).toBeCloseTo(0.75, 4);
  });

  it("keptScale clamps to [0.05, 1]", () => {
    expect(keptScale({ int: 0, frac: 32767 })).toBe(1);
    expect(keptScale({ int: 40, frac: 0 })).toBe(Math.fround(0.05));
  });

  it("keptScale reads both halves as signed 16-bit (quirks of the original)", () => {
    // scale 0.6: frac 43689 >= 0x8000 -> read as -21847 -> 1.5 -> clamped to 1
    expect(stepForScale(0.6, false)).toEqual({ int: 1, frac: 43689 });
    expect(keptScale({ int: 1, frac: 43689 })).toBe(1);
    // a mirrored step gives a negative scale -> clamped to 0.05
    expect(keptScale({ int: -1, frac: 0 })).toBe(Math.fround(0.05));
  });
});
