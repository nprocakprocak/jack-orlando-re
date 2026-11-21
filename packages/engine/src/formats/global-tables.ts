import { viewOf } from "./bytes";
import { GlobalError, cUpper, tokens } from "./global-tokens";

/** Fixed-size name buffers in the game's tables (name + NUL). */
export const FRAME_NAME_MAX = 13;
export const SECTION_NAME_MAX = 29;
export const ICS_MAX_FRAMES = 1000;
export const ICS_MAX_SECTIONS = 60;
export const FCM_MAX_EFFECTS = 20;
/** ICS shadow offset >= 1000: no shadow for this frame. */
export const NO_SHADOW = 1000;


export function int(tok: string | undefined, what: string): number {
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

export function frameName(tok: string): string {
  const name = cUpper(tok);
  if (name.length > FRAME_NAME_MAX) {
    throw new GlobalError(`frame name too long (${name.length} > ${FRAME_NAME_MAX}): ${name}`);
  }
  return name;
}

export class Stream {
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
  const dv = viewOf(data);
  const v = Array.from({ length: d >> 1 }, (_, i) => dv.getUint16(i * 2, true));
  for (let i = 1; i < v.length; i++) if (v[i - 1] < v[i]) throw new GlobalError("row widths are not non-increasing");
  if (v[v.length - 1] !== 0 || v[0] > d >> 1) {
    throw new GlobalError(`values out of range: first ${v[0]}, last ${v[v.length - 1]}`);
  }
  return v;
}
