import { describe, expect, it } from "vitest";
import { buildAvx, deltaChunk, paletteChunk } from "../video/synthetic";
import { MODE_INTRO } from "../video";
import { ClickSkip, IntroEscape, INTRO_AVX, INTRO_DLG, openIntro } from "./intro";

const avxBytes = () =>
  buildAvx([{ width: 4, height: 2, fps: 20, frames: [{ chunks: [paletteChunk([0, 0xf800]), deltaChunk(0, [[0, [1, 1, 1, 1, 1, 1, 1, 1]]])] }] }]);

const settings = { dialogText: true, sound: null, level: 127 };

describe("openIntro", () => {
  it("opens INTRO.AVX in the intro mode; a missing INTRO.DLG means no subtitles", async () => {
    const asked: string[] = [];
    const read = async (rel: string) => {
      asked.push(rel);
      if (rel === INTRO_AVX) return avxBytes();
      throw new Error("missing");
    };
    const p = await openIntro(read, settings);
    expect(p).not.toBeNull();
    expect(p!.screen.mode).toBe(MODE_INTRO);
    expect(asked).toEqual([INTRO_AVX, INTRO_DLG]);
    p!.start(0);
    expect(p!.step(0).presented).toBe(true);
  });

  it("returns null when INTRO.AVX is missing", async () => {
    expect(await openIntro(async () => Promise.reject(new Error("missing")), settings)).toBeNull();
  });

  it("returns null when INTRO.AVX is damaged", async () => {
    expect(await openIntro(async () => new Uint8Array([1, 2, 3]), settings)).toBeNull();
  });

  it("a damaged INTRO.DLG is ignored", async () => {
    const read = async (rel: string) => (rel === INTRO_AVX ? avxBytes() : new Uint8Array([9]));
    expect(await openIntro(read, settings)).not.toBeNull();
  });
});

describe("IntroEscape", () => {
  it("ignores an Esc held from before until it was released", () => {
    const e = new IntroEscape();
    expect(e.update(true)).toBe(false);
    expect(e.update(true)).toBe(false);
    expect(e.update(false)).toBe(false);
    expect(e.update(true)).toBe(true);
  });

  it("counts a fresh press at once", () => {
    const e = new IntroEscape();
    expect(e.update(false)).toBe(false);
    expect(e.update(true)).toBe(true);
  });
});

describe("ClickSkip", () => {
  it("a click ends the film once; no click, no skip", () => {
    const c = new ClickSkip();
    expect(c.take(true)).toBe(false);
    c.press();
    expect(c.take(true)).toBe(true);
    expect(c.take(true)).toBe(false);
  });

  it("a click while no skippable film runs is dropped, so it cannot skip the next one", () => {
    const c = new ClickSkip();
    c.press();
    expect(c.take(false)).toBe(false);
    expect(c.take(true)).toBe(false);
  });
});
