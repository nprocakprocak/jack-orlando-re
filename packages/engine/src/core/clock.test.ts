import { describe, expect, it } from "vitest";
import { GameTimer, TickCounter, type LogicTick } from "./clock";

describe("TickCounter", () => {
  it("converts real time into 5 ms ticks and carries the rest", () => {
    const c = new TickCounter();
    expect(c.advance(4)).toBe(0);
    expect(c.advance(1)).toBe(1);
    expect(c.advance(16.7)).toBe(3);
    expect(c.carryMs).toBeCloseTo(1.7);
    expect(c.advance(3.3)).toBe(1);
    expect(c.ticks).toBe(5);
    expect(c.carryMs).toBeCloseTo(0);
  });

  it("is exact over many small fractional steps", () => {
    const c = new TickCounter();
    for (let i = 0; i < 6000; i++) c.advance(1000 / 60);
    expect(c.ticks).toBe(20000); // 100 s
  });

  it("ignores time while paused (Timer_TickCallback skips when g_timersPaused)", () => {
    const c = new TickCounter();
    c.advance(12);
    c.paused = true;
    expect(c.advance(1000)).toBe(0);
    c.paused = false;
    expect(c.advance(3)).toBe(1);
    expect(c.ticks).toBe(3);
  });

  it("ignores zero, negative and NaN durations", () => {
    const c = new TickCounter();
    expect(c.advance(0)).toBe(0);
    expect(c.advance(-50)).toBe(0);
    expect(c.advance(NaN)).toBe(0);
    expect(c.ticks).toBe(0);
    expect(c.carryMs).toBe(0);
  });
});

describe("GameTimer (Game_TimerTick)", () => {
  function run(n: number, timer = new GameTimer()) {
    const ticks: LogicTick[] = [];
    for (let t = 1; t <= n; t++) timer.tick(t, (x) => ticks.push(x));
    return ticks;
  }

  it("runs the logic body on every 3rd 5 ms tick", () => {
    const ticks = run(9, new GameTimer(false));
    expect(ticks.map((t) => t.ticks5ms)).toEqual([3, 6, 9]);
    expect(ticks.map((t) => t.index)).toEqual([0, 1, 2]);
  });

  it("runs the body twice on the 11th logic tick, then on every 10th", () => {
    const ticks = run(33);
    expect(ticks).toHaveLength(12);
    expect(ticks.filter((t) => t.extra)).toEqual([{ index: 11, ticks5ms: 33, extra: true }]);
    expect(ticks[10]).toEqual({ index: 10, ticks5ms: 33, extra: false });
    // the extra body counts too (counter -> 1), so the next double is 10 slots later
    const doubles = run(3 * 41).filter((t) => t.extra).map((t) => t.ticks5ms / 3);
    expect(doubles).toEqual([11, 21, 31, 41]);
  });

  it("gives 11 bodies per 150 ms (~73.3 Hz) in steady state", () => {
    // 1 s = 200 ticks = 66 logic ticks; doubles at 11, 21..., 61
    expect(run(200)).toHaveLength(72);
    const timer = new GameTimer();
    run(33, timer); // past the first double
    const start = timer.count;
    run(300, timer); // 100 logic ticks = 1.5 s
    expect(timer.count - start).toBe(110);
  });

  it("plain 15 ms ticks when the double tick is disabled", () => {
    expect(run(200, new GameTimer(false))).toHaveLength(66);
  });
});
