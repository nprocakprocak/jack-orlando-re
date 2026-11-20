// Jack's frame sets, hot spots, sprite placement and shadows.
import { pad2 } from "../core/pad";
import type { HotSpot } from "../formats/global";

/** g_jackDir: 0 front, 1 profile, 2 back, 3 three-quarter front, 4 three-quarter back. */
export type JackDir = 0 | 1 | 2 | 3 | 4;
/** / g_jackInsDir: 1 = the frame as drawn (right), -1 = mirrored (left). */
export type Facing = 1 | -1;

/** Walk series in RESOURCE.PAK by direction, <series>1..12.PBM, hot spots in <series>.SFB. */
export const WALK_SERIES = ["FRON", "PROF", "BACK", "SKFR", "SKBA"] as const;
export const WALK_FRAMES = 12;
/** Walk frame index after Jack_Stand (writes 3 to). */
export const WALK_FRAME_AFTER_STAND = 3;

/** Standing frames in RESOURCE.PAK (buffers + dir * 0x36b6). */
export const STAND_FRAMES = ["SSFR2.PBM", "SSPR2.PBM", "SSBA2.PBM", "SSSP2.PBM", "SSST2.PBM"] as const;
/** Hard-coded hot spots of the standing frames: [xRight, y]; xLeft = width - xRight. */
export const STAND_HOT: readonly (readonly [number, number])[] = [[46, 264], [23, 262], [50, 266], [36, 264], [46, 260]];

/**
 * The uniform set (Jack_LoadWalkFramesUniform, script EXTRA 6): the same buffers get FRONW..SKBAW01..12
 * (two-digit numbers, Res_MakeNumberedName width 2; the civilian set uses width 1), hot spots FRONW.SFB.., standing
 * frames ST*W13.PBM with their own hard-coded hot spots. Shadows (SH_*), OBPL / PROPRO (walk-start turns) stay.
 */
export const WALK_SERIES_UNIFORM = ["FRONW", "PROFW", "BACKW", "SKFRW", "SKBAW"] as const;
export const STAND_FRAMES_UNIFORM = ["STFRW13.PBM", "STPRW13.PBM", "STBAW13.PBM", "STSFW13.PBM", "STSBW13.PBM"] as const;
export const STAND_HOT_UNIFORM: readonly (readonly [number, number])[] = [[47, 268], [24, 262], [46, 264], [39, 266], [49, 263]];

/** Jack_Stand multiplies the perspective scale by this: [civilian, uniform (g_jackUniform)] by direction. */
export const STAND_SCALE: readonly (readonly [number, number])[] = [
  [0.978, 0.978],
  [1, 1],
  [0.988, 1],
  [0.988, 1],
  [1.015, 1.014],
];

/** Directional shadows in RESOURCE.PAK by direction, <series>01..12.PBM (Game_Main, + dir * 0x30). */
export const SHADOW_SERIES = ["SH_FR", "SH_PR", "SH_BA", "SHSFR", "SHSBA"] as const;
/** Round shadow. */
export const ROUND_SHADOW = "CIEN1.BM";
/** Shadow frame used for standing and insertion frames (param_6 = 3 in Jack_DrawShadow calls). */
export const STILL_SHADOW_FRAME = 3;
/** Round shadow without a second shadow is drawn at 0.7 of the size. */
export const ROUND_SHADOW_ALONE_SCALE = 0.7;
/** Shadow scale above this is set to 0.99. */
export const SHADOW_SCALE_MAX = 0.99;

/**
 * Shadow anchor offsets (bytes, read by), indexed by shadowDirIndex():
 * the shadow image is drawn at (x - dx * s, y - dy * s).
 */
export const SHADOW_OFFSET_WALK_X = [48, 60, 60, 40, 50, 60, 60, 45] as const; //
export const SHADOW_OFFSET_STILL_X = [48, 55, 60, 42, 50, 65, 60, 55] as const; //
export const SHADOW_OFFSET_WALK_Y = [20, 15, 15, 25, 19, 23, 15, 21] as const; //
export const SHADOW_OFFSET_STILL_Y = [25, 20, 15, 22, 30, 23, 15, 20] as const; //
/** Offsets of the round shadow for standing/insertion frames. */
export const SHADOW_OFFSET_ROUND: readonly [number, number] = [55, 14];

export function walkFrameFile(dir: JackDir, frame: number, uniform = false): string {
  return uniform ? `${WALK_SERIES_UNIFORM[dir]}${pad2(frame + 1)}.PBM` : `${WALK_SERIES[dir]}${frame + 1}.PBM`;
}

