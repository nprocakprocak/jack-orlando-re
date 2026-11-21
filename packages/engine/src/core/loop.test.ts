import { describe, expect, it } from "vitest";
import type { LogicTick } from "./clock";
import { DIK } from "./keyboard";
import { EngineLoop, type FrameInfo, type GameHooks } from "./loop";
import { MOUSE_LEFT } from "./mouse";

/** Records hook calls and drives the loop with a fake clock. */
function harness(opts: ConstructorParameters<typeof EngineLoop>[1] = {}) {
  const updates: LogicTick[] = [];
  const frames: FrameInfo[] = [];
  const alphas: number[] = [];
  const active: boolean[] = [];
  const order: string[] = [];
  const hooks: GameHooks = {
    update: (t) => {
      updates.push(t);
      order.push("u");
    },
    frame: (f) => {
      frames.push(f);
      order.push("f");
    },
    render: (a) => {
      alphas.push(a);
      order.push("r");
    },
    activeChanged: (a) => active.push(a),
  };
  const loop = new EngineLoop(hooks, opts);
  let now = 1000;
  const run = (ms: number, fps: number) => {
    const end = now + ms;
    while (now + 1000 / fps <= end + 1e-9) {
      now += 1000 / fps;
      loop.step(now);
    }
  };
  const at = (dt: number) => {
    now += dt;
    return loop.step(now);
  };
  loop.step(now);
  return { loop, updates, frames, alphas, active, order, run, at };
}

