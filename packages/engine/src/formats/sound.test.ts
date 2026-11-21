import { describe, expect, it } from "vitest";
import { decodeGsm, decodeIma, Sound, soundExt, SOUND_RATE, SoundError } from "./sound";

// --- synthetic files -------------------------------------------------------------

function u32(...xs: number[]): number[] {
  return xs.flatMap((x) => [x & 0xff, (x >> 8) & 0xff, (x >> 16) & 0xff, (x >>> 24) & 0xff]);
}

/** Raw sound buffer: size, loop start, loop length, PCM. */
function rawSound(pcm: number[], opts: { size?: number; loopStart?: number; loopLength?: number } = {}) {
  return new Uint8Array([...u32(opts.size ?? pcm.length, opts.loopStart ?? 0, opts.loopLength ?? 0), ...pcm]);
}

/** Packed sound: 0x18-byte codec header, buffer header (not for type 0x33), codec data. */
function packedSound(
  type: number,
  payload: number[],
  opts: {
    packed?: number;
    unpacked?: number;
    size?: number;
    pred?: number;
    index?: number;
    predRight?: number;
  } = {},
) {
  const head = [
    ...u32(type, opts.packed ?? payload.length, opts.unpacked ?? 0, 0),
    (opts.pred ?? 0) & 0xff,
    ((opts.pred ?? 0) >> 8) & 0xff,
    opts.index ?? 0,
    0,
    (opts.predRight ?? 0) & 0xff,
    ((opts.predRight ?? 0) >> 8) & 0xff,
    0,
    0,
  ];
  const buffer = type === 0x33 ? [] : u32(opts.size ?? opts.unpacked ?? 0, 0, 0);
  return new Uint8Array([...head, ...buffer, ...payload]);
}

