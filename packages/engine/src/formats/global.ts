// Global data files: frame lists .ICS.FCM, GLOBAL.CCG/.MCC/.SSD, hot-spot tables *.SFB,
// circle masks CM*.BIN.
// The .ICS and .FCM parsers follow the game's loaders token by token (Ics_LoadSection /
// Scene_LoadIcs, Fcm_LoadSection / Scene_LoadFcm), so they read
// GLOBAL.ICS/FCM and the scene copies alike. Same model as the external checker.
import { viewOf } from "./bytes";
import { decrypt } from "./textcrypt";
import { GlobalError, tokens } from "./global-tokens";
import { Stream, frameName, int, parseCm, parseFcm, parseIcs, type FcmFilm, type Ics } from "./global-tables";
export { GlobalError, Tokens, bracketName, cAtof, cAtoi, cUpper, s16, strBetween, tokens } from "./global-tokens";
export {
  FCM_MAX_EFFECTS,
  FRAME_NAME_MAX,
  ICS_MAX_FRAMES,
  ICS_MAX_SECTIONS,
  NO_SHADOW,
  SECTION_NAME_MAX,
  fcmEffectFile,
  findSection,
  frameValues,
  parseCm,
  parseFcm,
  parseIcs,
} from "./global-tables";
export type { FcmEffect, FcmFilm, FcmFrame, Ics, IcsEffect, IcsFrame, IcsSection } from "./global-tables";

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
    items.push({
      name,
      values: Array.from({ length: 13 }, (_, i) => int(s.next(), `${tok} value ${i + 1}`)),
    });
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
  FRON: 12,
  BACK: 12,
  PROF: 12,
  SKFR: 12,
  SKBA: 12,
  FRONW: 12,
  BACKW: 12,
  PROFW: 12,
  SKFRW: 12,
  SKBAW: 12,
  ROTP: 17,
  ROTW: 17,
  OBPLBF: 8,
  OBPLFB: 8,
  PROPRO: 9,
  ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`OBPL_${i}`, 4])),
};

export function parseSfb(data: Uint8Array): HotSpot[] {
  if (data.length === 0 || data.length % 6) throw new GlobalError(`size ${data.length} is not a multiple of 6`);
  const dv = viewOf(data);
  const out: HotSpot[] = [];
  for (let i = 0; i < data.length; i += 6)
    out.push([dv.getInt16(i, true), dv.getInt16(i + 2, true), dv.getInt16(i + 4, true)]);
  return out;
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
      if (entries.length !== expected)
        throw new GlobalError(`${entries.length} entries, the series has ${expected} frames`);
      return { kind, value: entries };
    }
    case "cm":
      return { kind, value: parseCm(name, data) };
  }
  throw new GlobalError(`not a global data file: ${name}`);
}
