// where the shadow sprites lie and which objects are shown at scene start. Synthetic: own sprites, no game files.
import { describe, expect, it } from "vitest";
import { createSurface, Renderer, SCALE_KEEP } from "../render";
import { shownAtSceneStart, TYPE_PBM_ANIMATED, Z_SHADOW } from "./shadow";

describe("shadow sprites lie under everything (Game_Run: Sprite_Add z = 0)", () => {
  const img = createSurface(2, 2);
  const make = () => {
    const r = new Renderer(createSurface(64, 64));
    const objects = [0, 1, 2].map((z) => r.add(img, z, SCALE_KEEP)); // scene objects: z = index
    const shadow = r.add(img, Z_SHADOW, SCALE_KEEP);
    const person = r.add(img, 999.7, SCALE_KEEP);
    return { r, objects, shadow, person, order: () => r.sprites.items.map((s) => s.id) };
  };

  it("the shadow sprite is below object 0, whatever the order of adding", () => {
    const { r, objects, shadow, person, order } = make();
    expect(order()).toEqual([shadow, ...objects, person]);
    expect(r.sprites.items[0].z).toBeLessThan(0);
  });

  it("moving the person under or over an object (PUNDERE / POVERE) leaves the shadow at the bottom", () => {
    const { r, objects, shadow, person, order } = make();
    r.placeUnder(person, objects[1]);
    expect(order()).toEqual([shadow, objects[0], person, objects[1], objects[2]]);
    r.placeUnder(person, objects[0]);
    expect(order()[0]).toBe(shadow);
    expect(order()[1]).toBe(person);
  });
});

describe("objects shown at scene start (Scene_RefreshBackground)", () => {
  it("type −8 (SC005 SZYBY.PBM) is not placed: only its animation shows it", () => {
    expect(shownAtSceneStart(TYPE_PBM_ANIMATED, 284)).toBe(false);
    expect(shownAtSceneStart(TYPE_PBM_ANIMATED, 500)).toBe(false);
  });

  it("types 8 and 16 are placed unless they sit outside the screen (the scripts bring them in)", () => {
    expect(shownAtSceneStart(8, 284)).toBe(true);
    expect(shownAtSceneStart(16, 0)).toBe(true);
    expect(shownAtSceneStart(8, 500)).toBe(false);
    expect(shownAtSceneStart(8, -1000)).toBe(false);
    expect(shownAtSceneStart(8, -400)).toBe(true);
    expect(shownAtSceneStart(8, 479)).toBe(true);
    expect(shownAtSceneStart(8, 480)).toBe(false);
  });
});
