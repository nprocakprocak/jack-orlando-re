import { describe, expect, it } from "vitest";
import { Pak } from "./pak";

// --- synthetic archives -----------------------------------------------------

interface FakeFile {
  name: string;
  data: number[];
  nameLen?: number;
}

/** Builds a .PAK in memory following. */
function buildPak(files: FakeFile[], opts: { magic?: string; reserved?: number; dataStartDelta?: number } = {}) {
  const enc = new TextEncoder();
  const names = files.map((f) => enc.encode(f.name + "\0"));
  const dirSize = names.reduce((n, b) => n + 12 + b.length, 0);
  const dataStart = 16 + dirSize;
  const total = dataStart + files.reduce((n, f) => n + f.data.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  out.set(enc.encode((opts.magic ?? "PAK\0").padEnd(4, "\0").slice(0, 4)), 0);
  v.setUint32(4, files.length, true);
  v.setUint32(8, dataStart + (opts.dataStartDelta ?? 0), true);
  v.setUint32(12, opts.reserved ?? 0, true);
  let dir = 16;
  let data = dataStart;
  files.forEach((f, i) => {
    v.setUint32(dir, data, true);
    v.setUint32(dir + 4, f.data.length, true);
    v.setUint32(dir + 8, f.nameLen ?? names[i].length, true);
    out.set(names[i], dir + 12);
    dir += 12 + names[i].length;
    out.set(f.data, data);
    data += f.data.length;
  });
  return out;
}

describe("pak on synthetic data", () => {
  it("parses a well-formed archive", () => {
    const pak = new Pak(buildPak([{ name: "A.BM", data: [1, 2, 3] }, { name: "B.SND", data: [9] }]));
    expect(pak.entries.map((e) => [e.name, e.size])).toEqual([["A.BM", 3], ["B.SND", 1]]);
    expect([...pak.read("b.snd")]).toEqual([9]);
    expect(pak.verify()).toEqual([]);
  });

  it("parses an empty archive", () => {
    const pak = new Pak(buildPak([]));
    expect(pak.entries).toEqual([]);
    expect(pak.verify()).toEqual([]);
  });

  it("returns the first of repeated names", () => {
    const pak = new Pak(buildPak([{ name: "F.PBM", data: [1] }, { name: "F.PBM", data: [2] }]));
    expect([...pak.read("F.PBM")]).toEqual([1]);
  });

  it("decodes cp1250 names", () => {
    const raw = buildPak([{ name: "X", data: [] }]);
    raw[16 + 12] = 0xb9; // 'a-ogonek' in cp1250
    expect(new Pak(raw).entries[0].name).toBe("ą");
  });

  it("rejects too short data", () => {
    expect(() => new Pak(new Uint8Array(8))).toThrow(/too short/);
  });

  it("rejects bad magic", () => {
    expect(() => new Pak(buildPak([], { magic: "KAP" }))).toThrow(/bad magic/);
  });

  it("rejects a truncated directory", () => {
    const raw = buildPak([{ name: "A.BM", data: [] }]);
    expect(() => new Pak(raw.subarray(0, 20))).toThrow(/directory truncated/);
  });

  it("rejects name length 0 and over MAX_PATH", () => {
    expect(() => new Pak(buildPak([{ name: "A", data: [], nameLen: 0 }]))).toThrow(/name length 0/);
    expect(() => new Pak(buildPak([{ name: "A", data: [], nameLen: 0x105 }]))).toThrow(/name length 261/);
  });

  it("throws when reading a missing name", () => {
    expect(() => new Pak(buildPak([])).read("NOPE.BM")).toThrow(/not found/);
  });

  it("verify reports data_start mismatch, reserved field and size problems", () => {
    expect(new Pak(buildPak([{ name: "A", data: [1] }], { dataStartDelta: 4 })).verify()).toContainEqual(
      expect.stringMatching(/data_start/),
    );
    expect(new Pak(buildPak([], { reserved: 7 })).verify()).toContainEqual(expect.stringMatching(/reserved/));
    const raw = buildPak([{ name: "A", data: [1, 2, 3, 4] }]);
    expect(new Pak(raw.subarray(0, raw.length - 2)).verify()).toContainEqual(expect.stringMatching(/past end/));
    const padded = new Uint8Array(raw.length + 1);
    padded.set(raw);
    expect(new Pak(padded).verify()).toContainEqual(expect.stringMatching(/file size/));
  });
});
