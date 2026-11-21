// Jack's animation state: standing, walking and insertions (.ICS), as Game_Run drives them.
// Behaviour and addresses:
import { NO_SHADOW, type HotSpot, type IcsFrame } from "../formats/global";
import {
  f32,
  ftol,
  jackShadow,
  placeFrame,
  standFrameFile,
  standHotSpot,
  STAND_SCALE,
  stepVolumes,
  WALK_FRAME_AFTER_STAND,
  WALK_FRAMES,
  walkFrameFile,
  type Facing,
  type FrameSprite,
  type JackDir,
  type ShadowSprite,
} from "./jack";

/** g_insFrameDelay: ticks per frame.data holds 4; and scripts (SetPersonData) set 5. */
export const DEFAULT_FRAME_DELAY = 5;
/** WalkSpeed (registry): subtracted from the delay while walking. */
export const DEFAULT_WALK_SPEED = 1;
/** Scale clamp of global insertion frames. */
export const MIN_SCALE = 0.1;

/** Where Jack is: float position, direction, walk facing, perspective scale. */
export interface JackPose {
  x: number;
  y: number;
  dir: JackDir;
  facing: Facing;
  scale: number;
}

export type JackMode = "stand" | "walk" | "insertion";

export interface SoundEvent {
  /** .SND name: scene .SSD entry, GLOBAL.PAK name for global insertions, or a footstep sound */
  sound: string;
  /** the game plays the same sound on every listed channel */
  channels: number[];
  /** one volume per channel (0..64 before Sound_PlayIndexed's own doubling/clamp) */
  volumes: number[];
  kind: "insertion" | "step";
}

/** Result of one logic tick (15 ms). Fields left out did not change. */
export interface JackUpdate {
  /** new Sprite_Set of Jack's sprite */
  sprite?: FrameSprite;
  /** per shadow sprite: new position/image, or null = Sprite_Remove; undefined = untouched */
  shadows?: [ShadowSprite | null | undefined, ShadowSprite | null | undefined];
  sounds: SoundEvent[];
  /** the insertion finished during this tick */
  insertionEnded?: string;
  /** with `insertionEnded`: the ended insertion came from GLOBAL.ICS (g_jackInsFromScene == 0; idle ones too) */
  insertionGlobal?: boolean;
  /** walk frame shown this tick (0..11), when walking; the game moves Jack right before it */
  walkFrame?: number;
}

export interface InsertionStart {
  /** frame table: a scene's frames in file order, or one GLOBAL.ICS section */
  frames: readonly IcsFrame[];
  /** first frame and number of frames (g_jackInsFrame g_jackInsEnd, Ins_Find) */
  start: number;
  count: number;
  /** g_jackInsDir */
  facing: Facing;
  /** true: GLOBAL.ICS via Ins_StartGlobal (GLOBAL.PAK, scaleMul); false: scene (.PH2) */
  global: boolean;
  /**, third argument of Ins_StartGlobal (only for global insertions) */
  scaleMul?: number;
  name?: string;
}

export interface JackOptions {
  frameDelay?: number;
  walkSpeed?: number;
  /** shadows enabled (SetShadow) */
  shadows?: boolean;
  /** shadow scale (script command 0x89, default 1) */
  shadowScale?: number;
  /** SetPersonData with scale 2.0 = no perspective scaling */
  noScale?: boolean;
  /** g_jackUniform: the uniform frame set (EXTRA 6) and its stand scale */
  uniform?: boolean;
}

/** What the animator needs of one frame set: the walk hot spots and the standing widths. */
export interface WalkFrameSet {
  /** hot spots of FRON/PROF/BACK/SKFR/SKBA (.SFB; FRONW.. in the uniform), 12 per direction */
  hotSpots: readonly (readonly HotSpot[])[];
  /** widths of SSFR2..SSST2.PBM (STFRW13..STSBW13 in the uniform), needed for their xLeft */
  standWidths: readonly number[];
}

/** The civilian set (Jack_LoadWalkFrames) and the uniform set (Jack_LoadWalkFramesUniform). */
export interface WalkFrames extends WalkFrameSet {
  /** absent when the archive lacks the files (test archives); `uniform` then keeps the civilian frames */
  uniform?: WalkFrameSet;
}

export class AnimError extends Error {}

