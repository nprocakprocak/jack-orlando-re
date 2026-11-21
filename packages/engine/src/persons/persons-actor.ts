import type { InsertionStart } from "../anim/animator";
import type { FrameSprite } from "../anim/jack";
import { placeFrame } from "../anim/jack";
import type { IcsFrame } from "../formats/global";
import { f32, ftol, s16 } from "../walk/geometry";
import { PersonShadow } from "./shadow";
import { walkAngle, Y_SQUASH } from "../walk/walker";
import {
  ARRIVE_DX,
  ARRIVE_DY,
  NO_SHADOW,
  PERSON_MAX_FRAMES,
  SCRIPT_MIN_SCALE,
  WALK_MIN_SCALE,
  effectVolumes,
  personBrightness,
  personDirection,
  personScale,
  personSector,
  type PersonDef,
  type PersonEnv,
  type PersonOptions,
  type PersonSprite,
  type PersonUpdate,
  type ShadowCall,
} from "./persons";

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
  effects: { sound: number; volume: number }[] = Array.from({ length: PERSON_MAX_FRAMES }, () => ({
    sound: -1,
    volume: 0,
  }));
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

  constructor(
    readonly def: PersonDef,
    opts: PersonOptions,
  ) {
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
  private sprite(
    file: string,
    x: number,
    y: number,
    mirrored: boolean,
    env: PersonEnv,
    source: FrameSprite["source"],
    scale = this.scale,
  ): PersonSprite {
    return {
      file,
      source,
      x,
      y,
      scale,
      mirrored,
      brightness: personBrightness(this.x, this.y, env.lights, this.scale, this.def.lightScale, env.brightness),
    };
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
      out.sprite = this.sprite(
        f.file,
        ftol(this.x - hx * this.scale),
        ftol(this.y - f.hotY * this.scale),
        this.facing < 0,
        env,
        "scene",
      );
    }
    const fx = this.effects[frame];
    if (fx && fx.sound >= 0) {
      out.sounds.push({
        sound: fx.sound,
        channels: [1, 2],
        volumes: [...effectVolumes(fx.volume, this.scale, this.x, env.scrollX)],
        kind: "walk",
      });
    }
    if (env.shadows)
      out.shadow = this.nextShadow(this.x + this.shadowDx * this.scale, this.y + this.shadowDy * this.scale);
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
      out.sounds.push({
        sound: e.sound,
        channels,
        volumes: channels.map(() => e.volume),
        kind: "insertion",
      });
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

export { ScenePersons } from "./persons-scene";
