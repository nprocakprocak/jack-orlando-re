import { describe, expect, it } from "vitest";
import { BYTES_PER_TICK, movieFrameTicks, outroVolume, PREROLL_PCM_BYTES, RING_START, syncAdjust } from "./timing";

describe("movie timing", () => {
  it("frame time is 200 / fps with integer division", () => {
    expect(movieFrameTicks(12)).toBe(16);
    expect(movieFrameTicks(20)).toBe(10);
    expect(movieFrameTicks(18)).toBe(11); // 11.1
    expect(movieFrameTicks(6)).toBe(33);
    expect(movieFrameTicks(200)).toBe(1);
    expect(movieFrameTicks(300)).toBe(0);
  });

  it("fps 0 (a division by zero in the game) is an error", () => {
    expect(() => movieFrameTicks(0)).toThrow(/fps 0/);
  });

  it("the sound write position starts 8 bytes after the decoded preroll", () => {
    expect(PREROLL_PCM_BYTES).toBe(0x6baa0);
    expect(RING_START).toBe(0x6baa8);
    expect(RING_START).toBe(441000); // 2.5 s of 44100 Hz stereo 16 bit
    expect(BYTES_PER_TICK * 200).toBe(44100 * 4);
  });

  it("sync keeps the write cursor 0xdc * 2000 bytes ahead of the play cursor", () => {
    const wanted = 0xdc * 2000;
    expect(syncAdjust(wanted, 0)).toBe(0);
    expect(syncAdjust(wanted + 1999, 0)).toBe(0); // same 2000-byte unit
    expect(syncAdjust(RING_START, 0)).toBe(0); // the first frame: exactly 2.5 s = 441000 bytes
    expect(syncAdjust(RING_START, 2000)).toBe(-1); // lead 219
    expect(syncAdjust(wanted + 10 * 2000, 0)).toBe(10); // too far ahead: next frame later
    expect(syncAdjust(wanted - 30 * 2000, 0)).toBe(-30); // too close: next frame sooner
    expect(syncAdjust(wanted + 500 * 2000, 500 * 2000)).toBe(0); // only the difference counts
  });

  it("the outro fades linearly to 0 over the last segment, truncating", () => {
    expect(outroVolume(100, 30, 1)).toBe(96); // 100 * 29 / 30
    expect(outroVolume(100, 30, 15)).toBe(50);
    expect(outroVolume(100, 30, 29)).toBe(3);
    expect(outroVolume(100, 30, 30)).toBe(0);
    expect(outroVolume(0, 30, 3)).toBe(0);
  });
});
