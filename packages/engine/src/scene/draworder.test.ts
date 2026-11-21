// Drawing order: the sprite list is moved only by the script commands and by the depth test of
// sprites that overlap.
import { describe, expect, it } from "vitest";
import { DEFAULT_CLIP, newSprite, Renderer, SCALE_KEEP, SpriteList, createSurface } from "../render";
import { arrangePerson, personObjectDepth, personObjectDepthInsertion } from "../persons/depth";
import type { WalkObject } from "../walk/objects";

describe("sprite list moves (synthetic)", () => {
  const img = createSurface(2, 2);
  const make = () => {
    const r = new Renderer(createSurface(64, 64));
    const ids = [1, 2, 3, 4, 5].map((z) => r.add(img, z));
    return { r, ids, order: () => r.sprites.items.map((s) => ids.indexOf(s.id) + 1) };
  };

  it("z stays with the slot when two sprites swap (Sprite_MoveBack)", () => {
    const l = new SpriteList();
    const s = [1, 2, 3].map((z) => l.insert(newSprite(img, z, SCALE_KEEP, DEFAULT_CLIP, 0)));
    expect(l.swapWithNeighbour(2, -1)).toBe(true);
    expect(l.items.map((x) => x.z)).toEqual([1, 2, 3]);
    expect(l.items[1]).toBe(s[2]);
    expect(l.swapWithNeighbour(0, -1)).toBe(false);
    expect(l.swapWithNeighbour(2, 1)).toBe(false);
  });

  it("placeUnder moves down to directly under the other sprite, only when above", () => {
    const { r, ids, order } = make();
    expect(r.placeUnder(ids[4], ids[1])).toBe(true);
    expect(order()).toEqual([1, 5, 2, 3, 4]);
    expect(r.placeUnder(ids[4], ids[1])).toBe(false); // already under
    expect(order()).toEqual([1, 5, 2, 3, 4]);
  });

  it("placeOver moves up to directly over the other sprite, only when under", () => {
    const { r, ids, order } = make();
    expect(r.placeOver(ids[0], ids[3])).toBe(true);
    expect(order()).toEqual([2, 3, 4, 1, 5]);
    expect(r.placeOver(ids[0], ids[3])).toBe(false);
    expect(r.placeOver(ids[0], 999)).toBe(false); // unknown sprite
  });
});

// SC087, the guard's body (the last frame of JACKUDERZ2) must end up under the ledge GZYMS.PBM. Game_Run arranges
// Jack after every frame of an insertion with the two edge tests; the data below are the quad of GZYMS.PBM (x 77, y 94) typed in by hand.
describe("Jack against the ledge quad after an insertion frame (synthetic)", () => {
  const gzyms: WalkObject = {
    x: 77,
    y: 94,
    quad: [1, 84, 323, 56, 325, 77, 4, 105],
    center: [163, 80],
    valid: true,
  };
  it("Jack standing at (302, 100), above every edge of the quad, is behind the ledge", () => {
    expect(personObjectDepth(gzyms, 302, 100)).toBe("behind");
  });
  it("a point below the quad is in front, a point inside it is left as it is", () => {
    expect(personObjectDepth(gzyms, 200, 260)).toBe("front");
    expect(personObjectDepth(gzyms, 200, 175)).toBeNull();
  });
  it("POVERE JACK GZYMS followed by the first insertion frame puts Jack under GZYMS again, the body object LEZYG stays under the ledge", () => {
    // list order of SC087 after POVERE JACK GZYMS.PBM... GZYMS1, LEZYG, GZYMS, JACK
    const list = ["GZYMS1", "LEZYG", "GZYMS", "JACK"];
    const out = arrangePerson(list, "JACK", 302, 100, [{ id: "GZYMS", kind: "object", object: gzyms }]);
    expect(out).toEqual(["GZYMS1", "LEZYG", "JACK", "GZYMS"]);
    // nothing else moves: LEZYG is still under GZYMS, whatever SETPOSITIONE does to it
    expect(out.indexOf("LEZYG")).toBeLessThan(out.indexOf("GZYMS"));
  });
});

describe("person against an object after an insertion frame (Game_Run, synthetic)", () => {
  const zero = (x: number, y: number): WalkObject => ({
    x,
    y,
    quad: [0, 0, 0, 0, 0, 0, 0, 0],
    center: [0, 0],
    valid: false,
  });
  it("an all-zero quad compares the feet with the object's y: SC117 colonel (359) in front of the chair (247), behind a lower object", () => {
    expect(personObjectDepthInsertion(zero(103, 247), 359)).toEqual({ behind: false, front: true });
    expect(personObjectDepthInsertion(zero(0, 400), 359)).toEqual({ behind: true, front: false });
    expect(personObjectDepthInsertion(zero(0, 359), 359)).toEqual({ behind: false, front: false }); // equal: no move
  });
  it("uses corner 0 for behind and corner 2 for in front, plus the object's current y (SETPOSITIONE moves it)", () => {
    const o: WalkObject = {
      x: 10,
      y: 100,
      quad: [0, 50, 40, 20, 40, 10, 0, 60],
      center: [0, 0],
      valid: true,
    };
    expect(personObjectDepthInsertion(o, 140)).toEqual({ behind: true, front: true }); // 150 > 140, 110 < 140
    expect(personObjectDepthInsertion(o, 105)).toEqual({ behind: true, front: false });
    expect(personObjectDepthInsertion(o, 160)).toEqual({ behind: false, front: true });
    // the walking step's edge tests leave the zero quad alone
    expect(personObjectDepth(zero(103, 247), 164, 359)).toBeNull();
  });
});

describe("person sprite z (synthetic)", () => {
  it("a new person's sprite lies under every object from index 2 up (Game_Run: Sprite_Add z = 2), Jack over all", async () => {
    const { Z_PERSON, Z_JACK } = await import("./player");
    const img = createSurface(2, 2);
    const r = new Renderer(createSurface(64, 64));
    const objects = [0, 1, 2, 3, 4, 5].map((z) => r.add(img, z));
    const person = r.add(img, Z_PERSON);
    const jack = r.add(img, Z_JACK);
    const order = r.sprites.items.map((s) => s.id);
    // equal z: the newer sprite goes before the older one (Sprite_Add), so the person is under object 2
    expect(order).toEqual([objects[0], objects[1], person, objects[2], objects[3], objects[4], objects[5], jack]);
  });
});
