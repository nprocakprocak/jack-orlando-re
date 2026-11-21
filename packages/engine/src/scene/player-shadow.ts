// Shadows of Jack, of persons, and of objects.

import {
  jackShadow,
  SHADOW_OFFSET_ROUND,
  SHADOW_OFFSET_STILL_X,
  SHADOW_OFFSET_STILL_Y,
  SHADOW_OFFSET_WALK_X,
  SHADOW_OFFSET_WALK_Y,
  shadowDirIndex,
  type ShadowSprite,
} from "../anim";
import type { Image16 } from "../formats/bm";
import type { ShadowCall } from "../persons";
import { type PersonShadow, type ShadowDraw } from "../persons/shadow";
import { blitKeyed, blitScaled, SCALE_KEEP } from "../render";
import { ftol } from "../walk/geometry";
import type { ObjectSprite, ScenePlayerState } from "./player-state";
import { composeShadow, drawAt, flipped } from "./shadow";

// --- shadows: the commands of the scripts and the drawing ----------------------------------

/** The shadow state of a person (null = Jack's first shadow, which the commands treat as one with the second). */
function shadowOf(this: ScenePlayerState, person: number): PersonShadow | undefined {
    return this.persons.persons[person]?.shadow;
}

/**
 * SETSHADOW p n (case 0x12): cancels the fades; n = 0 switches the shadow off and removes its sprite (for Jack only the
 * first one - the game leaves the second), otherwise on with strength n (for Jack both, one strength).
 */
export function setShadow(this: ScenePlayerState, person: number | null, n: number): void {
    if (person === null) {
      for (const st of this.jackShadows) st.setShadow(n);
      if (n === 0 && this.shadowsOn) this.renderer.hide(this.shadowIds[0]);
      return;
    }
    const st = shadowOf.call(this, person);
    if (!st) return;
    if (st.setShadow(n) === "removed" && this.shadowsOn) this.renderer.hide(this.personShadowIds[person]);
}

/** MINSHADOW n p [which] (case 0x8a): fade out over n draws; `which` (0 / 1) picks Jack's shadow. */
export function fadeShadowOut(this: ScenePlayerState, person: number | null, n: number, which = 0): void {
    if (person === null) this.jackShadows[which === 0 ? 0 : 1].fadeOut(n);
    else shadowOf.call(this, person)?.fadeOut(n);
}

/** MAXSHADOW n p [which] (case 0x8b): fade in over n draws. */
export function fadeShadowIn(this: ScenePlayerState, person: number | null, n: number, which = 0): void {
    if (person === null) this.jackShadows[which === 0 ? 0 : 1].fadeIn(n);
    else shadowOf.call(this, person)?.fadeIn(n);
}

/** SETSPECSHADOW p object (case 0x99): the image the object's sprite shows now is the mask of the person's shadow. */
export function setSpecShadow(this: ScenePlayerState, person: number, object: string): boolean {
    const o = this.objectByName.get(object);
    const st = shadowOf.call(this, person);
    const image = o ? this.renderer.sprite(o.id)?.image : undefined;
    if (!st || !image) return false;
    st.useObjectMask();
    this.personMasks[person] = image as Image16;
    return true;
}

/**
 * SHOWSHADOW p x y scale (case 0x9a): the shadow at the point with the given scale, whether the person's shadow
 * is switched on or not; the point is remembered. `x`, `y` are shorts.
 */
export function showShadow(this: ScenePlayerState, person: number, x: number, y: number, scale: number): void {
    const p = this.persons.persons[person];
    if (!p) return;
    p.shadowStatus = true;
    placeShadowAt.call(this, person, x, y, scale);
}

/** HIDESHADOW p (case 0x9c): the flag goes off and the shadow is drawn at (0, 500), below the screen. */
export function hideShadow(this: ScenePlayerState, person: number): void {
    const p = this.persons.persons[person];
    if (!p) return;
    p.shadowStatus = false;
    placeShadowAt.call(this, person, 0, 500, 1);
}

/** SHADOWSTATUS p 0|1 (case 0x9b): only the flag. */
export function setShadowStatus(this: ScenePlayerState, person: number, on: boolean): void {
    const p = this.persons.persons[person];
    if (p) p.shadowStatus = on;
}

