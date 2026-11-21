// Scene description: Action\SCxxx.PHK (+ Data\SCxxx.PH2).
// Every loader of Scene_Load is emulated token by token (Text_NextToken
//, C atoi/atof) with its quirks, so the result is what the game sees.
// Same model as the external checker (camelCase here, snake_case there).

import { Pak } from "./pak";
import { decrypt } from "./textcrypt";

export class SceneError extends Error {}

/** Area names that make an area a scene exit (empty slots match "[]"). */
export const EXIT_NAMES = ["LEWO", "PRAWO", "DOL", "TO_IN", "UP", "TO_OUT", ""];

export const TYPE_PBM = 8;
export const TYPE_RAW16 = 16;
export const TYPE_PBM_TO16 = -8;

export const MAX_AREA_TRIANGLES = 15;
export const MAX_REC_POSITIONS = 299;

// --- tokenizer: shared, see global.ts ---------------------------------------------

import {
  Tokens, bracketName, cAtoi, cAtof, cUpper, frameValues, parseIcs as parseGlobalIcs,
  parseSsd as parseGlobalSsd, s16, strBetween, tokens, type IcsEffect,
} from "./global";
export { Tokens, bracketName, cAtoi, cAtof, cUpper, s16, strBetween, tokens };

const f32 = Math.fround;

/** Float as an integer number of millionths (same rounding as the external checker). */
export function micro(v: number): number {
  return Math.floor(v * 1e6 + 0.5);
}

// --- CCG ------------------------------------------------------------------------

export interface SceneObject {
  name: string;
  /** "graphic" from [grafiki], "element" from [elementy] (inventory icons) */
  kind: "graphic" | "element";
  /** 8 PBM, 16 raw RGB565 (or FLX slot), -8 PBM shown as 16-bit */
  type: number;
  x: number;
  y: number;
  /** millionths */
  scale: number;
  scaleB: number;
  /** floor footprint P0..P3 relative to (x, y): x0 y0 x1 y1 x2 y2 x3 y3 */
  quad: number[];
  flx: boolean;
  /** only for objects the game uses (index < count) */
  center?: number[] | null;
  convex?: boolean;
}

export interface Perspective {
  a: number;
  horizonY: number;
  refY: number;
  /** millionths */
  refScale: number;
}

export interface Ccg {
  background: string;
  /** background wider than the screen (name ended with '+'); scroll = start offset */
  wide: boolean;
  scroll: number;
  /** objects from [grafiki]; z of a sprite = object index */
  graphics: number;
  /** objects the game keeps ; objects[count..] were read but are ignored */
  count: number;
  objects: SceneObject[];
  perspective: Perspective | null;
  lights: number[][];
  /** walk area triangles: x1 y1 x2 y2 x3 y3 */
  walk: number[][];
  textColors: number[] | null;
}

function readObject(t: Tokens, name: string, kind: "graphic" | "element"): SceneObject {
  const type = s16(cAtoi(t.next("num")));
  const flx = kind === "graphic" && type === TYPE_RAW16 && name.startsWith("FLX");
  const x = s16(cAtoi(t.next("num")));
  const y = s16(cAtoi(t.next("num")));
  const scale = f32(cAtof(t.next("num")));
  const scaleB = f32(cAtof(t.next("num")));
  let quad: number[] = [];
  for (let i = 0; i < 8; i++) quad.push(t.short() ?? 0);
  if (flx) quad = [0, 0, 0, 0, 0, 0, 0, 0];
  return { name, kind, type, x, y, scale: micro(scale), scaleB: micro(scaleB), quad, flx };
}

