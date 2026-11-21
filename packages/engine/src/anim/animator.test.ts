import { describe, expect, it } from "vitest";
import { NO_SHADOW, parseIcs, type HotSpot, type IcsFrame } from "../formats/global";
import { AnimError, JackAnimator, type JackPose, type WalkFrames } from "./animator";
import { findInsertion, globalInsertion, insertionTable } from "./assets";
import { f32, ROUND_SHADOW } from "./jack";

const hot = (i: number): HotSpot => [40 + i, 60 - i, 260];
const DATA: WalkFrames = { hotSpots: [0, 1, 2, 3, 4].map(() => Array.from({ length: 12 }, (_, i) => hot(i))), standWidths: [100, 60, 110, 80, 90] };
const POSE: JackPose = { x: 300, y: 400, dir: 1, facing: 1, scale: 1 };

function frame(file: string, extra: Partial<IcsFrame> = {}): IcsFrame {
  return { file, xRight: 50, xLeft: 70, y: 262, shadow1: [5, 2], shadow2: [NO_SHADOW, NO_SHADOW], effect: null, ...extra };
}

function ticks(a: JackAnimator, n: number, pose = POSE) {
  return Array.from({ length: n }, () => a.tick(pose).update);
}

describe("JackAnimator: standing (Jack_Stand)", () => {
  it("uses SS*2.PBM with the fixed hot spot and the direction's scale factor", () => {
    const a = new JackAnimator(DATA);
    const u = a.stand({ ...POSE, dir: 0, scale: 0.5 });
    const s = f32(f32(0.978) * 0.5);
    expect(u.sprite).toEqual({ file: "SSFR2.PBM", source: "resource", x: Math.trunc(300 - 46 * s), y: Math.trunc(400 - 264 * s), scale: s, mirrored: false });
    expect(u.shadows![0]!.file).toBe("SH_FR04.PBM");
    expect(a.walkFrame).toBe(3);
    const left = a.stand({ ...POSE, dir: 1, facing: -1 });
    expect(left.sprite!.x).toBe(300 - (60 - 23));
    expect(left.sprite!.mirrored).toBe(true);
  });

  it("noScale and the uniform change the scale", () => {
    expect(new JackAnimator(DATA, { noScale: true }).standScale({ ...POSE, scale: 0.3 })).toBe(1);
    expect(new JackAnimator(DATA, { uniform: true }).standScale({ ...POSE, dir: 4, scale: 0.5 })).toBe(f32(f32(1.014) * 0.5));
    expect(new JackAnimator(DATA).standScale({ ...POSE, dir: 4, scale: 1 })).toBe(1); // 1.015 clamped
    expect(new JackAnimator(DATA).standScale({ ...POSE, dir: 0, scale: 0.05 })).toBe(f32(0.1));
  });
});

