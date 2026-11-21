import { describe, expect, it } from "vitest";
import {
  decodeGlobal,
  fcmEffectFile,
  frameValues,
  GlobalError,
  parseCm,
  parseFcm,
  parseGlobalCcg,
  parseIcs,
  parseMacros,
  parseSfb,
  parseSsd,
  tokens,
} from "./global";
const enc = (text: string) => {
  const b = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) b[i] = text.charCodeAt(i);
  return b;
};
const crlf = (...lines: string[]) => enc(lines.join("\r\n") + "\r\n");

describe("ICS (synthetic)", () => {
  const ics = (...lines: string[]) => parseIcs(crlf(...lines));

  it("tokenizes on bytes <= 0x20 like Text_NextToken", () => {
    expect(tokens(enc("  [A]\t\r\nB.PBM 1\x01-2 "))).toEqual(["[A]", "B.PBM", "1", "-2"]);
  });

  it("reads sections, frames and an EFFECT attached to the next frame", () => {
    const r = ics("[walk]", "a.pbm 1 2 3 4 5 1000 1000", "Effect step.snd 0 20 30", "B.PBM -1 -2 -3 -4 -5 -6 -7", "[Two]", "C.PBM 0 0 0 0 0 0 0");
    expect(r.sections.map((s) => s.name)).toEqual(["WALK", "TWO"]);
    const [a, b] = r.sections[0].frames;
    expect(a).toEqual({ file: "A.PBM", xRight: 1, xLeft: 2, y: 3, shadow1: [4, 5], shadow2: [1000, 1000], effect: null });
    expect(b.effect).toEqual({ sound: "STEP.SND", channel: 0, unused: 20, volume: 30 });
    expect(frameValues(b)).toEqual([-1, -2, -3, -4, -5, -6, -7]);
    expect(r.lostEffects).toEqual([]);
  });

  it("drops an EFFECT before a section or at the end", () => {
    const r = ics("[A]", "X.PBM 0 0 0 0 0 0 0", "EFFECT S1 1 2 3", "[B]", "Y.PBM 0 0 0 0 0 0 0", "EFFECT S2 1 2 3");
    expect(r.lostEffects).toEqual([["A", "S1"], ["B", "S2"]]);
    expect(r.sections[1].frames[0].effect).toBeNull();
  });

  it("GLOBAL.ICS loader recognizes only upper-case EFFECT", () => {
    const text = crlf("[A]", "Effect S 1 2 3", "X.PBM 0 0 0 0 0 0 0");
    expect(parseIcs(text).sections[0].frames[0].effect?.sound).toBe("S");
    // Ics_LoadSection reads "Effect" as a frame name, "S" as its first value
    expect(() => parseIcs(text, true)).toThrow("not a number: 'S'");
  });

  it("rejects broken files", () => {
    expect(() => parseIcs(enc(" \r\n"))).toThrow("empty file");
    expect(() => ics("X.PBM 1 2 3 4 5 6 7")).toThrow("does not start with a section");
    expect(() => ics("[A]", "X.PBM 1 2 3")).toThrow("truncated: [A] X.PBM value 4");
    expect(() => ics("[A]", "X.PBM 1 2 3 4 5 6 x")).toThrow("not a number");
    expect(() => ics("[A]", "X.PBM 1 2 3 4 5 6 40000")).toThrow("does not fit in int16");
    expect(() => ics("[A]", "ABCDEFGHIJ.PBM 0 0 0 0 0 0 0")).toThrow("frame name too long (14 > 13)");
    expect(() => ics(`[${"N".repeat(30)}]`)).toThrow("section name too long");
    expect(() => ics("[A]", "EFFECT S 1 2 3", "EFFECT T 1 2 3", "X.PBM 0 0 0 0 0 0 0")).toThrow("two EFFECTs");
    expect(() => ics("[A]", "EFFECT")).toThrow("truncated EFFECT");
  });

  it("enforces the game's table limits", () => {
    const sections = Array.from({ length: 61 }, (_, i) => `[S${i}]`);
    expect(() => ics(...sections)).toThrow("61 sections, the game allows 60");
    const frames = Array.from({ length: 1001 }, () => "X.PBM 0 0 0 0 0 0 0");
    expect(() => ics("[A]", ...frames)).toThrow("1001 frames, the game allows 1000");
    // GLOBAL.ICS sections are loaded one at a time: many sections are fine, a huge one is not
    expect(parseIcs(crlf(...sections), true).sections.length).toBe(61);
    expect(() => parseIcs(crlf("[A]", ...frames), true)).toThrow("a section has 1001 frames");
  });
});

