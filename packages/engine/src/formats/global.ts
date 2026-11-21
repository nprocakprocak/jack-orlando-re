// Global data files: frame lists .ICS.FCM, GLOBAL.CCG/.MCC/.SSD, hot-spot tables *.SFB,
// circle masks CM*.BIN.
// The .ICS and .FCM parsers follow the game's loaders token by token (Ics_LoadSection /
// Scene_LoadIcs, Fcm_LoadSection / Scene_LoadFcm), so they read
// GLOBAL.ICS/FCM and the scene copies alike. Same model as the external checker.
import { decrypt } from "./textcrypt";

/** Fixed-size name buffers in the game's tables (name + NUL). */
export const FRAME_NAME_MAX = 13;
export const SECTION_NAME_MAX = 29;
export const ICS_MAX_FRAMES = 1000;
export const ICS_MAX_SECTIONS = 60;
export const FCM_MAX_EFFECTS = 20;
/** ICS shadow offset >= 1000: no shadow for this frame. */
export const NO_SHADOW = 1000;

export class GlobalError extends Error {}

// --- text tokenizer (shared by every text format; scene.ts re-exports it) ------------------
// Interface for readers of the game's text files (scene .CCG/.ACE/.PCS/.ACI.ICS.SSD, and
// the .MCC compiler in). Same as the external checker.
// new Tokens(plain) reader over a decrypted buffer (latin-1)
// .next(buf?) Text_NextToken: next run of bytes > 0x20. At the end of the
// text the game leaves the destination buffer alone, so the token last
// read into the same named buffer is returned again ("" if none)
// .short() Text_ReadShort /: next token via atoi as int16; null
// at the end of the text
// .atEnd() nothing but separators left
// .findSection(n) Text_FindSection: rewinds, scans for token n (upper-cased
// compare); true only if text remains after it
// .pos.len cursor and length
// tokens(plain) all tokens as a string[] (strict parsers below)
// cAtoi/cAtof/s16 atoi/atof of a token, int16 wrap
// cUpper _strupr of the C locale (only a-z change)
// strBetween Str_Between ; bracketName = its "[" "]" use
// parseIcs/parseSsd the single ICS and SSD parsers (scene.ts adapts their result)

export function cAtoi(tok: string): number {
  const m = /^[+-]?[0-9]+/.exec(tok);
  return m ? parseInt(m[0], 10) : 0;
}

export function s16(v: number): number {
  return (((v + 0x8000) & 0xffff) - 0x8000) | 0;
}

export function cAtof(tok: string): number {
  const m = /^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?/.exec(tok);
  return m ? parseFloat(m[0]) : 0;
}

/** _strupr in the C locale: only a-z change. */
export function cUpper(s: string): string {
  return s.replace(/[a-z]+/g, (m) => m.toUpperCase());
}

/** Str_Between: characters after the first `opening` up to `closing` or the end. */
export function strBetween(tok: string, opening: string, closing: string): string {
  const i = tok.indexOf(opening);
  if (i < 0) return "";
  const j = tok.indexOf(closing, i + 1);
  return j < 0 ? tok.slice(i + 1) : tok.slice(i + 1, j);
}

export function bracketName(tok: string): string {
  return strBetween(tok, "[", "]");
}

/**
 * Text_NextToken over decrypted bytes. At the end of the text the game does not write the
 * destination buffer, so the token read last into it is returned again.
 */
export class Tokens {
  readonly text: string;
  pos = 0;
  private readonly buffers = new Map<string, string>();

  constructor(plain: Uint8Array) {
    let s = "";
    for (let i = 0; i < plain.length; i += 4096) s += String.fromCharCode(...plain.subarray(i, i + 4096));
    this.text = s; // latin-1: one char per byte
  }

  get len(): number {
    return this.text.length;
  }

  skip(): void {
    while (this.pos < this.len && this.text.charCodeAt(this.pos) < 0x21) this.pos++;
  }

  next(buf = "tok"): string {
    this.skip();
    if (this.pos < this.len) {
      const start = this.pos;
      while (this.pos < this.len && this.text.charCodeAt(this.pos) > 0x20) this.pos++;
      this.buffers.set(buf, this.text.slice(start, this.pos));
      this.skip();
    }
    return this.buffers.get(buf) ?? "";
  }

