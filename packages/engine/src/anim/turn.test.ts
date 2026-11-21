import { describe, expect, it } from "vitest";
import type { Facing } from "./jack";
import {
  placeTurnFrame,
  rotNumber,
  TURN_END,
  TURN_FRAMES_STANDING,
  TURN_FRAMES_WALKING,
  TURN_SCALE,
  TURN_SCALE_UNIFORM,
  turnEndWalkFrame,
  turnFrameFile,
  turnFrameTicks,
  turnHotSpotRef,
  TurnPlayer,
  turnSequence,
  turnShadow,
  turnShadowFile,
  type TurnStep,
} from "./turn";

/** All (dir, facing) states Jack_WalkToPoint can produce (front and back are never mirrored). */
const STATES: [number, Facing][] = [[0, 1], [2, 1], [1, 1], [1, -1], [3, 1], [3, -1], [4, 1], [4, -1]];
/** ROTP image showing each direction: 1 front, 5 three-quarter front, 9 profile, 13 three-quarter back, 17 back. */
const POSE: Record<number, number> = { 0: 1, 3: 5, 1: 9, 4: 13, 2: 17 };
const isSpot = (s: TurnStep[]) => s.every((x) => x.anim >= 13 && x.anim <= 20);
const lastRot = (st: TurnStep, counts: readonly number[]) => rotNumber(st.anim, counts[st.anim] - 1);
/** Turn frames that show a direction with the same mirror as the walk, except 3/4 back (drawn the other way). */
const rotFacing = (dir: number, mirror: Facing): Facing => (dir === 4 ? (-mirror as Facing) : mirror);

describe("turnSequence (Turn_Start rules)", () => {
  it("no change, no animation; every change has one, standing and walking", () => {
    for (const [d, f] of STATES) {
      expect(turnSequence(d, f, d, f)).toEqual([]);
      expect(turnSequence(d, f, d, f, true)).toEqual([]);
    }
    for (const [od, of] of STATES)
      for (const [nd, nf] of STATES) {
        if (od === nd && of === nf) continue;
        expect(turnSequence(od, of, nd, nf).length).toBeGreaterThan(0);
        expect(turnSequence(od, of, nd, nf, true).length).toBeGreaterThan(0);
      }
  });

  it("on the spot: starts next to the old pose, runs frame by frame, ends on the new pose and mirror", () => {
    for (const [od, of] of STATES)
      for (const [nd, nf] of STATES) {
        const s = turnSequence(od, of, nd, nf);
        if (!s.length) continue;
        expect(isSpot(s)).toBe(true);
        expect(s.every((x) => x.frame === 0)).toBe(true);
        const first = rotNumber(s[0].anim, 0);
        expect(Math.abs(first - POSE[od])).toBe(1);
        const last = s[s.length - 1];
        expect(lastRot(last, TURN_FRAMES_STANDING)).toBe(POSE[nd]);
        if (nd !== 0 && nd !== 2) expect(last.facing).toBe(rotFacing(nd, nf));
        for (let i = 1; i < s.length; i++) {
          const end = lastRot(s[i - 1], TURN_FRAMES_STANDING);
          const start = rotNumber(s[i].anim, 0);
          expect(Math.abs(start - end)).toBe(1);
          // the mirror flips only when passing through the front or the back
          if (s[i].facing !== s[i - 1].facing) expect([1, 2, 16, 17]).toContain(end);
        }
      }
  });

  it("direction of turn and length: the shorter way, 4 frames per 45°-ish step", () => {
    const frames = (s: TurnStep[]) => s.reduce((n, x) => n + TURN_FRAMES_STANDING[x.anim], 0);
    // front -> back: 180°, 16 frames, through the profile on Jack's right (ROTP 2..17)
    expect(turnSequence(0, 1, 2, 1).map((x) => x.anim)).toEqual([17, 18, 19, 20]);
    expect(frames(turnSequence(0, 1, 2, 1))).toBe(16);
    expect(turnSequence(2, 1, 0, 1).map((x) => x.anim)).toEqual([13, 14, 15, 16]);
    // profile left <-> profile right: 180° through the front, mirror flips at the front
    expect(turnSequence(1, 1, 1, -1)).toEqual([
      { anim: 15, frame: 0, facing: 1 },
      { anim: 16, frame: 0, facing: 1 },
      { anim: 17, frame: 0, facing: -1 },
      { anim: 18, frame: 0, facing: -1 },
    ]);
    expect(turnSequence(1, -1, 1, 1).map((x) => x.facing)).toEqual([-1, -1, 1, 1]);
    // 45°: one animation
    expect(frames(turnSequence(1, 1, 3, 1))).toBe(4);
    expect(frames(turnSequence(0, 1, 1, 1))).toBe(8);
  });

  it("the last matching rule wins (1 -> 3 with the mirror changing: 3 steps, not 1)", () => {
    expect(turnSequence(1, 1, 3, 1)).toEqual([{ anim: 15, frame: 0, facing: 1 }]);
    expect(turnSequence(1, 1, 3, -1).map((x) => [x.anim, x.facing])).toEqual([
      [15, 1],
      [16, 1],
      [17, -1],
    ]);
    // 4 -> 1: checks the facing product, not — same result
    expect(turnSequence(4, 1, 1, -1)).toEqual([{ anim: 14, frame: 0, facing: -1 }]);
    expect(turnSequence(4, 1, 1, 1).map((x) => x.anim)).toEqual([20, 13, 14]);
  });

  it("while walking: OBPL/PROPRO/OBPLBF/OBPLFB, or the on-the-spot frames where no walking variant exists", () => {
    expect(turnSequence(0, 1, 1, 1, true)).toEqual([
      { anim: 2, frame: 0, facing: -1 },
      { anim: 3, frame: 0, facing: -1 },
    ]);
    expect(turnSequence(1, 1, 1, -1, true)).toEqual([{ anim: 8, frame: 0, facing: -1 }]);
    expect(turnSequence(1, -1, 1, 1, true)).toEqual([{ anim: 8, frame: 0, facing: 1 }]);
    expect(turnSequence(0, 1, 2, 1, true)).toEqual([{ anim: 10, frame: 0, facing: 1 }]); // OBPLFB: front -> back
    expect(turnSequence(2, 1, 0, 1, true)).toEqual([{ anim: 9, frame: 0, facing: 1 }]); // OBPLBF
    // 3 -> 4 with the same mirror: 0xcc (204) steps passed, 4 used — the same frames as on the spot
    expect(turnSequence(3, 1, 4, 1, true)).toEqual(turnSequence(3, 1, 4, 1));
    expect(turnSequence(0, 1, 4, 1, true)).toEqual(turnSequence(0, 1, 4, 1));
    for (const [od, of] of STATES)
      for (const [nd, nf] of STATES) {
        const s = turnSequence(od, of, nd, nf, true);
        expect(s.every((x) => x.anim <= 10) || isSpot(s)).toBe(true);
      }
  });
});