function placeShadowAt(this: ScenePlayerState, person: number, x: number, y: number, scale: number): void {
    if (!this.shadowsOn) return;
    const p = this.persons.persons[person];
    p.shadowPoint = { x, y };
    const mask = this.personMasks[person] ?? this.roundMask;
    const d = p.shadow.show({ x, y, personScale: p.scale, lightScale: p.def.lightScale, maskWidth: mask.width, maskHeight: mask.height }, scale);
    putShadow.call(this, this.personShadowIds[person], d, mask, true);
}

/** Person_DrawShadow for one call of a person's step (the state decides whether and how it is drawn). */
export function drawPersonShadow(this: ScenePlayerState, person: number, call: ShadowCall): void {
    const p = this.persons.persons[person];
    const mask = this.personMasks[person] ?? this.roundMask;
    const d = p.shadow.draw(this.shadowsOn, {
      x: call.x, y: call.y, personScale: call.scale, lightScale: p.def.lightScale, maskWidth: mask.width, maskHeight: mask.height,
    });
    if (d) putShadow.call(this, this.personShadowIds[person], d, mask, true);
}

/**
 * Jack_DrawShadow: the animator has chosen image, scale and corner; this applies the shadow's state (off,
 * fading in / out) and draws. Mirrored shadows are drawn from the flipped mask (the game passes a negative column step).
 */
export function drawJackShadow(this: ScenePlayerState, index: 0 | 1, s: ShadowSprite): void {
    const st = this.jackShadows[index];
    if (!this.shadowsOn || (!st.enabled && !st.fadingIn)) return;
    const base = s.round ? this.roundMask : this.image("resource", s.file);
    const mask = s.mirrored ? flipped(base) : base;
    const fading = st.fadingOut || st.fadingIn;
    let d: ShadowDraw | null;
    if (fading) {
      // the scale changes, so the corner has to move round the anchor the animator used
      const [dx, dy] = jackShadowAnchor.call(this, s);
      d = st.draw(true, {
        x: s.x + dx * s.scale, y: s.y + dy * s.scale, personScale: s.fadeBase ?? s.scale, lightScale: 1, levelScale: this.jack.shadowScale,
        maskWidth: mask.width, maskHeight: mask.height,
      });
    } else d = drawAt(s.x, s.y, s.scale, mask.width, mask.height, st.strength);
    putShadow.call(this, this.shadowIds[index], d, mask, true);
}

/** The anchor offsets Jack_DrawShadow subtracted (animator `jackShadow`): the round shadow's, or the tables by mode. */
function jackShadowAnchor(this: ScenePlayerState, s: ShadowSprite): readonly [number, number] {
    if (s.round || this.jack.mode === "insertion") return SHADOW_OFFSET_ROUND;
    const i8 = shadowDirIndex(this.walker.dir, this.walker.mirror);
    return this.jack.mode === "stand" ? [SHADOW_OFFSET_STILL_X[i8], SHADOW_OFFSET_STILL_Y[i8]] : [SHADOW_OFFSET_WALK_X[i8], SHADOW_OFFSET_WALK_Y[i8]];
}

/** Render_ComposeRegionNoFlag + Blit_ShadowDarken + Sprite_Set of a shadow sprite. */
function putShadow(this: ScenePlayerState, id: number, d: ShadowDraw | null, mask: Image16, layered = false): void {
    const one = layered && this.shadowOne ? this.objectByName.get(this.shadowOne) : undefined;
    const img = d && composeShadow(one ? backdropWithSprites.call(this, id, d, one.id) : this.backdrop, d, mask, this.shadowTables);
    if (!d || !img) {
      this.renderer.hide(id);
      return;
    }
    // / Person_DrawShadow with SHADOWONE: the shadow sprite goes up to lie over the object's
    if (one) this.renderer.placeOver(id, one.id);
    this.renderer.set(id, d.x, d.y, img, SCALE_KEEP);
}

/**
 * Render_ComposeRegionNoFlag with a layer limit (SHADOWONE): the background under the shadow with every visible sprite up to the
 * object's (not the shadow's own, not those with the flag +0x1e) drawn over it; a copy of the whole background, which the
 * shadow code indexes by scene coordinates.
 */