  /** /: next token, atoi, s16; null = at end, destination unchanged. */
  short(): number | null {
    this.skip();
    if (this.pos >= this.len) return null;
    return s16(cAtoi(this.next("num")));
  }

  atEnd(): boolean {
    return this.pos >= this.len;
  }

  /** scan from the start for a token equal to name; true only if text remains. */
  findSection(name: string): boolean {
    const want = cUpper(name);
    this.pos = 0;
    for (;;) {
      const tok = this.next("section");
      if (cUpper(tok) === want || this.pos >= this.len) break;
    }
    return this.pos < this.len;
  }
}

/** All tokens of the text (Text_NextToken until the end). */
export function tokens(plain: Uint8Array): string[] {
  const t = new Tokens(plain);
  t.skip();
  const out: string[] = [];
  while (!t.atEnd()) out.push(t.next());
  return out;
}

function int(tok: string | undefined, what: string): number {
  // atoi into an int16; the data only has plain decimal numbers
  if (tok === undefined) throw new GlobalError(`truncated: ${what} missing at end of file`);
  if (!/^-?\d+$/.test(tok)) throw new GlobalError(`${what}: not a number: '${tok}'`);
  const v = Number(tok);
  if (v < -0x8000 || v > 0x7fff) throw new GlobalError(`${what}: ${v} does not fit in int16`);
  return v;
}

function sectionName(tok: string): string {
  const name = cUpper(tok.replace(/[[\]]/g, ""));
  if (name.length > SECTION_NAME_MAX) throw new GlobalError(`section name too long: [${name}]`);
  return name;
}

function frameName(tok: string): string {
  const name = cUpper(tok);
  if (name.length > FRAME_NAME_MAX) {
    throw new GlobalError(`frame name too long (${name.length} > ${FRAME_NAME_MAX}): ${name}`);
  }
  return name;
}

class Stream {
  pos = 0;
  constructor(readonly toks: string[]) {}
  next(): string | undefined {
    return this.pos < this.toks.length ? this.toks[this.pos++] : undefined;
  }
  done(): boolean {
    return this.pos >= this.toks.length;
  }
}

// ---------------------------------------------------------------- .ICS

export interface IcsEffect {
  /** scene: name from <scene>.SSD; GLOBAL.ICS: a GLOBAL.PAK file */
  sound: string;
  /** 0 = channels 1 and 2, else the channel number */
  channel: number;
  /** read into and never used */
  unused: number;
  /** 0..64 */
  volume: number;
}

export interface IcsFrame {
  file: string;
  /** hot spot X when Jack faces right */
  xRight: number;
  /** hot spot X of the mirrored frame (facing left) */
  xLeft: number;
  /** hot spot Y (feet) */
  y: number;
  /** [dx, dy] of shadow 1 from Jack's position; dx >= NO_SHADOW = none */
  shadow1: [number, number];
  shadow2: [number, number];
  effect: IcsEffect | null;
}

export interface IcsSection {
  name: string;
  frames: IcsFrame[];
  /** EFFECT right before the next '[' or the end of the text (the game drops it) */
  trailingEffect?: IcsEffect;
}

export interface Ics {
  sections: IcsSection[];
  /** [section, sound] of EFFECTs right before a '[' or the end: the game drops them */
  lostEffects: [string, string][];
}

export function frameValues(f: IcsFrame): number[] {
  return [f.xRight, f.xLeft, f.y, ...f.shadow1, ...f.shadow2];
}

export function findSection(ics: Ics, name: string): IcsSection | undefined {
  return ics.sections.find((s) => s.name === cUpper(name));
}

/**
 * Decrypted .ICS -> Ics. globalFile: GLOBAL.ICS, read by Ics_LoadSection one section at a time
 * (limits apply per section), which compares the token with "EFFECT" without upper-casing it.
 */
