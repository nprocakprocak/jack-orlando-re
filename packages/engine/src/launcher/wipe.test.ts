import { describe, expect, it } from "vitest";
import { textWidth } from "../formats/fnt";
import { encodeMazovia } from "../dialog/caption";
import { fakeAssets } from "../gui/fixtures";
import { createSurface } from "../render/surface";
import { LOGO_TICKS, TICK_MS, TOTAL_MS } from "./logos";
import { LaunchSequence, WAIT_BACKGROUND, WAIT_MIN_MS, buildWaitScreen, waitBoxGeometry } from "./wait-box";
import {
  WIPE_CHUNK, WIPE_PIXELS, WIPE_SLEEP_MS, WIPE_TOTAL_MS, StripeWipe, pixelsAt, wipeOrder, wipePixel,
} from "./wipe";

const white = () => {
  const s = createSurface(640, 480);
  s.pixels.fill(0xffff);
  return s;
};
const blackCount = (s: { pixels: Uint16Array }) => s.pixels.reduce((n, p) => n + (p === 0 ? 1 : 0), 0);

describe("stripe order", () => {
  it("steps 49 columns per pixel and wraps to the next row", () => {
    expect(wipePixel(0)).toBe(0);
    expect(wipePixel(1)).toBe(49);
    expect(wipePixel(13)).toBe(637); // 13 * 49 = 637
    expect(wipePixel(14)).toBe(640 + 46); // 686 = row 1, column 46
    // the row wraps modulo 480 once n / 640 exceeds 0x1df
    expect(Math.floor(wipePixel(WIPE_PIXELS - 1) / 640)).toBeLessThan(480);
  });
  it("visits every pixel of the screen exactly once", () => {
    const seen = new Uint8Array(WIPE_PIXELS);
    for (const p of wipeOrder()) seen[p]++;
    expect(seen.every((n) => n === 1)).toBe(true);
  });
});

describe("StripeWipe timing", () => {
  it("draws 0xf00 pixels per 10 ms sleep, the first one before the first sleep", () => {
    expect(pixelsAt(0)).toBe(1);
    expect(pixelsAt(WIPE_SLEEP_MS - 1)).toBe(1);
    expect(pixelsAt(WIPE_SLEEP_MS)).toBe(WIPE_CHUNK + 1);
    expect(pixelsAt(800)).toBe(WIPE_PIXELS);
    expect(pixelsAt(1e9)).toBe(WIPE_PIXELS);
    expect(WIPE_TOTAL_MS).toBe(855);
  });
  it("blackens the surface progressively and ends fully black", () => {
    const s = white();
    const w = new StripeWipe(s);
    w.advance(0);
    expect(blackCount(s)).toBe(1);
    w.advance(100);
    expect(blackCount(s)).toBe(10 * WIPE_CHUNK + 1);
    expect(w.done).toBe(false);
    w.advance(100000);
    expect(w.done).toBe(true);
    expect(blackCount(s)).toBe(WIPE_PIXELS);
  });
  it("is the same for small steps and one jump, and ignores negative time", () => {
    const a = white();
    const wa = new StripeWipe(a);
    for (let i = 0; i < 20; i++) wa.advance(16);
    const b = white();
    const wb = new StripeWipe(b);
    wb.advance(-5);
    wb.advance(320);
    expect(Array.from(a.pixels)).toEqual(Array.from(b.pixels));
  });
  it("rejects a surface that is not 640x480", () => {
    expect(() => new StripeWipe(createSurface(10, 10))).toThrow("640x480");
  });
});