function backdropWithSprites(this: ScenePlayerState, shadowId: number, d: ShadowDraw, objectId: number): Image16 {
    const bg = this.backdrop;
    const out: Image16 = { ...bg, pixels: bg.pixels.slice() };
    const items = this.renderer.sprites.items;
    const last = this.renderer.sprites.indexOf(objectId);
    for (let i = 0; i <= last; i++) {
      const sp = items[i];
      if (!sp.visible || !sp.image || sp.kind === "raw" || sp.id === shadowId || sp.flag !== 0) continue;
      const x0 = Math.max(sp.x, sp.clip.left, d.x, 0);
      const x1 = Math.min(sp.x + sp.w, sp.clip.right, d.x + d.width, bg.width);
      const y0 = Math.max(sp.y, sp.clip.top, d.y, 0);
      const y1 = Math.min(sp.y + sp.h, sp.clip.bottom, d.y + d.height, bg.height);
      if (x0 >= x1 || y0 >= y1) continue;
      if (sp.kind === "pal8") {
        const sx = sp.step.int < 0 ? sp.x + sp.w - x1 : x0 - sp.x;
        blitScaled(sp.image, sp.step, sx, y0 - sp.y, x1 - x0, y1 - y0, out, x0, y0);
      } else blitKeyed(sp.image, x0 - sp.x, y0 - sp.y, x1 - x0, y1 - y0, out, x0, y0);
    }
    return out;
}

/**
 * Render_ComposeRegion for the picture of a type -8 object: the part of the scene at (x, y, w, h) as a `w` x `h` picture,
 * the background with every visible sprite whose `z` is at most `maxZ` (the object's own z, not its own sprite) drawn over it. The
 * car windows of SC005 (SZYBY.PBM) thus tint the car body under them, not just the street: the picture is an opaque rectangle
 * (before it showed the bare background and covered SAM_INS.PBM). Persons and Jack (z above the objects) are not in it.
 */
export function composeRegion(this: ScenePlayerState, x: number, y: number, w: number, h: number, maxZ: number, excludeId: number): Image16 {
    const bg = this.backdrop;
    const out: Image16 = { ...bg, width: w, height: h, pixels: new Uint16Array(w * h) };
    for (let r = 0; r < h; r++) {
      const sy = y + r;
      if (sy < 0 || sy >= bg.height) continue;
      for (let c = Math.max(0, -x); c < w && x + c < bg.width; c++) out.pixels[r * w + c] = bg.pixels[sy * bg.width + x + c];
    }
    // "Under the object" is the sprite list as it is now: inserting a person's sprite (Biff's clinch, MWCI) pushes the car and the
    // windows one `z` up, so the static z of the object would drop the car from the picture. Before the object has a sprite
    // (first draw) its static z is the limit.
    const sprites = this.renderer.sprites.items;
    const own = sprites.findIndex((q) => q.id === excludeId);
    for (let i = 0; i < sprites.length; i++) {
      const sp = sprites[i];
      if (own >= 0 ? i >= own : sp.z > maxZ) continue;
      if (!sp.visible || !sp.image || sp.kind === "raw" || sp.id === excludeId) continue;
      const x0 = Math.max(sp.x, sp.clip.left, x);
      const x1 = Math.min(sp.x + sp.w, sp.clip.right, x + w);
      const y0 = Math.max(sp.y, sp.clip.top, y);
      const y1 = Math.min(sp.y + sp.h, sp.clip.bottom, y + h);
      if (x0 >= x1 || y0 >= y1) continue;
      if (sp.kind === "pal8") {
        const sx = sp.step.int < 0 ? sp.x + sp.w - x1 : x0 - sp.x;
        blitScaled(sp.image, sp.step, sx, y0 - sp.y, x1 - x0, y1 - y0, out, x0 - x, y0 - y);
      } else blitKeyed(sp.image, x0 - sp.x, y0 - sp.y, x1 - x0, y1 - y0, out, x0 - x, y0 - y);
    }
    return out;
}

/** SHADOWONE object (case 0x9d): switches the layered composition on for the rest of the scene. */
export function setShadowOne(this: ScenePlayerState, object: string): boolean {
    if (!this.objectByName.has(object)) return false;
    this.shadowOne = object;
    return true;
}

/** The background becomes the player's own before the first shadow is painted on it. */
function ownBackdrop(this: ScenePlayerState): Image16 {
    if (!this.backdropOwned) {
      this.backdrop = { ...this.backdrop, pixels: this.backdrop.pixels.slice() };
      this.renderer.setBackground(this.backdrop);
      this.backdropOwned = true;
    }
    return this.backdrop;
}

