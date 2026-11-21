import { describe, expect, it } from "vitest";
import { FntError, TABLE_SIZE, layoutText, parseFnt, renderText, textWidth, verifyFnt } from "./fnt";

const bytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

// --- synthetic fonts -----------------------------------------------------------

interface G {
  w: number;
  h: number;
  px: number[];
}

/** Font where every code is a blank 2x1 glyph except the given ones. */
function buildFont(glyphs: Record<number, G>): Uint8Array {
  const table: number[] = new Array(TABLE_SIZE).fill(0);
  const body: number[] = [0, 0];
  const entry = (code: number, offset: number, w: number, h: number) => {
    table[code * 4] = offset & 0xff;
    table[code * 4 + 1] = offset >> 8;
    table[code * 4 + 2] = w;
    table[code * 4 + 3] = h;
  };
  for (let c = 0; c < 256; c++) entry(c, TABLE_SIZE, 2, 1);
  for (const [code, g] of Object.entries(glyphs)) {
    entry(Number(code), TABLE_SIZE + body.length, g.w, g.h);
    body.push(...g.px);
  }
  return Uint8Array.from([...table, ...body]);
}

const A: G = { w: 3, h: 2, px: [0, 1, 0, 1, 2, 1] };
const B: G = { w: 1, h: 3, px: [2, 2, 1] };

describe("fnt on synthetic data", () => {
  const data = buildFont({ 65: A, 66: B });
  const font = parseFnt(data);

  it("parses the glyph table", () => {
    expect(font.glyphs[65]).toMatchObject({ width: 3, height: 2 });
    expect([...font.glyphs[65].pixels]).toEqual(A.px);
    expect(font.glyphs[0]).toMatchObject({ width: 2, height: 1 });
    expect(font.dataEnd).toBe(data.length);
    expect(verifyFnt(data)).toEqual([]);
  });

  it("rejects too short data", () => {
    expect(() => parseFnt(new Uint8Array(TABLE_SIZE - 1))).toThrow(FntError);
    expect(verifyFnt(new Uint8Array(3))).toEqual(["too short"]);
  });

  it("rejects glyph data beyond the end", () => {
    expect(() => parseFnt(data.subarray(0, data.length - 1))).toThrow(/glyph 66 data \d+\+1x3 out of range/);
  });

  it("rejects glyph data inside the table", () => {
    const bad = data.slice();
    bad[65 * 4] = 0xff; // offset 0x3ff
    bad[65 * 4 + 1] = 0x03;
    expect(() => parseFnt(bad)).toThrow(/glyph 65 data 1023\+3x2 out of range/);
  });

  it("verify reports trailing bytes, unknown pixel values and wide glyphs", () => {
    expect(verifyFnt(Uint8Array.from([...data, 0]))).toEqual([
      `glyph data ends at ${data.length}, file has ${data.length + 1} bytes`,
    ]);
    expect(verifyFnt(buildFont({ 65: { w: 1, h: 1, px: [3] } }))).toEqual([
      "pixel values [3] (only 0, 1, 2 are known)",
    ]);
    const wide = buildFont({ 65: { w: 128, h: 1, px: new Array(128).fill(2) } });
    expect(verifyFnt(wide)).toEqual(["glyphs [65] wider than 127 (the blitter uses width & 0x7f)"]);
  });

  it("measures text: width + 1 spacing per character", () => {
    expect(textWidth(font, bytes("AB"))).toBe(3 + 1 + 1 + 1);
    expect(textWidth(font, bytes(""))).toBe(0);
    expect(textWidth(font, bytes("A B"))).toBe(4 + 3 + 2); // the space is the 2-wide default glyph
  });

  it("'/N' sets the spacing and is not drawn", () => {
    expect(layoutText(font, bytes("A/3B")).glyphs.map((p) => p.x)).toEqual([0, 4]);
    expect(textWidth(font, bytes("/0AB"))).toBe(4);
    expect(textWidth(font, bytes("/3A/1A"))).toBe(6 + 4);
  });

  it("any character after '/' is a spacing digit", () => {
    expect(textWidth(font, bytes("/:A"))).toBe(3 + 10);
    expect(textWidth(font, Uint8Array.from([0x2f, 0x10, 0x41]))).toBe(3 + ((0x10 - 0x30) & 0xff));
  });

  it("a NUL or a trailing '/' ends the text", () => {
    expect(textWidth(font, Uint8Array.from([0x41, 0, 0x42]))).toBe(4);
    expect(textWidth(font, bytes("A/"))).toBe(4);
    expect(textWidth(font, Uint8Array.from([0x41, 0x2f, 0, 0x42]))).toBe(4);
  });

  it("renders outline and fill colors, 0 stays transparent", () => {
    const img = renderText(font, bytes("AB"), 0x1111, 0x2222);
    expect([img.width, img.height]).toEqual([6, 3]);
    const o = 0x1111;
    const f = 0x2222;
    expect([...img.pixels]).toEqual([
      0,
      o,
      0,
      0,
      f,
      0, //
      o,
      f,
      o,
      0,
      f,
      0, //
      0,
      0,
      0,
      0,
      o,
      0,
    ]);
  });

  it("renders empty text as an empty image", () => {
    expect(renderText(font, bytes(""), 1, 2)).toMatchObject({ width: 0, height: 0 });
  });
});