export class JackAnimator {
  frameDelay: number;
  walkSpeed: number;
  shadowsOn: boolean;
  shadowScale: number;
  noScale: boolean;
  /**
 * g_jackUniform (mis-read before as "gun"): which frame set the walk and standing frames come from. The game
 * swaps the images in place ; the shown sprite changes with the next frame Jack_Stand or the walk sets.
 */
  uniform: boolean;
  /** horizontal scroll used to pan footsteps */
  scrollX = 0;
  /** g_jackInsDelay: shared by walking and insertions, decremented every tick */
  delay = 0;
  /** */
  walkFrame = WALK_FRAME_AFTER_STAND;
  mode: JackMode = "stand";
  /** alternates KROK1/KROK2 */
  private stepToggle = false;
  /** shadow sprites currently shown */
  private shadowShown: [boolean, boolean] = [false, false];
  private ins: (InsertionStart & { cur: number; end: number }) | null = null;

  constructor(private readonly data: WalkFrames, opts: JackOptions = {}) {
    this.frameDelay = opts.frameDelay ?? DEFAULT_FRAME_DELAY;
    this.walkSpeed = opts.walkSpeed ?? DEFAULT_WALK_SPEED;
    this.shadowsOn = opts.shadows ?? true;
    this.shadowScale = opts.shadowScale ?? 1;
    this.noScale = opts.noScale ?? false;
    this.uniform = opts.uniform ?? false;
  }

  /** the uniform images are used only when they were loaded */
  private get useUniform(): boolean {
    return this.uniform && this.data.uniform !== undefined;
  }

  private get set(): WalkFrameSet {
    return this.useUniform ? this.data.uniform! : this.data;
  }

  get insertion(): string | undefined {
    return this.ins?.name;
  }

  /** Jack_Stand: standing frame of pose.dir, directional shadow 1, walk frame back to 3. */
  stand(pose: JackPose): JackUpdate {
    this.mode = "stand";
    this.ins = null;
    const scale = this.standScale(pose);
    const u = this.useUniform;
    const hot = standHotSpot(pose.dir, this.set.standWidths[pose.dir], u);
    const [x, y] = placeFrame(pose.x, pose.y, hot, pose.facing, scale, false);
    const sprite: FrameSprite = { file: standFrameFile(pose.dir, u), source: "resource", x, y, scale, mirrored: pose.facing < 0 };
    const shadow = jackShadow({
      index: 0, dir: pose.dir, facing: pose.facing, x: ftol(pose.x), y: ftol(pose.y), walkFrame: null,
      directional: true, twoShadows: false, scale, shadowScale: this.shadowScale,
    });
    this.walkFrame = WALK_FRAME_AFTER_STAND;
    this.shadowShown[0] = true;
    return { sprite, shadows: [shadow, undefined], sounds: [] };
  }

  /** Perspective scale of the standing frame: pose.scale times, clamped; noScale -> 1. */
  standScale(pose: JackPose): number {
    if (this.noScale) return 1;
    const s = f32(f32(STAND_SCALE[pose.dir][this.uniform ? 1 : 0]) * pose.scale);
    return Math.min(1, Math.max(f32(MIN_SCALE), s));
  }

  /** Start walking (= 1); the first frame comes when the delay runs out. */
  walk(): void {
    this.mode = "walk";
    this.ins = null;
  }

  /** Ins_StartGlobal / RunInsertion (Ins_Find): delay = frameDelay, first frame when it runs out. */
  startInsertion(s: InsertionStart): void {
    if (s.start < 0 || s.count < 0 || s.start + s.count > s.frames.length) {
      throw new AnimError(`insertion ${s.name ?? ""} ${s.start}+${s.count} outside ${s.frames.length} frames`);
    }
    this.ins = { ...s, cur: s.start, end: s.start + s.count };
    this.mode = "insertion";
    this.delay = this.frameDelay;
  }

  /**
 * One 15-ms logic tick: Game_TimerTick decrements the delay, then Game_Run shows the next
 * frame if it ran out. move: called on walk steps before the frame is drawn (the game moves Jack
 * by its step times the scale there, ; path following is 's).
 */
  tick(pose: JackPose, move?: (p: JackPose) => JackPose): { update: JackUpdate; pose: JackPose } {
    this.delay--;
    if (this.delay > 0) return { update: { sounds: [] }, pose };
    if (this.mode === "insertion" && this.ins) return { update: this.insertionStep(pose), pose };
    if (this.mode === "walk") {
      this.delay = Math.max(1, this.frameDelay - this.walkSpeed);
      const p = move ? move(pose) : pose;
      return { update: this.walkStep(p), pose: p };
    }
    return { update: { sounds: [] }, pose };
  }