export function walkHotSpotFile(dir: JackDir, uniform = false): string {
  return `${(uniform ? WALK_SERIES_UNIFORM : WALK_SERIES)[dir]}.SFB`;
}

export function standFrameFile(dir: JackDir, uniform = false): string {
  return (uniform ? STAND_FRAMES_UNIFORM : STAND_FRAMES)[dir];
}

export function shadowFile(dir: JackDir, frame: number): string {
  return `${SHADOW_SERIES[dir]}${pad2(frame + 1)}.PBM`;
}

/** [xRight, xLeft, y] of a standing frame of the given width. */
export function standHotSpot(dir: JackDir, width: number, uniform = false): HotSpot {
  const [x, y] = (uniform ? STAND_HOT_UNIFORM : STAND_HOT)[dir];
  return [x, width - x, y];
}

/** eight-way index of dir * facing, used to pick shadow offsets. */
export function shadowDirIndex(dir: number, facing: number): number {
  switch (dir * facing) {
    case 1: return 2;
    case 2: return 4;
    case 3: return 1;
    case 4: return 5;
    case -4: return 3;
    case -3: return 7;
    case -1: return 6;
    default: return 0; // also 0 and -2 (back, mirrored)
  }
}

/** __ftol: truncation toward zero. */
export const ftol = Math.trunc;
export const f32 = Math.fround;

/** Sprite_Set arguments of a Jack frame (the game pre-scales the image, then sets it unscaled). */
export interface FrameSprite {
  /** .PBM name */
  file: string;
  /** "resource": RESOURCE.PAK, "global": GLOBAL.PAK, "scene": the scene's .PH2 */
  source: "resource" | "global" | "scene";
  /** top-left corner in the 1024x480 work buffer */
  x: number;
  y: number;
  /** size factor: the drawn image is trunc(w * scale) x trunc(h * scale) */
  scale: number;
  /**
 * g_jackScale · g_jackShadowScale without the 0.7 of the lone round shadow and without the 0.99 limit. The fade-out/in branches of
 * Jack_DrawShadow build their size from this product only (no 0.7), so the fading draw must use it.
 */
  fadeBase?: number;
  mirrored: boolean;
}

/**
 * Top-left corner of a frame whose hot spot lands on (px, py): hot X is xRight for facing 1,
 * xLeft for -1 (the hot spot of the mirrored image). Insertion frames round (+0.5),
 * walk and standing frames truncate.
 */
export function placeFrame(px: number, py: number, hot: HotSpot, facing: Facing, scale: number, round: boolean): [number, number] {
  const hx = facing === 1 ? hot[0] : hot[1];
  const r = round ? 0.5 : 0;
  return [ftol(px - hx * scale + r), ftol(py - hot[2] * scale + r)];
}

/** What Jack_DrawShadow is asked to draw. */
export interface ShadowRequest {
  /** 0 or 1: sprite / */
  index: 0 | 1;
  /** g_jackDir */
  dir: number;
  /** (walk facing, also for insertions) */
  facing: number;
  /** anchor, already including the frame's shadow offset */
  x: number;
  y: number;
  /** walk frame 0..11 for walk shadows; null for standing/insertion frames (param_6 = 3) */
  walkFrame: number | null;
  /** set only around Jack_Stand's call, allows a directional still shadow */
  directional: boolean;
  /** g_jackTwoShadows */
  twoShadows: boolean;
  /** perspective scale */
  scale: number;
  /** script shadow scale (default 1.0, script command 0x89) */
  shadowScale: number;
}

export interface ShadowSprite {
  index: 0 | 1;
  /** RESOURCE.PAK image: SH_* .PBM or CIEN1.BM */
  file: string;
  round: boolean;
  x: number;
  y: number;
  scale: number;
  /**
 * g_jackScale · g_jackShadowScale without the 0.7 of the lone round shadow and without the 0.99 limit: the fade-out/in branches of
 * Jack_DrawShadow build their size from this product only, so a fading draw must use it.
 */
  fadeBase?: number;
  mirrored: boolean;
}

/**
 * Jack_DrawShadow without the fade-in/out states: image, size and position. The game
 * draws it by darkening the composed background under the non-zero pixels of the image
 * (Render_ComposeRegionNoFlag +).
 */