describe("FCM (synthetic)", () => {
  const fcm = (...lines: string[]) => parseFcm(crlf(...lines));

  it("reads plain films: first frame is the background, effects index the next frame", () => {
    const [f] = fcm("[film]", "80", "bg.pbm", "Effect s.snd 0 64 64", "EFFECT t.snd 2 1 9", "F1.PBM", "F2.PBM");
    expect(f).toMatchObject({ name: "FILM", frameMs: 80, positioned: false });
    expect(f.frames.map((x) => x.file)).toEqual(["BG.PBM", "F1.PBM", "F2.PBM"]);
    expect(f.effects).toEqual([
      { frame: 1, sound: "S.SND", channel: 0, unused: 64, volume: 64 },
      { frame: 1, sound: "T.SND", channel: 2, unused: 1, volume: 9 },
    ]);
    expect(fcmEffectFile(f.effects[0])).toBe("S.S16");
    expect(fcmEffectFile({ ...f.effects[0], sound: "NOEXT" })).toBe("NOEXT.S16");
  });

  it("reads positioned films (negative time) and several films", () => {
    const films = fcm("[A]", "-120", "BG.PBM", "F1.PBM 10 -20", "[B]", "50", "X.PBM", "Y.PBM");
    expect(films[0]).toMatchObject({ frameMs: 120, positioned: true });
    expect(films[0].frames).toEqual([{ file: "BG.PBM", x: 0, y: 0 }, { file: "F1.PBM", x: 10, y: -20 }]);
    expect(films[1].frames.length).toBe(2);
  });

  it("rejects broken films", () => {
    expect(() => parseFcm(enc(""))).toThrow("empty file");
    expect(() => fcm("100")).toThrow("does not start with a section");
    expect(() => fcm("[A]")).toThrow("truncated: [A] frame time");
    expect(() => fcm("[A]", "-10")).toThrow("background missing");
    expect(() => fcm("[A]", "-10", "BG", "F1 5")).toThrow("truncated: [A] F1 y");
    expect(() => fcm("[A]", "10", "BG")).toThrow("needs a background and at least one frame");
    expect(() => fcm("[A]", "10", "BG", "F", "EFFECT")).toThrow("truncated EFFECT");
    const effects = Array.from({ length: 21 }, () => "EFFECT S 1 1 1");
    expect(() => fcm("[A]", "10", "BG", "F", ...effects)).toThrow("21 effects, the table holds 20");
  });
});

describe("GLOBAL.CCG / MCC / SSD (synthetic)", () => {
  it("reads inventory items of GLOBAL.CCG", () => {
    const nums = "16 0 500 1 1 0 0 3 1 4 4 1 3";
    expect(parseGlobalCcg(crlf("[elementy]", `a.bm ${nums}`, "[]"))).toEqual([
      { name: "A.BM", values: [16, 0, 500, 1, 1, 0, 0, 3, 1, 4, 4, 1, 3] },
    ]);
    expect(() => parseGlobalCcg(crlf("[grafiki]"))).toThrow("must start with [elementy]");
    expect(() => parseGlobalCcg(crlf("[elementy]", `A.BM ${nums}`))).toThrow("missing closing []");
    expect(() => parseGlobalCcg(crlf("[elementy]", "A.BM 1 2"))).toThrow("truncated");
    expect(() => parseGlobalCcg(crlf("[elementy]", "[]", "X"))).toThrow("data after []");
  });

  it("splits macros into sections of command lines", () => {
    expect(parseMacros(crlf("", "[A-B]", "  HaveTool X.BM ", "\tLet SILNY 1", "[C]"))).toEqual([
      { name: "A-B", lines: ["HaveTool X.BM", "Let SILNY 1"] },
      { name: "C", lines: [] },
    ]);
    expect(() => parseMacros(crlf("Let X 1"))).toThrow("command before the first section");
    expect(() => parseMacros(crlf(""))).toThrow("no sections");
  });

  it("reads sound lists", () => {
    expect(parseSsd(crlf("a.snd", "B.S16"))).toEqual(["A.SND", "B.S16"]);
    expect(() => parseSsd(crlf(""))).toThrow("empty sound list");
  });
});

describe("SFB and CM (synthetic)", () => {
  const i16 = (...v: number[]) => new Uint8Array(new Int16Array(v).buffer);

  it("reads hot-spot triples and checks the series length", () => {
    expect(parseSfb(i16(47, 59, 257, -6, 94, 259))).toEqual([[47, 59, 257], [-6, 94, 259]]);
    expect(() => parseSfb(new Uint8Array(0))).toThrow("not a multiple of 6");
    expect(() => parseSfb(new Uint8Array(7))).toThrow("not a multiple of 6");
    const twelve = i16(...Array.from({ length: 36 }, (_, i) => i));
    expect(decodeGlobal("FRON.SFB", twelve).value).toHaveLength(12);
    expect(() => decodeGlobal("OBPL_0.SFB", twelve)).toThrow("12 entries, the series has 4 frames");
    expect(() => decodeGlobal("XYZ.SFB", twelve)).toThrow("unknown .SFB table");
  });

  it("reads circle masks", () => {
    expect(parseCm("CM8.BIN", i16(3, 1, 1, 0))).toEqual([3, 1, 1, 0]);
    expect(() => parseCm("MASK.BIN", i16(0))).toThrow("not a CM<size>.BIN name");
    expect(() => parseCm("CM8.BIN", i16(3, 1, 0))).toThrow("size 6, expected 8");
    expect(() => parseCm("CM8.BIN", i16(1, 3, 1, 0))).toThrow("not non-increasing");
    expect(() => parseCm("CM8.BIN", i16(3, 2, 1, 1))).toThrow("values out of range");
    expect(() => parseCm("CM8.BIN", i16(5, 2, 1, 0))).toThrow("values out of range");
  });

  it("rejects names outside the patterns", () => {
    expect(() => decodeGlobal("X.TXT", new Uint8Array(1))).toThrow(GlobalError);
  });
});
