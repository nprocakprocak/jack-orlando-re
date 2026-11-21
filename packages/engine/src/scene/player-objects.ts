// Scene objects, their animations, and clip rectangles.

import { type AnimaArgs, ObjectAnimation } from "../anim";
import { spriteFlagged, type HitRect, type SpriteCandidate } from "../areas";
import type { Image16 } from "../formats/bm";
import { Flx } from "../formats/media";
import { type ObjectAnim, type SceneObject } from "../formats/scene";
import { SCALE_KEEP, strideOf, type Rect, type Surface16 } from "../render";
import { f32 } from "../walk";
import { FlxAnimation } from "../video/flx";
import { BLANK } from "./decode";
import { blendOverBackdrop, brightenImage, GLASS_WHITE, mixColour } from "./objfx";
import { moveObjectQuad } from "./objquad";
import type { ObjectSprite, ScenePlayerState } from "./player-state";
import { stepAnimShadow } from "./player-shadow";
import { shownAtSceneStart, TYPE_PBM_ANIMATED } from "./shadow";

/**
 * CHWINDOW (->): the clip rectangle (+0x14..+0x1a) of the sprite of Jack (and his two
 * shadows), of an object or of a person, looked up in this order. Returns false when the name is unknown.
 */
export function setClip(this: ScenePlayerState, name: string, clip: Rect): boolean {
  const ids: number[] = [];
  if (name === "JACK") ids.push(this.jackId, ...this.shadowIds);
  else if (this.objectByName.has(name)) ids.push(this.objectByName.get(name)!.id);
  else {
    const i = this.persons.find(name);
    if (i < 0) return false;
    ids.push(this.personIds[i], this.personShadowIds[i]);
  }
  for (const id of ids) {
    const sp = this.renderer.sprite(id);
    if (sp) sp.clip = { ...clip };
  }
  // [PRE] (before the first tick): the scene is composed after it, so what the sprite showed outside its new window must not stay
  if (this.ticks === 0) this.refreshBackground();
  return true;
}

// --- objects ------------------------------------------------------------------------------

export function hasObject(this: ScenePlayerState, name: string): boolean {
  return this.objectByName.has(name);
}

export function objectAnim(this: ScenePlayerState, name: string): ObjectAnimation | null {
  return this.objectByName.get(name)?.anim ?? null;
}

export function objectPosition(this: ScenePlayerState, name: string): { x: number; y: number } | null {
  const o = this.objectByName.get(name);
  return o ? { x: o.x, y: o.y } : null;
}

/** SETPOSITIONE / SETPOSITIONEV (and MOVEE with relative = true). y >= 480 puts it below the screen. */
export function setObjectPosition(this: ScenePlayerState, name: string, x: number, y: number, relative = false): void {
  const o = this.objectByName.get(name);
  if (!o) return;
  o.x = relative ? o.x + x : x;
  o.y = relative ? o.y + y : y;
  // g_sceneObjX/Y feed the quad tests too (Depth_AboveQuadEdge, Object_QuadContains): the floor quad moves with the object
  moveObjectQuad(this.world.objects, o.z, o.x, o.y);
  // Script_ExecStep case 0x2b: a type -8 object's sprite is moved only to (0, 500); the animation step places it otherwise
  if (o.pbm16 && !(o.x === 0 && o.y === 500)) return;
  if (o.flx) {
    // an FLX slot's sprite follows too (Sprite_Set at the object's x, y with the picture it holds, no frame-rectangle offset):
    // SC006 / SC038 park a finished animation at (0, 500) this way, otherwise its last frame stays on the screen
    const sp = this.renderer.sprite(o.id);
    if (sp?.image && sp.image.width > 1) this.renderer.set(o.id, o.x, o.y, sp.image, SCALE_KEEP);
    return;
  }
  this.drawObject(o);
}

export function setObjectVisible(this: ScenePlayerState, name: string, visible: boolean): void {
  const o = this.objectByName.get(name);
  if (!o || o.visible === visible) return;
  o.visible = visible;
  if (!visible) this.renderer.hide(o.id);
  else if (!o.flx) this.drawObject(o);
  else {
    const sp = this.renderer.sprite(o.id);
    if (sp?.image && sp.image.width > 1) this.renderer.set(o.id, sp.x, sp.y, sp.image, SCALE_KEEP);
  }
}