describe("frames, hot spots, timing", () => {
  it("turnFrameTicks: ftol(delay · 1.3 − WalkSpeed), at least 1; JACKTEMPO without the option", () => {
    expect(turnFrameTicks(1)).toBe(5);
    expect(turnFrameTicks(0)).toBe(6);
    expect(turnFrameTicks(2)).toBe(4);
    expect(turnFrameTicks(9)).toBe(1);
    expect(turnFrameTicks(1, 8)).toBe(9); // 10.4 − 1
    expect(turnFrameTicks(1, 5, true)).toBe(6);
    expect(turnFrameTicks(9, 5, true)).toBe(6);
  });

  it("rotNumber: 13..16 backwards from 16, 17..20 forwards to 17; other anims are not ROTP", () => {
    expect([0, 1, 2, 3].map((f) => rotNumber(13, f))).toEqual([16, 15, 14, 13]);
    expect([0, 1, 2, 3].map((f) => rotNumber(16, f))).toEqual([4, 3, 2, 1]);
    expect([0, 1, 2, 3].map((f) => rotNumber(17, f))).toEqual([2, 3, 4, 5]);
    expect([0, 1, 2, 3].map((f) => rotNumber(20, f))).toEqual([14, 15, 16, 17]);
    expect(() => rotNumber(5, 0)).toThrow(RangeError);
    expect(() => rotNumber(21, 0)).toThrow(RangeError);
  });

  it("file names and hot spot entries", () => {
    expect(turnFrameFile(0, 0)).toBe("OBPL01.PBM");
    expect(turnFrameFile(7, 3)).toBe("OBPL32.PBM");
    expect(turnFrameFile(8, 7)).toBe("PROPRO8.PBM");
    expect(turnFrameFile(9, 0)).toBe("OBPLBF1.PBM");
    expect(turnFrameFile(10, 7)).toBe("OBPLFB8.PBM");
    expect(turnFrameFile(13, 0)).toBe("ROTP16.PBM");
    expect(turnFrameFile(20, 3, true)).toBe("ROTW17.PBM");
    expect(turnHotSpotRef(3, 2)).toEqual({ file: "OBPL_3.SFB", index: 2 });
    expect(turnHotSpotRef(8, 5)).toEqual({ file: "PROPRO.SFB", index: 5 });
    expect(turnHotSpotRef(9, 1)).toEqual({ file: "OBPLBF.SFB", index: 1 });
    expect(turnHotSpotRef(10, 1)).toEqual({ file: "OBPLFB.SFB", index: 1 });
    expect(turnHotSpotRef(16, 3)).toEqual({ file: "ROTP.SFB", index: 0 });
    expect(turnHotSpotRef(20, 3, true)).toEqual({ file: "ROTW.SFB", index: 16 });
    expect(turnShadowFile(17, 0)).toBe("SHROT02.PBM");
  });

  it("placeTurnFrame: hot X by mirror, truncation", () => {
    expect(placeTurnFrame(100.9, 300.9, [40, 60, 260], 1, 0.5)).toEqual([80, 170]);
    expect(placeTurnFrame(100.9, 300.9, [40, 60, 260], -1, 0.5)).toEqual([70, 170]);
  });

  it("end of walking turns: shift table and walk frame (cases 1 and 5 by mirror)", () => {
    expect(TURN_END).toHaveLength(11);
    expect(TURN_END[8]).toEqual({ dx: 85, dy: 0, walkFrame: 6 });
    expect(turnEndWalkFrame(1, 1)).toBe(9);
    expect(turnEndWalkFrame(1, -1)).toBe(3);
    expect(turnEndWalkFrame(5, -1)).toBe(3);
    expect(turnEndWalkFrame(0, -1)).toBe(3);
    expect(turnEndWalkFrame(13, 1)).toBeNull();
  });

  it("turnShadow: walking turns offset the still shadow, on-the-spot turns use SHROT with y offset only", () => {
    expect(turnShadow(3, 1, -1, 100, 200, 0.5)).toEqual({ kind: "walk", x: 90, y: 202, frame: 3, file: null, facing: -1 });
    expect(turnShadow(8, 0, 1, 100, 200, 1)?.frame).toBe(6);
    expect(turnShadow(15, 1, 1, 100.7, 200, 0.5)).toEqual({ kind: "rot", x: 100, y: 205, frame: 1, file: "SHROT07.PBM", facing: 1 });
    expect(turnShadow(11, 0, 1, 0, 0, 1)).toBeNull();
  });
});