export function parseIcs(plain: Uint8Array, globalFile = false): Ics {
  const s = new Stream(tokens(plain));
  const first = s.next();
  if (first === undefined) throw new GlobalError("empty file");
  if (!first.startsWith("[")) throw new GlobalError(`file does not start with a section: '${first}'`);
  const sections: IcsSection[] = [];
  const lost: [string, string][] = [];
  let cur: IcsSection = { name: sectionName(first), frames: [] };
  sections.push(cur);
  let effect: IcsEffect | null = null;
  while (!s.done()) {
    const tok = s.next()!;
    const isEffect = globalFile ? tok === "EFFECT" : cUpper(tok) === "EFFECT";
    if (isEffect) {
      if (effect) {
        throw new GlobalError(`[${cur.name}]: two EFFECTs before one frame (the game reads the second as a frame name)`);
      }
      const sound = s.next();
      if (sound === undefined) throw new GlobalError(`[${cur.name}]: truncated EFFECT`);
      const what = `[${cur.name}] EFFECT`;
      effect = { sound: frameName(sound), channel: int(s.next(), what), unused: int(s.next(), what), volume: int(s.next(), what) };
      continue;
    }
    if (tok.startsWith("[")) {
      if (effect) {
        lost.push([cur.name, effect.sound]);
        cur.trailingEffect = effect;
      }
      effect = null;
      cur = { name: sectionName(tok), frames: [] };
      sections.push(cur);
      continue;
    }
    const file = frameName(tok);
    const v = Array.from({ length: 7 }, (_, i) => int(s.next(), `[${cur.name}] ${file} value ${i + 1}`));
    cur.frames.push({ file, xRight: v[0], xLeft: v[1], y: v[2], shadow1: [v[3], v[4]], shadow2: [v[5], v[6]], effect });
    effect = null;
  }
  if (effect) {
    lost.push([cur.name, effect.sound]);
    cur.trailingEffect = effect;
  }
  const ics: Ics = { sections, lostEffects: lost };
  if (globalFile) {
    const biggest = Math.max(...sections.map((x) => x.frames.length));
    if (biggest > ICS_MAX_FRAMES) throw new GlobalError(`a section has ${biggest} frames, the game allows ${ICS_MAX_FRAMES}`);
    return ics;
  }
  if (sections.length > ICS_MAX_SECTIONS) {
    throw new GlobalError(`${sections.length} sections, the game allows ${ICS_MAX_SECTIONS}`);
  }
  const frames = sections.reduce((n, x) => n + x.frames.length, 0);
  if (frames > ICS_MAX_FRAMES) throw new GlobalError(`${frames} frames, the game allows ${ICS_MAX_FRAMES}`);
  return ics;
}

// ---------------------------------------------------------------- .FCM

export interface FcmEffect {
  /** fires right before this frame index is drawn (0 = background) */
  frame: number;
  /** as written; the game plays it with extension .S16 (see fcmEffectFile) */
  sound: string;
  /** 0 = channels 1 and 2 */
  channel: number;
  unused: number;
  /** stored as a byte, 0..64 */
  volume: number;
}

export interface FcmFrame {
  file: string;
  /** offset over the background, only for positioned films */
  x: number;
  y: number;
}

export interface FcmFilm {
  name: string;
  /** |N|: Timer_WaitSinceFrameStart(N) per frame; the last frame is held 3*N ms */
  frameMs: number;
  /** N < 0: every frame after the background has "x y" */
  positioned: boolean;
  /** frames[0] is the background, drawn once */
  frames: FcmFrame[];
  effects: FcmEffect[];
}

/** Path_SetExtension(name, "S16") in Fcm_LoadSection. */
export function fcmEffectFile(e: FcmEffect): string {
  const dot = e.sound.lastIndexOf(".");
  return (dot >= 0 ? e.sound.slice(0, dot) : e.sound) + ".S16";
}

