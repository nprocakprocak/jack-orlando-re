import { describe, expect, it } from "vitest";
import type { JackDir } from "../anim/jack";
import {
  GESTURE_CODES as C,
  Gestures,
  allGestureInsertions,
  giveInsertion,
  pickupInsertion,
  shootInsertion,
  slapInsertion,
  type GestureStep,
  type JackInfo,
} from "./gestures";

const jack = (dir: JackDir, facing: 1 | -1 = 1, uniform = false): JackInfo => ({ dir, facing, uniform });

/** A mock of the host: plays each started insertion for `len` ticks, then calls the end hook. */
class MockHost {
  playing: string | null = null;
  left = 0;
  readonly started: string[] = [];
  readonly vars: Record<string, number> = { SLAP: 0, SHOOT: 0 };
  constructor(readonly g: Gestures, readonly j: JackInfo, readonly len = 3) {}
  apply(s: { start?: { name: string }; vars?: Readonly<Record<string, number>> }): void {
    if (s.vars) Object.assign(this.vars, s.vars);
    if (s.start) {
      this.playing = s.start.name;
      this.left = this.len;
      this.started.push(s.start.name);
    }
  }
  run(code: number, arg: number): GestureStep {
    const s = this.g.command(code, arg, this.j)!;
    this.apply(s);
    return s;
  }
  /** steps 25-31 of the frame: the insertion advances */
  tick(): void {
    if (this.playing && --this.left <= 0) {
      this.playing = null;
      this.apply(this.g.globalInsertionEnd(this.j));
    }
  }
  /** runs a command until it answers "done"; returns the number of ticks it waited */
  until(code: number, arg: number, max = 100): number {
    for (let t = 0; t < max; t++) {
      if (this.run(code, arg).result === "done") return t;
      this.tick();
    }
    throw new Error("hangs");
  }
}

describe("insertion choice", () => {
  it("PICKUP: civil / uniform per dir, n 0 bends, other n stands up", () => {
    expect([0, 1, 2, 3, 4].map((d) => pickupInsertion(0, jack(d as JackDir)).name)).toEqual(["PP_D0", "PP_L0", "PP_U0", "SC34P0", "PP_RU0"]);
    expect([0, 1, 2, 3, 4].map((d) => pickupInsertion(5, jack(d as JackDir, -1, true)).name)).toEqual(["PM_D1", "PM_L1", "PM_U1", "PM_LD1", "PM_RU1"]);
    expect(pickupInsertion(1, jack(1, -1))).toEqual({ name: "PP_L1", facing: -1, scaleMul: 1 });
  });
  it("GIVE: phases 0..2, anything else OPUSZCZA", () => {
    expect([0, 1, 2, 3, -1].map((n) => giveInsertion(n, jack(3)).name)).toEqual([
      "DAJE_DO_WYC_DP_LD", "CHOWA_WYC_DP_LD", "STAY_DO_WYC_DP_LD", "OPUSZCZA_WYC_DP_LD", "OPUSZCZA_WYC_DP_LD",
    ]);
    expect(giveInsertion(0, jack(4, -1, true))).toEqual({ name: "DAJE_DO_WYC_DM_RU", facing: -1, scaleMul: 1 });
  });
  it("SHOOTF: side in the name, direction always 1; dir 4 swaps L/P", () => {
    expect(shootInsertion(0, jack(1, 1))).toEqual({ name: "SPPRL0", facing: 1, scaleMul: 1 });
    expect(shootInsertion(1, jack(1, -1, true))).toEqual({ name: "SWPRP1", facing: 1, scaleMul: 1 });
    expect(shootInsertion(0, jack(3, -1))!.name).toBe("SPSPP0");
    expect(shootInsertion(0, jack(4, 1))!.name).toBe("SPSTP0");
    expect(shootInsertion(1, jack(4, -1, true))!.name).toBe("SWSTL1");
    expect(shootInsertion(0, jack(0))).toBeNull();
    expect(shootInsertion(0, jack(2))).toBeNull();
    expect(shootInsertion(2, jack(1))).toBeNull();
  });
  it("SLAPF: BO/BW + PRO/34P/34T + phase; facing kept", () => {
    expect(slapInsertion(0, jack(1, -1))).toEqual({ name: "BOPRO0", facing: -1, scaleMul: 1 });
    expect(slapInsertion(1, jack(3, 1, true))!.name).toBe("BW34P1");
    expect(slapInsertion(2, jack(4))!.name).toBe("BO34T2");
    expect(slapInsertion(3, jack(1))).toBeNull();
    expect(slapInsertion(0, jack(0))).toBeNull();
  });
  it("102 distinct GLOBAL.ICS sections", () => {
    const all = allGestureInsertions();
    expect(all.length).toBe(102);
    expect(all).toContain("SC34P1");
    expect(all).not.toContain("PP_LD0");
  });
});