describe("wait box geometry", () => {
  it("is centred, 50 high, text width + 40 rounded up to even", () => {
    expect(waitBoxGeometry(155)).toEqual({ x: 222, y: 206, w: 196, h: 50 });
    expect(waitBoxGeometry(100).w).toBe(140);
  });

  it("draws a red box on black, sized from the label", () => {
    const text = " Wait ";
    const screen = buildWaitScreen(fakeAssets(), text);
    expect(screen.pixels[0]).toBe(0);
    const g = waitBoxGeometry(textWidth(fakeAssets().fontBig, encodeMazovia(text)));
    let minX = 640, minY = 480, maxX = 0, maxY = 0;
    for (let y = 0; y < 480; y++) {
      for (let x = 0; x < 640; x++) {
        if (!screen.pixels[y * 640 + x]) continue;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    expect([minX, minY, maxX - minX + 1, maxY - minY + 1]).toEqual([g.x, g.y, g.w, g.h]);
    const p = screen.pixels[(g.y + 4) * 640 + (g.x + 4)];
    expect(p >> 11).toBeGreaterThan(((p >> 5) & 0x3f) >> 1);
    expect(WAIT_BACKGROUND).toBe(0xc8c8);
  });
});

describe("LaunchSequence", () => {
  const logos = [0xf81f, 0x07e0, 0xffff].map((c) => new Uint16Array(640 * 480).fill(c));
  const box = () => {
    const s = createSurface(640, 480);
    s.pixels[100] = 0xc8c8;
    return s;
  };
  it("keeps the box until the logos are loaded and the minimum time has passed", () => {
    const fx = new LaunchSequence(box());
    fx.advance(WAIT_MIN_MS * 3);
    expect(fx.phase).toBe("wait");
    fx.setLogos(logos);
    fx.advance(1);
    expect(fx.phase).toBe("wipe");
  });
  it("waits at least WAIT_MIN_MS even when the logos are ready at once", () => {
    const fx = new LaunchSequence(box());
    fx.setLogos(logos);
    fx.advance(WAIT_MIN_MS - 1);
    expect(fx.phase).toBe("wait");
    fx.advance(1);
    expect(fx.phase).toBe("wipe");
  });
  it("wipes the box, plays the logos and finishes", () => {
    const fx = new LaunchSequence(box());
    fx.setLogos(logos);
    fx.advance(WAIT_MIN_MS);
    expect(fx.surface.pixels[100]).toBe(0xc8c8); // wipe not advanced yet
    fx.advance(WIPE_TOTAL_MS);
    expect(fx.phase).toBe("logos");
    expect(fx.surface.pixels[0]).toBe(0x0801); // first pass of the first (magenta) logo: near black
    fx.advance(TOTAL_MS);
    expect(fx.done).toBe(true);
  });
  it("ends after the blackout when the logos failed to load", () => {
    const fx = new LaunchSequence(box());
    fx.setLogos(null);
    fx.advance(WAIT_MIN_MS);
    fx.advance(WIPE_TOTAL_MS);
    expect(fx.done).toBe(true);
    expect(blackCount(fx.surface)).toBe(WIPE_PIXELS);
  });
  it("Escape during the logos blackens the frame on screen; elsewhere it does nothing", () => {
    const fx = new LaunchSequence(box());
    fx.skip(); // wait: ignored
    expect(fx.phase).toBe("wait");
    fx.setLogos(logos);
    fx.advance(WAIT_MIN_MS);
    fx.skip(); // wipe: ignored
    expect(fx.phase).toBe("wipe");
    fx.advance(WIPE_TOTAL_MS);
    fx.advance(LOGO_TICKS * TICK_MS * 0.5); // deep in the first logo
    expect(fx.phase).toBe("logos");
    expect(fx.surface.pixels[1234]).not.toBe(0);
    fx.skip();
    expect(fx.phase).toBe("abort");
    fx.advance(300);
    const mid = blackCount(fx.surface);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(WIPE_PIXELS);
    fx.advance(WIPE_TOTAL_MS);
    expect(fx.done).toBe(true);
    expect(blackCount(fx.surface)).toBe(WIPE_PIXELS);
    fx.skip();
    expect(fx.done).toBe(true);
  });
});
