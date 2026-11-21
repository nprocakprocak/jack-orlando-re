import { describe, expect, it } from "vitest";
import { turnFrameTicks, TURN_FRAMES_STANDING, TURN_FRAMES_WALKING } from "../anim/turn";
import type { Point } from "./geometry";
import type { WalkWorld } from "./smooth";
import {
  followPlanTurning,
  restorePointRotate,
  setPointRotate,
  startSegmentTurning,
  turningJack,
  turningTick,
  turnTo,
  type TurningJack,
} from "./turn";
import { createWalker, stepTicks, type WalkPlan } from "./index";

/** 0..1000 square, scale 1 everywhere (y ≥ 1). */
const BIG = [
  [0, 0, 0, 1000, 1000, 1000],
  [0, 0, 1000, 0, 1000, 1000],
];
const WORLD: WalkWorld = {
  walk: BIG,
  objects: [],
  perspective: { horizonY: 0, refY: 1, refScale: 1 },
};
const direct = (to: Point): WalkPlan => ({
  path: [{ x: 0, y: 0 }, to],
  direct: false,
  fromOutside: false,
});
const STEP = stepTicks(1);
const FRAME = turnFrameTicks(1);

function jack(x: number, y: number, dir = 0, mirror: 1 | -1 = 1, opts = {}): TurningJack {
  return turningJack(createWalker(x, y, WORLD, { dir, mirror }), opts);
}

