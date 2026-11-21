import { describe, expect, it } from "vitest";
import {
  CHUNK_EMPTY,
  CHUNK_PALETTE,
  CHUNK_RECT,
  ImaStereoStream,
  MediaError,
  isAvx,
  parseFlxHeader,
  rectProblems,
  verifyMedia,
  type Codec,
  type FlxHeader,
} from "./media";

// --- synthetic data ------------------------------------------------------------

const u16 = (v: number) => [v & 0xff, (v >> 8) & 0xff];
const u32 = (v: number) => [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >>> 24) & 0xff];

function flxHeader(
  frames: number,
  w: number,
  h: number,
  opts: { mode?: number; pal16?: number; fps?: number } = {},
): number[] {
  return [
    0x46,
    0x4c,
    0x58,
    0,
    ...u16(frames),
    ...u16(w),
    ...u16(h),
    ...u16(opts.fps ?? 12),
    1,
    opts.mode ?? 1,
    opts.pal16 ?? 1,
    0,
    ...u16(5),
    ...u16(7),
  ];
}

function chunk(type: number, body: number[]): number[] {
  return [type, 0, ...u32(6 + body.length), ...body];
}

/** Palette chunk: color i = i * 0x101 (RGB565), so pixels are easy to check. */
function palette16(f = (i: number) => i * 0x101): number[] {
  return chunk(CHUNK_PALETTE, Array.from({ length: 256 }, (_, i) => u16(f(i) & 0xffff)).flat());
}

function rect(x: number, y: number, w: number, h: number): number[] {
  return chunk(CHUNK_RECT, [...u16(x & 0xffff), ...u16(y & 0xffff), ...u16(w & 0xffff), ...u16(h & 0xffff)]);
}

function flx(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

describe("IMA stereo stream", () => {
  const c = (o: Partial<Codec> = {}): Codec => ({
    type: 0x33,
    packedSize: 1 << 30,
    unpackedSize: 0,
    loopOffset: 1 << 29,
    predictor: 0,
    index: 0,
    predictorR: 0,
    ...o,
  });
  const src = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff));

  it("keeps its state between calls", () => {
    const whole = new ImaStereoStream(c()).decode(src);
    const s = new ImaStereoStream(c());
    const parts = [...s.decode(src.subarray(0, 8)), ...s.decode(src.subarray(8, 24)), ...s.decode(src.subarray(24))];
    expect(parts).toEqual([...whole]);
    expect(whole.length).toBe(64);
  });

  it("decodes the left word then the right word, low nibble first", () => {
    // left code 4 (+step), right code 12 (-step); step 7 -> diff 7 + (7 >> 3) = 7
    const out = new ImaStereoStream(c({ predictor: 100, predictorR: -100 })).decode(
      new Uint8Array([4, 0, 0, 0, 12, 0, 0, 0]),
    );
    expect([out[0], out[1]]).toEqual([107, -107]);
  });

  it("starts from the codec header, both channels with the same index", () => {
    const s = new ImaStereoStream(c({ predictor: 5, predictorR: -6, index: 30 }));
    s.decode(new Uint8Array(8));
    // 8 codes of 0 per channel: index 30 - 8
    expect(s.state[1]).toBe(22);
    expect(s.state[3]).toBe(22);
  });

  it("resets to the saved state at packedSize (zeros if loopOffset was never reached)", () => {
    const s = new ImaStereoStream(c({ packedSize: 16, predictor: 1000, predictorR: 1000, index: 40 }));
    const out = s.decode(src.subarray(0, 24));
    const fresh = new ImaStereoStream(c({ predictor: 0, predictorR: 0, index: 0 })).decode(src.subarray(16, 24));
    expect([...out.subarray(32)]).toEqual([...fresh]);
    expect(s.resets).toBe(1);
    expect(s.pos).toBe((1 << 29) + 8); // reset after unit 2, unit 3 counted from loopOffset
  });

  it("saves at loopOffset and comes back there", () => {
    const s = new ImaStereoStream(c({ packedSize: 24, loopOffset: 8 }));
    const out = s.decode(src.subarray(0, 24));
    expect(s.pos).toBe(8);
    expect(s.state).toEqual(s.saved);
    // after the reset, the state is the one from position 8, so decoding [8..16)
    // again from there gives the same samples as the first time
    const again = s.decode(src.subarray(8, 16));
    expect([...again]).toEqual([...out.subarray(16, 32)]);
  });

  it("re-reads the header when the counter is back at 0", () => {
    const s = new ImaStereoStream(c({ packedSize: 8, loopOffset: 0, predictor: 50, predictorR: 60 }));
    const a = s.decode(src.subarray(0, 8));
    const b = s.decode(src.subarray(0, 8));
    expect([...b]).toEqual([...a]);
  });

  it("rejects data that is not whole 8-byte units", () => {
    expect(() => new ImaStereoStream(c()).decode(new Uint8Array(4))).toThrow(/not a multiple of 8/);
  });
});

describe("verify rules", () => {
  const h = (o: Partial<FlxHeader> = {}): FlxHeader => ({
    ...parseFlxHeader(new Uint8Array(flxHeader(1, 10, 5))),
    ...o,
  });

  it("rects: empty allowed, in frame (one column of slack), mode 2 only by size", () => {
    expect(rectProblems(h(), 0, [3, 3, -1, 5])).toEqual([]);
    expect(rectProblems(h(), 0, [0, 0, 11, 5])).toEqual([]);
    expect(rectProblems(h(), 0, [0, 0, 12, 5])).toHaveLength(1);
    expect(rectProblems(h(), 0, [0, 1, 10, 5])).toHaveLength(1);
    expect(rectProblems(h(), 0, [-1, 0, 2, 2])).toHaveLength(1);
    expect(rectProblems(h({ mode: 2 }), 0, [300, 200, 10, 5])).toEqual([]);
    expect(rectProblems(h({ mode: 2 }), 0, [0, 0, 11, 5])).toHaveLength(1);
  });

  it("palette: flag 1, in the first frame only", () => {
    const e = chunk(CHUNK_EMPTY, []);
    expect(verifyMedia("A.FLX", flx(flxHeader(2, 2, 1), palette16(), e, e))).toEqual([]);
    expect(verifyMedia("A.FLX", flx(flxHeader(1, 2, 1, { pal16: 0 }), e))).toEqual([
      "palette flag 0",
      "first frame has no palette",
    ]);
    expect(verifyMedia("A.FLX", flx(flxHeader(2, 2, 1), palette16(), e, palette16(), e))).toEqual([
      "palette in frame 1",
    ]);
    expect(verifyMedia("A.FLX", flx(flxHeader(1, 2, 1), palette16(), rect(0, 0, 5, 1), e))).toHaveLength(1);
    expect(verifyMedia("A.FLX", new Uint8Array(3))).toEqual([expect.stringMatching(/truncated/)]);
  });

  it("is case-insensitive about the extension", () => {
    expect(isAvx("intro.avx")).toBe(true);
    expect(isAvx("D1.FLX")).toBe(false);
  });

  it("MediaError is the only error type", () => {
    expect(new MediaError("x")).toBeInstanceOf(Error);
  });
});