  /** frame f of the walk series, footsteps at 0 and 6, shadow of frame f + 1. */
  private walkStep(pose: JackPose): JackUpdate {
    const f = this.walkFrame;
    const sounds: SoundEvent[] = [];
    if (f === 0 || f === 6) {
      // KROK1/KROK2 alternately; the game checks that the scene has the sound
      const [v1, v2] = stepVolumes(pose.scale, pose.x, this.scrollX);
      sounds.push({ sound: this.stepToggle ? "KROK1.SND" : "KROK2.SND", channels: [2, 1], volumes: [v2, v1], kind: "step" });
      this.stepToggle = !this.stepToggle;
    }
    // the walk path has no noScale test (is read only by Jack_Stand and insertions)
    const scale = pose.scale;
    const hot = this.set.hotSpots[pose.dir][f];
    const [x, y] = placeFrame(pose.x, pose.y, hot, pose.facing, scale, false);
    const sprite: FrameSprite = { file: walkFrameFile(pose.dir, f, this.useUniform), source: "resource", x, y, scale, mirrored: pose.facing < 0 };
    this.walkFrame = (f + 1) % WALK_FRAMES;
    const update: JackUpdate = { sprite, sounds, walkFrame: f };
    if (this.shadowsOn) {
      const s1 = jackShadow({
        index: 0, dir: pose.dir, facing: pose.facing, x: ftol(pose.x), y: ftol(pose.y), walkFrame: this.walkFrame,
        directional: false, twoShadows: false, scale: pose.scale, shadowScale: this.shadowScale,
      });
      this.shadowShown[0] = true;
      update.shadows = [s1, this.hide(1)];
    }
    return update;
  }

  /** Game_Run ... */
  private insertionStep(pose: JackPose): JackUpdate {
    const ins = this.ins!;
    const frame = ins.frames[ins.cur];
    const sounds: SoundEvent[] = [];
    // the effect of g_insFrames[cur] plays before the end test: at cur == end it belongs to the
    // first frame of the next section
    if (frame?.effect) {
      const e = frame.effect;
      const channels = e.channel === 0 ? [1, 2] : [e.channel];
      sounds.push({ sound: e.sound, channels, volumes: channels.map(() => e.volume), kind: "insertion" });
    }
    this.delay = this.frameDelay;
    if (ins.cur + 1 > ins.end) {
      this.ins = null;
      this.mode = "stand";
      return { sounds, insertionEnded: ins.name ?? "", insertionGlobal: ins.global };
    }
    // scale saved for the shadows, then noScale / global multiplier for the frame
    const base = pose.scale;
    let s = this.noScale ? 1 : base;
    if (ins.global) s = Math.min(1, Math.max(f32(MIN_SCALE), f32(s * (ins.scaleMul ?? 1))));
    const hot: HotSpot = [frame.xRight, frame.xLeft, frame.y];
    const [x, y] = placeFrame(pose.x, pose.y, hot, ins.facing, s, true);
    const sprite: FrameSprite = { file: frame.file, source: ins.global ? "global" : "scene", x, y, scale: s, mirrored: ins.facing < 0 };
    const update: JackUpdate = { sprite, sounds };
    if (this.shadowsOn) update.shadows = this.insertionShadows(frame, pose, base, ins.facing);
    ins.cur++;
    return update;
  }

  /** shadow 1 from (d, e), shadow 2 from (f, g); always the round CIEN1.BM. */
  private insertionShadows(frame: IcsFrame, pose: JackPose, scale: number, insFacing: Facing): JackUpdate["shadows"] {
    const both = frame.shadow1[0] < NO_SHADOW && frame.shadow2[0] < NO_SHADOW;
    const out: [ShadowSprite | null | undefined, ShadowSprite | null | undefined] = [undefined, undefined];
    for (const index of [0, 1] as const) {
      const [dx, dy] = index === 0 ? frame.shadow1 : frame.shadow2;
      if (dx >= NO_SHADOW) {
        out[index] = this.hide(index);
        continue;
      }
      const k = this.noScale ? 1 : scale;
      out[index] = jackShadow({
        index, dir: pose.dir, facing: pose.facing,
        x: ftol(insFacing === 1 ? pose.x + dx * k : pose.x - dx * k), y: ftol(pose.y + dy * k), walkFrame: null,
        // is set for shadow 1 only when both exist, and always before shadow 2
        directional: false, twoShadows: index === 1 || both, scale, shadowScale: this.shadowScale,
      });
      this.shadowShown[index] = true;
    }
    return out;
  }

  private hide(index: 0 | 1): null | undefined {
    if (!this.shadowShown[index]) return undefined;
    this.shadowShown[index] = false;
    return null;
  }
}