describe("turn in the walk (Jack_WalkToPoint, Game_Run)", () => {
  it("click from standing: on-the-spot turn first, Jack does not move until it ends, then walks", () => {
    const tj = jack(500, 500); // facing the player
    followPlanTurning(tj, direct({ x: 800, y: 500 }));
    expect(tj.walker.walking).toBe(true);
    expect(tj.moving).toBe(true);
    expect([tj.walker.dir, tj.walker.mirror]).toEqual([1, -1]); // new facing set at once
    expect(tj.turn!.steps.map((s) => [s.anim, s.facing])).toEqual([
      [17, -1],
      [18, -1],
    ]);
    // walking table: 4 + 4 frames, the first drawn on the next tick (timer 0 → −1)
    const frames: string[] = [];
    let ticks = 0;
    while (tj.turn) {
      const r = turningTick(tj, WORLD, STEP, FRAME);
      ticks++;
      expect(r.walk).toEqual([]);
      if (r.turn?.frame) frames.push(r.turn.frame.file);
      expect([tj.walker.x, tj.walker.y]).toEqual([500, 500]);
    }
    expect(frames).toEqual([
      "ROTP02.PBM",
      "ROTP03.PBM",
      "ROTP04.PBM",
      "ROTP05.PBM",
      "ROTP06.PBM",
      "ROTP07.PBM",
      "ROTP08.PBM",
      "ROTP09.PBM",
    ]);
    expect(ticks).toBe(1 + 7 * FRAME);
    // the next walk step comes a full frame delay after the last turn frame
    let moved = 0;
    for (let i = 0; i < FRAME && moved === 0; i++) {
      turningTick(tj, WORLD, STEP, FRAME);
      if (tj.walker.x !== 500) moved = i + 1;
    }
    expect(moved).toBe(FRAME);
    while (tj.walker.walking) turningTick(tj, WORLD, STEP, FRAME);
    expect([tj.walker.x, tj.walker.y]).toEqual([800, 500]);
    expect(tj.moving).toBe(false); // Jack_Stand on arrival
  });

  it("corner of a path (> 2 points): POINTROTATE is forced, so the turn is on the spot (ROTP), no shift", () => {
    const tj = jack(200, 500, 1, -1);
    const plan: WalkPlan = {
      path: [
        { x: 200, y: 500 },
        { x: 600, y: 500 },
        { x: 600, y: 900 },
      ],
      direct: false,
      fromOutside: false,
    };
    followPlanTurning(tj, plan);
    expect(tj.turn).toBeNull(); // already facing right
    expect([tj.pointRotate, tj.pointRotateSaved]).toEqual([true, false]);
    let started = false;
    for (let i = 0; i < 2000 && !started; i++) started = turningTick(tj, WORLD, STEP, FRAME).turnStarted;
    expect(started).toBe(true);
    expect(tj.walker.index).toBe(2);
    // right (1, −1) -> down (0): ROTP 08, 07 (anim 15 cut to 2 while walking), then 04, 03, 02 (16 cut to 3)
    expect(tj.turn!.steps.map((s) => [s.anim, s.facing])).toEqual([
      [15, -1],
      [16, -1],
    ]);
    const before = { x: tj.walker.x, y: tj.walker.y };
    const frames: string[] = [];
    while (tj.turn) {
      const r = turningTick(tj, WORLD, STEP, FRAME);
      if (r.turn?.frame) frames.push(r.turn.frame.file);
      expect(r.turn?.ended?.shift ?? null).toBeNull();
      expect([tj.walker.x, tj.walker.y]).toEqual([before.x, before.y]);
    }
    expect(frames).toEqual(["ROTP08.PBM", "ROTP07.PBM", "ROTP04.PBM", "ROTP03.PBM", "ROTP02.PBM"]);
    expect(tj.walkFrame).toBeNull();
    expect(tj.walker.walking).toBe(true);
    while (tj.walker.walking) turningTick(tj, WORLD, STEP, FRAME);
    expect([tj.walker.x, tj.walker.y]).toEqual([600, 900]);
    expect(tj.pointRotate).toBe(false); // restored on arrival
  });

  it("a 2-point walk started while moving: walking-turn frames (OBPL), shift at the end, segment restarts", () => {
    const tj = jack(200, 500, 1, -1);
    followPlanTurning(tj, direct({ x: 800, y: 500 }));
    for (let i = 0; i < 30; i++) turningTick(tj, WORLD, STEP, FRAME);
    expect(tj.walker.walking).toBe(true);
    followPlanTurning(tj, direct({ x: tj.walker.x, y: 950 })); // new click, straight down
    expect(tj.pointRotate).toBe(false);
    expect(tj.turn!.steps.map((s) => [s.anim, s.facing])).toEqual([
      [0, -1],
      [1, -1],
    ]);
    const before = { x: tj.walker.x, y: tj.walker.y };
    let last;
    while (tj.turn) last = turningTick(tj, WORLD, STEP, FRAME);
    // anim 0: x + 40, y + 2; anim 1: x + 38, y + 14 (facing −1, scale 1)
    expect(tj.walker.x).toBeCloseTo(before.x + 40 + 38, 3);
    expect(tj.walker.y).toBeCloseTo(before.y + 2 + 14, 3);
    expect(last!.turn!.ended!.walkFrame).toBe(3);
    expect(tj.walkFrame).toBe(3);
    while (tj.walker.walking || tj.turn) turningTick(tj, WORLD, STEP, FRAME);
    expect(tj.walker.y).toBe(950);
  });

  it("setPointRotate / restorePointRotate: POINTROTATE survives a forced walk", () => {
    const tj = jack(200, 500, 1, -1);
    setPointRotate(tj, true);
    followPlanTurning(tj, {
      path: [
        { x: 200, y: 500 },
        { x: 600, y: 500 },
        { x: 600, y: 900 },
      ],
      direct: false,
      fromOutside: false,
    });
    expect([tj.pointRotate, tj.pointRotateSaved]).toEqual([true, true]);
    while (tj.walker.walking || tj.turn) turningTick(tj, WORLD, STEP, FRAME);
    expect(tj.pointRotate).toBe(true);
    setPointRotate(tj, false);
    tj.pointRotate = true; // as forced by a walk interrupted before arrival
    restorePointRotate(tj); // the next click (Script_InterruptOutMacros)
    expect(tj.pointRotate).toBe(false);
  });

  it("POINTROTATE and the uniform turn on the spot even while walking; uniform uses ROTW", () => {
    for (const opts of [{ pointRotate: true }, { uniform: true }]) {
      const tj = jack(200, 500, 1, -1, opts);
      tj.moving = true;
      startSegmentTurning(tj, { x: 200, y: 900 });
      expect(tj.turn!.steps.every((s) => s.anim >= 13)).toBe(true);
      expect(tj.turn!.uniform).toBe(!!(opts as { uniform?: boolean }).uniform);
    }
    const tj = jack(200, 500, 1, -1);
    tj.moving = true;
    startSegmentTurning(tj, { x: 200, y: 900 });
    expect(tj.turn!.steps.every((s) => s.anim <= 10)).toBe(true);
  });

  it("no turn when the direction stays, or when the target is already reached", () => {
    const tj = jack(200, 500, 1, -1);
    startSegmentTurning(tj, { x: 800, y: 500 });
    expect(tj.turn).toBeNull();
    const near = jack(200, 500, 0, 1);
    expect(startSegmentTurning(near, { x: 205, y: 501 })).toBe(true);
    expect(near.turn).toBeNull();
    expect(near.moving).toBe(false);
  });

  it("an empty rule set leaves a running turn alone; a new one restarts it", () => {
    const tj = jack(500, 500);
    startSegmentTurning(tj, { x: 800, y: 500 });
    const first = tj.turn;
    startSegmentTurning(tj, { x: 900, y: 500 }); // same direction: no Turn_Start
    expect(tj.turn).toBe(first);
    startSegmentTurning(tj, { x: 500, y: 100 }); // now away from the player
    expect(tj.turn).not.toBe(first);
  });

  it("standOnArrival false keeps (a macro holds the player)", () => {
    const tj = jack(200, 500, 1, -1);
    startSegmentTurning(tj, { x: 300, y: 500 });
    while (tj.walker.walking) turningTick(tj, WORLD, STEP, FRAME, false);
    expect(tj.moving).toBe(true);
  });
});

