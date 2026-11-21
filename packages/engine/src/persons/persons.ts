// Scene persons from <scene>.PCS: walking, drawing and insertion (.ICS) playback. The per-person
// tick is Game_Run (walking) and (insertions); the walk
// start is, the script commands are cases of Script_ExecStep.
// Pure logic, no DOM; positions are floats.
import type { InsertionStart } from "../anim/animator";
import type { FrameSprite } from "../anim/jack";
import { placeFrame } from "../anim/jack";
import type { IcsFrame } from "../formats/global";
import type { Person } from "../formats/scene";
import { f32, ftol, s16 } from "../walk/geometry";
import { PersonShadow } from "./shadow";
import { walkAngle, Y_SQUASH } from "../walk/walker";

/** Persons per scene (the per-person tables are 0x11 entries long, clears 0x11 blocks). */
export const MAX_PERSONS = 17;
/** Directions per person (0x240 / 0x48) and frames per direction (0x48 / 4). */
export const PERSON_DIRS = 8;
export const PERSON_MAX_FRAMES = 18;
/** Arrival window of a walk: |dx| < 10 and |dy| < 5. */
export const ARRIVE_DX = 10;
export const ARRIVE_DY = 5;
/** Scale clamp of the walk step (= 0.01 1.0); script commands clamp at 0.1. */
export const WALK_MIN_SCALE = f32(0.01);
export const SCRIPT_MIN_SCALE = f32(0.1);
/** "no shadow" marker of insertion frames (shadow offsets >= 1000). */
export const NO_SHADOW = 1000;

/** One PCS frame: the image and its hot spot (x for facing 1, x for the mirrored image, y). */
export interface PersonFrame {
  file: string;
  hotRight: number;
  hotLeft: number;
  hotY: number;
}

/** A [NAME] block of a .PCS file (Scene_LoadPcs). */
export interface PersonDef {
  name: string;
  framesPerDir: number;
  /** PCS field 3 (`tryb`): < 2 → shadow mask of 12000 B, else `mode * 2` B */
  mode: number;
  /** PCS field 4 (float): multiplies the light range */
  lightScale: number;
  /** PCS field 5: the game pre-scales the image ; the sprite is the same */
  prescale: boolean;
  /** frames per direction 0..7, null = direction missing (851de0 pointer 0) */
  dirs: (PersonFrame[] | null)[];
}

/** Person block of the parsed scene → PersonDef (later duplicate directions replace earlier ones). */
export function personDef(p: Person): PersonDef {
  const dirs: (PersonFrame[] | null)[] = Array.from({ length: PERSON_DIRS }, () => null);
  for (const d of p.directions) {
    if (d.dir < 0 || d.dir >= PERSON_DIRS) continue;
    dirs[d.dir] = d.frames.map((f) => ({ file: String(f[0]), hotRight: Number(f[1]), hotLeft: Number(f[2]), hotY: Number(f[3]) }));
  }
  return {
    name: p.name,
    framesPerDir: p.framesPerDir,
    mode: p.mode ?? 0,
    lightScale: f32(p.scale / 1e6),
    prescale: (p.flag ?? 0) !== 0,
    dirs,
  };
}

/** Sector bounds read by from as shorts: the 8 bounds, then the bytes after them. */
export const PERSON_SECTOR_BOUNDS = [22, 67, 112, 157, 202, 248, 292, 338, 15408] as const;

/**
 * Wanted direction for a walk angle in whole degrees: the first k with
 * bounds[k] <= deg <= bounds[k+1] gives (k + 7) & 7; no match (0..21 degrees) gives 6.
 * 0 = towards the viewer, 2 = left, 4 = away, 6 = right (angle 0 = right, 90 = down).
 */
export function personSector(deg: number): number {
  for (let k = 0; k < 8; k++) {
    if (PERSON_SECTOR_BOUNDS[k] <= deg && deg <= PERSON_SECTOR_BOUNDS[k + 1]) return (k + 7) & 7;
  }
  return 6;
}