export function parseFcm(plain: Uint8Array): FcmFilm[] {
  const s = new Stream(tokens(plain));
  const films: FcmFilm[] = [];
  let tok = s.next();
  if (tok === undefined) throw new GlobalError("empty file");
  if (!tok.startsWith("[")) throw new GlobalError(`file does not start with a section: '${tok}'`);
  while (tok !== undefined) {
    const film: FcmFilm = { name: sectionName(tok), frameMs: 0, positioned: false, frames: [], effects: [] };
    films.push(film);
    const n = int(s.next(), `[${film.name}] frame time`);
    film.frameMs = Math.abs(n);
    film.positioned = n < 0;
    if (film.positioned) {
      const bg = s.next();
      if (bg === undefined) throw new GlobalError(`[${film.name}]: background missing`);
      film.frames.push({ file: frameName(bg), x: 0, y: 0 });
    }
    tok = undefined;
    while (!s.done()) {
      const t = s.next()!;
      if (cUpper(t) === "EFFECT") {
        const sound = s.next();
        if (sound === undefined) throw new GlobalError(`[${film.name}]: truncated EFFECT`);
        const what = `[${film.name}] EFFECT`;
        film.effects.push({
          frame: film.frames.length,
          sound: frameName(sound),
          channel: int(s.next(), what),
          unused: int(s.next(), what),
          volume: int(s.next(), what),
        });
        continue;
      }
      if (t.startsWith("[")) {
        tok = t;
        break;
      }
      const frame: FcmFrame = { file: frameName(t), x: 0, y: 0 };
      if (film.positioned) {
        frame.x = int(s.next(), `[${film.name}] ${frame.file} x`);
        frame.y = int(s.next(), `[${film.name}] ${frame.file} y`);
      }
      film.frames.push(frame);
    }
    if (film.effects.length > FCM_MAX_EFFECTS) {
      throw new GlobalError(`[${film.name}]: ${film.effects.length} effects, the table holds ${FCM_MAX_EFFECTS}`);
    }
    if (film.frames.length < 2) throw new GlobalError(`[${film.name}]: needs a background and at least one frame`);
  }
  return films;
}

// ---------------------------------------------------------------- GLOBAL.CCG.MCC.SSD

export interface CcgItem {
  name: string;
  /** 13 numbers; their meaning is the scene .CCG format */
  values: number[];
}

/** GLOBAL.CCG: [elementy], then items "NAME.BM" + 13 numbers, closed by "[]". */
export function parseGlobalCcg(plain: Uint8Array): CcgItem[] {
  const s = new Stream(tokens(plain));
  if (s.next() !== "[elementy]") throw new GlobalError("GLOBAL.CCG must start with [elementy]");
  const items: CcgItem[] = [];
  for (;;) {
    const tok = s.next();
    if (tok === undefined) throw new GlobalError("GLOBAL.CCG: missing closing []");
    if (tok === "[]") break;
    const name = frameName(tok);
    items.push({ name, values: Array.from({ length: 13 }, (_, i) => int(s.next(), `${tok} value ${i + 1}`)) });
  }
  if (!s.done()) throw new GlobalError("GLOBAL.CCG: data after []");
  return items;
}

export interface MacroSection {
  name: string;
  /** command lines as written (compiled by Script_CompileMacros, meaning) */
  lines: string[];
}

export function parseMacros(plain: Uint8Array): MacroSection[] {
  const sections: MacroSection[] = [];
  let text = "";
  for (let i = 0; i < plain.length; i++) text += String.fromCharCode(plain[i]);
  for (const raw of text.split("\r\n")) {
    // like Python bytes.strip(): ASCII whitespace
    const line = raw.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, "");
    if (!line) continue;
    if (line.startsWith("[") && line.endsWith("]")) sections.push({ name: line.slice(1, -1), lines: [] });
    else if (!sections.length) throw new GlobalError(`command before the first section: '${line}'`);
    else sections[sections.length - 1].lines.push(line);
  }
  if (!sections.length) throw new GlobalError("no sections");
  return sections;
}

/** .SSD: list of sound file names (Sound_LoadSceneSfx). */
export function parseSsd(plain: Uint8Array): string[] {
  const names = tokens(plain).map(frameName);
  if (!names.length) throw new GlobalError("empty sound list");
  return names;
}

// ---------------------------------------------------------------- .SFB

/** [xRight, xLeft, y]: the same hot spot as ICS values 1-3. */
export type HotSpot = [number, number, number];