/** What / end with: the composed, darkened rectangle is copied back into the background. */
function bakeShadow(this: ScenePlayerState, d: ShadowDraw, mask: Image16): void {
    const bg = ownBackdrop.call(this);
    const img = composeShadow(bg, d, mask, this.shadowTables);
    if (!img) return;
    const x0 = Math.max(d.x, 0);
    const x1 = Math.min(d.x + img.width, bg.width);
    for (let r = 0; r < img.height; r++) {
      const y = d.y + r;
      if (y < 0 || y >= bg.height) continue;
      for (let x = x0; x < x1; x++) bg.pixels[y * bg.width + x] = img.pixels[r * img.width + x - d.x];
    }
    this.renderer.redrawAll();
}

/**
 * SHADOWBY object dx dy level (case 0x11, +): the object's image (a mask) is a shadow baked
 * into the background at the object's position + (dx, dy), 1:1, with the given strength. Not switched off by `shadows`.
 */
export function shadowBy(this: ScenePlayerState, object: string, dx: number, dy: number, level: number): boolean {
    const o = this.objectByName.get(object);
    const mask = o ? (this.renderer.sprite(o.id)?.image as Image16 | null | undefined) : undefined;
    if (!o || !mask) return false;
    const x = o.x + dx;
    const y = o.y + dy;
    const width = mask.width;
    const d: ShadowDraw = {
      scale: 1, x, y, width, height: mask.height, level, stepInt: 1, stepFrac: 0,
      backdrop: { srcX: Math.max(x, 0), srcWidth: Math.min(x + width, this.backdrop.width) - Math.max(x, 0), dstX: Math.max(-x, 0) },
    };
    bakeShadow.call(this, d, mask);
    return true;
}

/** PUTSHADOW x y f (case 0x8c): the round shadow baked into the background, strength of Jack's shadows. */
export function putShadowOnBackground(this: ScenePlayerState, x: number, y: number, scale: number): void {
    const s = Math.fround(scale);
    const [ax, ay] = SHADOW_OFFSET_ROUND;
    const d = drawAt(ftol(x - ax * s), ftol(y - ay * s), s, this.roundMask.width, this.roundMask.height, this.jackShadows[0].strength);
    bakeShadow.call(this, d, this.roundMask);
}

/** SHOWSHADOW / HIDESHADOW EXTRA: a round shadow in a sprite of its own, anchor (60, 15), strength of Jack's. */
export function showExtraShadow(this: ScenePlayerState, x: number, y: number, scale: number): void {
    const s = Math.fround(scale);
    const d = drawAt(ftol(x - 60 * s), ftol(y - 15 * s), s, this.roundMask.width, this.roundMask.height, this.jackShadows[0].strength);
    putShadow.call(this, this.extraShadowId, d, this.roundMask);
}

/**
 * ANIMASHADOW anim person shadow n (case 0x8d): while the FLX animation runs, Jack's shadow (a round one, the standing mode)
 * follows the points of the .ACI section SHADn at the object's position. `shadow` null stops it.
 * `person` null = Jack; for a person only the flag of its shadow changes (nothing draws it).
 */
export function setAnimShadow(this: ScenePlayerState, anim: string, person: number | null, shadow: number | null, clear: boolean): boolean {
    if (!this.objectByName.get(anim)?.flx) return false;
    const p = person === null ? undefined : this.persons.persons[person];
    if (person !== null && !p) return false;
    if (shadow === null) {
      this.animShadows.delete(anim);
      if (p) p.shadowStatus = false;
      return true;
    }
    const points = this.scene.shadows.find((s) => s.index === shadow)?.points;
    if (!points) return false;
    this.animShadows.set(anim, { jack: person === null, person: person ?? -1, points, step: 0, clear });
    if (p) p.shadowStatus = true;
    return true;
}

/** One FLX step of an animation with a shadow: draw Jack's shadow at the point, count; at the end maybe remove it. */
export function stepAnimShadow(this: ScenePlayerState, o: ObjectSprite, drewPixels: boolean, rect: readonly number[], mode: number): void {
    const a = this.animShadows.get(o.name);
    if (!a) return;
    const pt = a.points[a.step];
    if (a.jack && drewPixels && pt) {
      const s = jackShadow({
        index: 0, dir: this.walker.dir, facing: this.walker.mirror,
        x: o.x + pt[0] + (mode === 2 ? rect[0] : 0), y: o.y + pt[1] + (mode === 2 ? rect[1] : 0), walkFrame: null,
        directional: false, twoShadows: false, scale: this.walker.scale, shadowScale: this.jack.shadowScale,
      });
      drawJackShadow.call(this, 0, s);
    }
    if (++a.step >= a.points.length) {
      this.animShadows.delete(o.name);
      if (a.clear && a.jack) this.renderer.hide(this.shadowIds[0]);
    }
}