describe("turnTo (Jack_TurnFromTo: LOOKTO / ROTATETO / STAY)", () => {
  it("standing: on-the-spot turn with the full frame counts; ROTATETO waits", () => {
    const tj = jack(500, 500, 1, 1);
    tj.moving = true;
    const r = turnTo(tj, { dir: 1, mirror: -1 });
    expect(r).toEqual({ stand: false, waits: true, steps: tj.turn!.steps });
    expect(tj.moving).toBe(false);
    expect([tj.walker.dir, tj.walker.mirror]).toEqual([1, -1]);
    let n = 0;
    while (tj.turn) if (turningTick(tj, WORLD, STEP, FRAME).turn?.frame) n++;
    expect(n).toBe(4 * TURN_FRAMES_STANDING[15]);
    expect([tj.walker.x, tj.walker.y]).toEqual([500, 500]); // no shift on the spot
  });

  it("walking: a change stops the walk; the same facing → Jack_Stand", () => {
    const tj = jack(200, 500, 1, -1);
    startSegmentTurning(tj, { x: 800, y: 500 });
    expect(turnTo(tj, { dir: 1, mirror: -1 })).toEqual({ stand: true, waits: false, steps: [] });
    expect(tj.walker.walking).toBe(true);
    const r = turnTo(tj, { dir: 0, mirror: 1 });
    expect(tj.walker.walking).toBe(false);
    expect(r.steps.map((s) => s.anim)).toEqual([15, 16]);
    // not walking: the standing frame counts (16 is not cut to 3)
    let n = 0;
    while (tj.turn) if (turningTick(tj, WORLD, STEP, FRAME).turn?.frame) n++;
    expect(n).toBe(TURN_FRAMES_STANDING[15] + TURN_FRAMES_STANDING[16]);
    expect(TURN_FRAMES_WALKING[15] + TURN_FRAMES_WALKING[16]).toBeLessThan(n);
  });

  it("standing, same facing: nothing happens and LOOKTO does not wait", () => {
    const tj = jack(500, 500, 3, -1);
    expect(turnTo(tj, { dir: 3, mirror: -1 })).toEqual({ stand: false, waits: false, steps: [] });
    expect(tj.turn).toBeNull();
  });
});