/** Frame counts of the series each table belongs to. */
export const SFB_COUNTS: Record<string, number> = {
  FRON: 12, BACK: 12, PROF: 12, SKFR: 12, SKBA: 12,
  FRONW: 12, BACKW: 12, PROFW: 12, SKFRW: 12, SKBAW: 12,
  ROTP: 17, ROTW: 17, OBPLBF: 8, OBPLFB: 8, PROPRO: 9,
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`OBPL_${i}`, 4])),
};

export function parseSfb(data: Uint8Array): HotSpot[] {
  if (data.length === 0 || data.length % 6) throw new GlobalError(`size ${data.length} is not a multiple of 6`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const out: HotSpot[] = [];
  for (let i = 0; i < data.length; i += 6) out.push([dv.getInt16(i, true), dv.getInt16(i + 2, true), dv.getInt16(i + 4, true)]);
  return out;
}

// ---------------------------------------------------------------- CM*.BIN

/**
 * CM<d>.BIN: d/2 uint16 = pixels cleared at each side of row i of the top half of a d-pixel
 * frame (bottom half mirrored): a circle mask (Film_Play).
 */
export function parseCm(name: string, data: Uint8Array): number[] {
  const m = /^CM(\d+)\.BIN$/i.exec(name);
  if (!m) throw new GlobalError(`not a CM<size>.BIN name: ${name}`);
  const d = Number(m[1]);
  if (data.length !== d) throw new GlobalError(`size ${data.length}, expected ${d} (${d >> 1} uint16 values)`);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const v = Array.from({ length: d >> 1 }, (_, i) => dv.getUint16(i * 2, true));
  for (let i = 1; i < v.length; i++) if (v[i - 1] < v[i]) throw new GlobalError("row widths are not non-increasing");
  if (v[v.length - 1] !== 0 || v[0] > d >> 1) {
    throw new GlobalError(`values out of range: first ${v[0]}, last ${v[v.length - 1]}`);
  }
  return v;
}

// ---------------------------------------------------------------- dispatch

export const PATTERNS = ["*.ICS", "*.FCM", "GLOBAL.CCG", "GLOBAL.MCC", "GLOBAL.SSD", "*.SFB", "CM*.BIN"];

export type GlobalKind = "ics" | "fcm" | "ccg" | "mcc" | "ssd" | "sfb" | "cm";

export function kindOf(name: string): string {
  const u = name.toUpperCase();
  if (u.startsWith("CM") && u.endsWith(".BIN")) return "cm";
  return u.slice(u.lastIndexOf(".") + 1).toLowerCase();
}

export type Decoded =
  | { kind: "ics"; value: Ics }
  | { kind: "fcm"; value: FcmFilm[] }
  | { kind: "ccg"; value: CcgItem[] }
  | { kind: "mcc"; value: MacroSection[] }
  | { kind: "ssd"; value: string[] }
  | { kind: "sfb"; value: HotSpot[] }
  | { kind: "cm"; value: number[] };

/** Parses any file matching PATTERNS (raw, still encrypted where the game encrypts it). */
export function decodeGlobal(name: string, data: Uint8Array): Decoded {
  const kind = kindOf(name);
  switch (kind) {
    case "ics":
      return { kind, value: parseIcs(decrypt(data), name.toUpperCase() === "GLOBAL.ICS") };
    case "fcm":
      return { kind, value: parseFcm(decrypt(data)) };
    case "ccg":
      return { kind, value: parseGlobalCcg(decrypt(data)) };
    case "mcc":
      return { kind, value: parseMacros(decrypt(data)) };
    case "ssd":
      return { kind, value: parseSsd(decrypt(data)) };
    case "sfb": {
      const entries = parseSfb(data);
      const expected = SFB_COUNTS[name.toUpperCase().slice(0, -4)];
      if (expected === undefined) throw new GlobalError(`unknown .SFB table ${name}`);
      if (entries.length !== expected) throw new GlobalError(`${entries.length} entries, the series has ${expected} frames`);
      return { kind, value: entries };
    }
    case "cm":
      return { kind, value: parseCm(name, data) };
  }
  throw new GlobalError(`not a global data file: ${name}`);
}