export function jackShadow(r: ShadowRequest): ShadowSprite {
  const i8 = r.dir === 16 ? 16 : shadowDirIndex(r.dir, r.facing);
  const validDir = r.dir >= 0 && r.dir <= 4;
  let file: string;
  if (i8 === 16) file = ROUND_SHADOW;
  else if (r.walkFrame !== null) {
    // out-of-range -> SH_FR04 after a "!!!!!" debug print
    file = validDir && r.walkFrame >= 0 && r.walkFrame <= 11 ? shadowFile(r.dir as JackDir, r.walkFrame) : shadowFile(0, 3);
  } else if (!r.directional || r.twoShadows) file = ROUND_SHADOW;
  else file = validDir ? shadowFile(r.dir as JackDir, STILL_SHADOW_FRAME) : shadowFile(0, 3);
  const round = file === ROUND_SHADOW;
  const fadeBase = f32(r.scale * r.shadowScale);
  let s = f32(fadeBase * (round && !r.twoShadows ? ROUND_SHADOW_ALONE_SCALE : 1));
  if (s > f32(SHADOW_SCALE_MAX)) s = f32(SHADOW_SCALE_MAX);
  let dx: number;
  let dy: number;
  if (r.walkFrame === null) {
    if (round || i8 > 7) [dx, dy] = SHADOW_OFFSET_ROUND;
    else [dx, dy] = [SHADOW_OFFSET_STILL_X[i8], SHADOW_OFFSET_STILL_Y[i8]];
  } else if (i8 === 16) [dx, dy] = SHADOW_OFFSET_ROUND; // bytes 16 of both walk tables
  else [dx, dy] = [SHADOW_OFFSET_WALK_X[i8], SHADOW_OFFSET_WALK_Y[i8]];
  return { index: r.index, file, round, x: ftol(r.x - dx * s), y: ftol(r.y - dy * s), scale: s, fadeBase, mirrored: r.facing < 0 };
}

/** Footstep volumes: [channel 1, channel 2], panned by Jack's x on the visible screen. */
export function stepVolumes(scale: number, x: number, scrollX: number): [number, number] {
  const span = scrollX + 640;
  return [ftol((64 * scale * (640 - x + scrollX)) / span), ftol((64 * scale * x) / span)];
}

/** Idle counter limit in Game_Run frames and its value after an idle animation. */
export const IDLE_FRAMES = 1500;
export const IDLE_FRAMES_AFTER = 700;

export interface IdleChoice {
  /** GLOBAL.ICS section */
  section?: string;
  /** in the uniform: Script_Stay with "LD" / "RD", like the script command STAY */
  stay?: "LD" | "RD";
  facing: number;
  /** multiplies the scale of global insertion frames */
  scaleMul: number;
}

/**
 * What Jack does after IDLE_FRAMES frames without input. uniform: g_jackUniform ;
 * rand: one value of the C rand(); koltVar: value of the game variable GUN (g_varIdxGun; KOLT only if non-zero).
 * The STAY cases do not reset the idle counter (only the switch branch writes 700).
 */
export function idleChoice(dir: JackDir, facing: Facing, uniform: boolean, rand: number, koltVar: number): IdleChoice | null {
  const odd = rand % 2 !== 0;
  if (uniform) {
    const df = dir * facing;
    if (dir === 0 || df === 1 || df === 2 || df === -4) return { stay: "LD", facing, scaleMul: 1 };
    if (df === 4 || df === -1) return { stay: "RD", facing, scaleMul: 1 };
    if (dir === 3) return { section: "MOW34", facing, scaleMul: 1 };
    return null;
  }
  switch (dir) {
    case 0:
      return !odd && koltVar !== 0 ? { section: "KOLT", facing: 1, scaleMul: f32(0.985) } : { section: "KLFR", facing: 1, scaleMul: f32(0.97) };
    case 1:
      return { section: "KLPRO", facing, scaleMul: 1 };
    case 2:
      return { section: "KLTYL", facing: 1, scaleMul: f32(0.975) };
    case 3:
      return { section: odd ? "34PKL" : "MONETA", facing, scaleMul: f32(0.98) };
    case 4:
      return { section: "34TKL", facing, scaleMul: 1 };
  }
}

/**
 * The frame set after loading a save (Save_LoadState): the uniform set is loaded when Jack is not in it and
 * JACKISWOJ == 1, the civilian set when he is and JACKISWOJ == 0; otherwise the set stays (so JACKISWOJ = 2 changes nothing).
 * "New game" (Var_LoadAll, then when in the uniform) is another path: the civilian set.
 */
export function uniformAfterLoad(current: boolean, jackIsWoj: number): boolean {
  return current ? jackIsWoj !== 0 : jackIsWoj === 1;
}
