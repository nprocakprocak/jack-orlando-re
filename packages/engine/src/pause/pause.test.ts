import { describe, expect, it } from "vitest";
import { EngineLoop } from "../core/loop";
import { bindPause, type PauseEnv } from "./dom";
import { PauseController, pauseReason, ThrottleDetector, type PauseReason } from "./policy";
import { PAUSE_ON_BLUR_KEY, readPauseOnBlur, writePauseOnBlur, type StorageLike } from "./settings";

class MemStorage implements StorageLike {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
}

const throwing: StorageLike = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("blocked");
  },
};

describe("settings", () => {
  it("defaults to pause when nothing is stored", () => {
    expect(readPauseOnBlur("", null)).toBe(true);
    expect(readPauseOnBlur("", new MemStorage())).toBe(true);
  });

  it("reads and writes the shared key", () => {
    const s = new MemStorage();
    expect(writePauseOnBlur(s, false)).toBe(true);
    expect(s.data.get(PAUSE_ON_BLUR_KEY)).toBe("0");
    expect(readPauseOnBlur("", s)).toBe(false);
    writePauseOnBlur(s, true);
    expect(s.data.get("jack-orlando.pauseOnBlur")).toBe("1");
    expect(readPauseOnBlur("", s)).toBe(true);
  });

  it("ignores unknown stored values", () => {
    const s = new MemStorage();
    s.setItem(PAUSE_ON_BLUR_KEY, "yes");
    expect(readPauseOnBlur("", s)).toBe(true);
  });

  it("the URL parameter wins over the storage", () => {
    const s = new MemStorage();
    writePauseOnBlur(s, true);
    expect(readPauseOnBlur("?pause=never", s)).toBe(false);
    writePauseOnBlur(s, false);
    expect(readPauseOnBlur("?pause=blur", s)).toBe(true);
    expect(readPauseOnBlur(new URLSearchParams("pause=BLUR"), s)).toBe(true);
    // an unknown value falls back to the storage
    expect(readPauseOnBlur("?pause=sometimes", s)).toBe(false);
  });

  it("a storage that throws counts as empty / refuses the write", () => {
    expect(readPauseOnBlur("", throwing)).toBe(true);
    expect(writePauseOnBlur(throwing, false)).toBe(false);
    expect(writePauseOnBlur(null, false)).toBe(false);
  });
});

describe("pauseReason", () => {
  const base = { focused: true, hidden: false, pauseOnBlur: true, throttled: false };
  it("covers every combination", () => {
    expect(pauseReason(base)).toBe(null);
    expect(pauseReason({ ...base, hidden: true })).toBe("hidden");
    expect(pauseReason({ ...base, hidden: true, pauseOnBlur: false })).toBe("hidden");
    expect(pauseReason({ ...base, focused: false })).toBe("blur");
    expect(pauseReason({ ...base, focused: false, pauseOnBlur: false })).toBe(null);
    expect(pauseReason({ ...base, focused: false, pauseOnBlur: false, throttled: true })).toBe("throttled");
    // throttling pauses also with the focus (a hidden pane of the desktop app: visible, focused, rAF at 1 Hz)
    expect(pauseReason({ ...base, pauseOnBlur: false, throttled: true })).toBe("throttled");
    expect(pauseReason({ ...base, throttled: true })).toBe("throttled");
  });
});

describe("ThrottleDetector", () => {
  it("two slow gaps in a row mark throttling, three normal gaps clear it", () => {
    const d = new ThrottleDetector();
    let t = 0;
    expect(d.frame(t)).toBe(false);
    for (let i = 0; i < 10; i++) expect(d.frame((t += 16.7))).toBe(false);
    expect(d.frame((t += 1000))).toBe(false); // one long frame: a long task, not throttling
    expect(d.frame((t += 1000))).toBe(true);
    expect(d.frame((t += 16.7))).toBe(true);
    expect(d.frame((t += 16.7))).toBe(true);
    expect(d.frame((t += 16.7))).toBe(false);
  });

  it("a single long frame between normal ones is not throttling", () => {
    const d = new ThrottleDetector();
    let t = 0;
    for (let i = 0; i < 20; i++) d.frame((t += i % 5 === 4 ? 800 : 16));
    expect(d.throttled).toBe(false);
  });

  it("a medium gap resets the recovery count", () => {
    const d = new ThrottleDetector();
    let t = 0;
    d.frame(t);
    d.frame((t += 1000));
    d.frame((t += 1000));
    d.frame((t += 16));
    d.frame((t += 16));
    d.frame((t += 100)); // neither slow nor normal
    d.frame((t += 16));
    d.frame((t += 16));
    expect(d.throttled).toBe(true);
    d.frame((t += 16));
    expect(d.throttled).toBe(false);
  });

  it("the watchdog sees a stopped rAF while the timer keeps its pace", () => {
    const d = new ThrottleDetector();
    expect(d.check(1000)).toBe(false); // no frame yet: nothing to judge
    d.frame(1000);
    expect(d.check(1250)).toBe(false);
    expect(d.check(1500)).toBe(true);
    d.reset();
    expect(d.throttled).toBe(false);
    expect(d.lastFrame).toBe(null);
  });

  it("a late watchdog (busy main thread) does not count", () => {
    const d = new ThrottleDetector();
    d.frame(0);
    d.check(100);
    // a 900 ms long task: the timer and the frame are both late
    expect(d.check(1000)).toBe(false);
    d.frame(1010);
    expect(d.check(1250)).toBe(false);
  });
});