describe("JackAnimator: the uniform set (Jack_LoadWalkFramesUniform)", () => {
  const uhot = (i: number): HotSpot => [30 + i, 70 - i, 250];
  const BOTH: WalkFrames = {
    ...DATA,
    uniform: { hotSpots: [0, 1, 2, 3, 4].map(() => Array.from({ length: 12 }, (_, i) => uhot(i))), standWidths: [101, 61, 111, 81, 91] },
  };

  it("standing: ST*W13.PBM with the uniform hot spots and scale", () => {
    const a = new JackAnimator(BOTH, { uniform: true });
    const files = ([0, 1, 2, 3, 4] as const).map((dir) => a.stand({ ...POSE, dir }).sprite!.file);
    expect(files).toEqual(["STFRW13.PBM", "STPRW13.PBM", "STBAW13.PBM", "STSFW13.PBM", "STSBW13.PBM"]);
    const s = f32(f32(0.978) * 0.5);
    const u = a.stand({ ...POSE, dir: 0, scale: 0.5 });
    expect(u.sprite).toEqual({ file: "STFRW13.PBM", source: "resource", x: Math.trunc(300 - 47 * s), y: Math.trunc(400 - 268 * s), scale: s, mirrored: false });
    // mirrored: xLeft = width of STSFW13 (81) - 39
    expect(a.stand({ ...POSE, dir: 3, facing: -1 }).sprite!.x).toBe(300 - Math.trunc((81 - 39) * f32(1)));
    // 0.988 of the civilian three-quarter frames is 1 in the uniform
    expect(a.standScale({ ...POSE, dir: 3, scale: 0.5 })).toBe(0.5);
    // shadows stay SH_* (does not load other ones)
    expect(a.stand({ ...POSE, dir: 2 }).shadows![0]!.file).toBe("SH_BA04.PBM");
  });

  it("walking: FRONW01..12 (two digits) in all five directions with the uniform hot spots", () => {
    const a = new JackAnimator(BOTH, { frameDelay: 2, walkSpeed: 1, uniform: true });
    for (const dir of [0, 1, 2, 3, 4] as const) {
      a.walk();
      a.walkFrame = 0;
      const u = ticks(a, 1, { ...POSE, dir })[0];
      expect(u.sprite!.file).toBe(`${["FRONW", "PROFW", "BACKW", "SKFRW", "SKBAW"][dir]}01.PBM`);
      expect(u.sprite!.x).toBe(300 - 30);
      expect(u.sprite!.y).toBe(400 - 250);
    }
    a.walkFrame = 11;
    expect(ticks(a, 1)[0].sprite!.file).toBe("PROFW12.PBM");
  });

  it("switching the flag swaps the set on the next frame; without loaded uniform frames the civilian ones stay", () => {
    const a = new JackAnimator(BOTH);
    expect(a.stand(POSE).sprite!.file).toBe("SSPR2.PBM");
    a.uniform = true;
    expect(a.stand(POSE).sprite!.file).toBe("STPRW13.PBM");
    a.uniform = false;
    expect(a.stand(POSE).sprite!.file).toBe("SSPR2.PBM");
    const civ = new JackAnimator(DATA, { uniform: true });
    expect(civ.stand(POSE).sprite!.file).toBe("SSPR2.PBM");
    expect(civ.standScale({ ...POSE, dir: 3, scale: 0.5 })).toBe(0.5); // the flag still picks the scale
  });
});

describe("JackAnimator: walking", () => {
  it("one frame per (delay - walkSpeed) ticks, from frame 3, shadow one frame ahead, footsteps at 0 and 6", () => {
    const a = new JackAnimator(DATA, { frameDelay: 5, walkSpeed: 1 });
    a.stand(POSE);
    a.walk();
    const out = ticks(a, 4 * 13);
    const shown = out.filter((u) => u.sprite);
    expect(shown.length).toBe(13);
    expect(out.findIndex((u) => u.sprite)).toBe(0); // delay starts at 0
    expect(out.slice(1, 4).every((u) => !u.sprite)).toBe(true);
    expect(shown.map((u) => u.walkFrame)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3]);
    expect(shown[0].sprite!.file).toBe("PROF4.PBM");
    expect(shown[0].sprite!.x).toBe(300 - 43);
    expect(shown[0].shadows![0]!.file).toBe("SH_PR05.PBM");
    const steps = shown.filter((u) => u.sounds.length).map((u) => [u.walkFrame, u.sounds[0].sound]);
    expect(steps).toEqual([[6, "KROK2.SND"], [0, "KROK1.SND"]]);
  });

  it("calls move before drawing and never waits less than 1 tick", () => {
    const a = new JackAnimator(DATA, { frameDelay: 1, walkSpeed: 3 });
    a.walk();
    let n = 0;
    for (let i = 0; i < 5; i++) {
      const { update, pose } = a.tick(POSE, (p) => ({ ...p, x: p.x + ++n }));
      expect(update.sprite!.x).toBe(pose.x - DATA.hotSpots[1][update.walkFrame!][0]);
    }
    expect(n).toBe(5);
  });

  it("removes a shown shadow 2 when walking starts, shadows off leaves them alone", () => {
    const a = new JackAnimator(DATA);
    a.startInsertion({ frames: [frame("A.PBM", { shadow2: [1, 1] })], start: 0, count: 1, facing: 1, global: false });
    const ins = ticks(a, 5).find((u) => u.sprite)!;
    expect(ins.shadows![1]!.file).toBe(ROUND_SHADOW);
    a.walk();
    const w = ticks(a, 5).find((u) => u.sprite)!;
    expect(w.shadows![1]).toBeNull();
    const off = new JackAnimator(DATA, { shadows: false });
    off.walk();
    expect(ticks(off, 1)[0].shadows).toBeUndefined();
  });
});

