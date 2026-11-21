import { describe, expect, it } from "vitest";
import { BmError, decodeBm, readBm, rgb565ToRgba, verifyBm } from "./bm";
import { Pak, PakError } from "./pak";

// --- synthetic images ---------------------------------------------------------

/** One invented file in a .PAK built in the test. */
function oneFilePak(name: string, data: Uint8Array): Pak {
  const rawName = new TextEncoder().encode(`${name}\0`);
  const dataStart = 16 + 12 + rawName.length;
  const out = new Uint8Array(dataStart + data.length);
  const view = new DataView(out.buffer);
  out.set([0x50, 0x41, 0x4b, 0], 0);
  view.setUint32(4, 1, true);
  view.setUint32(8, dataStart, true);
  view.setUint32(16, dataStart, true);
  view.setUint32(20, data.length, true);
  view.setUint32(24, rawName.length, true);
  out.set(rawName, 28);
  out.set(data, dataStart);
  return new Pak(out);
}

function header(w: number, h: number): number[] {
  return [w & 0xff, w >> 8, h & 0xff, h >> 8];
}

function u16(values: number[]): number[] {
  return values.flatMap((v) => [v & 0xff, v >> 8]);
}

/** 8-bit .BM: header, 128-color palette, one palette byte offset per pixel. */
function palette(colors: number[]): number[] {
  const p = [...colors];
  while (p.length < 128) p.push(0);
  return u16(p);
}

describe("bm on synthetic data", () => {
  it("decodes RGB565", () => {
    const img = decodeBm(new Uint8Array([...header(2, 1), ...u16([0xf800, 0x07e0])]));
    expect(img.kind).toBe("rgb565");
    expect([...img.pixels]).toEqual([0xf800, 0x07e0]);
  });

  it("decodes 8-bit with palette, pixel bytes are byte offsets", () => {
    const data = [...header(3, 1), ...palette([0, 0x001f, 0xffff]), 0, 2, 4];
    const img = decodeBm(new Uint8Array(data));
    expect(img.kind).toBe("pal8");
    expect([...img.pixels]).toEqual([0, 0x001f, 0xffff]);
    expect(verifyBm(new Uint8Array(data))).toEqual([]);
  });

  it("decodes a 0x0 image", () => {
    expect(decodeBm(new Uint8Array(header(0, 0))).pixels.length).toBe(0);
  });

  it("decodes the largest offset 254", () => {
    const pal = palette([]);
    pal[254] = 0x34;
    pal[255] = 0x12;
    expect([...decodeBm(new Uint8Array([...header(1, 1), ...pal, 254])).pixels]).toEqual([0x1234]);
  });

  it("rejects too short data", () => {
    expect(() => decodeBm(new Uint8Array(3))).toThrow(BmError);
    expect(verifyBm(new Uint8Array(3))).toEqual(["too short"]);
  });

  it("rejects a size that fits neither variant", () => {
    expect(() => decodeBm(new Uint8Array([...header(2, 2), 0, 0, 0]))).toThrow(
      /fits neither 2x2 RGB565 \(12\) nor 8-bit \(264\)/,
    );
  });

  it("rejects odd palette offsets", () => {
    expect(() => decodeBm(new Uint8Array([...header(1, 1), ...palette([]), 3]))).toThrow(/odd palette offset 3/);
  });

  it("verify reports a non-transparent palette entry 0", () => {
    expect(verifyBm(new Uint8Array([...header(1, 1), ...palette([5]), 0]))).toEqual([
      "palette entry 0 is not 0 (transparent)",
    ]);
  });

  it("reads a bitmap from a pak and throws when the name is missing", () => {
    const pak = oneFilePak("DOT.BM", new Uint8Array([...header(1, 1), ...u16([0x001f])]));
    expect(readBm(pak, "dot.bm").pixels[0]).toBe(0x001f);
    expect(() => readBm(pak, "NOPE.BM")).toThrow(PakError);
  });

  it("converts RGB565 to RGBA with bit replication and color key 0", () => {
    const rgba = rgb565ToRgba(new Uint16Array([0xffff, 0, 0xf800, 0x07e0, 0x001f, 0x0841]));
    expect([...rgba]).toEqual([
      255, 255, 255, 255, 0, 0, 0, 0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 8, 8, 8, 255,
    ]);
    expect([...rgb565ToRgba(new Uint16Array([0]), false)]).toEqual([0, 0, 0, 255]);
  });
});
