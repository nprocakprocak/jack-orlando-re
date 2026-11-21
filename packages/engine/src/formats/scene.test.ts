import { describe, expect, it } from "vitest";
import { Pak } from "./pak";
import {
  bracketName,
  cAtof,
  cAtoi,
  cUpper,
  findTriangle,
  jackStart,
  parseAce,
  parseAci,
  parseCcg,
  parseIcs,
  parseMcc,
  parsePcs,
  parseScene,
  parseSsd,
  perspectiveScale,
  psdName,
  quadCenter,
  quadIsConvex,
  s16,
  SceneError,
  sceneNameOf,
  strBetween,
  Tokens,
  tokens,
  triangleContains,
} from "./scene";
import { encrypt } from "./textcrypt";

// --- synthetic data ----------------------------------------------------------

const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
const lines = (...l: string[]) => ascii(l.join("\r\n") + "\r\n");

/** Minimal .PAK bytes with encrypted text files. */
function pakOf(files: Record<string, Uint8Array>): Pak {
  const names = Object.keys(files);
  let dirSize = 16;
  for (const n of names) dirSize += 12 + n.length + 1;
  const total = dirSize + names.reduce((s, n) => s + files[n].length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set(ascii("PAK\0"));
  v.setUint32(4, names.length, true);
  v.setUint32(8, dirSize, true);
  let pos = 16;
  let off = dirSize;
  for (const n of names) {
    v.setUint32(pos, off, true);
    v.setUint32(pos + 4, files[n].length, true);
    v.setUint32(pos + 8, n.length + 1, true);
    out.set(ascii(n), pos + 12);
    pos += 12 + n.length + 1;
    out.set(files[n], off);
    off += files[n].length;
  }
  return new Pak(out);
}

describe("scene tokenizer", () => {
  it("parses numbers like C atoi/atof", () => {
    expect(cAtoi("12abc")).toBe(12);
    expect(cAtoi("-7")).toBe(-7);
    expect(cAtoi("+3")).toBe(3);
    expect(cAtoi("x1")).toBe(0);
    expect(cAtof("0.630000")).toBeCloseTo(0.63);
    expect(cAtof("1.")).toBe(1);
    expect(cAtof("2e2x")).toBe(200);
    expect(cAtof("abc")).toBe(0);
  });

  it("wraps values stored in shorts", () => {
    expect(s16(65504)).toBe(-32);
    expect(s16(32767)).toBe(32767);
    expect(s16(32768)).toBe(-32768);
  });

  it("upper-cases only a-z and extracts bracket names", () => {
    expect(cUpper("ab\x86c")).toBe("AB\x86C");
    expect(bracketName("[LEWO]")).toBe("LEWO");
    expect(bracketName("[]")).toBe("");
    expect(bracketName("[OPEN")).toBe("OPEN");
    expect(bracketName("NONE")).toBe("");
  });

  it("Str_Between with other delimiters; tokens() lists every token", () => {
    expect(strBetween("a(b)c", "(", ")")).toBe("b");
    expect(strBetween("a(bc", "(", ")")).toBe("bc");
    expect(strBetween("abc", "(", ")")).toBe("");
    expect(tokens(ascii("  a\tbb\r\n[C] "))).toEqual(["a", "bb", "[C]"]);
    expect(tokens(ascii(" \r\n"))).toEqual([]);
  });

  it("returns the previous token at the end of the text", () => {
    const t = new Tokens(ascii(" a\tbb\r\n"));
    expect(t.next()).toBe("a");
    expect(t.next()).toBe("bb");
    expect(t.atEnd()).toBe(true);
    expect(t.next()).toBe("bb");
    expect(t.short()).toBeNull();
  });

  it("finds sections from the start, case-insensitive, only if text follows", () => {
    const t = new Tokens(ascii("[B] 1 [a] 2 [C]"));
    expect(t.findSection("[A]")).toBe(true);
    expect(t.next()).toBe("2");
    expect(t.findSection("[b]")).toBe(true);
    expect(t.findSection("[C]")).toBe(false); // last token: nothing left after it
    expect(t.findSection("[D]")).toBe(false);
  });
});

describe("CCG on synthetic data", () => {
  const obj = (name: string, type: number, x: number, y: number, quad = "1 0 9 0 9 5 1 5") =>
    `${name} ${type} ${x} ${y} 1.000000 0.500000 ${quad}`;

  it("rejects an empty file and a file without [grafiki]", () => {
    expect(() => parseCcg(new Uint8Array(0))).toThrow(SceneError);
    expect(() => parseCcg(lines("[elementy]", "X.BM 16 0 0 1 1 0 0 0 0 0 0 0 0"))).toThrow(/grafiki/);
  });

  it("reads background, objects, z order and the other sections", () => {
    const c = parseCcg(
      lines(
        "[grafiki]",
        "DEK.BM",
        obj("a.pbm", 8, 10, 20),
        obj("FLX0", 16, 5, 6),
        obj("B.PBM", -8, 1, 2),
        "",
        "[perspektywa]",
        "310 220 416 0.630000",
        "[obszar_chodu]",
        "2",
        "0 0 10 -5 20 0",
        "1 2 3 4 5 6",
        "[kolor_liter]",
        "1 65504 1 63480 1 63480",
        "[swiatlo]",
        "320 0",
        "100 7",
        "[elementy]",
        obj("IPODK.BM", 16, 0, 500),
        "[]",
      ),
    );
    expect(c.background).toBe("DEK.BM");
    expect(c.wide).toBe(false);
    expect(c.graphics).toBe(3);
    expect(c.count).toBe(4);
    expect(c.objects.map((o) => o.name)).toEqual(["A.PBM", "FLX0", "B.PBM", "IPODK.BM"]);
    expect(c.objects[0]).toMatchObject({
      kind: "graphic",
      type: 8,
      x: 10,
      y: 20,
      scale: 1000000,
      scaleB: 500000,
      flx: false,
    });
    expect(c.objects[1].flx).toBe(true);
    expect(c.objects[1].quad).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(c.objects[2].type).toBe(-8);
    expect(c.objects[3].kind).toBe("element");
    expect(c.perspective).toEqual({ a: 310, horizonY: 220, refY: 416, refScale: 630000 });
    expect(c.walk).toEqual([
      [0, 0, 10, -5, 20, 0],
      [1, 2, 3, 4, 5, 6],
    ]);
    expect(c.textColors).toEqual([1, -32, 1, -2056, 1, -2056]);
    expect(c.lights).toEqual([
      [320, 0],
      [100, 7],
    ]);
  });

  it("scrolled background: '+' suffix, start offset clamped to 0x178 and aligned to 4", () => {
    expect(parseCcg(lines("[grafiki]", "DEK.BM+", "7", "[]"))).toMatchObject({
      background: "DEK.BM",
      wide: true,
      scroll: 4,
    });
    expect(parseCcg(lines("[grafiki]", "DEK.BM+", "999", "[]")).scroll).toBe(0x178);
  });

  it("drops an object that ends exactly at the end of the text", () => {
    const c = parseCcg(lines("[grafiki]", "DEK.BM", obj("A.BM", 16, 0, 0), obj("B.BM", 16, 0, 0)));
    expect(c.count).toBe(1);
    const e = parseCcg(lines("[grafiki]", "DEK.BM", obj("A.BM", 16, 0, 0), "[elementy]", obj("I.BM", 16, 0, 500)));
    expect(e.count).toBe(1);
    expect(e.objects).toHaveLength(2); // read, but ignored by the game
  });

  it("uses only the first [elementy] section", () => {
    const c = parseCcg(
      lines("[grafiki]", "DEK.BM", "[elementy]", obj("I.BM", 16, 0, 500), "[elementy]", obj("J.BM", 16, 0, 500), "[]"),
    );
    expect(c.objects.map((o) => o.name)).toEqual(["I.BM"]);
  });

  it("missing optional sections give defaults", () => {
    const c = parseCcg(lines("[grafiki]", "DEK.BM", "[]"));
    expect(c).toMatchObject({
      count: 0,
      perspective: null,
      lights: [],
      walk: [],
      textColors: null,
    });
  });
});

describe("scene geometry", () => {
  it("quad center is the intersection of the diagonals", () => {
    expect(quadCenter([0, 0, 10, 0, 10, 10, 0, 10])).toEqual([5, 5]);
    expect(quadCenter([0, 0, 0, 0, 0, 0, 0, 0])).toBeNull();
  });

  it("convexity follows the game's turn direction", () => {
    expect(quadIsConvex([0, 0, 10, 0, 10, 10, 0, 10])).toBe(true);
    expect(quadIsConvex([0, 0, 0, 10, 10, 10, 10, 0])).toBe(false);
    expect(quadIsConvex([0, 0, 0, 0, 0, 0, 0, 0])).toBe(false);
  });

  it("point in triangle like Walk_FindTriangle", () => {
    const up = [0, 10, 5, 0, 10, 10]; // apex above the long edge
    expect(triangleContains(up, 5, 5)).toBe(true);
    expect(triangleContains(up, 1, 1)).toBe(false);
    expect(triangleContains(up, 11, 9)).toBe(false);
    const down = [0, 0, 5, 10, 10, 0]; // apex below
    expect(triangleContains(down, 5, 5)).toBe(true);
    expect(triangleContains(down, 1, 9)).toBe(false);
    expect(findTriangle([up, down], 5, 5)).toBe(0);
    expect(findTriangle([up, down], 5, 5, 1)).toBe(1);
    expect(findTriangle([up, down], 50, 5)).toBe(-1);
  });

  it("only the x1..x3 range is checked: unsorted triangles lose points", () => {
    expect(triangleContains([10, 10, 5, 0, 0, 10], 5, 5)).toBe(false);
  });

  it("the edge product is compared unrounded, as in (no f32 rounding)", () => {
    // slope 1/3 as f32 is 0.3333333432..., so 3 * slope = 1.00000003 > 1 although f32 rounds it to 1
    expect(triangleContains([0, 0, 1, -10, 3, 1], 3, 1)).toBe(true);
    expect(triangleContains([0, 0, 1, -10, 3, 1], 3, 0)).toBe(false);
  });

  it("perspective scale grows linearly below the horizon and is clamped", () => {
    const p = { a: 0, horizonY: 220, refY: 416, refScale: 630000 };
    expect(perspectiveScale(p, 416)).toBeCloseTo(0.63);
    expect(perspectiveScale(p, 221)).toBe(0.1);
    expect(perspectiveScale(p, 2000)).toBe(1);
  });
});

describe("ACE, PCS, ICS, ACI, SSD, MCC on synthetic data", () => {
  it("ACE: areas, exits and the empty name", () => {
    const { areas, complete } = parseAce(lines("3", "[LEWO] 1 0 0 1 1 2 0", "[KUBEL] 0", "[] 0"));
    expect(areas.map((a) => [a.name, a.exit, a.triangles.length])).toEqual([
      ["LEWO", true, 1],
      ["KUBEL", false, 0],
      ["", true, 0],
    ]);
    expect(complete).toBe(true);
    expect(parseAce(lines("1", "[UP] 0", "junk")).complete).toBe(false);
    expect(parseAce(new Uint8Array(0)).areas).toEqual([]);
  });

  it("PCS: person header and frames per direction", () => {
    const p = parsePcs(
      lines(
        "[POL2]",
        "2725 2 1 0.800000 1",
        "0",
        "A.PBM 1 2 3",
        "B.PBM 4 5 6",
        "2",
        "C.PBM 0 0 0",
        "d.pbm 9 9 9",
        "[X]",
        "5 1 0 1.0 0",
        "1",
        "E.PBM 7 8 9",
        "[]",
      ),
    );
    expect(p).toHaveLength(2);
    expect(p[0]).toMatchObject({
      name: "POL2",
      n: 2725,
      framesPerDir: 2,
      mode: 1,
      scale: 800000,
      flag: 1,
    });
    expect(p[0].directions.map((d) => d.dir)).toEqual([0, 2]);
    expect(p[0].directions[1].frames[1]).toEqual(["D.PBM", 9, 9, 9]);
    expect(p[1].directions[0].frames).toEqual([["E.PBM", 7, 8, 9]]);
  });

  it("ICS: frames with 7 values, effects before frames and at the section end", () => {
    const s = parseIcs(
      lines(
        "[a]",
        "F1.PBM 1 2 3 4 5 6 7",
        "Effect K.SND 0 30 31",
        "F2.PBM 0 0 0 0 0 1000 1000",
        "Effect L.SND 1 2 3",
        "[B]",
        "F3.PBM 1 1 1 1 1 1 1",
      ),
    );
    expect(s.map((x) => x.name)).toEqual(["A", "B"]);
    expect(s[0].frames[1]).toEqual({
      file: "F2.PBM",
      values: [0, 0, 0, 0, 0, 1000, 1000],
      effect: ["K.SND", 0, 31],
    });
    expect(s[0].trailingEffect).toEqual(["L.SND", 1, 3]);
    expect(s[1].frames).toHaveLength(1);
  });

  it("ACI: REC sequences (first value made positive), images and shadows", () => {
    const { anims, shadows } = parseAci(
      lines(
        "[KA1.BM]",
        "3",
        "REC -4 4 3 END",
        "REC 1 END",
        "KA2.BM 1 2",
        "KA3.BM 0 0",
        "[NONE]",
        "1",
        "X.BM 0 0",
        "[SHAD1]",
        "10 20 30 40",
        "[]",
      ),
      ["OTHER", "KA1.BM"],
    );
    expect(anims).toEqual([
      {
        object: 1,
        name: "KA1.BM",
        count: 3,
        recs: [[4, 4, 3], [1]],
        images: [
          ["KA2.BM", 1, 2],
          ["KA3.BM", 0, 0],
        ],
      },
    ]);
    expect(shadows).toEqual([
      {
        index: 1,
        points: [
          [10, 20],
          [30, 40],
        ],
      },
    ]);
  });

  it("SSD: sound names and the .PSD file loaded for each", () => {
    expect(parseSsd(lines("krok1.snd", "001-03C.SND"))).toEqual(["KROK1.SND", "001-03C.SND"]);
    expect(psdName("KROK1.SND")).toBe("KROK1.PSD");
    expect(psdName("NOEXT")).toBe("NOEXT.PSD");
  });

  it("MCC: sections, GoToScene targets without extension, Jack's start per LAST", () => {
    const m = parseMcc(
      lines(
        "[PRE]",
        "SetPosition JACK 1 2",
        "If LAST 4",
        "  SetPosition JACK 5 6 / old: SetPosition JACK 0 0 /",
        "EndIf",
        "[INIT]",
        "If LAST 6",
        "SetPosition JACK 7 8",
        "SetPosition JACK 9 10",
        "EndIf",
        "[POKAZANIE-LEWO]",
        "SetPosition JACK 99 99",
        "GoToScene SC006",
        "GoToScene sc026.CFG",
      ),
    );
    expect(m.sections).toEqual(["PRE", "INIT", "POKAZANIE-LEWO"]);
    expect(m.gotos).toEqual(["SC006", "SC026"]);
    expect(m.jackStarts).toEqual([
      { section: "PRE", last: null, x: 1, y: 2 },
      { section: "PRE", last: 4, x: 5, y: 6 },
      { section: "INIT", last: 6, x: 9, y: 10 },
    ]);
  });
});

describe("parseScene on a synthetic archive", () => {
  const enc = (...l: string[]) => encrypt(lines(...l));

  it("requires .CCG and .MCC", () => {
    expect(() => parseScene(pakOf({ "SC9.MCC": enc("[PRE]") }), "SC9")).toThrow(/CCG/);
    expect(() => parseScene(pakOf({ "SC9.CCG": enc("[grafiki]", "D.BM", "[]") }), "SC9")).toThrow(/MCC/);
  });

  it("combines the files and picks Jack's start", () => {
    const pak = pakOf({
      "SC9.CCG": enc(
        "[grafiki]",
        "D.BM",
        "O.BM 16 1 2 1 1 0 0 10 0 10 10 0 10",
        "[obszar_chodu]",
        "1",
        "0 0 5 9 10 0",
        "[]",
      ),
      "SC9.MCC": enc("[PRE]", "SetPosition JACK 3 4", "[INIT]", "If LAST 2", "SetPosition JACK 5 6", "EndIf"),
      "SC9.ACE": enc("1", "[PRAWO] 0"),
      "SC9.SSD": enc("KROK1.SND"),
    });
    const s = parseScene(pak, sceneNameOf("Action/sc9.phk"));
    expect(s.scene).toBe("SC9");
    expect(s.ccg.objects[0]).toMatchObject({ name: "O.BM", center: [5, 5], convex: true });
    expect(s.areas[0].exit).toBe(true);
    expect(s.sounds).toEqual(["KROK1.SND"]);
    expect(s.persons).toEqual([]);
    expect(jackStart(s, 2)).toEqual({ x: 5, y: 6 });
    expect(jackStart(s, 7)).toEqual({ x: 3, y: 4 });
    expect(jackStart({ ...s, macros: { ...s.macros, jackStarts: [] } }, 2)).toBeNull();
  });
});