/** Scene_LoadCcg. */
export function parseCcg(plain: Uint8Array): Ccg {
  if (plain.length === 0) throw new SceneError("empty .CCG (game exits: 'Error dlugosci')");
  const t = new Tokens(plain);
  if (!t.findSection("[grafiki]")) throw new SceneError("no [grafiki] section (game exits: 'NO [graphisc] SECTION')");
  let bg = t.next("name");
  let wide = false;
  let scroll = 0;
  if (bg.endsWith("+")) {
    bg = bg.slice(0, -1);
    wide = true;
    scroll = t.short() ?? 0;
    scroll = scroll > 0x178 ? 0x178 : scroll - (scroll & 3);
  }
  let objects: SceneObject[] = [];
  let count = 0;
  while (t.pos < t.len) {
    const tok = t.next("name");
    if (tok.startsWith("[")) break;
    const name = cUpper(tok);
    if (t.atEnd()) {
      objects.push({ name, kind: "graphic", type: 0, x: 0, y: 0, scale: 0, scaleB: 0, quad: [0, 0, 0, 0, 0, 0, 0, 0], flx: false });
      count++;
      break;
    }
    objects.push(readObject(t, name, "graphic"));
    if (t.atEnd()) break;
    count++;
  }
  const graphics = count;
  objects = objects.slice(0, count);
  if (t.findSection("[elementy]")) {
    for (;;) {
      if (t.atEnd()) break;
      const tok = t.next("name");
      if (tok.startsWith("[") || t.atEnd()) break;
      objects.push(readObject(t, cUpper(tok), "element"));
      if (t.atEnd()) break;
      count++;
    }
  }
  let perspective: Perspective | null = null;
  if (t.findSection("[perspektywa]")) {
    const a = s16(cAtoi(t.next("num")));
    const horizonY = s16(cAtoi(t.next("num")));
    const refY = s16(cAtoi(t.next("num")));
    t.skip();
    const refScale = t.atEnd() ? 0 : f32(cAtof(t.next("num")));
    perspective = { a, horizonY, refY, refScale: micro(refScale) };
  }
  const lights: number[][] = [];
  if (t.findSection("[swiatlo]")) {
    let tok = t.next("num");
    while (!tok.startsWith("[") && t.pos < t.len) {
      const x = s16(cAtoi(tok));
      lights.push([x, t.short() ?? 0]);
      tok = t.next("num");
    }
  }
  const walk: number[][] = [];
  if (t.findSection("[obszar_chodu]")) {
    const n = s16(cAtoi(t.next("num")));
    for (let i = 0; i < n; i++) {
      const tri: number[] = [];
      for (let k = 0; k < 6; k++) tri.push(s16(cAtoi(t.next("num"))));
      walk.push(tri);
    }
  }
  let textColors: number[] | null = null;
  if (t.findSection("[kolor_liter]")) {
    textColors = [];
    for (let i = 0; i < 6; i++) textColors.push(t.short() ?? 0);
  }
  return { background: cUpper(bg), wide, scroll, graphics, count, objects, perspective, lights, walk, textColors };
}

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

// --- ACE ------------------------------------------------------------------------

export interface Area {
  name: string;
  exit: boolean;
  triangles: number[][];
}

/** Scene_LoadAce. complete = no text left after the last area. */
export function parseAce(plain: Uint8Array): { areas: Area[]; complete: boolean } {
  const areas: Area[] = [];
  if (plain.length === 0) return { areas, complete: true };
  const t = new Tokens(plain);
  const n = s16(cAtoi(t.next("num")));
  for (let i = 0; i < n; i++) {
    const name = bracketName(t.next("name"));
    const k = s16(cAtoi(t.next("num")));
    const triangles: number[][] = [];
    for (let j = 0; j < k; j++) {
      const tri: number[] = [];
      for (let v = 0; v < 6; v++) tri.push(s16(cAtoi(t.next("num"))));
      triangles.push(tri);
    }
    areas.push({ name, exit: EXIT_NAMES.includes(name), triangles });
  }
  return { areas, complete: t.atEnd() };
}

// --- PCS ------------------------------------------------------------------------

export interface PersonDirection {
  dir: number;
  /** [file, x, y, z] */
  frames: (string | number | null)[][];
}

export interface Person {
  name: string;
  n: number | null;
  framesPerDir: number;
  mode: number | null;
  /** millionths */
  scale: number;
  flag: number | null;
  directions: PersonDirection[];
}