describe("TurnPlayer", () => {
  it("plays every frame of every step, step sound at frame 2 of the first animation only, then done", () => {
    const p = new TurnPlayer(turnSequence(1, 1, 1, -1)); // 4 animations, 16 frames
    const drawn: string[] = [];
    let sounds = 0;
    const ends: number[] = [];
    for (let i = 0; i < 16; i++) {
      const r = p.step(false, 0.5);
      drawn.push(r.frame!.file);
      if (r.stepSound) sounds++;
      if (r.ended) ends.push(r.ended.anim);
      expect(r.done).toBe(i === 15);
    }
    expect(drawn).toEqual([8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `ROTP${String(n).padStart(2, "0")}.PBM`));
    expect(sounds).toBe(1);
    expect(ends).toEqual([15, 16, 17, 18]);
    expect(p.step(false, 0.5)).toEqual({ frame: null, stepSound: false, ended: null, done: true });
  });

  it("while walking, animations 15 and 16 end early (2 and 3 frames)", () => {
    const count = (walking: boolean) => {
      const p = new TurnPlayer(turnSequence(2, 1, 0, 1)); // 13, 14, 15, 16
      let n = 0;
      while (!p.step(walking, 1).done) n++;
      return n + 1;
    };
    expect(count(false)).toBe(16);
    expect(count(true)).toBe(4 + 4 + 2 + 3);
    expect(TURN_FRAMES_WALKING[15]).toBe(2);
  });

  it("frame size: g_jackScale · table, at most 1; uniform uses ROTW and its own table", () => {
    const p = new TurnPlayer([{ anim: 2, frame: 3, facing: 1 }]);
    expect(p.step(true, 0.95).frame!.scale).toBe(1); // 0.95 · 1.08 > 1
    const q = new TurnPlayer([{ anim: 15, frame: 0, facing: 1 }], true);
    const f = q.step(false, 0.5).frame!;
    expect(f.file).toBe("ROTW08.PBM");
    expect(f.scale).toBeCloseTo(0.5 * 0.96, 6);
    expect(TURN_SCALE[15][0]).not.toBe(TURN_SCALE_UNIFORM[15][0]);
  });

  it("a walking turn reports its shift and walk frame when it ends", () => {
    const p = new TurnPlayer([{ anim: 9, frame: 0, facing: 1 }]);
    let r = p.step(true, 1);
    for (let i = 1; i < 8; i++) r = p.step(true, 1);
    expect(r.ended).toEqual({ anim: 9, facing: 1, shift: { dx: -50, dy: -10 }, walkFrame: 0 });
    expect(r.done).toBe(true);
  });

  it("an empty sequence is an error", () => {
    expect(() => new TurnPlayer([])).toThrow(RangeError);
  });
});
