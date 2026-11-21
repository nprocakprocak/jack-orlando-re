// Scene persons from <scene>.PCS: walking, drawing and insertion (.ICS) playback. The per-person
// tick is Game_Run (walking) and (insertions); the walk
// start is, the script commands are cases of Script_ExecStep.
// Pure logic, no DOM; positions are floats.
import type { FrameSprite } from "../anim/jack";
import type { Person } from "../formats/scene";
import { f32, ftol, s16 } from "../walk/geometry";
export { ScenePerson, ScenePersons } from "./persons-actor";

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
