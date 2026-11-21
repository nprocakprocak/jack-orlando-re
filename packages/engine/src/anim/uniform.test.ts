// The uniform frame set (Jack_LoadWalkFramesUniform) on a synthetic archive; no game files.
import { describe, expect, it } from "vitest";
import type { Pak } from "../formats/pak";
import { AnimError } from "./animator";
import { loadWalkFrames } from "./assets";
import { STAND_FRAMES, STAND_FRAMES_UNIFORM, standFrameFile, standHotSpot, WALK_SERIES, WALK_SERIES_UNIFORM, uniformAfterLoad, walkFrameFile, walkHotSpotFile } from "./jack";

/** .SFB of 12 triples (x, 100 - x, y) with x = base + i. */
function sfb(base: number): Uint8Array {
  const b = new Uint8Array(72);
  const v = new DataView(b.buffer);
  for (let i = 0; i < 12; i++) {
    v.setInt16(i * 6, base + i, true);
    v.setInt16(i * 6 + 2, 100 - base - i, true);
    v.setInt16(i * 6 + 4, 250, true);
  }
  return b;
}

/** A .PBM header with only the width. */
const pbm = (w: number) => new Uint8Array([w & 0xff, w >> 8, 10, 0]);

/** The two methods loadWalkFrames uses. */
function fakePak(files: Record<string, Uint8Array>): Pak {
  return {
    find: (n: string) => (n in files ? { name: n } : undefined),
    read: (e: { name: string } | string) => files[typeof e === "string" ? e : e.name],
  } as unknown as Pak;
}

function civilianFiles(): Record<string, Uint8Array> {
  const f: Record<string, Uint8Array> = {};
  WALK_SERIES.forEach((s, d) => (f[`${s}.SFB`] = sfb(10 * d)));
  STAND_FRAMES.forEach((n, d) => (f[n] = pbm(60 + d)));
  return f;
}

function uniformFiles(): Record<string, Uint8Array> {
  const f: Record<string, Uint8Array> = {};
  WALK_SERIES_UNIFORM.forEach((s, d) => (f[`${s}.SFB`] = sfb(5 + 10 * d)));
  STAND_FRAMES_UNIFORM.forEach((n, d) => (f[n] = pbm(80 + d)));
  return f;
}

describe("uniform frame names", () => {
  it("walk frames have two-digit numbers, the civilian ones one digit", () => {
    expect(walkFrameFile(0, 0, true)).toBe("FRONW01.PBM");
    expect(walkFrameFile(4, 11, true)).toBe("SKBAW12.PBM");
    expect(walkFrameFile(0, 0)).toBe("FRON1.PBM");
    expect(walkHotSpotFile(2, true)).toBe("BACKW.SFB");
    expect(standFrameFile(3, true)).toBe("STSFW13.PBM");
    expect(standFrameFile(3)).toBe("SSSP2.PBM");
  });

  it("standing hot spots are the hard-coded ones of", () => {
    expect([0, 1, 2, 3, 4].map((d) => standHotSpot(d as 0, 100, true))).toEqual([
      [47, 53, 268], [24, 76, 262], [46, 54, 264], [39, 61, 266], [49, 51, 263],
    ]);
  });
});

describe("loadWalkFrames: both sets", () => {
  it("reads the civilian and the uniform hot spots and standing widths", () => {
    const w = loadWalkFrames(fakePak({ ...civilianFiles(), ...uniformFiles() }));
    expect(w.hotSpots[1][0]).toEqual([10, 90, 250]);
    expect(w.standWidths).toEqual([60, 61, 62, 63, 64]);
    expect(w.uniform!.hotSpots[1][0]).toEqual([15, 85, 250]);
    expect(w.uniform!.hotSpots[4][11]).toEqual([56, 44, 250]);
    expect(w.uniform!.standWidths).toEqual([80, 81, 82, 83, 84]);
  });

  it("an archive without the uniform files gives the civilian set only", () => {
    expect(loadWalkFrames(fakePak(civilianFiles())).uniform).toBeUndefined();
  });

  it("a partial uniform set is an error", () => {
    const u = uniformFiles();
    delete u["STBAW13.PBM"];
    expect(() => loadWalkFrames(fakePak({ ...civilianFiles(), ...u }))).toThrow(new AnimError("STBAW13.PBM missing"));
    const v = uniformFiles();
    delete v["SKBAW.SFB"];
    expect(() => loadWalkFrames(fakePak({ ...civilianFiles(), ...v }))).toThrow(new AnimError("SKBAW.SFB missing"));
  });
});

describe("uniformAfterLoad (Save_LoadState)", () => {
  it("JACKISWOJ 1 puts the civilian Jack into the uniform, 0 takes it off; other values keep the set", () => {
    expect(uniformAfterLoad(false, 1)).toBe(true);
    expect(uniformAfterLoad(false, 0)).toBe(false);
    expect(uniformAfterLoad(false, 2)).toBe(false);
    expect(uniformAfterLoad(true, 0)).toBe(false);
    expect(uniformAfterLoad(true, 1)).toBe(true);
    expect(uniformAfterLoad(true, 2)).toBe(true);
  });
});
