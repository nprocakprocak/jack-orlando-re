// object / animation commands of Script_ExecStep (SHOWANIMAFRAME, SETDARKNESSANIMA, BRIGHTNESSE, CLEARANIMABUFFER,
// MOVEEP, RELATIVEMULP). Synthetic: a fake player with a real Renderer and own pictures - no game files.
import { describe, expect, it } from "vitest";
import type { ObjectAnim } from "../formats/scene";
import type { Image16 } from "../formats/bm";
import { ObjectAnimation } from "../anim/objects";
import { blend565 } from "../cursor/lens";
import { createSurface, Renderer, SCALE_KEEP } from "../render";
import { scaleColor } from "../anim/light";
import { blendOverBackdrop, brightenImage, mixColour } from "./objfx";
import { ScenePlayer } from "./player";

const img = (w: number, h: number, fill: number, kind: Image16["kind"] = "pal8rle"): Image16 => ({
  width: w,
  height: h,
  kind,
  pixels: new Uint16Array(w * h).fill(fill),
});

describe("objfx helpers", () => {
  it("mixColour: (white, black, t) per channel", () => {
    expect(mixColour(0xffff, 0, 0)).toBe(0xffff);
    expect(mixColour(0xffff, 0, 2)).toBe(0);
    expect(mixColour(0xffff, 0, 1.5)).toBe((7 << 11) | (15 << 5) | 7); // the ring colour of Film_Play
    expect(mixColour(0xffff, 0, 0.7)).toBe((20 << 11) | (40 << 5) | 20);
  });

  it("brightenImage scales every colour, keeps 0 and does not touch the input", () => {
    const src = img(2, 1, 0);
    src.pixels[1] = 0xffff;
    const out = brightenImage(src, 0.5);
    expect(out.pixels[0]).toBe(0);
    expect(out.pixels[1]).toBe(scaleColor(0xffff, 0.5));
    expect(src.pixels[1]).toBe(0xffff);
  });

  it("a channel never drops to 0 (the original sets 1)", () => {
    const out = brightenImage(img(1, 1, 0x0821), 0.1);
    expect(out.pixels[0]).toBe((1 << 11) | (1 << 5) | 1);
  });

  it("a 16-bit picture has no palette: unchanged", () => {
    const src = img(1, 1, 0x1234, "rgb565");
    expect(brightenImage(src, 0.5)).toBe(src);
  });

  it("blendOverBackdrop: the blue part is the level toward the colour, level 0 shows the scene, outside the scene stays 0", () => {
    const bg = img(4, 2, 0x8410, "rgb565");
    const mask = img(2, 2, 0);
    mask.pixels[0] = 16; // level 16
    mask.pixels[3] = 31;
    const out = blendOverBackdrop(mask, bg, 3, 0, 0);
    expect(out.kind).toBe("rgb565");
    expect(out.pixels[0]).toBe(blend565(0x8410, 0, 16));
    expect(out.pixels[1]).toBe(0); // x = 4: outside the backdrop
    expect(out.pixels[2]).toBe(0x8410); // level 0
    expect(out.pixels[3]).toBe(0); // x = 4 again
    const inside = blendOverBackdrop(mask, bg, 0, 0, 0xffff);
    expect(inside.pixels[3]).toBe(blend565(0x8410, 0xffff, 31));
    expect(inside.pixels[1]).toBe(0x8410);
  });
});