/** per wanted direction up to 5 candidates; negative = use |v| mirrored, 100 = end. */
export const PERSON_DIR_FALLBACK: readonly (readonly number[])[] = [
  [1, 7, 100, 100, 100],
  [-7, 0, 2, -6, 100],
  [-6, 1, 3, -5, -7],
  [-5, 2, 4, -6, 100],
  [3, 5, 100, 100, 100],
  [-3, 4, 6, -2, 100],
  [-2, 5, 7, -1, -3],
  [-1, 0, 6, -2, 100],
];

/**
 * Direction and mirror used for a wanted direction `e`: `e` itself when the person has frames
 * for it, else the first usable fallback candidate (a negative one mirrors the images). When
 * nothing fits the previous direction stays (null) and the mirror is 1.
 */
export function personDirection(e: number, has: (dir: number) => boolean): { dir: number; facing: 1 | -1 } | null {
  if (has(e)) return { dir: e, facing: 1 };
  for (const cand of PERSON_DIR_FALLBACK[e] ?? []) {
    if (cand === 100) continue;
    const dir = Math.abs(cand);
    if (has(dir)) return { dir, facing: cand < 0 ? -1 : 1 };
  }
  return null;
}

/** Perspective scale of a person: float((y - horizon) * refScale / (refY - horizon)). */
export function personScale(y: number, horizon: number, refScale: number, refY: number): number {
  return f32(((y - horizon) * refScale) / (refY - horizon));
}

/** Effect volumes [channel 1, channel 2] at x: panned over the visible 640 px. */
export function effectVolumes(volume: number, scale: number, x: number, scrollX: number): [number, number] {
  const span = scrollX + 640;
  return [ftol((volume * scale * (640 - x + scrollX)) / span), ftol((volume * scale * x) / span)];
}

/** Brightness factor [i]: base + up to 1 near a light; range = trunc(scale * 300 * PCS scale). */
export function personBrightness(x: number, y: number, lights: readonly (readonly number[])[], scale: number, lightScale: number, base: number): number {
  let near = 1000;
  for (const [lx, ly] of lights) {
    const dx = s16(ftol(x - lx));
    const dy = s16(ftol((y - ly) * 3));
    const d = s16(ftol(Math.sqrt(dx * dx + dy * dy)));
    if (d < near) near = d;
  }
  const range = s16(ftol(f32(scale) * 300 * lightScale));
  return near < range ? f32((range - near) / range + base) : base;
}

// --- state --------------------------------------------------------------------------------

export interface PersonSprite extends FrameSprite {
  /** palette brightness: rescale the frame's palette (brightenPbm) when < 1 */
  brightness: number;
}

export interface PersonSound {
  /** walk effect: slot of the scene sound table ; insertion effect: name from the .SSD */
  sound: number | string;
  channels: number[];
  /** one volume per channel */
  volumes: number[];
  kind: "walk" | "insertion";
}

/** One call of the shadow routine Person_DrawShadow (the scene draws it through `ScenePerson.shadow`). */
export interface ShadowCall {
  x: number;
  y: number;
  /** person scale at the time of the call */
  scale: number;
  /** [i], grows with every shadow update */
  phase: number;
}

export type PersonEvent = { kind: "walkArrived" } | { kind: "insertionEnded"; name: string };

export interface PersonUpdate {
  /** new Sprite_Set of the person's sprite */
  sprite?: PersonSprite;
  sounds: PersonSound[];
  shadow?: ShadowCall | null;
  events: PersonEvent[];
  /** the update comes from the insertion part of Game_Run: its order test against objects differs */
  insertion?: boolean;
}

export interface PersonEnv {
  /** scroll offset */
  scrollX: number;
  /** [swiatlo] positions of the scene */
  lights: readonly (readonly number[])[];
  /** g_sceneBrightness */
  brightness: number;
  /** g_shadowsOn */
  shadows: boolean;
}