/** ANIMA: start the animation of an object. */
export function startObjectAnim(this: ScenePlayerState, name: string, a: AnimaArgs): boolean {
  const o = this.objectByName.get(name);
  if (!o?.anim) return false;
  o.anim.start(a);
  return true;
}

/**
 * SHOWANIMAFRAME anim n (Script_ExecStep case 0x1b): the sprite of the animation's object shows ACI image `n` at the
 * object's place + the image's offset, at once, and the current image index becomes `n` (0 = the object's own picture).
 * Whether the animation runs is not looked: a running one overwrites the picture with its next frame. False when
 * the object or the image does not exist.
 */
export function showAnimFrame(this: ScenePlayerState, name: string, n: number): boolean {
  const o = this.objectByName.get(name);
  if (!o?.anim || o.flx || n < 0 || n >= o.anim.imageCount) return false;
  const f = o.anim.image(n);
  o.frameFile = f.file;
  o.frameDx = f.dx;
  o.frameDy = f.dy;
  o.light = 1;
  o.anim.index = n;
  this.drawObject(o);
  return true;
}

/**
 * SETDARKNESSANIMA anim f (case 0x67): the colour a type -8 picture is blended toward, `(0xffff, 0, f)`
 * (white at f = 0, darker as f grows). Drawn at the next frame change; a picture already shown is redrawn.
 */
export function setAnimDarkness(this: ScenePlayerState, name: string, f: number): boolean {
  const o = this.objectByName.get(name);
  if (!o) return false;
  o.darkness = mixColour(0xffff, 0, f);
  if (o.pbm16 && o.visible && !o.flx) this.drawObject(o);
  return true;
}

/**
 * BRIGHTNESSE object f (case 0x40): the channels of the colours of the object's picture are multiplied by `f` (the original
 * rewrites the palette of the sprite image, so repeated calls compound and the next unpacked frame is bright again).
 * Applies to the picture shown now; 16-bit pictures are left alone. False when there is no such object.
 */
export function brightenObject(this: ScenePlayerState, name: string, f: number): boolean {
  const o = this.objectByName.get(name);
  if (!o) return false;
  o.light = f32(o.light * f);
  if (o.visible && !o.flx) this.drawObject(o);
  return true;
}

/**
 * CLEARANIMABUFFER anim (case 0x81): `memset` of the animation's picture buffer (also its width and height): the sprite is empty
 * until the next frame is drawn. Only animations with a buffer (type 8 / -8 pictures, FLX slots) have one; for the rest nothing happens.
 */
export function clearAnimBuffer(this: ScenePlayerState, name: string): boolean {
  const o = this.objectByName.get(name);
  if (!o?.anim || !o.buffered) return false;
  this.renderer.set(o.id, o.x + o.frameDx, o.y + o.frameDy, BLANK, SCALE_KEEP);
  this.renderer.hide(o.id);
  o.visible = false;
  return true;
}

/**
 * MOVEEP object dx dy (case 0x4b): g_sceneObjX/Y += (dx, dy) and nothing else (MOVEE, case 0x3f, then moves the sprite).
 * The animation steps place their pictures at the object's coordinates, so the sprite follows with the next frame
 * (SC013 `ZMIATAJ`: Alice sweeping moves between the `ANIMA SASS1.PBM` phases).
 */
export function moveObjectPoint(this: ScenePlayerState, name: string, dx: number, dy: number): boolean {
  const o = this.objectByName.get(name);
  if (!o) return false;
  o.x += dx;
  o.y += dy;
  moveObjectQuad(this.world.objects, o.z, o.x, o.y);
  return true;
}

/**
 * The visible sprites of objects, persons and Jack in drawing order (last = on top) as the click code
 * sees them: `pixelHit` = an opaque pixel under the point (world
 * coordinates); `flagged` = an opaque pixel inside `rect` (the cursor's redraw rectangle, areas/rect.ts; pass 1 of the hit tests). Jack is a target like the others, under the name "JACK" (`<verb>-JACK`, and the click that opens the coat).
 */
