import { describe, expect, it } from "vitest";
import { INTRO_FLAG_KEY, markIntroShown, readStartupOptions } from "./intro-flag";
import {
  FADE_IN_TICKS, HOLD_TICKS, FADE_OUT_TICKS, LOGO_STEPS, LOGO_TICKS, LogoSequence, TICK_MS, TOTAL_MS, TOTAL_TICKS,
  positionAtTick,
} from "./logos";

const N = 640 * 480;
const flat = (c: number): Uint16Array => new Uint16Array(N).fill(c);
const SYNTH = [flat(0xf81f), flat(0x07e0), flat(0xffff)];

describe("timing (Media_Step case 5)", () => {
  it("adds up to 3 x (32 x 11 + 101 + 32 x 7) ticks of 5 ms", () => {
    expect(LOGO_TICKS).toBe(677);
    expect(TOTAL_TICKS).toBe(2031);
    expect(TOTAL_MS).toBe(10155);
  });
  it("walks fade-in, hold, fade-out, next logo, done", () => {
    expect(positionAtTick(0)).toEqual({ logo: 0, phase: "in", step: 1 });
    expect(positionAtTick(FADE_IN_TICKS - 1).step).toBe(1);
    expect(positionAtTick(FADE_IN_TICKS).step).toBe(2);
    expect(positionAtTick(LOGO_STEPS * FADE_IN_TICKS - 1)).toEqual({ logo: 0, phase: "in", step: 32 });
    expect(positionAtTick(LOGO_STEPS * FADE_IN_TICKS).phase).toBe("hold");
    const out0 = LOGO_STEPS * FADE_IN_TICKS + HOLD_TICKS;
    expect(positionAtTick(out0 - 1).phase).toBe("hold");
    expect(positionAtTick(out0)).toEqual({ logo: 0, phase: "out", step: 1 });
    expect(positionAtTick(out0 + FADE_OUT_TICKS)).toEqual({ logo: 0, phase: "out", step: 2 });
    expect(positionAtTick(LOGO_TICKS - 1)).toEqual({ logo: 0, phase: "out", step: 32 });
    expect(positionAtTick(LOGO_TICKS)).toEqual({ logo: 1, phase: "in", step: 1 });
    expect(positionAtTick(2 * LOGO_TICKS).logo).toBe(2);
    expect(positionAtTick(TOTAL_TICKS - 1)).toEqual({ logo: 2, phase: "out", step: 32 });
    expect(positionAtTick(TOTAL_TICKS).phase).toBe("done");
    expect(positionAtTick(-5).phase).toBe("in");
  });
});

describe("LogoSequence", () => {
  const frameAt = (seq: LogoSequence, ms: number) => {
    seq.advance(ms - seq.elapsedMs);
    return seq.surface.pixels;
  };
  it("rejects the wrong number or size of logos", () => {
    expect(() => new LogoSequence([flat(1)])).toThrow("expected 3");
    expect(() => new LogoSequence([flat(1), flat(1), new Uint16Array(4)])).toThrow("not 640x480");
  });
  it("fades in one pass per step: the first frame is one pass from black, 32 reach the logo", () => {
    const seq = new LogoSequence(SYNTH);
    // red and blue move by 1 per pass (green by 2, but this logo has none)
    expect(frameAt(seq, 0)[0]).toBe(0x0800 | 1);
    expect(frameAt(seq, (LOGO_STEPS * FADE_IN_TICKS - 1) * TICK_MS)[12345]).toBe(0xf81f);
  });
  it("holds the full logo, then fades to black", () => {
    const seq = new LogoSequence(SYNTH);
    expect(frameAt(seq, (LOGO_STEPS * FADE_IN_TICKS + 10) * TICK_MS)[0]).toBe(0xf81f);
    expect(frameAt(seq, (LOGO_STEPS * FADE_IN_TICKS + HOLD_TICKS) * TICK_MS)[0]).toBe(0xf81f - 0x0800 - 1);
    expect(frameAt(seq, (LOGO_TICKS - 1) * TICK_MS)[0]).toBe(0);
  });
  it("starts the next logo from black and ends on a black screen", () => {
    const seq = new LogoSequence(SYNTH);
    expect(frameAt(seq, LOGO_TICKS * TICK_MS)[0]).toBe(2 << 5);
    expect(seq.done).toBe(false);
    frameAt(seq, TOTAL_MS + 1000);
    expect(seq.done).toBe(true);
    expect(seq.elapsedMs).toBe(TOTAL_MS);
    expect(seq.surface.pixels.every((p) => p === 0)).toBe(true);
  });
  it("gives the same frame for small steps and for one big jump", () => {
    for (const ms of [300, 1900, 2300, 3000, 4000, 7777]) {
      const a = new LogoSequence(SYNTH);
      for (let t = 0; t < ms; t += 16) a.advance(Math.min(16, ms - t));
      const b = new LogoSequence(SYNTH);
      b.advance(ms);
      expect(Array.from(a.surface.pixels.subarray(0, 8))).toEqual(Array.from(b.surface.pixels.subarray(0, 8)));
      expect(a.position).toEqual(b.position);
    }
  });
  it("ignores negative time", () => {
    const seq = new LogoSequence(SYNTH);
    seq.advance(-100);
    expect(seq.elapsedMs).toBe(0);
  });
});

describe("startup options: logos always, intro on the first run (g_cfgPlayIntro)", () => {
  const store = (init?: string) => {
    const m = new Map<string, string>(init === undefined ? [] : [[INTRO_FLAG_KEY, init]]);
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };
  it("first run: logos and intro; after the intro: logos only", () => {
    const s = store();
    expect(readStartupOptions("", s)).toEqual({ logos: true, intro: true });
    markIntroShown(s);
    expect(s.m.get(INTRO_FLAG_KEY)).toBe("0");
    expect(readStartupOptions("", s)).toEqual({ logos: true, intro: false });
  });
  it("?logos= switches the logos and the first-run intro", () => {
    expect(readStartupOptions("?logos=1", store("0"))).toEqual({ logos: true, intro: true });
    expect(readStartupOptions("?logos=0", store())).toEqual({ logos: false, intro: false });
    expect(readStartupOptions("?logos=x", store("0"))).toEqual({ logos: true, intro: false });
  });
  it("?intro= wins over ?logos= and the stored flag", () => {
    expect(readStartupOptions("?intro=1", store("0"))).toEqual({ logos: true, intro: true });
    expect(readStartupOptions("?intro=0", store())).toEqual({ logos: true, intro: false });
    expect(readStartupOptions("?logos=0&intro=1", store("0"))).toEqual({ logos: false, intro: true });
    expect(readStartupOptions("?logos=1&intro=0", store())).toEqual({ logos: true, intro: false });
  });
  it("survives missing or throwing storage", () => {
    expect(readStartupOptions("", null)).toEqual({ logos: true, intro: true });
    const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readStartupOptions("", bad)).toEqual({ logos: true, intro: true });
    expect(() => markIntroShown(bad)).not.toThrow();
    expect(() => markIntroShown(null)).not.toThrow();
  });
});