export interface PersonOptions {
  /** perspective horizon at scene load (copied to [i]) */
  horizon: number;
}

interface Insertion extends InsertionStart {
  cur: number;
  end: number;
}

/** The state of one person: the arrays indexed by person, gathered. */
export class ScenePerson {
  /** position (floats) */
  x = 0;
  y = 0;
  /** walk target */
  targetX = 0;
  targetY = 0;
  moving = false;
  /** current frame (shown by the next step) */
  frame = 0;
  /** direction in use and mirror (±1) */
  dir = 0;
  facing: 1 | -1 = 1;
  /** mirror before the last walk start */
  prevFacing: 1 | -1 = 1;
  /** per-step velocity / */
  vx = 0;
  vy = 0;
  /** SETPERSONDATA: ticks between steps, refY, step length */
  delay = 0;
  refY = 0;
  speed = 0;
  /** reference scale (SETPERSONDATA's float) */
  refScale = 1;
  /** perspective horizon (SETPERSPY) */
  horizon: number;
  /** scale */
  scale = 0;
  /** f == 3.0: the walk step does not recompute the scale */
  fixedScale = false;
  /** f == 2.0: scale is 1 */
  noScale = false;
  /** the scale the person had when SETPERSONDATA f = 2 switched it off (null: it never had one) */
  /** SETDIRWALK: frames run backwards */
  reverse = false;
  /** SHOWFRAME: one step without moving */
  showFrame = false;
  /** SETCHKPRIOR (1 at scene start): order against other sprites */
  checkDepth = true;
  /** CHKDISTANCE: Jack steps away from a walking person (not reproduced) */
  checkDistance = false;
  /** step timer (15 ms ticks) */
  counter = 0;
  /** walk effects / per frame: scene sound slot and volume; sound < 0 = none */
  effects: { sound: number; volume: number }[] = Array.from({ length: PERSON_MAX_FRAMES }, () => ({ sound: -1, volume: 0 }));
  /** shadow offsets / */
  shadowDx = 0;
  shadowDy = 0;
  shadowPhase = 0;
  /** state of the shadow commands (SETSHADOW, MINSHADOW, SETSPECSHADOW...) and of Person_DrawShadow: */
  readonly shadow: PersonShadow;
  /** (SHOWSHADOW, SHADOWSTATUS, HIDESHADOW): the shadow is placed by the script; HIDE leaves its sprite */
  shadowStatus = false;
  /** /: the point of the last Person_DrawShadow call (the foot point plus the shadow offset) */
  shadowPoint = { x: 0, y: 0 };
  /** direction of the running insertion */
  insFacing: 1 | -1 = 1;
  private ins: Insertion | null = null;

  constructor(readonly def: PersonDef, opts: PersonOptions) {
    this.horizon = opts.horizon;
    this.shadow = new PersonShadow(def.mode);
  }

  get inserting(): boolean {
    return this.ins !== null;
  }
  get insertionName(): string | undefined {
    return this.ins?.name;
  }

  /** has frames for the direction (851de0[dir][0] != 0) */
  hasDir(dir: number): boolean {
    return !!this.def.dirs[dir]?.length;
  }

  private perspectiveScale(): number {
    return personScale(this.y, this.horizon, this.refScale, this.refY);
  }

  private clampedScale(): number {
    const s = this.perspectiveScale();
    return s < SCRIPT_MIN_SCALE ? SCRIPT_MIN_SCALE : s > 1 ? 1 : s;
  }

  /** SETPOSITION: float position, perspective scale clamped to 0.1..1 (unless fixed). */
  setPosition(x: number, y: number): void {
    this.x = f32(x);
    this.y = f32(y);
    if (this.fixedScale) return;
    this.scale = this.noScale ? 1 : this.clampedScale();
  }