describe("PauseController", () => {
  function make(pauseOnBlur: boolean) {
    const calls: [boolean, PauseReason | null][] = [];
    const c = new PauseController({ pauseOnBlur }, (p, r) => calls.push([p, r]));
    return { c, calls };
  }

  it("with the option: blur pauses, focus resumes", () => {
    const { c, calls } = make(true);
    c.setFocused(false, 10);
    c.setHidden(true, 20); // reason changes, paused does not
    expect(c.reason).toBe("hidden");
    c.setHidden(false, 30);
    expect(c.reason).toBe("blur");
    c.setFocused(true, 40);
    expect(calls).toEqual([
      [true, "blur"],
      [false, null],
    ]);
    expect(c.history.map((h) => h.at)).toEqual([10, 40]);
  });

  it("without the option: blur keeps running, a hidden page pauses", () => {
    const { c, calls } = make(false);
    c.setFocused(false);
    expect(c.paused).toBe(false);
    c.setHidden(true);
    expect(c.reason).toBe("hidden");
    c.setHidden(false);
    expect(calls).toEqual([
      [true, "hidden"],
      [false, null],
    ]);
  });

  it("without the option: throttled rAF pauses until frames are regular again", () => {
    const { c, calls } = make(false);
    c.setFocused(false, 0);
    let t = 0;
    for (let i = 0; i < 5; i++) c.frame((t += 16));
    expect(c.paused).toBe(false);
    c.check(t + 250);
    c.check(t + 500); // rAF stopped, the timer still runs
    expect(c.reason).toBe("throttled");
    c.frame((t += 1000));
    c.frame((t += 16));
    c.frame((t += 16));
    expect(c.paused).toBe(true);
    c.frame((t += 16));
    expect(c.paused).toBe(false);
    expect(calls.map((x) => x[0])).toEqual([true, false]);
  });

  it("focus clears a throttled state at once", () => {
    const { c } = make(false);
    c.setFocused(false);
    c.frame(0);
    c.frame(1000);
    c.frame(2000);
    expect(c.reason).toBe("throttled");
    c.setFocused(true);
    expect(c.paused).toBe(false);
    expect(c.detector.lastFrame).toBe(null);
  });

  it("switching the option while blurred applies at once", () => {
    const { c } = make(false);
    c.setFocused(false);
    c.setPauseOnBlur(true);
    expect(c.reason).toBe("blur");
    c.setPauseOnBlur(false);
    expect(c.paused).toBe(false);
  });

  it("starts paused on a hidden page", () => {
    const c = new PauseController({ pauseOnBlur: false, hidden: true });
    expect(c.reason).toBe("hidden");
  });
});

/** Fake browser: event targets, a manual rAF queue and timers on a fake clock. */
function fakeBrowser() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { hidden: false });
  let now = 0;
  let frames: { id: number; cb: (t: number) => void }[] = [];
  let timers: { id: number; cb: () => void; ms: number; next: number }[] = [];
  let ids = 1;
  const env: PauseEnv = {
    requestFrame: (cb) => {
      const id = ids++;
      frames.push({ id, cb });
      return id;
    },
    cancelFrame: (id) => (frames = frames.filter((f) => f.id !== id)),
    setInterval: (cb, ms) => {
      const id = ids++;
      timers.push({ id, cb, ms, next: now + ms });
      return id;
    },
    clearInterval: (id) => (timers = timers.filter((t) => t.id !== id)),
    now: () => now,
  };
  /** advance the clock by `ms`, running rAF every `frameMs` (0 = rAF stopped) and the timers */
  const run = (ms: number, frameMs: number, onFrame?: (t: number) => void) => {
    const end = now + ms;
    let nextFrame = frameMs ? now + frameMs : Infinity;
    while (true) {
      const nextTimer = Math.min(...timers.map((t) => t.next), Infinity);
      const next = Math.min(nextFrame, nextTimer);
      if (next > end) break;
      now = next;
      if (next === nextFrame) {
        const due = frames;
        frames = [];
        for (const f of due) f.cb(now);
        onFrame?.(now);
        nextFrame += frameMs;
      } else {
        for (const t of timers) if (t.next === now) {
          t.next += t.ms;
          t.cb();
        }
      }
    }
    now = end;
  };
  /** a long task: the clock moves, nothing runs; overdue timers fire once right after it */
  const block = (ms: number) => {
    now += ms;
    for (const t of timers) if (t.next < now) t.next = now;
  };
  return { win, doc, env, run, block, get now() { return now; }, pendingFrames: () => frames.length, timerCount: () => timers.length };
}

