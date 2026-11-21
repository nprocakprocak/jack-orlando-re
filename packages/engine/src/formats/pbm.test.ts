import { describe, expect, it } from "vitest";
import { decodePbm, isPlaceholder, PbmError, tailPixels, unpackPbm, verifyPbm } from "./pbm";

// --- synthetic images ---------------------------------------------------------

/** .PBM: header, 128-color palette (RGB565), RLE stream. */
function buildPbm(w: number, h: number, colors: number[], stream: number[]): Uint8Array {
  const pal = [...colors];
  while (pal.length < 128) pal.push(0);
  return new Uint8Array([w & 0xff, w >> 8, h & 0xff, h >> 8, ...pal.flatMap((c) => [c & 0xff, c >> 8]), ...stream]);
}

const COLORS = [0, 0xf800, 0x07e0, 0x001f];

describe("pbm on synthetic data", () => {
  it("decodes literals (even bytes) as palette byte offsets", () => {
    const img = decodePbm(buildPbm(4, 1, COLORS, [0, 2, 4, 6]));
    expect([...img.pixels]).toEqual([0, 0xf800, 0x07e0, 0x001f]);
  });

  it("decodes runs: odd byte b, then count copies of b-1", () => {
    const data = buildPbm(3, 2, COLORS, [3, 4, 4, 1, 1]);
    expect([...unpackPbm(data).indices]).toEqual([2, 2, 2, 2, 4, 0]);
    expect([...decodePbm(data).pixels]).toEqual([0xf800, 0xf800, 0xf800, 0xf800, 0x07e0, 0]);
    expect(verifyPbm(data)).toEqual([]);
  });

  it("accepts runs of length 0 and 255", () => {
    const data = buildPbm(255, 1, COLORS, [5, 0, 7, 255]);
    const s = unpackPbm(data);
    expect(s.indices.every((b) => b === 6)).toBe(true);
    expect(s.streamEnd).toBe(data.length);
  });

  it("stops as soon as the image is full; a valid RLE continuation after it is accepted", () => {
    const data = buildPbm(1, 1, COLORS, [2, 9, 3, 4]);
    expect(unpackPbm(data).streamEnd).toBe(data.length - 3);
    expect(tailPixels(data, data.length - 3)).toBe(4);
    expect(verifyPbm(data)).toEqual([]);
  });

  it("reports bytes after the stream that are not a complete RLE continuation", () => {
    const data = buildPbm(1, 1, COLORS, [2, 4, 9]);
    expect(tailPixels(data, data.length - 2)).toBeNull();
    expect(verifyPbm(data)).toEqual(["2 bytes after the RLE stream are not a valid RLE continuation"]);
  });

  it("accepts the PUSTY.PBM placeholder only by exact name and content", () => {
    const one = new Uint8Array([0x91]);
    expect(isPlaceholder(one, "PUSTY.PBM")).toBe(true);
    expect(isPlaceholder(one, "Action/SC076.phk:pusty.pbm")).toBe(true);
    expect(verifyPbm(one, "PUSTY.PBM")).toEqual([]);
    expect(decodePbm(one, "PUSTY.PBM")).toEqual({ width: 0, height: 0, kind: "pal8rle", pixels: new Uint16Array(0) });
    expect(verifyPbm(one, "OTHER.PBM")).toEqual(["too short"]);
    expect(verifyPbm(new Uint8Array([0x90]), "PUSTY.PBM")).toEqual(["too short"]);
    expect(() => decodePbm(one)).toThrow(/too short/);
  });

  it("rejects too short data", () => {
    expect(() => unpackPbm(new Uint8Array(0x103))).toThrow(/too short/);
    expect(verifyPbm(new Uint8Array(10))).toEqual(["too short"]);
  });

  it("rejects an empty image", () => {
    expect(() => unpackPbm(buildPbm(0, 5, COLORS, []))).toThrow(/empty image 0x5/);
  });

  it("rejects a truncated stream", () => {
    expect(() => unpackPbm(buildPbm(3, 1, COLORS, [2]))).toThrow(/truncated at pixel 1 of 3/);
    expect(() => unpackPbm(buildPbm(3, 1, COLORS, [2, 3]))).toThrow(/truncated in run at pixel 1/);
  });

  it("rejects a run past the end of the image", () => {
    expect(() => unpackPbm(buildPbm(2, 1, COLORS, [3, 3]))).toThrow(PbmError);
    expect(verifyPbm(buildPbm(2, 1, COLORS, [2, 3, 3]))).toEqual(["run of 3 at pixel 1 overruns 2 pixels"]);
  });

  it("verify reports a non-transparent palette entry 0", () => {
    expect(verifyPbm(buildPbm(1, 1, [7], [0]))).toEqual(["palette entry 0 is not 0 (transparent)"]);
  });
});
