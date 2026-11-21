// Scene object animations from .ACI, played as Game_Run does after the
// script command Anima (Script_ExecStep case 4).
import type { ObjectAnim } from "../formats/scene";

/**
 * 1 = images 0..n-1 once, 2 = images in a loop, 3 = a REC sequence once,
 * 4 = a REC sequence in a loop. 5/6 are .FLX animations, not handled here.
 */
export type AnimMode = 1 | 2 | 3 | 4;
/** Mode after SceneAnim_LoadObject, before any Anima command. */
export const LOADED_MODE = 3;

export interface AnimaArgs {
  mode: AnimMode;
  /** ticks per frame */
  delay: number;
  /** play backwards (first argument != 0): step -1 from the last image / REC position */
  backward?: boolean;
  /** REC sequence for modes 3/4 */
  rec?: number;
}

/** AnimaEffect: a sound at one position (REC position for modes 3/4, image index for 1/2) of one REC. */
export interface AnimEffect {
  frame: number;
  rec: number;
  sound: string;
  /** 0 = channels 1 and 2 */
  channel: number;
  volume: number;
}

export interface ObjectFrame {
  /** image index: 0 = the object's own CCG image, i = ACI image i */
  index: number;
  /** null for index 0 (the CCG image) */
  file: string | null;
  /** offset from the object's CCG position */
  dx: number;
  dy: number;
  /** differs from the previously drawn index (the game redraws only then) */
  changed: boolean;
}

export interface ObjectTick {
  frame?: ObjectFrame;
  sounds: AnimEffect[];
  /** the animation stopped: "end" (mode 1/3 ran out; the waiting macro continues), "stop" (stop marker) */
  stopped?: "end" | "stop";
}

export class ObjectAnimation {
  /** */
  active = false;
  mode: AnimMode | number = LOADED_MODE;
  delay = 0;
  /** decremented every tick for every animation, active or not */
  counter = 0;
  /** */
  step = 1;
  /** current image index */
  index = 0;
  /** */
  rec = 0;
  /** [rec]: position in each REC sequence */
  readonly pos: number[];
  /** */
  private drawn = -1;
  /** /: stop when the REC position reaches stopAt (script command 0x38) */
  stopAt: number | null = null;
  /** stop at the next negative REC value (script command 0x3a) */
  stopAtMarker = false;
  effects: AnimEffect[] = [];

  constructor(readonly anim: ObjectAnim) {
    this.pos = anim.recs.map(() => 0);
  }

  /** images including the object's own (index 0). */
  get imageCount(): number {
    return 1 + this.anim.images.length;
  }

  image(index: number): Omit<ObjectFrame, "changed"> {
    if (index === 0) return { index, file: null, dx: 0, dy: 0 };
    const img = this.anim.images[index - 1];
    // REC values 0 or past the images (2 in the data) index outside the game's table
    if (!img) return { index, file: null, dx: 0, dy: 0 };
    return { index, file: String(img[0]), dx: Number(img[1]), dy: Number(img[2]) };
  }

  /** Script_ExecStep case 4 (Anima). */
  start(a: AnimaArgs): void {
    this.active = true;
    this.delay = a.delay;
    this.counter = a.delay;
    this.mode = a.mode;
    const rec = a.rec ?? 0;
    const seq = this.anim.recs[rec];
    const isRec = a.mode === 3 || a.mode === 4;
    if (isRec && !seq) throw new RangeError(`${this.anim.name}: no REC ${rec}`);
    if (!a.backward) {
      this.step = 1;
      this.index = 0;
      if (isRec) {
        this.index = seq[0] - 1; // the loader made seq[0] positive
        this.pos[rec] = 0;
        this.rec = rec;
      }
    } else {
      this.step = -1;
      this.index = this.imageCount - 1;
      if (isRec) {
        // no abs here: a negative last value gives a negative index
        this.index = seq[seq.length - 1] - 1;
        this.pos[rec] = seq.length - 1;
        this.rec = rec;
      }
    }
  }

  /** Script_ExecStep case 5: stop (the state stays for a later resume). */
  stop(): void {
    this.active = false;
  }

  /** Script_ExecStep case 0x3b (SetFrame) for 8-bit objects: image index (modes 1/2) or REC position. */
  setFrame(rec: number, value: number): void {
    if (this.mode === 1 || this.mode === 2) this.index = value;
    else if (this.mode === 3 || this.mode === 4) {
      this.pos[rec] = value;
      this.index = Math.abs(this.anim.recs[rec][value]) - 1;
    } else this.index = value;
  }

  /** One 15-ms tick. */
  tick(): ObjectTick {
    this.counter--;
    if (!this.active || this.counter > 0) return { sounds: [] };
    const isRec = this.mode === 3 || this.mode === 4;
    const at = isRec ? this.pos[this.rec] : this.index;
    const sounds = this.effects.filter((e) => e.frame === at && e.rec === this.rec);
    this.counter = this.delay;
    const img = this.image(this.index);
    const frame: ObjectFrame = { ...img, changed: this.index !== this.drawn };
    this.drawn = this.index;
    const out: ObjectTick = { frame, sounds };
    if (isRec) this.advanceRec(out);
    else if (this.mode === 1 || this.mode === 2) this.advanceImages(out);
    return out;
  }

  /** */
  private advanceRec(out: ObjectTick): void {
    const seq = this.anim.recs[this.rec];
    let p = this.pos[this.rec] + this.step;
    this.pos[this.rec] = p;
    if (this.stopAt !== null && p === this.stopAt) {
      this.active = false;
      this.stopAt = null;
      out.stopped = "stop";
      this.index = Math.abs(seq[Math.min(Math.max(p, 0), seq.length - 1)]) - 1;
      return;
    }
    if (p >= seq.length) {
      if (this.mode === 3) {
        this.active = false;
        out.stopped = "end";
      } else p = 0;
    }
    if (p < 0) {
      if (this.mode === 3) {
        this.active = false;
        out.stopped = "end";
      } else p = seq.length - 1;
    }
    this.pos[this.rec] = p;
    // the game reads seq[p] even after a mode-3 end (one past the sequence); we clamp
    let v = seq[Math.min(Math.max(p, 0), seq.length - 1)];
    if (v < 0) {
      v = -v;
      if (this.stopAtMarker) {
        this.active = false;
        this.stopAtMarker = false;
        out.stopped ??= "stop";
      }
    }
    this.index = v - 1;
  }

  /** */
  private advanceImages(out: ObjectTick): void {
    let i = this.index + this.step;
    if (i >= this.imageCount) {
      if (this.mode === 1) {
        this.active = false;
        out.stopped = "end";
      } else i = 0;
    }
    if (i < 0) {
      if (this.mode === 1) {
        this.active = false;
        out.stopped = "end";
      } else i = this.imageCount - 1;
    }
    this.index = i;
  }
}

/** All object animations of a scene, by object name. */
export function sceneAnimations(anims: readonly ObjectAnim[]): Map<string, ObjectAnimation> {
  return new Map(anims.map((a) => [a.name, new ObjectAnimation(a)]));
}