describe("bindPause + EngineLoop", () => {
  function setup(pauseOnBlur: boolean) {
    const b = fakeBrowser();
    let elapsed = 0;
    let logic = 0;
    const loop = new EngineLoop({
      update: () => logic++,
      render: (_a, info) => (elapsed += info.elapsedMs),
    });
    const sound: boolean[] = [];
    const binding = bindPause(b.win, b.doc, loop, { pauseOnBlur, onChange: (p) => sound.push(p), env: b.env });
    const play = (ms: number, frameMs = 1000 / 60) => b.run(ms, frameMs, (t) => loop.step(t));
    return { b, loop, binding, sound, play, elapsed: () => elapsed, logic: () => logic };
  }

  it("a blur stops game time and the sound; no catch-up after the focus returns", () => {
    const s = setup(true);
    s.play(1000);
    const before = s.elapsed();
    expect(before).toBeGreaterThan(950);
    s.b.win.dispatchEvent(new Event("blur"));
    expect(s.loop.active).toBe(false);
    s.play(5000); // the window is visible: rAF keeps coming, the loop ignores it
    expect(s.elapsed()).toBe(before);
    const logicPaused = s.logic();
    s.b.win.dispatchEvent(new Event("focus"));
    s.play(1000);
    // one second of game time again, not six
    expect(s.elapsed() - before).toBeGreaterThan(950);
    expect(s.elapsed() - before).toBeLessThanOrEqual(1000);
    // 1000 / 15 ms plus the double tick on every 11th (GameTimer)
    expect(s.logic() - logicPaused).toBeLessThanOrEqual(74);
    expect(s.sound).toEqual([true, false]);
    expect(s.loop.stats.droppedMs).toBe(0);
  });

  it("without the option a blurred, visible window plays on", () => {
    const s = setup(false);
    s.b.win.dispatchEvent(new Event("blur"));
    s.play(2000);
    expect(s.loop.active).toBe(true);
    expect(s.elapsed()).toBeGreaterThan(1950);
    expect(s.sound).toEqual([]);
  });

  it("without the option a hidden tab pauses and resumes from the same moment", () => {
    const s = setup(false);
    s.play(500);
    const t0 = s.elapsed();
    s.b.doc.hidden = true;
    s.b.doc.dispatchEvent(new Event("visibilitychange"));
    s.play(10_000, 0); // rAF stopped in a hidden tab
    s.b.doc.hidden = false;
    s.b.doc.dispatchEvent(new Event("visibilitychange"));
    expect(s.elapsed()).toBe(t0);
    s.play(500);
    expect(s.elapsed() - t0).toBeLessThanOrEqual(500);
    expect(s.elapsed() - t0).toBeGreaterThan(450);
    expect(s.sound).toEqual([true, false]);
  });

  it("without the option a throttled background window pauses (1 fps rAF)", () => {
    const s = setup(false);
    s.b.win.dispatchEvent(new Event("blur"));
    s.play(500);
    const t0 = s.elapsed();
    s.play(5000, 1000); // occluded window the browser does not report as hidden
    expect(s.sound).toEqual([true]);
    expect(s.loop.active).toBe(false);
    // at most what ran before the watchdog noticed (one 1 s gap is capped by maxStepMs)
    expect(s.elapsed() - t0).toBeLessThanOrEqual(100);
    s.play(200); // regular frames again
    expect(s.loop.active).toBe(true);
    expect(s.sound).toEqual([true, false]);
  });

  it("a focused, visible page with rAF at 1 Hz (hidden app pane) pauses too; no catch-up", () => {
    const s = setup(true);
    s.play(500);
    const t0 = s.elapsed();
    s.play(5000, 1000);
    expect(s.loop.active).toBe(false);
    expect(s.sound).toEqual([true]);
    expect(s.elapsed() - t0).toBeLessThanOrEqual(100);
    s.play(200);
    expect(s.loop.active).toBe(true);
    expect(s.sound).toEqual([true, false]);
  });

  it("long tasks with a focus do not pause", () => {
    const s = setup(true);
    for (let i = 0; i < 5; i++) {
      s.play(300);
      s.b.block(700); // a 700 ms long task: neither rAF nor timers run
    }
    expect(s.sound).toEqual([]);
  });

  it("starts paused on a hidden page and unbinds everything", () => {
    const b = fakeBrowser();
    b.doc.hidden = true;
    const loop = new EngineLoop();
    const sound: boolean[] = [];
    const binding = bindPause(b.win, b.doc, loop, { pauseOnBlur: true, onChange: (p) => sound.push(p), env: b.env });
    expect(loop.active).toBe(false);
    expect(sound).toEqual([true]);
    binding.setPauseOnBlur(false);
    expect(binding.controller.state.pauseOnBlur).toBe(false);
    binding.unbind();
    expect(b.pendingFrames()).toBe(0);
    expect(b.timerCount()).toBe(0);
    b.doc.hidden = false;
    b.doc.dispatchEvent(new Event("visibilitychange"));
    expect(loop.active).toBe(false);
  });
});