  /** MOVEP: shift the float position (case 0x37). */
  movePosition(dx: number, dy: number): void {
    this.x = f32(this.x + dx);
    this.y = f32(this.y + dy);
  }

  /**
 * SETPERSONDATA delay refY speed f (case 3): `f` 3.0 = the scale is no longer recomputed,
 * 2.0 = scale 1, else the reference scale (the new scale is not clamped here).
 */
  setPersonData(delay: number, refY: number, speed: number, f: number): void {
    this.delay = delay;
    this.refY = refY;
    this.speed = speed;
    if (f === 3) {
      this.fixedScale = true;
      return;
    }
    this.fixedScale = false;
    if (f === 2) {
      this.noScale = true;
      return;
    }
    this.noScale = false;
    this.refScale = f32(f);
    this.scale = this.perspectiveScale();
  }

  /** SETPERSPY: lower perspective horizon of this person. */
  setHorizon(y: number): void {
    this.horizon = y;
  }

  /** SETFRAME for persons (case 0x27): mode 0 = as given, 2 = (f+6)%12 when mirrored, 4 = same with the previous mirror. */
  setFrame(frame: number, mode: 0 | 2 | 4): void {
    if (mode === 0) this.frame = frame;
    else if (mode === 2) this.frame = this.facing === 1 ? frame : (frame + 6) % 12;
    else this.frame = this.prevFacing === 1 ? frame : (frame + 6) % 12;
  }

  /** SHOWFRAME: show frame `frame` at the next step without moving. */
  show(frame: number): void {
    this.showFrame = true;
    this.frame = frame;
  }

  /** WALKEFFECT (case 0x41): scene sound slot and volume of a walk frame; sound < 0 clears it (slot 0 is a sound: KROK1.SND). */
  setWalkEffect(frame: number, sound: number, volume: number): void {
    this.effects[frame] = sound < 0 ? { sound: -1, volume: 0 } : { sound, volume };
  }

  /**
 * start walking to (tx, ty). `forced` = WALKTODIR's direction (0..7) instead of
 * the one from the angle. Chooses direction and mirror, sets the velocity.
 */
  startWalk(tx: number, ty: number, forced?: number): void {
    this.targetX = s16(tx);
    this.targetY = s16(ty);
    this.moving = true;
    this.prevFacing = this.facing;
    this.facing = 1;
    const { rad, deg } = walkAngle(this.x, this.y, this.targetX, this.targetY);
    const pick = personDirection(forced !== undefined ? forced : personSector(deg), (d) => this.hasDir(d));
    if (pick) {
      this.dir = pick.dir;
      this.facing = pick.facing;
    }
    this.vx = f32(Math.cos(rad) * this.speed);
    this.vy = f32(Math.sin(rad) * this.speed * Y_SQUASH);
  }

  /**
 * INITFIRST (`fresh`, Script_ExecStep case 2) / RUNINSERTION (case 7) on a person: `dir` 0 = right (1),
 * 1 = left (-1), 2 = the person's mirror. Only INITFIRST zeroes the step timer and recomputes the scale (perspective
 * clamped to 0.1..1, 1.0 with f = 2; the fixed-scale flag f = 3 is not checked). RUNINSERTION touches neither: the insertion is
 * drawn with the scale the person already has - from the last SETPOSITION, SETPERSONDATA, walking step or INITFIRST - even
 * after a MOVEP (SC116 [MAJOR]: `MOVEP MAJOR 35 17` between OBROT_MAJOR and OBROT_MAJOR1 keeps 0.711;), and its first
 * frame waits for the timer left by the last step.
 */
  startInsertion(ins: InsertionStart, dir: 0 | 1 | 2, fresh = false): void {
    if (ins.start < 0 || ins.count < 0 || ins.start + ins.count > ins.frames.length) {
      throw new Error(`insertion ${ins.name ?? ""} ${ins.start}+${ins.count} outside ${ins.frames.length} frames`);
    }
    this.ins = { ...ins, cur: ins.start, end: ins.start + ins.count };
    if (fresh) {
      this.counter = 0;
      this.scale = this.noScale ? 1 : this.clampedScale();
    }
    this.insFacing = dir === 0 ? 1 : dir === 1 ? -1 : this.facing;
  }