describe("JackAnimator: insertions", () => {
  it("shows each frame after frameDelay ticks, rounds the placement, ends one delay after the last", () => {
    const a = new JackAnimator(DATA, { frameDelay: 3 });
    a.startInsertion({ frames: [frame("A.PBM"), frame("B.PBM")], start: 0, count: 2, facing: 1, global: false, name: "AB" });
    const out = ticks(a, 9);
    expect(out.map((u) => u.sprite?.file ?? (u.insertionEnded !== undefined ? "end" : "-"))).toEqual(["-", "-", "A.PBM", "-", "-", "B.PBM", "-", "-", "end"]);
    expect(out[2].sprite).toEqual({ file: "A.PBM", source: "scene", x: 250, y: 138, scale: 1, mirrored: false });
    expect(out[8].insertionEnded).toBe("AB");
    expect(a.mode).toBe("stand");
  });

  it("mirrors with xLeft, flips shadow dx, scales offsets unless noScale", () => {
    const a = new JackAnimator(DATA, { frameDelay: 1 });
    a.startInsertion({ frames: [frame("A.PBM", { shadow1: [10, 4] })], start: 0, count: 1, facing: -1, global: false });
    const u = a.tick({ ...POSE, scale: 0.5 }).update;
    expect(u.sprite).toMatchObject({ x: Math.trunc(300 - 70 * 0.5 + 0.5), mirrored: true });
    const sh = u.shadows![0]!;
    const s = f32(0.5 * 0.7);
    expect([sh.x, sh.y]).toEqual([Math.trunc(295 - 55 * s), Math.trunc(402 - 14 * s)]);
    expect(u.shadows![1]).toBeUndefined();
    const n = new JackAnimator(DATA, { frameDelay: 1, noScale: true });
    n.startInsertion({ frames: [frame("A.PBM", { shadow1: [10, 4] })], start: 0, count: 1, facing: 1, global: false });
    const v = n.tick({ ...POSE, scale: 0.5 }).update;
    expect(v.sprite!.scale).toBe(1);
    expect(v.shadows![0]!.x).toBe(Math.trunc(310 - 55 * s)); // offset unscaled, shadow size still 0.5
  });

  it("global insertions: GLOBAL.PAK, scale times scaleMul clamped to 0.1..1", () => {
    const a = new JackAnimator(DATA, { frameDelay: 1 });
    a.startInsertion({ frames: [frame("A.PBM"), frame("B.PBM")], start: 0, count: 2, facing: 1, global: true, scaleMul: 0.97 });
    const u = a.tick({ ...POSE, scale: 1 }).update;
    expect(u.sprite).toMatchObject({ source: "global", scale: f32(0.97) });
    expect(a.tick({ ...POSE, scale: 0.05 }).update.sprite!.scale).toBe(f32(0.1));
  });

  it("plays effects on both channels for channel 0, and the next section's first effect at the end", () => {
    const ics = parseIcs(
      new TextEncoder().encode("[A] A1.PBM 1 2 3 1000 0 1000 0 EFFECT S1.SND 0 7 30 A2.PBM 1 2 3 1000 0 1000 0 [B] EFFECT S2.SND 3 0 20 B1.PBM 1 2 3 1000 0 1000 0"),
    );
    const table = insertionTable(ics);
    expect(table.sections).toEqual([{ name: "A", start: 0, count: 2 }, { name: "B", start: 2, count: 1 }]);
    const a = new JackAnimator(DATA, { frameDelay: 1 });
    a.startInsertion(findInsertion(table, "A", 1)!);
    const out = ticks(a, 3);
    expect(out[1].sounds).toEqual([{ sound: "S1.SND", channels: [1, 2], volumes: [30, 30], kind: "insertion" }]);
    expect(out[2].insertionEnded).toBe("A");
    expect(out[2].sounds).toEqual([{ sound: "S2.SND", channels: [3], volumes: [20], kind: "insertion" }]);
    expect(out[0].shadows).toEqual([undefined, undefined]); // no shadows in the frame, none shown before
    expect(findInsertion(table, "a", 1)).toBeNull(); // strcmp: exact name
    expect(globalInsertion(ics, "b", -1, 0.9)).toMatchObject({ start: 0, count: 1, global: true, scaleMul: 0.9, name: "B" });
    expect(globalInsertion(ics, "C", 1)).toBeNull();
  });

  it("rejects ranges outside the frame table", () => {
    const a = new JackAnimator(DATA);
    expect(() => a.startInsertion({ frames: [frame("A.PBM")], start: 0, count: 2, facing: 1, global: false })).toThrow(AnimError);
    expect(() => a.startInsertion({ frames: [], start: -1, count: 0, facing: 1, global: false })).toThrow(AnimError);
  });
});