/** Scene_LoadPcs. */
export function parsePcs(plain: Uint8Array): Person[] {
  const persons: Person[] = [];
  if (plain.length === 0) return persons;
  const t = new Tokens(plain);
  let tok = t.next("section");
  let done = false;
  while (!done && t.pos < t.len) {
    const name = tok.length >= 2 ? tok.slice(1, -1) : "";
    const n = t.short();
    const framesPerDir = t.short() || 0;
    const mode = t.short();
    t.skip();
    const scale = f32(cAtof(t.next("num")));
    const flag = t.short();
    const directions: PersonDirection[] = [];
    let local = "";
    for (;;) {
      local = t.next("local");
      if (local.startsWith("[") || t.pos >= t.len) break;
      const dir = s16(cAtoi(local));
      const frames: (string | number | null)[][] = [];
      for (let i = 0; i < framesPerDir; i++) {
        const f = cUpper(t.next("frame"));
        frames.push([f, t.short(), t.short(), t.short()]);
      }
      directions.push({ dir, frames });
      if (t.pos >= t.len) break;
    }
    persons.push({ name, n, framesPerDir, mode, scale: micro(scale), flag, directions });
    if (t.pos < t.len) tok = local;
    else done = true;
  }
  return persons;
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

// --- ACI ------------------------------------------------------------------------

export interface ObjectAnim {
  /** index of the CCG object (its z) */
  object: number;
  name: string;
  count: number | null;
  /** REC ... END sequences of image indices (0 = the object's own image) */
  recs: number[][];
  /** extra images 1..n: [file, x, y] */
  images: (string | number)[][];
}

export interface Shadow {
  index: number;
  points: number[][];
}

/** Scene_LoadAci: a section [NAME] per CCG object, then [SHAD0] [SHAD3]. */
export function parseAci(plain: Uint8Array, objectNames: string[]): { anims: ObjectAnim[]; shadows: Shadow[] } {
  const anims: ObjectAnim[] = [];
  const shadows: Shadow[] = [];
  if (plain.length === 0) return { anims, shadows };
  const t = new Tokens(plain);
  objectNames.forEach((obj, i) => {
    if (!t.findSection(`[${obj}]`)) return;
    const count = t.short();
    const recs: number[][] = [];
    const images: (string | number)[][] = [];
    while (t.pos < t.len) {
      let tok = t.next("num");
      if (tok.startsWith("[")) break;
      while (tok === "REC") {
        const seq: number[] = [];
        for (;;) {
          tok = t.next("num");
          if (tok === "END") break;
          let v = s16(cAtoi(tok));
          if (seq.length === 0 && v < 0) v = -v;
          seq.push(v);
          if (seq.length > MAX_REC_POSITIONS || t.atEnd()) break;
        }
        recs.push(seq);
        tok = t.next("num");
      }
      const x = s16(cAtoi(t.next("num")));
      const y = s16(cAtoi(t.next("num")));
      images.push([cUpper(tok), x, y]);
    }
    anims.push({ object: i, name: obj, count, recs, images });
  });
  for (let k = 0; k < 4; k++) {
    if (!t.findSection(`[SHAD${k}]`)) continue;
    const points: number[][] = [];
    while (t.pos < t.len) {
      const tok = t.next("num");
      if (tok.startsWith("[")) break;
      points.push([s16(cAtoi(tok)), s16(cAtoi(t.next("num")))]);
    }
    shadows.push({ index: k, points });
  }
  return { anims, shadows };
}

// --- SSD / MCC ------------------------------------------------------------------

/** Sound_LoadSceneSfx: sound names; the game loads <name>.PSD. */
export function parseSsd(plain: Uint8Array): string[] {
  return plain.length === 0 ? [] : parseGlobalSsd(plain);
}

export function psdName(snd: string): string {
  const i = snd.lastIndexOf(".");
  return (i >= 0 ? snd.slice(0, i) : snd) + ".PSD";
}

export interface JackStart {
  /** "PRE" or "INIT" */
  section: string;
  /** previous scene number from 'If LAST n', null = unconditional */
  last: number | null;
  x: number;
  y: number;
}

export interface Macros {
  sections: string[];
  /** GoToScene targets without extension */
  gotos: string[];
  jackStarts: JackStart[];
}

/** Only section names, GoToScene targets and Jack's start positions (the language is). */
export function parseMcc(plain: Uint8Array): Macros {
  const text = new Tokens(plain).text.replace(/\/[^/]*\//g, " ");
  const sections: string[] = [];
  const gotos: string[] = [];
  const jackStarts: JackStart[] = [];
  let section: string | null = null;
  let last: number | null = null;
  for (const raw of text.split("\r\n")) {
    const words = raw.split(/[\x00-\x20]+/).filter((w) => w);
    if (!words.length) continue;
    const w0 = cUpper(words[0]);
    if (w0.startsWith("[")) {
      section = cUpper(bracketName(words[0]));
      sections.push(section);
      last = null;
      continue;
    }
    if (w0 === "GOTOSCENE" && words.length > 1) gotos.push(cUpper(words[1]).split(".")[0]);
    if (section !== "PRE" && section !== "INIT") continue;
    if (w0 === "IF" && words.length > 2 && cUpper(words[1]) === "LAST") last = cAtoi(words[2]);
    else if (w0 === "ENDIF") last = null;
    else if (w0 === "SETPOSITION" && words.length > 3 && cUpper(words[1]) === "JACK") {
      const x = cAtoi(words[2]);
      const y = cAtoi(words[3]);
      const st = jackStarts.find((s) => s.section === section && s.last === last);
      if (st) {
        st.x = x;
        st.y = y;
      } else jackStarts.push({ section, last, x, y });
    }
  }
  return { sections, gotos, jackStarts };
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
