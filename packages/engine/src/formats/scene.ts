// Scene description: Action\SCxxx.PHK (+ Data\SCxxx.PH2).
// Every loader of Scene_Load is emulated token by token (Text_NextToken
//, C atoi/atof) with its quirks, so the result is what the game sees.
// Same model as the external checker (camelCase here, snake_case there).

import { Pak } from "./pak";
import { decrypt } from "./textcrypt";

import {
  Tokens, bracketName, cAtoi, cAtof, cUpper, frameValues, parseIcs as parseGlobalIcs,
  parseSsd as parseGlobalSsd, s16, strBetween, tokens, type IcsEffect,
} from "./global";
export { Tokens, bracketName, cAtoi, cAtof, cUpper, s16, strBetween, tokens };
import {
  SceneError, parseAce, parseAci, parseCcg, parseMcc, parsePcs,
  type Area, type Ccg, type Macros, type ObjectAnim, type Person, type Perspective, type Shadow,
} from "./scene-text";
export {
  EXIT_NAMES, MAX_AREA_TRIANGLES, MAX_REC_POSITIONS, SceneError, TYPE_PBM, TYPE_PBM_TO16, TYPE_RAW16, micro,
  parseAce, parseAci, parseCcg, parseMcc, parsePcs,
} from "./scene-text";
export type {
  Area, Ccg, JackStart, Macros, ObjectAnim, Person, PersonDirection, Perspective, SceneObject, Shadow,
} from "./scene-text";

const f32 = Math.fround;

/** intersection of the diagonals P0-P2 and P1-P3 (relative to the object), truncated. */
export function quadCenter(quad: number[]): number[] | null {
  let [x0, y0, x1, y1, x2, y2, x3, y3] = quad;
  if (x2 === x0) x2++;
  const k1 = f32((y2 - y0) / (x2 - x0));
  const b1 = f32(y2 - x2 * k1);
  if (x3 === x1) x3++;
  const k2 = f32((y3 - y1) / (x3 - x1));
  const b2 = f32(y3 - x3 * k2);
  if (k1 === k2) return null;
  const x = f32((b2 - b1) / (k1 - k2));
  const y = f32(k1 * x + b1);
  return [Math.trunc(x), Math.trunc(y)];
}

/** on (P0,P1,P2), (P1,P2,P3), (P2,P3,P0): every cross product > 0. */
export function quadIsConvex(quad: number[]): boolean {
  const p = [0, 2, 4, 6].map((i) => [quad[i], quad[i + 1]]);
  const turn = (a: number[], b: number[], c: number[]) =>
    (b[0] - a[0]) * (c[1] - b[1]) - (c[0] - b[0]) * (b[1] - a[1]) > 0;
  return turn(p[0], p[1], p[2]) && turn(p[1], p[2], p[3]) && turn(p[2], p[3], p[0]);
}

// --- walk area ------------------------------------------------------------------

/** (px - ax) * slope(a, b) <= py - ay; slope of a vertical edge = dy * 1e7. */
function below(px: number, py: number, ax: number, ay: number, bx: number, by: number): boolean {
  const dx = s16(bx - ax);
  const slope = dx === 0 ? f32((by - ay) * 1e7) : f32((by - ay) / dx);
  return (px - ax) * slope <= py - ay; // the product is compared unrounded (x87 register)
}

/**
 * Point test of Walk_FindTriangle for one triangle. The x range checked is
 * x1..x3, so the game expects vertices sorted by x (true for all scene data).
 */
export function triangleContains(tri: readonly number[], px: number, py: number): boolean {
  const [x1, y1, x2, y2, x3, y3] = tri;
  const [lo, hi] = y1 < y2 ? [Math.min(y1, y3), Math.max(y2, y3)] : [Math.min(y2, y3), Math.max(y1, y3)];
  if (!(x1 <= px && px <= x3 && lo <= py && py <= hi)) return false;
  if (!below(x2, y2, x1, y1, x3, y3)) {
    return !below(px, py, x1, y1, x3, y3) && below(px, py, x1, y1, x2, y2) && below(px, py, x2, y2, x3, y3);
  }
  return below(px, py, x1, y1, x3, y3) && !below(px, py, x1, y1, x2, y2) && !below(px, py, x2, y2, x3, y3);
}

/** Walk_FindTriangle: index of the first triangle >= start containing the point, or -1. */
export function findTriangle(walk: readonly (readonly number[])[], px: number, py: number, start = 0): number {
  for (let i = start; i < walk.length; i++) if (triangleContains(walk[i], px, py)) return i;
  return -1;
}

