import { describe, expect, it } from "vitest";
import {
  cursorHitRect,
  spriteFlagged,
  spritePasses,
  spriteClickTarget,
  spriteReaction,
  type FlagSprite,
  type SpriteCandidate,
} from "./index";

describe("cursorHitRect (Sprite_SetOverlay)", () => {
  it("is the cursor image centred on the mouse when there was no previous rectangle", () => {
    expect(cursorHitRect(100, 80, 50, 33, null)).toEqual({ x: 75, y: 64, w: 50, h: 33 });
  });
  it("makes an odd width even and at least 4", () => {
    expect(cursorHitRect(100, 80, 17, 25, null).w).toBe(18);
    expect(cursorHitRect(100, 80, 2, 2, null).w).toBe(4);
  });
  it("covers the old and the new place when they are no further apart than the old size", () => {
    const prev = { x: 75, y: 64, w: 50, h: 33 };
    expect(cursorHitRect(110, 84, 50, 33, prev)).toEqual({ x: 75, y: 64, w: 60, h: 37 });
    // too far: only the new one
    expect(cursorHitRect(300, 80, 50, 33, prev)).toEqual({ x: 275, y: 64, w: 50, h: 33 });
    expect(cursorHitRect(100, 200, 50, 33, prev)).toEqual({ x: 75, y: 184, w: 50, h: 33 });
  });
});

describe("spriteFlagged (flag)", () => {
  /** a 6x4 sprite at (50, 40) whose only opaque pixel is (5, 3), its bottom right corner */
  const corner: FlagSprite = { x: 50, y: 40, w: 6, h: 4, opaque: (dx, dy) => dx === 5 && dy === 3 };
  it("is set when an opaque pixel lies anywhere in the rectangle, not only under its centre", () => {
    expect(spriteFlagged(corner, { x: 20, y: 20, w: 50, h: 33 })).toBe(true);
    expect(spriteFlagged(corner, { x: 55, y: 43, w: 10, h: 10 })).toBe(true);
  });
  it("is clear when the rectangle misses the opaque pixels, the box, or only touches the edge", () => {
    expect(spriteFlagged(corner, { x: 20, y: 20, w: 30, h: 33 })).toBe(false); // ends at x = 50
    expect(spriteFlagged(corner, { x: 50, y: 40, w: 5, h: 4 })).toBe(false); // the box part without the pixel
    expect(spriteFlagged(corner, { x: 56, y: 40, w: 10, h: 10 })).toBe(false); // right of the box
    expect(spriteFlagged(corner, { x: 50, y: 44, w: 10, h: 10 })).toBe(false); // below the box
    expect(spriteFlagged({ ...corner, opaque: () => false }, { x: 0, y: 0, w: 640, h: 480 })).toBe(false);
  });
});

describe("the flag makes small sprites easy to take", () => {
  const tool: SpriteCandidate = { name: "PRZYBORNIK", pixelHit: false, flagged: true };
  const wall: SpriteCandidate = { name: "WALL", pixelHit: false, flagged: false };
  it("the hand (mode 4) clicks a flagged sprite although no opaque pixel is under the hotspot", () => {
    expect(spritePasses(4, true)).toBe(2);
    expect(spriteClickTarget([tool, wall], 4)).toBe(0);
    expect(spriteClickTarget([tool, wall], 5)).toBe(0); // the item in hand as well
  });
  it("the pointer (0) and the magnifier (1) need the pixel for a click; the pointer's test also sees the flag", () => {
    expect(spriteClickTarget([tool, wall], 0)).toBe(-1);
    expect(spriteClickTarget([tool, wall], 1)).toBe(-1);
    const port = {
      exists: (n: string) => n === "BRANIE-PRZYBORNIK",
      start: () => -1,
      interruptOutMacros: () => {},
    } as never;
    expect(spriteReaction([tool, wall], port, 4, { verb: "BRANIE", item: null }).exists).toBe(true);
    expect(spriteReaction([tool], port, 1, { verb: "PATRZENIE", item: null }).over).toBe(false);
  });
  it("a pixel hit wins over a flagged sprite below the hotspot's sprite order", () => {
    const top: SpriteCandidate = { name: "TOP", pixelHit: true, flagged: true };
    expect(spriteClickTarget([tool, top], 4)).toBe(1);
    expect(spriteClickTarget([top, tool], 4)).toBe(0);
  });
});
