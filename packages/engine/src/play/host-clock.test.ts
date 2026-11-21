// The AUTOINCRANGE clock.
import { describe, expect, it } from "vitest";
import { Variables } from "../script";
import { AUTOINC_PERIOD, AutoIncClock, varIndex } from "./host";
import { setup, step } from "./testing";

describe("AUTOINCRANGE clock (Script_ExecStep case 0x5b, Game_TimerTick, Game_Run)", () => {
  /** Runs macro M (frame + tick), then `n - 1` more logic ticks without frames: n clock ticks in all. */
  const clockSetup = (text: string) => {
    const clock = new AutoIncClock();
    const s = setup(text, 3, undefined, clock);
    return { s, clock, ticks: (n: number) => { for (let i = 0; i < n; i++) s.host.tick(); } };
  };

  it("sets the variable to min, takes the range, and raises the variable every 64 logic ticks", () => {
    const { s, clock, ticks } = clockSetup("[M] Let A 9\nAutoIncRange A 2 5");
    s.it.start("M");
    step(s); // LET
    step(s); // AUTOINCRANGE (+ the first clock tick)
    expect(s.it.vars.get("A")).toBe(2);
    expect(clock.state()).toEqual({ min: 2, max: 5, variable: varIndex(s.it.vars, "A") });
    expect(clock.ticks).toBe(1);
    ticks(AUTOINC_PERIOD - 2);
    expect(s.it.vars.get("A")).toBe(2); // 63 ticks: not yet
    ticks(1);
    expect(s.it.vars.get("A")).toBe(3);
    expect(clock.ticks).toBe(0);
  });

  it("wraps from max + 1 to min: the variable runs min..max", () => {
    const { s, ticks } = clockSetup("[M] AutoIncRange A 2 4");
    s.it.start("M");
    s.it.tick(); // AUTOINCRANGE without a clock tick
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      ticks(AUTOINC_PERIOD);
      seen.push(s.it.vars.get("A"));
    }
    expect(seen).toEqual([3, 4, 2, 3, 4]);
  });

  it("a variable set above max by a script wraps to min at the next step (SC082: LET OCHR 21 with max 60 stays)", () => {
    const clock = new AutoIncClock();
    const vars = new Variables(new Map([["X", 0], ["OCHR", 70]]));
    clock.start(1, 0, 60);
    for (let i = 0; i < AUTOINC_PERIOD; i++) clock.tick(vars);
    expect(vars.get("OCHR")).toBe(0);
  });

  it("a second AUTOINCRANGE replaces the range; the old variable stops, the tick counter runs on", () => {
    const { s, clock, ticks } = clockSetup("[M] AutoIncRange A 0 60\n[N] AutoIncRange B 0 200");
    s.it.start("M");
    s.it.tick();
    ticks(AUTOINC_PERIOD + 10);
    expect(s.it.vars.get("A")).toBe(1);
    s.it.start("N");
    s.it.tick();
    expect(clock.variable).toBe(varIndex(s.it.vars, "B"));
    expect(clock.ticks).toBe(10); // AUTOINCRANGE does not zero g_autoIncTicks
    ticks(AUTOINC_PERIOD - 10);
    expect([s.it.vars.get("A"), s.it.vars.get("B")]).toEqual([1, 1]);
  });

  it("off (variable -1): nothing counts, not even the tick counter", () => {
    const clock = new AutoIncClock();
    const vars = new Variables(new Map([["A", 5]]));
    for (let i = 0; i < 200; i++) clock.tick(vars);
    expect([vars.get("A"), clock.ticks]).toEqual([5, 0]);
  });

  it("the variable is a short: 32767 + 1 = -32768, which is not above max, so no wrap", () => {
    const clock = new AutoIncClock();
    const vars = new Variables(new Map([["A", 32767]]));
    clock.start(0, 0, 32767);
    for (let i = 0; i < AUTOINC_PERIOD; i++) clock.tick(vars);
    expect(vars.get("A")).toBe(-32768);
  });

  it("without a clock in the environment the command only sets the variable", () => {
    const s = setup("[M] Let A 9\nAutoIncRange A 3 5");
    s.it.start("M");
    for (let i = 0; i < 3 + AUTOINC_PERIOD; i++) step(s);
    expect(s.it.vars.get("A")).toBe(3);
    expect(s.log.filter((e) => e.kind === "unhandled")).toEqual([]);
  });

  it("a chapter-3 scene start runs the OCHR clock 0..60 and keeps OCHR's value; other chapters leave the clock", () => {
    const vars = new Variables(new Map([["LOC7", 0], ["A", 0], ["OCHR", 17]]));
    const clock = new AutoIncClock();
    clock.start(0, 0, 200); // SC000D [PRE]: AUTOINCRANGE LOC7 0 200
    clock.sceneStart(2, vars);
    expect(clock.state()).toEqual({ min: 0, max: 200, variable: 0 });
    clock.sceneStart(3, vars);
    expect(clock.state()).toEqual({ min: 0, max: 60, variable: 2 });
    expect(vars.get("OCHR")).toBe(17);
    clock.sceneStart(3, new Variables(new Map([["A", 0]]))); // no OCHR: the search's start value, index 0
    expect(clock.variable).toBe(0);
  });

  it("a [PRE] AUTOINCRANGE after the chapter-3 start wins (Game_Run l. 382 runs before [PRE])", () => {
    const { s, clock } = clockSetup("[PRE] AutoIncRange A 1 2");
    clock.sceneStart(3, s.it.vars); // no OCHR in VARS -> index 0
    s.it.runSynchronous("PRE");
    expect(clock.state()).toEqual({ min: 1, max: 2, variable: varIndex(s.it.vars, "A") });
  });

  it("save tail: state() -> restore() keeps the range; the tick counter is not part of it and runs on", () => {
    const a = new AutoIncClock();
    a.start(158, 0, 60);
    a.ticks = 40;
    const b = new AutoIncClock();
    b.ticks = 7;
    b.restore(JSON.parse(JSON.stringify(a.state())));
    expect(b.state()).toEqual({ min: 0, max: 60, variable: 158 });
    expect(b.ticks).toBe(7);
  });
});