export function spriteCandidates(
  this: ScenePlayerState,
  px: number,
  py: number,
  rect: HitRect | null = null,
): SpriteCandidate[] {
  const named: { id: number; name: string }[] = [
    ...this.objects.filter((o) => !o.flx).map((o) => ({ id: o.id, name: o.name })),
    ...[...this.objectByName.values()].filter((o) => !o.anim).map((o) => ({ id: o.id, name: o.name })),
    ...this.persons.persons.map((p, i) => ({ id: this.personIds[i], name: p.def.name })),
    { id: this.jackId, name: "JACK" },
  ];
  const out: { z: number; c: SpriteCandidate }[] = [];
  for (const { id, name } of named) {
    const sp = this.renderer.sprite(id);
    if (!sp?.visible || !sp.image || sp.w <= 0 || sp.h <= 0) continue;
    out.push({
      z: this.renderer.sprites.indexOf(id),
      c: {
        name,
        pixelHit: spritePixelHit(sp, px, py),
        flagged:
          !!rect &&
          spriteFlagged(
            {
              x: sp.x,
              y: sp.y,
              w: sp.w,
              h: sp.h,
              opaque: (dx, dy) => spritePixelHit(sp, sp.x + dx, sp.y + dy),
            },
            rect,
          ),
      },
    });
  }
  return out.sort((a, b) => a.z - b.z).map((x) => x.c);
}

/** Is an opaque pixel of Jack's sprite under the point (world coordinates)? The test of for Jack's sprite `g_jackSprite`. */
export function jackHit(this: ScenePlayerState, px: number, py: number): boolean {
  const sp = this.renderer.sprite(this.jackId);
  return !!sp?.visible && !!sp.image && sp.w > 0 && sp.h > 0 && spritePixelHit(sp, px, py);
}

/** of Game_Run: what an ANIMAEFFECT entry / a macro of the animation compares with. */
export function animImage(this: ScenePlayerState, o: ObjectSprite): number {
  const a = o.anim!;
  if (a.mode === 3 || a.mode === 4) return a.pos[a.rec] ?? 0;
  return a.index;
}

export function addObjects(this: ScenePlayerState, animate: boolean): void {
  const { ccg, objectAnims } = this.scene;
  const anims = new Map(objectAnims.map((a) => [a.name, a]));
  ccg.objects.slice(0, ccg.count).forEach((o, z) => {
    if (o.flx) {
      addFlxObject.call(this, o, z, anims.get(o.name));
      return;
    }
    if (o.kind !== "graphic" || !this.src.phk.find(o.name)) return;
    const offscreen = o.y >= 480 || o.y < -400;
    // Scene_RefreshBackground skips type -8 objects (their sprite stays invisible until an animation step shows it)
    const pbm16 = o.type === TYPE_PBM_ANIMATED;
    const shown = shownAtSceneStart(o.type, o.y);
    // the demo (M1) leaves out what sits outside the screen; in the game the scripts move it in later
    if (offscreen && !this.scripted) return;
    let img: Image16;
    try {
      img = this.image("phk", o.name, o.type === 8 || o.type === TYPE_PBM_ANIMATED);
    } catch {
      return;
    }
    const scale = o.type === 8 ? o.scale / 1e6 : SCALE_KEEP;
    const id = this.renderer.add(img, z, scale);
    const a = anims.get(o.name);
    const anim = a ? new ObjectAnimation(a) : null;
    const sprite: ObjectSprite = {
      id,
      name: o.name,
      z,
      anim,
      x: o.x,
      y: o.y,
      scale,
      base: img,
      visible: shown,
      pbm16,
      frameFile: null,
      frameDx: 0,
      frameDy: 0,
      buffered: o.type === 8 || pbm16,
      light: 1,
      darkness: GLASS_WHITE,
    };
    if (shown) this.renderer.set(id, o.x, o.y, img, scale);
    this.drawnObjects.add(z);
    this.objectSpriteIds.set(z, id);
    if (!this.objectByName.has(o.name)) this.objectByName.set(o.name, sprite);
    if (anim) {
      if (animate && a) anim.start(a.recs.length ? { mode: 4, delay: 6, rec: 0 } : { mode: 2, delay: 6 });
      this.objects.push(sprite);
    }
  });
}

/**
 * `FLXn` object: no image of its own; ANIMA mode 5/6 plays a .FLX file of its .ACI section on a sprite at the
 * object's position + the frame rectangle's (x, y) (Game_Run, Sprite_Set(g_objAnimSprite[anim]...)).
 * The sprite exists from the start, invisible, so that CHWINDOW can clip it.
 */
