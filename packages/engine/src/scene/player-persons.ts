// Persons, the depth order, and their pictures.

import { brightenPbm, findInsertion } from "../anim";
import type { Image16 } from "../formats/bm";
import { decodePbm } from "../formats/pbm";
import type { Scene } from "../formats/scene";
import { behindByY, personObjectDepth, personObjectDepthInsertion, type PersonUpdate } from "../persons";
import { applyStand, avoidPerson } from "../persons/avoid";
import type { Sprite } from "../render";
import { f32, objectDepth, personDepth, planWalk, type DepthRelation } from "../walk";
import { decodeSceneImage } from "./decode";
import type { ScenePlayerState, TickResult } from "./player-state";
import { drawPersonShadow } from "./player-shadow";

/**
 * PUNDERE / POVERE (Script_ExecStep 0x15 / 0x1c): Sprite_MoveBack / Sprite_MoveFront of the person's sprite
 * (null = Jack) repeated by the distance, only when it lies on the wrong side: it ends directly under / over
 * the object's sprite. The place holds until a depth test of a step finds the sprites overlapping.
 */
export function placeAgainstObject(this: ScenePlayerState, person: number | null, object: string, over: boolean): void {
    const o = this.objectByName.get(object);
    if (!o) return;
    placeSprite.call(this, person === null ? this.jackId : this.personIds[person], o.id, over);
}

/**
 * PUNDERP (Script_ExecStep 0x14): Sprite_MoveBack of the person's sprite until it lies directly under the
 * other person's (null = Jack); nothing happens when it is under already.
 */
export function placeUnderPerson(this: ScenePlayerState, person: number | null, other: number | null): void {
    const to = other === null ? this.jackId : this.personIds[other];
    if (to === undefined) return;
    placeSprite.call(this, person === null ? this.jackId : this.personIds[person], to, false);
}

/** EOVERE (0x3d): Sprite_MoveFront of an object's sprite until it lies directly over another object's. */
export function placeObjectOver(this: ScenePlayerState, object: string, other: string): void {
    const a = this.objectByName.get(object);
    const b = this.objectByName.get(other);
    if (a && b) this.renderer.placeOver(a.id, b.id);
}

/** PUNDERE / POVERE / depth test move only the sprite of the person (Sprite_MoveBack / MoveFront); the shadows stay at the bottom. */
function placeSprite(this: ScenePlayerState, id: number, other: number, over: boolean): void {
    if (over) this.renderer.placeOver(id, other);
    else this.renderer.placeUnder(id, other);
}

/** HIDE person: Sprite_Remove (the next walk or insertion step draws it again). */
export function hidePerson(this: ScenePlayerState, person: number): void {
    const id = this.personIds[person];
    if (id === undefined) return;
    this.renderer.hide(id);
    // Script_ExecStep case 9: the shadow goes too unless SHOWSHADOW / SHADOWSTATUS placed it by hand
    if (this.shadowsOn && !this.persons.persons[person].shadowStatus) this.renderer.hide(this.personShadowIds[person]);
}

/** Scene insertion for a person (RUNINSERTION p name ...). */
export function personInsertion(this: ScenePlayerState, person: number, name: string, dir: 0 | 1 | 2, count?: number, fresh = false): boolean {
    const p = this.persons.persons[person];
    const ins = p ? findInsertion(this.insertions, name, 1) : null;
    if (!p || !ins) return false;
    p.startInsertion(count === undefined ? ins : { ...ins, count: Math.min(count, ins.count) }, dir, fresh);
    if (fresh) this.freshPersons.add(person);
    return true;
}

/**
 * RELATIVEMULP person f (case 0x89): g_personLightScale[person] = f, the factor of the person's light range and shadow size
 * (PCS field 4). Jack (`person` null): g_jackShadowScale, the factor of Jack's shadow size.
 */
export function setPersonLightScale(this: ScenePlayerState, person: number | null, f: number): boolean {
    if (person === null) {
      this.jackShadowScale = f32(f);
      return true;
    }
    const p = this.persons.persons[person];
    if (!p) return false;
    p.def.lightScale = f32(f);
    return true;
}