describe("sound on synthetic data", () => {
  it("parses raw 8-bit and 16-bit buffers", () => {
    const s8 = new Sound(rawSound([0x80, 0xff, 0x00]), "SND");
    expect([s8.kind, s8.bits, s8.size, s8.frames, [...s8.pcm]]).toEqual(["raw8", 8, 3, 3, [0x80, 0xff, 0x00]]);
    expect(s8.verify()).toEqual([]);
    const s16 = new Sound(rawSound([0x01, 0x00, 0xff, 0xff, 0x00, 0x80]), "S16");
    expect([s16.kind, s16.frames, [...s16.pcm]]).toEqual(["raw16", 3, [1, -1, -32768]]);
    expect(s16.channelData()[0][2]).toBe(-1);
    expect(s16.verify()).toEqual([]);
  });

  it("raw buffers keep loop fields and report bad ones", () => {
    const s = new Sound(rawSound([0, 0, 0, 0], { loopStart: 2, loopLength: 2 }), "S16");
    expect([s.loopStart, s.loopLength, s.verify()]).toEqual([2, 2, []]);
    expect(new Sound(rawSound([0, 0], { loopStart: 1, loopLength: 2 }), "S16").verify()).toContainEqual(
      expect.stringMatching(/loop 1\+2 past size 2/),
    );
  });

  it("verify reports trailing bytes, odd 16-bit sizes and wrong extensions", () => {
    expect(new Sound(rawSound([0, 0, 0], { size: 2 }), "S16").verify()).toContainEqual(
      expect.stringMatching(/1 bytes after/),
    );
    expect(new Sound(rawSound([0, 0, 0]), "S16").verify()).toContainEqual(expect.stringMatching(/multiple of 2/));
    expect(new Sound(rawSound([0, 0]), "S22").verify()).toContainEqual(expect.stringMatching(/unexpected raw16/));
  });

  it("rejects too short and truncated files", () => {
    expect(() => new Sound(new Uint8Array(3))).toThrow(/too short/);
    expect(() => new Sound(new Uint8Array([0, 0, 0, 0, 0, 0]), "S16")).toThrow(/buffer header truncated/);
    expect(() => new Sound(rawSound([1, 2], { size: 4 }), "S16")).toThrow(/data truncated: 2 of 4/);
    expect(() => new Sound(new Uint8Array(u32(0x35, 0)))).toThrow(/codec header truncated/);
    expect(() => new Sound(packedSound(0x35, []).subarray(0, 0x1c))).toThrow(/buffer header truncated/);
    expect(() => new Sound(packedSound(0x35, [1, 2], { packed: 3 }))).toThrow(/data truncated: 2 of 3/);
  });

  it("decodes IMA ADPCM nibbles low first with the standard tables", () => {
    // code 7 from index 0: diff = 0 + 7 + 3 + 1 = 11, index 8 (step 16);
    // code 15 then: diff = -(2 + 16 + 8 + 4) = -30, index 16 (step 34); code 0 adds step >> 3
    // and lowers the index: +4 (step 31), +3, +3 (step 25), +3, +2 (step 21), +2
    expect([...decodeIma(new Uint8Array([0xf7, 0, 0, 0]), 16, 0, 0)]).toEqual([11, -19, -15, -12, -9, -6, -4, -2]);
    expect([...decodeIma(new Uint8Array([0x00, 0, 0, 0]), 16, 100, 0)]).toEqual(Array(8).fill(100));
  });

  it("IMA clamps the predictor and the step index", () => {
    const s = decodeIma(new Uint8Array(8).fill(0x77), 32, 32760, 85);
    expect(Math.max(...s)).toBe(32767);
    expect([...decodeIma(new Uint8Array(4).fill(0xff), 16, -32760, 88)].every((x) => x === -32768)).toBe(true);
  });

  it("decodes IMA stereo with one word per channel, interleaved", () => {
    const s = decodeIma(new Uint8Array([7, 0, 0, 0, 0, 0, 0, 0]), 32, 0, 0, 2, 50);
    expect([...s.subarray(0, 4)]).toEqual([11, 50, 13, 50]);
    expect(s.length).toBe(16);
  });

  it("IMA rejects bad output sizes and truncated data", () => {
    expect(() => decodeIma(new Uint8Array(4), 8, 0, 0)).toThrow(/not a multiple of 16/);
    expect(() => decodeIma(new Uint8Array(4), 32, 0, 0, 2)).toThrow(/truncated/);
  });

  it("parses packed IMA mono (.PSD) and stereo (type 0x33) files", () => {
    const mono = new Sound(packedSound(0x32, [0x07, 0, 0, 0], { unpacked: 16, pred: -5, index: 3 }), "PSD");
    expect([mono.kind, mono.dataOffset, mono.size, mono.predictor, mono.index, mono.verify()]).toEqual([
      "ima",
      0x24,
      16,
      -5,
      3,
      [],
    ]);
    const stereo = new Sound(packedSound(0x33, Array(8).fill(0), { unpacked: 32, predRight: 7 }));
    expect([stereo.kind, stereo.channels, stereo.dataOffset, stereo.size, stereo.frames]).toEqual([
      "ima-stereo",
      2,
      0x18,
      32,
      8,
    ]);
    expect([...stereo.pcm.subarray(0, 2)]).toEqual([0, 7]);
    expect(stereo.channelData()[1][0]).toBeCloseTo(7 / 32768);
  });

  it("verify reports inconsistent IMA headers", () => {
    const bad = new Sound(packedSound(0x32, [0, 0, 0, 0], { unpacked: 32, size: 16 }), "PSD").verify();
    expect(bad).toContainEqual(expect.stringMatching(/unpacked size 32 != 4 \* packed 4/));
    expect(bad).toContainEqual(expect.stringMatching(/buffer size 16 != unpacked size 32/));
    expect(bad).toContainEqual(expect.stringMatching(/IMA data truncated/));
  });

  it("GSM decodes whole 65-byte blocks only, 320 samples each", () => {
    expect(decodeGsm(new Uint8Array(64)).length).toBe(0);
    expect(decodeGsm(new Uint8Array(65)).length).toBe(320);
    expect(decodeGsm(new Uint8Array(140)).length).toBe(640);
  });

  it("GSM output is truncated to 13 bits like libgsm", () => {
    const block = new Uint8Array(65).map((_, i) => (i * 37 + 11) & 0xff);
    const s = decodeGsm(block);
    expect(s.every((x) => (x & 7) === 0)).toBe(true);
    expect(s.some((x) => x !== 0)).toBe(true);
    // first samples, cross-checked with the external checker (the decoder is bit-exact with
    // the Windows ACM GSM 6.10 codec on the game's files, see)
    expect([...s.subarray(0, 8)]).toEqual(GSM_PATTERN_HEAD);
  });

  it("parses packed GSM files; type 0x34 keeps the high byte xor 0x80", () => {
    const block = Array.from({ length: 65 }, (_, i) => (i * 37 + 11) & 0xff);
    const g16 = new Sound(packedSound(0x35, block, { size: 600 }), "S22");
    expect([g16.kind, g16.size, g16.decodedBytes, g16.verify()]).toEqual(["gsm16", 600, 640, []]);
    const g8 = new Sound(packedSound(0x34, block, { size: 300 }), "SND");
    expect([g8.kind, g8.bits, g8.decodedBytes, g8.verify()]).toEqual(["gsm8", 8, 320, []]);
    expect(g8.pcm[3]).toBe(((g16.pcm[3] >> 8) & 0xff) ^ 0x80);
    expect(new Sound(packedSound(0x35, block, { size: 700 }), "S22").verify()).toContainEqual(
      expect.stringMatching(/decodes to 640 bytes, buffer size is 700/),
    );
    expect(new Sound(packedSound(0x35, [...block, 0], { size: 2 }), "S22").verify()).toContainEqual(
      expect.stringMatching(/not a multiple of 65/),
    );
  });

  it("writes a PCM WAV of the playable part", () => {
    const s = new Sound(rawSound([1, 0, 2, 0, 3, 0], { size: 4 }), "S16");
    const w = s.wav();
    const v = new DataView(w.buffer);
    expect(String.fromCharCode(...w.subarray(0, 4), ...w.subarray(8, 16))).toBe("RIFFWAVEfmt ");
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true), v.getUint32(40, true)]).toEqual([
      1,
      SOUND_RATE,
      16,
      4,
    ]);
    expect([...w.subarray(44)]).toEqual([1, 0, 2, 0]);
    expect(w.length).toBe(48);
  });

  it("soundExt and SoundError", () => {
    expect([soundExt("a.b.s22"), soundExt("NOEXT")]).toEqual(["S22", ""]);
    expect(() => new Sound(new Uint8Array(0))).toThrow(SoundError);
  });
});

const GSM_PATTERN_HEAD = [0, 0, 1344, 1336, 1672, 2576, 2688, 2872];