function addFlxObject(this: ScenePlayerState, o: SceneObject, z: number, aci: ObjectAnim | undefined): void {
  if (!aci || this.objectByName.has(o.name)) return;
  const blank: Image16 = { width: 1, height: 1, kind: "rgb565", pixels: new Uint16Array(1) };
  const id = this.renderer.add(blank, z, SCALE_KEEP);
  const anim = new ObjectAnimation(aci);
  const sprite: ObjectSprite = {
    id,
    name: o.name,
    z,
    anim,
    x: o.x,
    y: o.y,
    scale: SCALE_KEEP,
    base: blank,
    visible: false,
    frameFile: null,
    frameDx: 0,
    frameDy: 0,
    flx: { play: null, rec: 0 },
    buffered: true,
    light: 1,
    darkness: GLASS_WHITE,
  };
  this.objectByName.set(o.name, sprite);
  this.objects.push(sprite);
}

/**
 * ANIMA mode 5 (once) / 6 (loop) on an FLX slot: record `rec` of its section names the file (Script_ExecStep case 4:
 * `[anim * 300 + rec]`); mode 6 restarts with record 0 whatever `rec` was. The sprite buffer is cleared.
 */
export function startFlxAnim(this: ScenePlayerState, name: string, mode: 5 | 6, delay: number, rec: number): boolean {
  const o = this.objectByName.get(name);
  if (!o?.flx || !o.anim) return false;
  const files = o.anim.anim.images;
  const file = files[rec]?.[0];
  const first = files[0]?.[0];
  if (typeof file !== "string" || typeof first !== "string") return false;
  const load = (f: string) => new Flx(this.src.phk.read(f));
  o.flx.play = new FlxAnimation(load(file), mode === 6, load(first));
  o.flx.rec = rec;
  o.anim.mode = mode;
  o.anim.active = true;
  o.anim.delay = delay;
  o.anim.counter = delay;
  if (o.visible) this.renderer.hide(o.id);
  o.visible = false;
  return true;
}

/** One due FLX step (Game_Run 0x4368xx): the frame counter is the image for ACTIVEMACROANIMA / ANIMAEFFECT. */
export function stepFlx(this: ScenePlayerState, o: ObjectSprite): void {
  const f = o.flx!;
  const play = f.play;
  if (!play || play.isFinished) {
    o.anim!.active = false;
    return;
  }
  this.events.push({ kind: "animFrame", anim: o.name, image: play.counter, rec: f.rec, flx: true });
  const s = play.step();
  stepAnimShadow.call(this, o, !!s.sprite, s.rect, play.header.mode);
  if (s.sprite) {
    const img: Image16 = {
      width: s.sprite.width,
      height: s.sprite.height,
      kind: "rgb565",
      pixels: s.sprite.pixels,
    };
    this.renderer.set(o.id, o.x + s.sprite.x, o.y + s.sprite.y, img, SCALE_KEEP);
    o.visible = true;
  }
  if (s.finished) {
    o.anim!.active = false;
    this.events.push({ kind: "animEnded", anim: o.name, reason: "end" });
  }
}

export function drawObject(this: ScenePlayerState, o: ObjectSprite): void {
  let img = o.frameFile ? this.image("phk", o.frameFile) : o.base;
  if (o.light < 1) img = brightenImage(img, o.light);
  // Game_Run (type -8, g_sceneObjWasPbm16 = 1): the picture is a mask blended over the scene toward the animation's colour
  if (o.pbm16) {
    const x = o.x + o.frameDx;
    const y = o.y + o.frameDy;
    img = blendOverBackdrop(img, this.composeRegion(x, y, img.width, img.height, o.z, o.id), 0, 0, o.darkness);
  }
  this.renderer.set(o.id, o.x + o.frameDx, o.y + o.frameDy, img, o.scale);
  o.visible = true;
}

/**
 *, pass 0: the point (g_clickX, g_clickY, shorts) lies strictly inside the sprite's rectangle
 * (`0 < dx < w`, `0 < dy < h`) and the pixel under it is not transparent. A scaled sprite is sampled at its own
 * resolution; a mirrored one (negative scale) from the other side.
 */
export function spritePixelHit(
  sp: { x: number; y: number; w: number; h: number; scale: number; image?: Surface16 | null },
  px: number,
  py: number,
): boolean {
  const img = sp.image;
  if (!img) return false;
  const dx = Math.trunc(px) - sp.x;
  const dy = Math.trunc(py) - sp.y;
  if (!(dx > 0 && dx < sp.w && dy > 0 && dy < sp.h)) return false;
  let sx = Math.trunc((dx * img.width) / sp.w);
  const sy = Math.trunc((dy * img.height) / sp.h);
  if (sp.scale < 0) sx = img.width - 1 - sx;
  return (img.pixels[sy * strideOf(img) + sx] ?? 0) !== 0;
}