/**
 * CHKDISTANCE (Jack_AvoidPerson), after every step of a person and every frame of its insertion: a person
 * walking at Jack makes him stop (when it goes away from him) or step aside. The walk is a click's (planWalk +
 * Jack_WalkTo); the flag is set whether or not a path was found.
 */
function checkAvoid(this: ScenePlayerState, i: number): void {
    const p = this.persons.persons[i];
    if (this.playerLocked || !p.checkDistance || this.jackHidden || this.jack.mode === "insertion") return;
    const w = this.walker;
    const r = avoidPerson(
      { x: w.x, y: w.y, scale: w.scale },
      { x: p.x, y: p.y, scale: p.scale, shadowDx: p.shadowDx, shadowDy: p.shadowDy, velX: p.vx, velY: p.vy },
      this.world,
      this.jackAvoiding,
    );
    if (r.kind === "stand") {
      if (this.tj.turn || !w.walking) return;
      applyStand(w);
      this.standJack();
    } else if (r.kind === "walk") {
      // Jack_WalkTo runs whether or not a path is found: it ends the running OUTMACRO macros first (Script_InterruptOutMacros(-1))
      this.events.push({ kind: "jackAvoidWalk" });
      const plan = planWalk(this.world, w, r.target);
      if (plan) this.walkPlan(plan);
      this.jackAvoiding = true;
    }
}

/**
 * Where a caption above a person goes (Script_ExecStep case 10): center x of the sprite, top - 10.
 * `person` is an index of `persons`, null = Jack. Without a drawn sprite the feet position stands in.
 */
export function speakerPoint(this: ScenePlayerState, person: number | null): { x: number; y: number } {
    const id = person === null ? this.jackId : this.personIds[person];
    const sp = id === undefined ? undefined : this.renderer.sprite(id);
    if (sp?.visible && sp.w > 0) return { x: sp.x + Math.trunc(sp.w / 2), y: sp.y - 10 };
    const p = person === null ? this.walker : this.persons.persons[person];
    return { x: Math.trunc(p?.x ?? 320), y: Math.trunc((p?.y ?? 240) - 10) };
}

export function personEnv(this: ScenePlayerState): { scrollX: number; lights: Scene["ccg"]["lights"]; brightness: number; shadows: boolean } {
    return { scrollX: this.scrollX, lights: this.scene.ccg.lights, brightness: this.brightness, shadows: this.shadowsOn };
}

export function tickPersons(this: ScenePlayerState, result: TickResult): void {
    const env = personEnv.call(this);
    this.persons.tick(env).forEach((u, i) => {
      if (u) applyPerson.call(this, i, u, result);
    });
}

export function applyPerson(this: ScenePlayerState, i: number, u: PersonUpdate, result: TickResult): void {
    const s = u.sprite;
    if (s) {
      const img = personImage.call(this, s.file, s.source, s.brightness);
      this.renderer.set(this.personIds[i], s.x, s.y, img, s.mirrored ? -s.scale : s.scale);
    }
    result.personSounds.push(...u.sounds);
    if (u.shadow) drawPersonShadow.call(this, i, u.shadow);
    for (const e of u.events) {
      if (e.kind === "walkArrived") this.events.push({ kind: "personArrived", person: i });
      else this.events.push({ kind: "personInsertionEnded", person: i, name: e.name });
    }
    const p = this.persons.persons[i];
    if (this.insReleaseEarly && u.sprite && p.inserting) {
      // Game_Run: the insertion drew a frame while `insReleaseEarly` was set: it stops and the flag is spent
      p.clearInsertion();
      this.insReleaseEarly = false;
      this.events.push({ kind: "personInsertionReleased", person: i });
    }
    if (u.sprite) {
      arrangePerson.call(this, i, !!u.insertion);
      checkAvoid.call(this, i);
    }
}

/**
 * Drawing order of a person after a step: for every other sprite the person's
 * rectangle overlaps - Jack and other persons by the y of the feet, objects by their floor quads - the sprite
 * moves under / over it when it lies on the wrong side; otherwise the order stays (scripts set it: PUNDERE...).
 */
