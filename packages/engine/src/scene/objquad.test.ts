// Synthetic: SC005 - the woman walks behind the inspector's car only when the quad follows SETPOSITIONE.
import { describe, expect, it } from "vitest";
import { personObjectDepth } from "../persons";
import { Renderer, createSurface } from "../render";
import type { WalkObject } from "../walk/objects";
import { moveObjectQuad } from "./objquad";

const obj = (x: number, y: number, quad: number[]): WalkObject => ({
  x,
  y,
  quad,
  center: [0, 0],
  valid: true,
});

describe("object quad follows SETPOSITIONE", () => {
  // SAM_INS.PBM (.CCG at 0,500, script puts it at 238,280) and SZYBY.PBM (310,284): the quads of SC005
  const car = () => obj(0, 500, [5, 79, 198, 88, 187, 119, 9, 121]);
  const windows = () => obj(310, 284, [2, 85, 90, 94, 90, 96, -3, 101]);

  it("moves x and y, keeps the quad", () => {
    const o = car();
    moveObjectQuad([o], 0, 238, 280);
    expect([o.x, o.y]).toEqual([238, 280]);
    expect(o.quad).toEqual([5, 79, 198, 88, 187, 119, 9, 121]);
  });

  it("an unknown index changes nothing", () => {
    const o = car();
    moveObjectQuad([o], 3, 1, 1);
    expect([o.x, o.y]).toEqual([0, 500]);
  });

  it("a woman whose feet are above the car quad is behind it only after the move", () => {
    const o = car();
    const w = windows();
    // she passes at (393, 343): above the car and above the windows
    expect(personObjectDepth(o, 393, 343)).toBeNull(); // stale quad at (0,500): no verdict - she stays over the car, under the windows
    expect(personObjectDepth(w, 393, 343)).toBe("behind");
    moveObjectQuad([o], 0, 238, 280);
    expect(personObjectDepth(o, 393, 343)).toBe("behind"); // now both objects put her behind
  });

  it("feet below the quad: in front of the car", () => {
    const o = car();
    moveObjectQuad([o], 0, 238, 280);
    expect(personObjectDepth(o, 340, 420)).toBe("front");
  });
});

describe("draw order stays under the sprite list rules", () => {
  it("a sprite placed under the car is under the windows too (the windows lie above the car)", () => {
    const img = createSurface(2, 2);
    const r = new Renderer(createSurface(64, 64));
    const car = r.add(img, 8);
    const windows = r.add(img, 9);
    const woman = r.add(img, 1000);
    r.placeUnder(woman, car);
    const order = r.sprites.items.map((s) => s.id);
    expect(order.indexOf(woman)).toBeLessThan(order.indexOf(car));
    expect(order.indexOf(car)).toBeLessThan(order.indexOf(windows));
  });
});