  /** Drop a running insertion without events (scene change). */
  clearInsertion(): void {
    this.ins = null;
  }

  /** Game_TimerTick: the step timer counts down once per 15 ms tick. */
  countdown(): void {
    if (this.counter > 0) this.counter--;
  }

  /** Game_Run: does the walking part run this tick? */
  get walkDue(): boolean {
    if (this.moving && this.counter <= 0 && !this.inserting) return true;
    return this.showFrame;
  }

  /** Game_Run: does the insertion part run this tick? */
  get insertionDue(): boolean {
    return this.ins !== null && this.counter <= 0;
  }

  /** `scale` = the scale the frame is drawn with; the light is computed from the person's own scale before any override. */
  private sprite(file: string, x: number, y: number, mirrored: boolean, env: PersonEnv, source: FrameSprite["source"], scale = this.scale): PersonSprite {
    return { file, source, x, y, scale, mirrored, brightness: personBrightness(this.x, this.y, env.lights, this.scale, this.def.lightScale, env.brightness) };
  }

  /** Game_Run: one walking step. */
  walkStep(env: PersonEnv): PersonUpdate {
    const out: PersonUpdate = { sounds: [], events: [] };
    const frame = this.frame;
    this.counter = this.delay;
    const adx = Math.abs(s16(ftol(this.x - this.targetX)));
    const ady = Math.abs(s16(ftol(this.y - this.targetY)));
    if (adx < ARRIVE_DX && ady < ARRIVE_DY && !this.showFrame) {
      this.moving = false;
      out.events.push({ kind: "walkArrived" });
    }
    if (this.noScale) this.scale = 1;
    else if (!this.fixedScale) {
      let s = this.perspectiveScale();
      if (s < WALK_MIN_SCALE) s = WALK_MIN_SCALE;
      if (s > 1) s = 1;
      this.scale = s;
    }
    if (!this.showFrame) {
      this.x = f32(this.x + this.vx * this.scale);
      this.y = f32(this.y + this.vy * this.scale);
    }
    const f = this.def.dirs[this.dir]?.[frame];
    if (f) {
      const hx = this.facing === -1 ? f.hotLeft : f.hotRight;
      out.sprite = this.sprite(f.file, ftol(this.x - hx * this.scale), ftol(this.y - f.hotY * this.scale), this.facing < 0, env, "scene");
    }
    const fx = this.effects[frame];
    if (fx && fx.sound >= 0) {
      out.sounds.push({ sound: fx.sound, channels: [1, 2], volumes: [...effectVolumes(fx.volume, this.scale, this.x, env.scrollX)], kind: "walk" });
    }
    if (env.shadows) out.shadow = this.nextShadow(this.x + this.shadowDx * this.scale, this.y + this.shadowDy * this.scale);
    const n = this.def.framesPerDir;
    if (this.reverse) {
      this.frame--;
      if (this.frame < 0) this.frame = n - 1;
    } else {
      this.frame++;
      if (this.frame >= n) this.frame = 0;
    }
    this.showFrame = false;
    return out;
  }

  private nextShadow(x: number, y: number, scale = this.scale): ShadowCall {
    const s = { x: ftol(x), y: ftol(y), scale, phase: this.shadowPhase };
    this.shadowPoint = { x: s.x, y: s.y };
    this.shadowPhase = (this.shadowPhase + 1) & 0x7fff;
    return s;
  }