function arrangePerson(this: ScenePlayerState, i: number, insertion = false): void {
    const p = this.persons.persons[i];
    if (!p.checkDepth) return;
    const id = this.personIds[i];
    const self = this.renderer.sprite(id);
    if (!self?.visible) return;
    for (const other of depthPartners.call(this, self)) {
      let rel: DepthRelation = null;
      let target = other.id;
      if (other.kind === "object" && insertion) {
        if (!this.world.objects[other.index]) continue;
        // after an insertion frame: plain y comparisons with quad corners 0 / 2, not the edge tests of the walking step
        const d = personObjectDepthInsertion(this.world.objects[other.index], p.y);
        const items = this.renderer.sprites.items;
        const me = items.findIndex((s) => s.id === id);
        const them = items.findIndex((s) => s.id === other.id);
        if (d.behind && them < me) placeSprite.call(this, id, other.id, false);
        else if (d.front && them > me) placeSprite.call(this, id, other.id, true);
        continue;
      }
      if (other.kind === "object") rel = personObjectDepth(this.world.objects[other.index], p.x, p.y);
      else if (other.kind === "person") {
        if (other.index === i) continue;
        rel = behindByY(p.y, this.persons.persons[other.index].y);
      } else {
        if (this.jackHidden) continue;
        rel = behindByY(p.y, this.walker.y);
        target = this.jackId;
      }
      if (rel === "behind") placeSprite.call(this, id, target, false);
      else if (rel === "front") placeSprite.call(this, id, target, true);
    }
}

/** Jack and the persons / objects the depth test knows, among the visible sprites overlapping `self`, in list order. */
function depthPartners(this: ScenePlayerState, self: Sprite): { kind: "object" | "person" | "jack"; index: number; id: number }[] {
    const known = new Map<number, { kind: "object" | "person" | "jack"; index: number; id: number }>();
    for (const [k, id] of this.objectSpriteIds) known.set(id, { kind: "object", index: k, id });
    this.personIds.forEach((id, k) => known.set(id, { kind: "person", index: k, id }));
    known.set(this.jackId, { kind: "jack", index: 0, id: this.jackId });
    const out: { kind: "object" | "person" | "jack"; index: number; id: number }[] = [];
    for (const sp of [...this.renderer.sprites.items]) {
      const k = known.get(sp.id);
      if (!k || sp.id === self.id || !sp.visible || !sp.image) continue;
      if (sp.x < self.x + self.w && self.x < sp.x + sp.w && sp.y < self.y + self.h && self.y < sp.y + sp.h) out.push(k);
    }
    return out;
}

function personImage(this: ScenePlayerState, file: string, source: string, brightness: number): Image16 {
    const pak = source === "scene" ? (this.src.phk.find(file) ? this.src.phk : this.src.ph2) : source === "global" ? this.src.global : this.src.resource;
    if (!pak) throw new Error(`${this.src.name}: no archive for ${source}:${file}`);
    if (brightness < 1) return decodePbm(brightenPbm(pak.read(file), brightness), file);
    const key = `${source}:${file}`;
    let img = this.cache.get(key);
    if (!img) {
      const data = pak.read(file);
      img = decodeSceneImage(data, file);
      this.cache.set(key, img);
    }
    return img;
}

/**
 * Jack against the sprites his rectangle overlaps (Game_Run, again): persons by the y of the
 * feet, objects by their floor quads. Like the original it never sorts: Jack's sprite (and his
 * shadows) moves under / over the other one only when it lies on the wrong side.
 */
export function arrangeJack(this: ScenePlayerState, edgesOnly = false): void {
    if (this.jackHidden || !this.jackCheckDepth) return;
    const self = this.renderer.sprite(this.jackId);
    if (!self?.visible) return;
    const at = { x: Math.trunc(this.walker.x), y: Math.trunc(this.walker.y) };
    for (const other of depthPartners.call(this, self)) {
      let rel: DepthRelation = null;
      if (other.kind === "object") rel = edgesOnly ? personObjectDepth(this.world.objects[other.index], at.x, at.y) : objectDepth(this.world.objects[other.index], at);
      else if (other.kind === "person") rel = personDepth(this.walker.y, this.persons.persons[other.index].y);
      if (rel !== null) placeSprite.call(this, this.jackId, other.id, rel === "front");
    }
}
