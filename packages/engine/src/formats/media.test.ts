import { describe, expect, it } from "vitest";
import {
  AVX_GAP,
  AVX_PREROLL,
  Avx,
  CHUNK_DELTA,
  CHUNK_EMPTY,
  CHUNK_PACKED,
  CHUNK_PALETTE,
  CHUNK_RECT,
  Flx,
  FrameBuffer,
  decodeFrame,
  frameTicks,
  parseFlxHeader,
  unpackRle,
  verifyMedia,
  type Codec,
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

/** Delta record: size, start, pairs [skip, count...bytes]. */
function delta(start: number, pairs: number[][]): number[] {
  const body = pairs.flatMap(([skip, ...bytes]) => [skip, bytes.length, ...bytes]);
  return [...u32(8 + body.length), ...u32(start), ...body];
}

/** Chunk type 1: [1, 0] + delta record (its size is the chunk size, so size - 2 bytes of pairs). */
function deltaChunk(start: number, pairs: number[][]): number[] {
  const rec = delta(start, pairs);
  const total = rec.length + 2;
  return [CHUNK_DELTA, 0, ...u32(total), ...u32(start), ...rec.slice(8)];
}

function rect(x: number, y: number, w: number, h: number): number[] {
  return chunk(CHUNK_RECT, [...u16(x & 0xffff), ...u16(y & 0xffff), ...u16(w & 0xffff), ...u16(h & 0xffff)]);
}

function flx(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

function frames(data: Uint8Array) {
  return [...new Flx(data).frames()].map((f) => ({
    kind: f.frame.kind,
    rect: f.frame.rect,
    palette: f.frame.palette,
  }));
}

describe("FLX header", () => {
  it("parses all fields", () => {
    const h = parseFlxHeader(new Uint8Array(flxHeader(3, 10, 4, { mode: 2, fps: 11 })));
    expect(h).toEqual({
      frames: 3,
      width: 10,
      height: 4,
      fps: 11,
      unkC: 1,
      mode: 2,
      pal16: 1,
      unkF: 0,
      x: 5,
      y: 7,
    });
    expect(frameTicks(h)).toBe(18);
    expect(frameTicks({ ...h, fps: 0 })).toBe(0);
  });

  it("rejects bad magic, truncation and an empty frame size", () => {
    const bad = flxHeader(1, 2, 2);
    bad[0] = 0x47;
    expect(() => parseFlxHeader(new Uint8Array(bad))).toThrow(/bad FLX magic/);
    expect(() => parseFlxHeader(new Uint8Array(flxHeader(1, 2, 2).slice(0, 10)))).toThrow(/truncated/);
    expect(() => parseFlxHeader(new Uint8Array(flxHeader(1, 0, 2)))).toThrow(/frame size/);
  });
});

describe("FLX frames", () => {
  it("decodes palette, rect, delta, packed and empty frames", () => {
    const data = flx(
      flxHeader(3, 4, 2),
      palette16(),
      rect(0, 0, 4, 2),
      deltaChunk(0, [
        [0, 1, 2],
        [3, 3],
      ]), // pixels 0,1 then skip 3 -> pixel 5
      chunk(CHUNK_PACKED, [...u32(8 + 4), ...u32(2), 0, 2, 0xff, 9, 2]), // unpacked: pair skip 0, 2 x 9 at pixel 2
      chunk(CHUNK_EMPTY, []),
    );
    const it = new Flx(data).frames();
    const f0 = it.next().value!;
    expect(f0.frame).toEqual({ kind: CHUNK_DELTA, rect: [0, 0, 4, 2], palette: true });
    expect([...f0.fb.indices]).toEqual([1, 2, 0, 0, 0, 3, 0, 0]);
    // scene path: untouched pixels stay 0, written ones get the palette color
    expect([...f0.fb.frame()]).toEqual([0x101, 0x202, 0, 0, 0, 0x303, 0, 0]);
    const f1 = it.next().value!;
    expect(f1.frame.kind).toBe(CHUNK_PACKED);
    expect([...f1.fb.indices]).toEqual([1, 2, 9, 9, 0, 3, 0, 0]);
    expect(it.next().value!.frame).toEqual({ kind: CHUNK_EMPTY, palette: false });
    expect(it.next().done).toBe(true);
  });

  it("is lazy: frames after the one requested are not decoded", () => {
    const data = flx(flxHeader(2, 2, 1), palette16(), chunk(CHUNK_EMPTY, []), [9, 0, ...u32(6)]);
    const it = new Flx(data).frames();
    expect(it.next().value!.index).toBe(0);
    expect(() => it.next()).toThrow(/unknown chunk type 9/);
  });

  it("rejects bytes after the last frame and missing frames", () => {
    expect(() => frames(flx(flxHeader(1, 2, 1), palette16(), chunk(CHUNK_EMPTY, []), [0]))).toThrow(
      /1 bytes after frame 1/,
    );
    expect(() => frames(flx(flxHeader(2, 2, 1), palette16(), chunk(CHUNK_EMPTY, [])))).toThrow(/chunk head truncated/);
  });

  it("checks chunk sizes", () => {
    expect(() => frames(flx(flxHeader(1, 2, 1), [CHUNK_EMPTY, 0, ...u32(5)]))).toThrow(/bad size 5/);
    expect(() => frames(flx(flxHeader(1, 2, 1), [CHUNK_EMPTY, 0, ...u32(60)]))).toThrow(/bad size 60/);
    expect(() => frames(flx(flxHeader(1, 2, 1), chunk(CHUNK_EMPTY, [1])))).toThrow(/empty frame chunk/);
    expect(() => frames(flx(flxHeader(1, 2, 1), chunk(CHUNK_RECT, [1, 2]), chunk(CHUNK_EMPTY, [])))).toThrow(
      /rect chunk at 20: size 8/,
    );
    expect(() => frames(flx(flxHeader(1, 2, 1), chunk(CHUNK_PALETTE, [1, 2]), chunk(CHUNK_EMPTY, [])))).toThrow(
      /2 bytes, expected 512/,
    );
  });

  it("enforces the chunk order palette, rect, image", () => {
    const empty = chunk(CHUNK_EMPTY, []);
    expect(() => frames(flx(flxHeader(1, 2, 1), rect(0, 0, 1, 1), palette16(), empty))).toThrow(
      /palette chunk out of order/,
    );
    expect(() => frames(flx(flxHeader(1, 2, 1), palette16(), palette16(), empty))).toThrow(/out of order/);
    expect(() => frames(flx(flxHeader(1, 2, 1), rect(0, 0, 1, 1), rect(0, 0, 1, 1), empty))).toThrow(/unexpected rect/);
    const fb = new FrameBuffer(2, 1);
    const d = flx(rect(0, 0, 1, 1), empty);
    expect(() => decodeFrame(fb, d, 0, d.length, 1, false)).toThrow(/unexpected rect/);
  });

  it("reads signed rects (empty rects have a negative size)", () => {
    expect(frames(flx(flxHeader(1, 2, 1), rect(639, 378, -638, -377), chunk(CHUNK_EMPTY, [])))[0].rect).toEqual([
      639, 378, -638, -377,
    ]);
  });

  it("converts an RGB888 palette (pal16 = 0) to RGB565", () => {
    const pal = Array.from({ length: 256 }, () => [0, 0, 0]).flat();
    pal.splice(0, 3, 0xff, 0x80, 0x08);
    const data = flx(flxHeader(1, 1, 1, { pal16: 0 }), chunk(CHUNK_PALETTE, pal), deltaChunk(0, [[0, 0]]));
    const f = new Flx(data).frames().next().value!;
    expect(f.fb.palette[0]).toBe((0xf8 << 8) | (0x80 << 3) | 1);
    expect(f.fb.frame()[0]).toBe(f.fb.palette[0]);
    expect(() => frames(flx(flxHeader(1, 1, 1, { pal16: 0 }), palette16(), chunk(CHUNK_EMPTY, [])))).toThrow(
      /512 bytes, expected 768/,
    );
  });
});

describe("FrameBuffer", () => {
  it("rerender = true redraws every pixel when the palette changes", () => {
    const fb = new FrameBuffer(2, 1, true);
    const d = flx(
      palette16(),
      deltaChunk(0, [[1, 5]]),
      palette16((i) => i + 1),
      chunk(CHUNK_EMPTY, []),
    );
    const first = decodeFrame(fb, d, 0, d.length, 1);
    expect([...fb.frame()]).toEqual([0, 0x505]);
    decodeFrame(fb, d, first.next, d.length, 1);
    expect([...fb.frame()]).toEqual([1, 6]);
  });

  it("rerender = false keeps the colors of the moment of writing", () => {
    const fb = new FrameBuffer(2, 1, false);
    const d = flx(
      palette16(),
      deltaChunk(0, [[1, 5]]),
      palette16((i) => i + 1),
      deltaChunk(0, [[0, 5]]),
    );
    const first = decodeFrame(fb, d, 0, d.length, 1);
    decodeFrame(fb, d, first.next, d.length, 1);
    expect([...fb.frame()]).toEqual([6, 0x505]);
  });

  it("stops at a count with no bytes left, like the game", () => {
    const fb = new FrameBuffer(4, 1);
    // pairs: (0, 1, [7]) then (2, 200) at the very end
    const rec = [...u32(8 + 5), ...u32(0), 0, 1, 7, 2, 200];
    expect(fb.applyDelta(new Uint8Array(rec))).toBe(rec.length);
    expect([...fb.indices]).toEqual([7, 0, 0, 0]);
    expect(fb.overruns).toBe(0);
  });

  it("lets a run read past the record end and counts it", () => {
    const fb = new FrameBuffer(4, 1);
    // size says 11 bytes: one pair (0, 3) with only one byte inside, then 2 more follow
    const src = new Uint8Array([...u32(11), ...u32(0), 0, 3, 4, 5, 6]);
    expect(fb.applyDelta(src)).toBe(13);
    expect([...fb.indices]).toEqual([4, 5, 6, 0]);
    expect(fb.overruns).toBe(1);
    // past the end of the source the bytes read as 0
    const fb2 = new FrameBuffer(4, 1);
    fb2.indices.fill(9);
    fb2.applyDelta(new Uint8Array([...u32(11), ...u32(0), 0, 3, 4]));
    expect([...fb2.indices]).toEqual([4, 0, 0, 9]);
  });

  it("chunk type 1 walks 2 bytes into the next chunk head", () => {
    // pairs fill the chunk exactly; the next chunk's [type, 0] is read as one more
    // pair (skip type, count 0) and writes nothing
    const d = flx(palette16(), deltaChunk(0, [[0, 1]]), rect(0, 0, 1, 1), chunk(CHUNK_EMPTY, []));
    const fb = new FrameBuffer(3, 1);
    const r = decodeFrame(fb, d, 0, d.length, 1);
    expect([...fb.indices]).toEqual([1, 0, 0]);
    expect(decodeFrame(fb, d, r.next, d.length, 1).frame.rect).toEqual([0, 0, 1, 1]);
  });

  it("a packed run past the record end reads the stale unpack buffer", () => {
    const fb = new FrameBuffer(8, 1);
    // first record leaves 1,2,3,4 at unpack offsets 10..13
    const first = chunk(CHUNK_PACKED, [...u32(14), ...u32(0), 0, 4, 1, 2, 3, 4]);
    // second: size 11 but the pair asks for 3 bytes -> 1 own + 2 stale (offsets 11, 12)
    const second = chunk(CHUNK_PACKED, [...u32(11), ...u32(4), 0, 3, 9]);
    const d = flx(first, second);
    const r = decodeFrame(fb, d, 0, d.length, 1);
    decodeFrame(fb, d, r.next, d.length, 1);
    expect([...fb.indices]).toEqual([1, 2, 3, 4, 9, 2, 3, 0]);
    expect(fb.overruns).toBe(1);
  });

  it("writes past the frame inside the capacity, rejects past it", () => {
    const fb = new FrameBuffer(2, 1, false, 4);
    fb.applyDelta(new Uint8Array(delta(2, [[0, 7, 8]])));
    expect([...fb.indices]).toEqual([0, 0, 7, 8]);
    expect(() => fb.applyDelta(new Uint8Array(delta(3, [[0, 7, 8]])))).toThrow(/writes pixel 4 outside/);
    expect(() => fb.applyDelta(new Uint8Array(delta(5, [])))).toThrow(/start 5 outside/);
    expect(() => fb.applyDelta(new Uint8Array([1, 2, 3]))).toThrow(/head truncated/);
  });

  it("resize keeps the buffer and checks the capacity", () => {
    const fb = new FrameBuffer(2, 2, false, 6);
    fb.resize(3, 2);
    expect(fb.frame().length).toBe(6);
    expect(() => fb.resize(4, 2)).toThrow(/larger than the buffer/);
  });
});

describe("RLE (chunk type 2)", () => {
  it("unpacks runs and literals after the copied head", () => {
    const src = new Uint8Array([...u32(8 + 6), ...u32(3), 5, 0xff, 6, 4, 7]);
    const { buf, size, next } = unpackRle(src, 0, src.length);
    expect(size).toBe(14);
    expect(next).toBe(src.length);
    expect([...buf.subarray(8, 14)]).toEqual([5, 6, 6, 6, 6, 7]);
    expect([...buf.subarray(0, 8)]).toEqual([...src.subarray(0, 8)]);
  });

  it("reuses and grows the output buffer", () => {
    const src = new Uint8Array([...u32(10), ...u32(0), 1, 2]);
    const old = new Uint8Array(12).fill(0xee);
    const { buf } = unpackRle(src, 0, src.length, old);
    expect(buf).toBe(old);
    expect([...buf.subarray(8)]).toEqual([1, 2, 0xee, 0xee]);
    expect(unpackRle(src, 0, src.length, new Uint8Array(2)).buf.length).toBe(10);
  });

  it("rejects every broken case", () => {
    const run = (b: number[]) => () => unpackRle(new Uint8Array(b), 0, b.length);
    expect(run([1, 2, 3])).toThrow(/head truncated/);
    expect(run([...u32(8), ...u32(0)])).toThrow(/unpacked size 8/);
    expect(run([...u32(12), ...u32(0), 1])).toThrow(/data ends with 3 bytes/);
    expect(run([...u32(12), ...u32(0), 0xff, 1])).toThrow(/run truncated/);
    expect(run([...u32(10), ...u32(0), 0xff, 1, 3])).toThrow(/run of 3 overflows by 1/);
    const extra = flx(chunk(CHUNK_PACKED, [...u32(9), ...u32(0), 1, 2]));
    expect(() => decodeFrame(new FrameBuffer(2, 1), extra, 0, extra.length, 1)).toThrow(/1 bytes left after unpacking/);
  });
});

// --- AVX ---------------------------------------------------------------------------

function codec(o: Partial<Codec> = {}): number[] {
  const c = {
    type: 0x33,
    packedSize: 0x10000000,
    unpackedSize: 0,
    loopOffset: 0xee000000,
    predictor: 0,
    index: 0,
    predictorR: 0,
    ...o,
  };
  return [
    ...u32(c.type),
    ...u32(c.packedSize),
    ...u32(c.unpackedSize),
    ...u32(c.loopOffset),
    ...u16(c.predictor & 0xffff),
    c.index,
    0,
    ...u16(c.predictorR & 0xffff),
    0,
    0,
  ];
}

function record(video: number[], sound: number[] = Array(8).fill(0x11)): number[] {
  const body = [...video, ...u32(4 + sound.length), ...sound];
  return [...u32(body.length), ...body];
}

function block(...records: number[][]): number[] {
  const body = records.flat();
  return [...u32(4 + body.length), ...body];
}

function avx(segments: number, blocks: number[][], opts: { bits?: number; codec?: Partial<Codec> } = {}): Uint8Array {
  const pre = new Array(AVX_PREROLL - 0x18).fill(0);
  return new Uint8Array([...u16(segments), 4, opts.bits ?? 16, ...codec(opts.codec), ...pre, ...blocks.flat()]);
}

const aHeader = (frames: number) => flxHeader(frames, 2, 1, { pal16: 1 });
const empty = chunk(CHUNK_EMPTY, []);

describe("AVX container", () => {
  it("walks blocks, records and segments", () => {
    const data = avx(2, [
      block(record([...aHeader(2), ...palette16(), ...deltaChunk(0, [[0, 3, 4]])]), record(empty)),
      block(record([...aHeader(1), ...empty])),
    ]);
    const m = new Avx(data);
    expect([m.segments, m.unk2, m.bits, m.blocks.length, m.records.length]).toEqual([2, 4, 16, 2, 3]);
    const got = [...m.frames()].map((f) => [f.number, f.segment, f.index, f.frame.kind, [...f.fb.frame()]]);
    expect(got).toEqual([
      [0, 0, 0, CHUNK_DELTA, [0x303, 0x404]],
      [1, 0, 1, CHUNK_EMPTY, [0x303, 0x404]],
      [2, 1, 0, CHUNK_EMPTY, [0x303, 0x404]],
    ]);
    expect(m.audioChunk(m.records[0]).length).toBe(8);
    expect(verifyMedia("X.AVX", data)).toEqual([]);
  });

  it("pcm = preroll + 2 silent frames + record sound", () => {
    const m = new Avx(avx(1, [block(record([...aHeader(1), ...empty], Array(16).fill(0x77)))]));
    const preroll = (AVX_PREROLL - 0x18) * 2;
    expect(m.pcm(0).length).toBe(preroll + AVX_GAP / 2);
    const all = m.pcm();
    expect(all.length).toBe(preroll + AVX_GAP / 2 + 32);
    expect([...all.subarray(preroll, preroll + 4)]).toEqual([0, 0, 0, 0]);
    expect(m.pcm(1)).toEqual(all);
  });

  it("rejects broken headers", () => {
    expect(() => new Avx(new Uint8Array(100))).toThrow(/shorter than header/);
    expect(() => new Avx(avx(1, [], { bits: 8 }))).toThrow(/bits 8/);
    expect(() => new Avx(avx(1, [], { codec: { type: 0x32 } }))).toThrow(/codec 50/);
  });

  it("rejects broken blocks and records", () => {
    const one = block(record([...aHeader(1), ...empty]));
    expect(() => new Avx(avx(1, [[1, 2]]))).toThrow(/block size truncated/);
    expect(() => new Avx(avx(1, [[...u32(3)]]))).toThrow(/bad size 3/);
    expect(() => new Avx(avx(1, [[...u32(4 + 2), 0, 0]]))).toThrow(/record length truncated/);
    expect(() => new Avx(avx(1, [[...u32(8), ...u32(9)]]))).toThrow(/runs past its block/);
    expect(() => [...new Avx(avx(1, [one, one])).frames()]).toThrow(/after the last segment/);
    expect(() => [...new Avx(avx(2, [one])).frames()]).toThrow(/ends in segment 0 with 0 frames missing \(2 segments/);
    const inside = block(record([...aHeader(2), ...empty]), record([...aHeader(1), ...empty]));
    expect(() => [...new Avx(avx(1, [inside])).frames()]).toThrow(/FLX header inside segment 0/);
    expect(() => [...new Avx(avx(1, [block(record([...aHeader(0), ...empty]))])).frames()]).toThrow(/0 frames/);
    expect(() => [
      ...new Avx(avx(1, [block(record([...aHeader(1), ...rect(0, 0, 1, 1), ...empty]))])).frames(),
    ]).toThrow(/unexpected rect/);
    const big = flxHeader(1, 2000, 1000);
    expect(() => [...new Avx(avx(1, [block(record([...big, ...empty]))])).frames()]).toThrow(/larger than the buffer/);
  });

  it("checks the sound chunk of each record", () => {
    const m = new Avx(avx(1, [block(record([...aHeader(1), ...empty]))]));
    expect(() => m.audioChunk(m.records[0])).toThrow(/not decoded yet/);
    // record whose sound chunk is missing / does not fill the record
    const noSound = [...aHeader(1), ...empty];
    const bad = new Avx(avx(1, [block([...u32(noSound.length), ...noSound])]));
    const f = bad.frames().next().value!;
    expect(() => bad.audioChunk(f.record)).toThrow(/no sound chunk/);
    const wrong = [...aHeader(1), ...empty, ...u32(20), 0, 0, 0, 0];
    const w = new Avx(avx(1, [block([...u32(wrong.length), ...wrong])]));
    expect(() => w.audioChunk(w.frames().next().value!.record)).toThrow(/does not fill the record/);
    expect(verifyMedia("W.AVX", avx(1, [block([...u32(wrong.length), ...wrong])]))).toEqual([
      expect.stringMatching(/does not fill/),
    ]);
    expect(verifyMedia("O.AVX", avx(1, [block(record([...aHeader(1), ...empty], [1, 2, 3, 4]))]))).toEqual([
      expect.stringMatching(/not a multiple of 8/),
    ]);
  });
});