describe("state", () => {
  it("PICKUP: start, wait for the end, then go on (bottle: PICKUP, TAKE, PICKUP 1)", () => {
    const h = new MockHost(new Gestures(), jack(0), 6);
    const s = h.run(C.PICKUP, 0);
    expect(s).toEqual({ result: "repeat", start: { name: "PP_D0", facing: 1, scaleMul: 1 } });
    expect(h.g.state).toBe(1);
    // waiting: no new start
    expect(h.run(C.PICKUP, 0)).toEqual({ result: "repeat" });
    for (let i = 0; i < 6; i++) h.tick();
    expect(h.g.state).toBe(2);
    expect(h.run(C.PICKUP, 0)).toEqual({ result: "done" });
    expect(h.g.state).toBe(0);
    expect(h.until(C.PICKUP, 1)).toBe(6);
    expect(h.started).toEqual(["PP_D0", "PP_D1"]);
  });

  it("the end seen on the next repeat: the macro goes on one tick after the last frame", () => {
    const h = new MockHost(new Gestures(), jack(1), 1);
    expect(h.until(C.GIVE, 2)).toBe(1);
    expect(h.started).toEqual(["STAY_DO_WYC_DP_L"]);
  });

  it("SHOOTF: aim, a line, lower (STRZELANIE-BABA)", () => {
    const h = new MockHost(new Gestures(), jack(1, -1), 4);
    expect(h.until(C.SHOOTF, 0)).toBe(4);
    expect(h.until(C.SHOOTF, 1)).toBe(4);
    expect(h.started).toEqual(["SPPRP0", "SPPRP1"]);
    expect(h.vars).toEqual({ SLAP: 0, SHOOT: 0 });
  });

  it("SHOOTF / SLAPF with dir 0 or 2: nothing, state untouched", () => {
    const g = new Gestures();
    expect(g.command(C.SHOOTF, 0, jack(0))).toEqual({ result: "done" });
    expect(g.command(C.SLAPF, 1, jack(2))).toEqual({ result: "done" });
    expect(g.state).toBe(0);
  });

  it("SLAPF: raise, guard loop during the line, lower (UDERZENIE-BABA)", () => {
    const h = new MockHost(new Gestures(), jack(3), 2);
    expect(h.until(C.SLAPF, 0)).toBe(2);
    // SLAPF 1: guard started, the macro goes on at once (pc + 1 - 1), state 3
    const s = h.run(C.SLAPF, 1);
    expect(s.result).toBe("done");
    expect(s.vars).toEqual({ SLAP: 1 });
    expect(h.g.state).toBe(3);
    expect(h.vars.SLAP).toBe(1);
    // TALKRANDOM runs: the guard ends and restarts, SLAP cleared at each end
    for (let i = 0; i < 5; i++) h.tick();
    expect(h.started).toEqual(["BO34P0", "BO34P1", "BO34P1", "BO34P1"]);
    expect(h.vars.SLAP).toBe(0);
    expect(h.g.state).toBe(3);
    // SLAPF 2 replaces the loop and waits
    expect(h.until(C.SLAPF, 2)).toBe(2);
    expect(h.started.at(-1)).toBe("BO34P2");
    expect(h.g.state).toBe(0);
    expect(h.playing).toBeNull();
  });

  it("state 3 and a dir without fist: the loop stops, state stays 3", () => {
    const g = new Gestures();
    g.command(C.SLAPF, 1, jack(1));
    expect(g.globalInsertionEnd(jack(0))).toEqual({ vars: { SLAP: 0, SHOOT: 0 } });
    expect(g.state).toBe(3);
    expect(g.globalInsertionEnd(jack(4, 1, true)).start!.name).toBe("BW34T1");
  });

  it("state 3: PICKUP / GIVE / SHOOTF do nothing and go on", () => {
    const g = new Gestures();
    g.command(C.SLAPF, 1, jack(1));
    expect(g.command(C.PICKUP, 0, jack(1))).toEqual({ result: "done" });
    expect(g.command(C.GIVE, 0, jack(1))).toEqual({ result: "done" });
    expect(g.command(C.SHOOTF, 0, jack(1))).toEqual({ result: "done" });
    expect(g.state).toBe(3);
  });

  it("engine fix: a gesture after a finished idle insertion plays in full", () => {
    const h = new MockHost(new Gestures(), jack(1), 3);
    h.g.globalInsertionEnd(h.j); // KLPRO idle insertion ended
    expect(h.g.state).toBe(0);
    expect(h.until(C.PICKUP, 0)).toBe(3);
    expect(h.until(C.PICKUP, 1)).toBe(3);
    expect(h.started).toEqual(["PP_L0", "PP_L1"]);
  });

  it("original (originalIdleBug): any global insertion end (idle) leaves state 2 - the next gesture is skipped", () => {
    const g = new Gestures({ originalIdleBug: true });
    g.globalInsertionEnd(jack(1)); // e.g. KLPRO idle insertion
    expect(g.state).toBe(2);
    expect(g.command(C.PICKUP, 0, jack(1))).toEqual({ result: "done" });
    expect(g.state).toBe(0);
  });

  it("an argument without insertion hangs the macro (SHOOTF 2, SLAPF 3)", () => {
    const g = new Gestures();
    expect(g.command(C.SHOOTF, 2, jack(1))).toEqual({ result: "repeat" });
    expect(g.command(C.SHOOTF, 2, jack(1))).toEqual({ result: "repeat" });
    g.reset();
    expect(g.command(C.SLAPF, 3, jack(1))).toEqual({ result: "repeat", vars: { SLAP: 1 } });
    expect(g.state).toBe(1);
    expect(new MockHost(g, jack(1)).run(C.SLAPF, 3).result).toBe("repeat");
  });

  it("other codes: undefined; reset clears the state", () => {
    const g = new Gestures();
    expect(g.command(0x91, 0, jack(0))).toBeUndefined();
    g.command(C.GIVE, 0, jack(0));
    g.reset();
    expect(g.state).toBe(0);
  });
});