  /** Game_Run: one insertion step (frame effect, end test, draw, shadow). */
  insertionStep(env: PersonEnv): PersonUpdate {
    const ins = this.ins!;
    const out: PersonUpdate = { sounds: [], events: [], insertion: true };
    const fr: IcsFrame | undefined = ins.frames[ins.cur];
    // as for Jack, the effect of g_insFrames[cur] plays before the end test
    if (fr?.effect) {
      const e = fr.effect;
      const channels = e.channel === 0 ? [1, 2] : [e.channel];
      out.sounds.push({ sound: e.sound, channels, volumes: channels.map(() => e.volume), kind: "insertion" });
    }
    if (ins.cur + 1 > ins.end) {
      this.ins = null;
      out.events.push({ kind: "insertionEnded", name: ins.name ?? "" });
      return out;
    }
    this.counter = this.delay;
    // /: Game_Run keeps the person's own scale in, sets 1.0 while drawing when f = 2
    // and puts the own scale back after the frame (is only a temporary). With RUNINSERTION not touching the scale
    // the own scale may differ from 1.0 here, e.g. f = 2 set after the last SETPOSITION.
    const own = this.scale;
    const k = this.noScale ? 1 : own;
    // truncating, unlike Jack's insertion frames (+0.5)
    const [px, py] = placeFrame(this.x, this.y, [fr.xRight, fr.xLeft, fr.y], this.insFacing, k, false);
    out.sprite = this.sprite(fr.file, px, py, this.insFacing < 0, env, ins.global ? "global" : "scene", k);
    if (env.shadows && fr.shadow1[0] < NO_SHADOW) {
      const sx = this.insFacing === 1 ? this.x + fr.shadow1[0] * k : this.x - fr.shadow1[0] * k;
      // the offset d, e is scaled unless f = 2, the shadow itself has the restored own scale times RELATIVEMULP
      // (Person_DrawShadow: *). 1.0 after INITFIRST / SETPOSITION / a walking step with f = 2 (SC083);
      // the scale from before f = 2 when only RUNINSERTION followed
      out.shadow = this.nextShadow(sx, this.y + fr.shadow1[1] * k, own);
    }
    ins.cur++;
    return out;
  }
}

// --- the scene's persons ---------------------------------------------------------------------

function merge(a: PersonUpdate, b: PersonUpdate): PersonUpdate {
  return { sprite: b.sprite ?? a.sprite, sounds: [...a.sounds, ...b.sounds], shadow: b.shadow !== undefined ? b.shadow : a.shadow, events: [...a.events, ...b.events] };
}

/** All persons of a scene, ticked like Game_Run: every walking part first, then every insertion part. */
export class ScenePersons {
  readonly persons: ScenePerson[];
  private byName = new Map<string, number>();

  constructor(defs: readonly PersonDef[], opts: PersonOptions) {
    if (defs.length > MAX_PERSONS) throw new Error(`${defs.length} persons, the game has room for ${MAX_PERSONS}`);
    this.persons = defs.map((d) => new ScenePerson(d, opts));
    // Script_FindPerson returns the FIRST person of that name: SC083's .PCS has two GANGSTER sections
    defs.forEach((d, i) => {
      if (!this.byName.has(d.name)) this.byName.set(d.name, i);
    });
  }

  /** Script_FindPerson: index of the first person with that name, -1 when missing. */
  find(name: string): number {
    return this.byName.get(name) ?? -1;
  }

  get(name: string): ScenePerson | undefined {
    const i = this.find(name);
    return i < 0 ? undefined : this.persons[i];
  }

  /** One 15 ms tick: timers, walking steps, insertion steps. Result index = person index. */
  tick(env: PersonEnv): (PersonUpdate | null)[] {
    const res: (PersonUpdate | null)[] = this.persons.map(() => null);
    for (const p of this.persons) p.countdown();
    this.persons.forEach((p, i) => {
      if (p.walkDue) res[i] = p.walkStep(env);
    });
    this.persons.forEach((p, i) => {
      if (!p.insertionDue) return;
      const u = p.insertionStep(env);
      const prev = res[i];
      res[i] = prev ? merge(prev, u) : u;
    });
    return res;
  }
}