describe("EngineLoop timing", () => {
  it("first step only starts the clock and renders a frame", () => {
    const h = harness();
    expect(h.loop.ticks).toBe(0);
    expect(h.frames).toHaveLength(1);
    expect(h.updates).toHaveLength(0);
  });

  it("logic rate is independent of the display rate", () => {
    for (const fps of [30, 60, 75, 144, 240]) {
      const h = harness();
      h.run(3000, fps);
      // 600 ticks = 200 logic slots, doubles at 11, 21..., 191 -> 219 bodies
      expect(h.loop.ticks).toBe(600);
      expect(h.updates).toHaveLength(219);
    }
  });

  it("ticks are numbered in order and passed with g_ticks5ms", () => {
    const h = harness({ doubleEvery11th: false });
    h.at(45);
    expect(h.updates.map((u) => u.ticks5ms)).toEqual([3, 6, 9]);
    expect(h.updates.map((u) => u.index)).toEqual([0, 1, 2]);
  });

  it("catches up several logic ticks in one step, updates before the frame", () => {
    const h = harness({ doubleEvery11th: false });
    h.order.length = 0;
    h.at(95); // 19 ticks -> 6 logic ticks
    expect(h.updates).toHaveLength(6);
    expect(h.order).toEqual(["u", "u", "u", "u", "u", "u", "f", "r"]);
  });

  it("long gap (tab throttled without visibility event) is capped at maxStepMs", () => {
    const h = harness({ maxStepMs: 100, doubleEvery11th: false });
    h.at(10_000);
    expect(h.loop.ticks).toBe(20);
    expect(h.updates).toHaveLength(6);
    expect(h.loop.stats.droppedMs).toBe(9900);
    // after the gap the loop continues normally
    h.at(15);
    expect(h.loop.ticks).toBe(23);
  });

  it("time going backwards or standing still adds nothing", () => {
    const h = harness();
    h.at(20);
    const t = h.loop.ticks;
    h.at(-50);
    h.at(0);
    expect(h.loop.ticks).toBe(t);
  });

  it("minimum frame time: a new frame only after more than 1 tick (g_frameMinMs = 5)", () => {
    const h = harness();
    expect(h.at(4)).toBe(false); // 0 ticks
    expect(h.at(4)).toBe(false); // 1 tick (8 ms)
    expect(h.at(4)).toBe(true); // 2 ticks (12 ms)
    expect(h.loop.stats.skippedFrames).toBe(2);
    const h2 = harness();
    h2.run(1000, 240);
    // 200 ticks, at most one frame per 2 ticks (5-10 ms in the original)
    expect(h2.frames.length).toBeLessThanOrEqual(101);
    expect(h2.frames.length).toBeGreaterThan(60);
    const h3 = harness();
    h3.run(1000, 60);
    expect(h3.frames).toHaveLength(61); // every rAF at 60 Hz (3+ ticks apart)
  });

  it("frameMinMs < 5 disables the wait (ms / 5 == 0)", () => {
    const h = harness({ frameMinMs: 4 });
    expect(h.at(1)).toBe(true);
    expect(h.at(1)).toBe(true);
  });

  it("frameMinMs 20 needs more than 4 ticks", () => {
    const h = harness({ frameMinMs: 20 });
    expect(h.at(20)).toBe(false);
    expect(h.at(5)).toBe(true);
  });

  it("frame info and counter", () => {
    const h = harness();
    h.at(20);
    h.at(20);
    expect(h.frames.map((f) => f.frame)).toEqual([0, 1, 2]);
    expect(h.frames.map((f) => f.ticks5ms)).toEqual([0, 4, 8]);
    expect(h.frames[2].logicTicks).toBe(2);
    expect(h.loop.frameCount).toBe(3);
  });

  it("alpha is the progress towards the next logic tick, in [0, 1)", () => {
    const h = harness({ doubleEvery11th: false });
    h.at(7.5); // 1 tick + 2.5 ms -> 7.5 / 15
    h.at(10); // frames need > 1 tick: 3 ticks + 2.5 ms total -> logic tick + 2.5 ms
    expect(h.alphas[1]).toBeCloseTo(2.5 / 15);
    const h2 = harness();
    h2.run(2000, 144);
    for (const a of h2.alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });
});

describe("EngineLoop pause / resume", () => {
  it("inactive: no ticks, no updates, no frames; no time jump after resume", () => {
    const h = harness({ doubleEvery11th: false });
    h.at(30);
    const ticks = h.loop.ticks;
    const frames = h.frames.length;
    h.loop.setActive(false);
    expect(h.active).toEqual([false]);
    h.run(60_000, 60); // a minute in the background
    expect(h.loop.ticks).toBe(ticks);
    expect(h.frames).toHaveLength(frames);
    h.loop.setActive(true);
    expect(h.active).toEqual([false, true]);
    // first step after resume only re-bases the clock; no tick passed since the last
    // frame start, so the minimum frame time still holds the frame back
    expect(h.at(16)).toBe(false);
    expect(h.loop.ticks).toBe(ticks);
    expect(h.at(15)).toBe(true);
    expect(h.loop.ticks).toBe(ticks + 3);
    expect(h.loop.stats.droppedMs).toBe(0);
  });

  it("redundant setActive calls are ignored", () => {
    const h = harness();
    h.loop.setActive(true);
    h.loop.setActive(false);
    h.loop.setActive(false);
    expect(h.active).toEqual([false]);
  });

  it("time fed via advance() while paused is discarded", () => {
    const h = harness();
    h.loop.setActive(false);
    h.loop.advance(1000);
    expect(h.loop.ticks).toBe(0);
  });

  it("focus loss releases input; regaining clears held keys and buttons", () => {
    const h = harness();
    const kb = h.loop.keyboard;
    kb.push({ dik: DIK.LEFT, down: true, char: 0 });
    h.at(40); // poll
    expect(kb.isKeyDown(DIK.LEFT)).toBe(true);
    h.loop.mouse.buttonDown(MOUSE_LEFT);
    h.loop.setActive(false);
    // key-up happens while another window has focus and never reaches the game
    kb.push({ dik: DIK.LEFT, down: false, char: 0 });
    h.loop.setActive(true);
    expect(kb.isKeyDown(DIK.LEFT)).toBe(false);
    expect(h.loop.mouse.buttons).toBe(0);
  });
});

describe("EngineLoop input polling", () => {
  it("keyboard is polled every 40 ms (8 ticks)", () => {
    const h = harness();
    const kb = h.loop.keyboard;
    kb.push({ dik: DIK.A, down: true, char: 0x61 });
    h.at(35); // 7 ticks
    expect(kb.isKeyDown(DIK.A)).toBe(false);
    h.at(5); // 8th tick
    expect(kb.isKeyDown(DIK.A)).toBe(true);
    kb.push({ dik: DIK.A, down: false, char: 0 });
    h.at(39);
    expect(kb.isKeyDown(DIK.A)).toBe(true);
    h.at(1);
    expect(kb.isKeyDown(DIK.A)).toBe(false);
  });

  it("input applied by a poll is visible to logic ticks later in the same step", () => {
    const seen: boolean[] = [];
    const loop = new EngineLoop(
      { update: () => seen.push(loop.keyboard.isKeyDown(DIK.SPACE)) },
      { doubleEvery11th: false },
    );
    loop.keyboard.push({ dik: DIK.SPACE, down: true, char: 0x20 });
    loop.step(0);
    loop.step(45); // ticks 1..9: logic at 3, 6, 9; poll at 8
    expect(seen).toEqual([false, false, true]);
  });

  it("accepts injected keyboard and mouse", () => {
    const h = harness();
    const loop = new EngineLoop({}, { keyboard: h.loop.keyboard, mouse: h.loop.mouse });
    expect(loop.keyboard).toBe(h.loop.keyboard);
    expect(loop.mouse).toBe(h.loop.mouse);
  });

  it("works without any hooks", () => {
    const loop = new EngineLoop();
    loop.step(0);
    expect(loop.step(100)).toBe(true);
    expect(loop.logicTicks).toBe(6);
  });
});

describe("EngineLoop game time", () => {
  it("elapsedMs sums to the time consumed, without pauses or dropped time", () => {
    const h = harness();
    h.run(1000, 60);
    expect(h.frames.reduce((a, f) => a + f.elapsedMs, 0)).toBeCloseTo(h.loop.gameMs, 6);
    expect(h.loop.gameMs).toBeCloseTo(1000, 0);
    h.loop.setActive(false);
    h.run(5000, 60); // paused: no frames, no game time
    expect(h.loop.gameMs).toBeCloseTo(1000, 0);
    h.loop.setActive(true);
    h.at(0); // first step after the pause only restarts the measurement
    const f = h.frames.length;
    h.at(16);
    expect(h.frames.length).toBe(f + 1);
    expect(h.frames.at(-1)!.elapsedMs).toBe(16);
    h.at(1000); // a long frame: capped by maxStepMs
    expect(h.frames.at(-1)!.elapsedMs).toBe(100);
    expect(h.frames.at(-1)!.gameMs).toBeCloseTo(1116, 0);
  });

  it("time of skipped frames is carried into the next frame", () => {
    const h = harness();
    h.at(16);
    h.at(2); // under FRAME_MIN_MS: no frame
    h.at(16);
    expect(h.frames.slice(1).map((f) => f.elapsedMs)).toEqual([16, 18]);
  });
});