/**
 * Character scale at screen y (formula at e.g. Script_ExecStep):
 * (y - horizonY) * refScale / (refY - horizonY). also clamps to 0.1..1 (and divides
 * by 3 for its own caller); the clamp is applied here.
 */
export function perspectiveScale(p: Perspective, y: number): number {
  const s = ((y - p.horizonY) * (p.refScale / 1e6)) / (p.refY - p.horizonY);
  return Math.min(1, Math.max(0.1, s));
}

// --- ICS ------------------------------------------------------------------------

/** [sound, v1, v3] (v2 is read and dropped by the game) */
export type Effect = (string | number | null)[];

export interface InsertionFrame {
  file: string;
  values: (number | null)[];
  effect: Effect | null;
}

export interface Insertion {
  name: string;
  frames: InsertionFrame[];
  trailingEffect?: Effect;
}

/** Scene_LoadIcs on global.parseIcs (the same format as GLOBAL.ICS). */
export function parseIcs(plain: Uint8Array): Insertion[] {
  if (plain.length === 0) return [];
  const effect = (e: IcsEffect | null | undefined): Effect | null => (e ? [e.sound, e.channel, e.volume] : null);
  return parseGlobalIcs(plain).sections.map((sec) => {
    const out: Insertion = {
      name: sec.name,
      frames: sec.frames.map((f) => ({ file: f.file, values: frameValues(f), effect: effect(f.effect) })),
    };
    if (sec.trailingEffect) out.trailingEffect = effect(sec.trailingEffect)!;
    return out;
  });
}

// --- SSD ------------------------------------------------------------------------

/** Sound_LoadSceneSfx: sound names; the game loads <name>.PSD. */
export function parseSsd(plain: Uint8Array): string[] {
  return plain.length === 0 ? [] : parseGlobalSsd(plain);
}

export function psdName(snd: string): string {
  const i = snd.lastIndexOf(".");
  return (i >= 0 ? snd.slice(0, i) : snd) + ".PSD";
}

// --- whole scene ----------------------------------------------------------------

export interface Scene {
  scene: string;
  ccg: Ccg;
  areas: Area[];
  aceComplete: boolean;
  persons: Person[];
  insertions: Insertion[];
  objectAnims: ObjectAnim[];
  shadows: Shadow[];
  sounds: string[];
  macros: Macros;
}

/** Scene name from an archive name/path: "Action/SC001.phk" -> "SC001". */
export function sceneNameOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  return cUpper(base.split(".")[0]);
}

/** Parses scene `scene` from its .PHK archive. */
export function parseScene(pak: Pak, scene: string): Scene {
  const text = (ext: string): Uint8Array | null => {
    const e = pak.find(`${scene}.${ext}`);
    return e ? decrypt(pak.read(e)) : null;
  };
  const ccgPlain = text("CCG");
  if (!ccgPlain) throw new SceneError(`${scene}.CCG missing (mandatory, no Pak_Exists check)`);
  const mcc = text("MCC");
  if (!mcc) throw new SceneError(`${scene}.MCC missing (mandatory)`);
  const ccg = parseCcg(ccgPlain);
  const used = ccg.objects.slice(0, ccg.count);
  for (const o of used) {
    o.center = o.flx ? null : quadCenter(o.quad);
    o.convex = o.flx ? false : quadIsConvex(o.quad);
  }
  const ace = text("ACE");
  const { areas, complete } = ace ? parseAce(ace) : { areas: [], complete: true };
  const aci = text("ACI");
  const { anims, shadows } = aci ? parseAci(aci, used.map((o) => o.name)) : { anims: [], shadows: [] };
  const empty = new Uint8Array(0);
  return {
    scene,
    ccg,
    areas,
    aceComplete: complete,
    persons: parsePcs(text("PCS") ?? empty),
    insertions: parseIcs(text("ICS") ?? empty),
    objectAnims: anims,
    shadows,
    sounds: parseSsd(text("SSD") ?? empty),
    macros: parseMcc(mcc),
  };
}

/**
 * Where Jack stands when the scene starts after scene `lastScene` (number from 'If LAST n'):
 * [INIT] wins over [PRE], a block for this LAST over an unconditional one. null if the
 * scripts give no position (Jack keeps the one set by other commands; see).
 */
export function jackStart(scene: Scene, lastScene: number | null): { x: number; y: number } | null {
  const starts = scene.macros.jackStarts;
  for (const section of ["INIT", "PRE"]) {
    const s =
      starts.find((st) => st.section === section && st.last === lastScene && lastScene !== null) ??
      starts.find((st) => st.section === section && st.last === null);
    if (s) return { x: s.x, y: s.y };
  }
  return null;
}