describe("object commands on a fake player", () => {
  const aci = (): ObjectAnim =>
    ({
      name: "OBJ",
      images: [
        ["F1", 5, 6],
        ["F2", -3, 2],
      ],
      recs: [],
    }) as unknown as ObjectAnim;

  const make = (opts: { pbm16?: boolean; buffered?: boolean; flx?: boolean } = {}) => {
    const r = new Renderer(createSurface(64, 64));
    const base = img(2, 2, 0x1111);
    const id = r.add(base, 3, SCALE_KEEP);
    r.set(id, 10, 10, base, SCALE_KEEP);
    const pics: Record<string, Image16> = { F1: img(3, 3, 0x2222), F2: img(1, 1, 0x3333) };
    const o = {
      id,
      name: "OBJ",
      z: 0,
      anim: new ObjectAnimation(aci()),
      x: 10,
      y: 10,
      scale: SCALE_KEEP,
      base,
      visible: true,
      pbm16: opts.pbm16 ?? false,
      frameFile: null as string | null,
      frameDx: 0,
      frameDy: 0,
      buffered: opts.buffered ?? true,
      light: 1,
      darkness: 0xffff,
      flx: opts.flx ? { play: null, rec: 0 } : undefined,
    };
    const persons = [{ def: { lightScale: 1 } }];
    const self = {
      renderer: r,
      objectByName: new Map([["OBJ", o]]),
      backdrop: img(64, 64, 0x8410, "rgb565"),
      world: { objects: [{ x: 10, y: 10, quad: [0, 0, 1, 0, 1, 1, 0, 1], center: [0, 0], valid: true }] },
      persons: { persons },
      jackShadowScale: 1,
      image: (_s: string, f: string) => pics[f],
      drawObject: undefined as unknown,
      composeRegion: undefined as unknown,
      refreshBackground: undefined as unknown,
      ticks: 0,
    };
    self.refreshBackground = () => ScenePlayer.prototype.refreshBackground.call(self);
    self.composeRegion = (...a: unknown[]) =>
      (ScenePlayer.prototype as unknown as { composeRegion(...x: unknown[]): unknown }).composeRegion.apply(self, a);
    self.drawObject = (oo: unknown) => (ScenePlayer.prototype as unknown as { drawObject(o: unknown): void }).drawObject.call(self, oo);
    const p = self as unknown as ScenePlayer;
    const call = (m: keyof ScenePlayer, ...a: unknown[]) => (ScenePlayer.prototype[m] as (...x: unknown[]) => unknown).apply(p, a);
    return { r, o, self, persons, call };
  };

  it("SHOWANIMAFRAME shows ACI image n at object + offset and sets the image index", () => {
    const { r, o, call } = make();
    expect(call("showAnimFrame", "OBJ", 1)).toBe(true);
    const sp = r.sprite(o.id)!;
    expect([sp.x, sp.y, sp.image!.width]).toEqual([15, 16, 3]);
    expect(o.anim.index).toBe(1);
    expect(call("showAnimFrame", "OBJ", 2)).toBe(true);
    expect([r.sprite(o.id)!.x, r.sprite(o.id)!.y]).toEqual([7, 12]);
    expect(call("showAnimFrame", "OBJ", 0)).toBe(true); // the object's own picture, no offset
    expect([r.sprite(o.id)!.x, r.sprite(o.id)!.y, r.sprite(o.id)!.image!.width]).toEqual([10, 10, 2]);
  });

  it("SHOWANIMAFRAME with a missing image, a missing object or an FLX slot does nothing", () => {
    const { o, call } = make();
    expect(call("showAnimFrame", "OBJ", 3)).toBe(false);
    expect(call("showAnimFrame", "OBJ", -1)).toBe(false);
    expect(call("showAnimFrame", "NOPE", 1)).toBe(false);
    expect(o.frameFile).toBeNull();
    expect(make({ flx: true }).call("showAnimFrame", "OBJ", 1)).toBe(false);
  });

  it("SHOWANIMAFRAME shows a hidden object (Sprite_Set) and resets BRIGHTNESSE of the old picture", () => {
    const { r, o, call } = make();
    call("brightenObject", "OBJ", 0.5);
    r.hide(o.id);
    o.visible = false;
    call("showAnimFrame", "OBJ", 1);
    expect(o.visible).toBe(true);
    expect(o.light).toBe(1);
    expect(r.sprite(o.id)!.image!.pixels[0]).toBe(0x2222);
  });

  it("BRIGHTNESSE scales the picture shown, compounds, and a new frame is bright again", () => {
    const { r, o, call } = make();
    expect(call("brightenObject", "OBJ", 0.5)).toBe(true);
    expect(r.sprite(o.id)!.image!.pixels[0]).toBe(scaleColor(0x1111, 0.5));
    call("brightenObject", "OBJ", 0.5);
    expect(o.light).toBe(0.25);
    call("showAnimFrame", "OBJ", 2);
    expect(r.sprite(o.id)!.image!.pixels[0]).toBe(0x3333);
    expect(o.base.pixels[0]).toBe(0x1111); // the cached picture itself is not modified
    expect(call("brightenObject", "NOPE", 0.5)).toBe(false);
  });

  it("SETDARKNESSANIMA: the colour is mixColour(white, black, f); a type -8 picture is drawn blended over the scene", () => {
    const { r, o, call } = make({ pbm16: true });
    o.base = img(2, 2, 31); // level 31 everywhere
    expect(call("setAnimDarkness", "OBJ", 0.7)).toBe(true);
    expect(o.darkness).toBe(mixColour(0xffff, 0, 0.7));
    const sp = r.sprite(o.id)!;
    expect((sp.image as Image16).kind).toBe("rgb565");
    expect(sp.image!.pixels[0]).toBe(blend565(0x8410, mixColour(0xffff, 0, 0.7), 31));
    expect(call("setAnimDarkness", "NOPE", 1)).toBe(false);
  });

  it("without SETDARKNESSANIMA the colour is white (starts as 0xffff)", () => {
    const { r, o, call } = make({ pbm16: true });
    o.base = img(2, 2, 16);
    call("brightenObject", "OBJ", 1);
    expect(r.sprite(o.id)!.image!.pixels[0]).toBe(blend565(0x8410, 0xffff, 16));
  });

  it("a type -8 picture is blended over the sprites below it (the car body under SZYBY.PBM), not over the bare background", () => {
    const { r, o, self, call } = make({ pbm16: true });
    const car = img(8, 8, 0x4208, "rgb565");
    const carId = r.add(car, 1, SCALE_KEEP);
    r.set(carId, 8, 8, car, SCALE_KEEP); // z 1 <= the object's z (set below): under the glass
    const top = img(2, 2, 0x7777, "rgb565");
    const topId = r.add(top, 40, SCALE_KEEP);
    r.set(topId, 10, 10, top, SCALE_KEEP); // z 40: above the glass (a person), not in the picture
    o.z = 5;
    o.base = img(4, 4, 16);
    o.base.pixels[0] = 0; // level 0: shows what is under it unchanged
    call("brightenObject", "OBJ", 1);
    const out = r.sprite(o.id)!.image!;
    expect(out.pixels[0]).toBe(0x4208); // car, not the background 0x8410
    expect(out.pixels[1]).toBe(blend565(0x4208, 0xffff, 16));
    // beyond the car (x >= 16) the background shows through
    const far = img(4, 4, 16);
    o.x = 14;
    o.base = far;
    call("brightenObject", "OBJ", 1);
    const out2 = r.sprite(o.id)!.image!;
    expect(out2.pixels[0]).toBe(blend565(0x4208, 0xffff, 16));
    expect(out2.pixels[3]).toBe(blend565(0x8410, 0xffff, 16));
    expect(self.backdrop.pixels[0]).toBe(0x8410); // the backdrop itself is not modified
  });

  it("'under the picture' follows the sprite list, not the object's static z (a person's sprite inserted pushes the car up past the object's z)", () => {
    const { r, o, call } = make({ pbm16: true });
    // the object's sprite sits at z 3 and the car at z 2 (under it in the list), while the object's static z is 0
    const car = img(8, 8, 0x4208, "rgb565");
    const carId = r.add(car, 2, SCALE_KEEP);
    r.set(carId, 8, 8, car, SCALE_KEEP);
    const above = img(2, 2, 0x7777, "rgb565");
    const aboveId = r.add(above, 4, SCALE_KEEP); // after the object's sprite in the list: not in the picture
    r.set(aboveId, 10, 10, above, SCALE_KEEP);
    o.z = 0;
    o.base = img(4, 4, 16);
    o.base.pixels[0] = 0;
    call("brightenObject", "OBJ", 1);
    const out = r.sprite(o.id)!.image!;
    expect(out.pixels[0]).toBe(0x4208); // the car is in
    expect(out.pixels[2 * 4 + 2]).toBe(blend565(0x4208, 0xffff, 16)); // x,y = 12,12 inside the car; the sprite above is not mixed in
  });

  it("CHWINDOW does not erase what the sprite showed before it; refreshBackground (after [PRE]) does (SC000 GAZE1.PBM, SC000B CARINSP.PBM)", () => {
    const { r, o, self, call } = make();
    self.ticks = 7; // the scene runs already
    const fb = (x: number, y: number) => r.framebuffer.pixels[y * r.framebuffer.width + x];
    const bg = fb(0, 0);
    expect(fb(10, 10)).toBe(0x1111); // drawn at its .CCG point before [PRE]
    expect(call("setClip", "OBJ", { left: 20, top: 0, right: 64, bottom: 64 })).toBe(true); // [PRE]: CHWINDOW to the right of it
    expect(fb(10, 10)).toBe(0x1111); // CHWINDOW only writes the rectangle: the pixels stay
    call("setObjectPosition", "OBJ", 10, 10); // SETPOSITIONE to the same place: redraws only inside the clip
    expect(fb(10, 10)).toBe(0x1111);
    call("refreshBackground");
    expect(fb(10, 10)).toBe(bg); // Scene_RefreshBackground: the background again, the sprite drawn with its clip
    expect(r.sprite(o.id)!.clip.left).toBe(20);
  });

  it("CHWINDOW in [PRE] (before the first tick) leaves no ghost of the sprite outside its window", () => {
    const { r, o, call } = make();
    const fb = (x: number, y: number) => r.framebuffer.pixels[y * r.framebuffer.width + x];
    const bg = fb(0, 0);
    call("setClip", "OBJ", { left: 20, top: 0, right: 64, bottom: 64 });
    expect(fb(10, 10)).toBe(bg);
    expect(o.visible).toBe(true);
  });

  it("a clipped sprite is still drawn inside its clip after the refresh", () => {
    const { r, o, call } = make();
    call("setClip", "OBJ", { left: 11, top: 0, right: 64, bottom: 64 });
    call("refreshBackground");
    const fb = (x: number, y: number) => r.framebuffer.pixels[y * r.framebuffer.width + x];
    expect(fb(10, 10)).not.toBe(0x1111);
    expect(fb(11, 10)).toBe(0x1111);
    expect(o.visible).toBe(true);
  });

  it("an ordinary object is not blended", () => {
    const { r, o, call } = make();
    call("setAnimDarkness", "OBJ", 1);
    expect(o.darkness).toBe(mixColour(0xffff, 0, 1));
    expect(r.sprite(o.id)!.image!.pixels[0]).toBe(0x1111);
  });

  it("CLEARANIMABUFFER empties the sprite of an animation with a buffer, a later frame draws it again", () => {
    const { r, o, call } = make();
    expect(call("clearAnimBuffer", "OBJ")).toBe(true);
    expect(r.sprite(o.id)!.visible).toBe(false);
    expect(o.visible).toBe(false);
    call("showAnimFrame", "OBJ", 1);
    expect(r.sprite(o.id)!.visible).toBe(true);
  });

  it("CLEARANIMABUFFER on an animation without a buffer, or on an unknown name, does nothing", () => {
    const { r, o, call } = make({ buffered: false });
    expect(call("clearAnimBuffer", "OBJ")).toBe(false);
    expect(r.sprite(o.id)!.visible).toBe(true);
    expect(call("clearAnimBuffer", "NOPE")).toBe(false);
  });

  it("MOVEEP moves the coordinates and the quad but not the sprite; the next frame uses them", () => {
    const { r, o, self, call } = make();
    expect(call("moveObjectPoint", "OBJ", -4, 3)).toBe(true);
    expect([o.x, o.y]).toEqual([6, 13]);
    expect([self.world.objects[0].x, self.world.objects[0].y]).toEqual([6, 13]);
    expect([r.sprite(o.id)!.x, r.sprite(o.id)!.y]).toEqual([10, 10]); // MOVEE would have moved it
    call("moveObjectPoint", "OBJ", -4, 3);
    call("showAnimFrame", "OBJ", 1);
    expect([r.sprite(o.id)!.x, r.sprite(o.id)!.y]).toEqual([2 + 5, 16 + 6]);
    expect(call("moveObjectPoint", "NOPE", 1, 1)).toBe(false);
  });

  it("RELATIVEMULP sets a person's light scale (float32) and Jack's shadow scale", () => {
    const { persons, self, call } = make();
    expect(call("setPersonLightScale", 0, 0.7)).toBe(true);
    expect(persons[0].def.lightScale).toBe(Math.fround(0.7));
    expect(call("setPersonLightScale", null, 0.5)).toBe(true);
    expect(self.jackShadowScale).toBe(0.5);
    expect(call("setPersonLightScale", 4, 1)).toBe(false);
  });
});
