// the dialog layer, sound, music, films and FLX animations in the play host. Tests use stubs for
// the dialog controller and the audio, so the commands must reach the right module.
import { describe, expect, it } from "vitest";
import { blend565, FilmRun, filmPlace, isOutro, mixColour, movieBase, RING_COLOUR, type FilmSource } from "./film";
import type { Image16 } from "../formats/bm";
import { drawOverlays } from "./overlay";

/** A 4x4 picture; `fill` everywhere, or 0 (transparent) where `hole(x, y)` says so */
function pic(fill: number, hole: (x: number, y: number) => boolean = () => false): Image16 {
  const pixels = new Uint16Array(16);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) pixels[y * 4 + x] = hole(x, y) ? 0 : fill;
  return { width: 4, height: 4, kind: "rgb565", pixels };
}

function filmSource(over: Partial<FilmSource> = {}): FilmSource {
  return {
    film: {
      name: "T",
      frameMs: 100,
      positioned: false,
      frames: [
        { file: "BG", x: 0, y: 0 },
        { file: "A", x: 0, y: 0 },
        { file: "B", x: 0, y: 0 },
        { file: "C", x: 0, y: 0 },
      ],
      effects: [
        { frame: 1, sound: "X.SND", channel: 0, unused: 0, volume: 40 },
        { frame: 3, sound: "Y.SND", channel: 2, unused: 0, volume: 50 },
      ],
    },
    images: [pic(0x1111), pic(0x2222, (x) => x < 2), pic(0x3333, (x) => x < 2), pic(0x4444, (x) => x < 2)],
    scene: { pixels: new Uint16Array(64 * 64).fill(0x0abc), width: 64, height: 64 },
    mask: null,
    ring: null,
    ...over,
  };
}

describe("RUNFILMP: Film_Play", () => {
  it("the ring colour: (0xffff, 0, 1.5f) = (a * (2 - t) + b * t) / 2 per channel = (7, 15, 7), a dark grey", () => {
    expect(mixColour(0xffff, 0, 1.5)).toBe((7 << 11) | (15 << 5) | 7);
    expect(RING_COLOUR).toBe(0x39e7);
    expect(mixColour(0xffff, 0, 0)).toBe(0xffff); // t = 0: the first colour
    expect(mixColour(0xffff, 0xffff, 1)).toBe(0xffff);
  });

  it("the ring blend rounds like the tables: diff * level / 32, ties to even", () => {
    // blue: 16 * 1/32 = 0.5 -> 0, 16 * 3/32 = 1.5 -> 2, -16 * 3/32 = -1.5 -> -2, 16 * 5/32 = 2.5 -> 2
    expect(blend565(0, 16, 1)).toBe(0);
    expect(blend565(0, 16, 3)).toBe(2);
    expect(blend565(16, 0, 3)).toBe(14);
    expect(blend565(0, 16, 5)).toBe(2);
    // all channels: black toward white at level 16 is half of each channel
    expect(blend565(0, 0xffff, 16)).toBe((16 << 11) | (32 << 5) | 16);
    expect(blend565(0x1234, 0x5678, 0)).toBe(0x1234);
    expect(blend565(0xffff, 0xffff, 20)).toBe(0xffff);
    // toward a darker colour the scene darkens, toward a lighter one it lightens
    const ring = blend565(0x2104, RING_COLOUR, 16);
    expect(ring).toBeGreaterThan(0x2104);
  });

  it("the window is centred on (x, y) (C short division) and clamped to [6, scroll - w + 0x276] x [6, 0x1d6 - h]", () => {
    expect(filmPlace(510, 310, 240, 240, 0)).toEqual({ x: 390, y: 190 });
    expect(filmPlace(490, 310, 241, 240, 0)).toEqual({ x: 490 - 120, y: 190 });
    expect(filmPlace(0, 0, 240, 240, 0)).toEqual({ x: 6, y: 6 });
    expect(filmPlace(900, 900, 240, 240, 0)).toEqual({ x: 390, y: 0x1d6 - 240 });
    // the upper bound follows the scroll, the lower bound 6 does not
    expect(filmPlace(900, 100, 240, 240, 100)).toEqual({ x: 490, y: 6 });
    expect(filmPlace(10, 100, 240, 240, 300).x).toBe(6);
  });

  it("time: picture i shows from (i-1)*frameMs, the last stays one pass plus 3*frameMs; the film is n-1 passes + 300 ms long", () => {
    const run = new FilmRun(filmSource(), 0, 20, 20, 0);
    expect([0, 99, 100, 199, 200, 299, 5000].map((t) => run.frameAt(t))).toEqual([1, 1, 2, 2, 3, 3, 3]);
    expect(run.total).toBe(3 * 100 + 300);
    expect(run.finished(599)).toBe(false);
    expect(run.finished(600)).toBe(true);
  });

  it("effects fire once, in the pass of their frame; channel 0 is for both channels (the game decides), a skipped pass still fires", () => {
    const run = new FilmRun(filmSource(), 0, 20, 20, 0);
    expect(run.effectsUntil(0).map((e) => e.sound)).toEqual(["X.SND"]);
    expect(run.effectsUntil(50)).toEqual([]);
    expect(run.effectsUntil(250).map((e) => e.sound)).toEqual(["Y.SND"]);
    expect(run.effectsUntil(600)).toEqual([]);
  });

  it("an effect of frame 0 never fires and blocks the rest of the table (the pointer waits for `frame == pass`)", () => {
    const src = filmSource();
    src.film.effects.unshift({ frame: 0, sound: "Z.SND", channel: 1, unused: 0, volume: 1 });
    const run = new FilmRun(src, 0, 20, 20, 0);
    expect(run.effectsUntil(1000)).toEqual([]);
  });

  it("plain mode: the scene is copied with a 4-pixel frame around; background and picture are keyed over it", () => {
    const run = new FilmRun(filmSource(), 0, 30, 30, 0);
    expect(run.margin).toBe(4);
    const w = run.windowAt(0);
    expect([w.x, w.y, w.width, w.height]).toEqual([
      filmPlace(30, 30, 4, 4, 0).x - 4,
      filmPlace(30, 30, 4, 4, 0).y - 4,
      12,
      12,
    ]);
    const at = (x: number, y: number) => w.pixels[(y + 4) * 12 + x + 4];
    expect(at(0, 0)).toBe(0x1111); // background where the picture is transparent
    expect(at(3, 0)).toBe(0x2222); // the picture over it
    expect(w.pixels[0]).not.toBe(0x0abc); // the corner of the frame was changed by the bevel
    expect(w.pixels[6 * 12 + 6]).toBe(0x2222);
    expect(run.windowAt(250).pixels[(0 + 4) * 12 + 3 + 4]).toBe(0x4444);
  });

  it("mirror mode (1, 3) flips background and pictures; circle mode (2, 3) cuts the rows by the mask", () => {
    const run = new FilmRun(filmSource({ mask: [1, 0] }), 3, 30, 30, 0);
    expect(run.mirrored && run.circle).toBe(true);
    expect(run.margin).toBe(0);
    const w = run.windowAt(0);
    // mirrored: the transparent half of the picture is on the right now, the picture on the left
    expect(w.pixels[1 * 4 + 0]).toBe(0x2222);
    expect(w.pixels[1 * 4 + 3]).toBe(0x1111);
    // rows 0 and 3: one pixel off the background at each end (the picture covers the left half only)
    expect(w.pixels[0 * 4 + 3]).toBe(0x0abc);
    expect(w.pixels[3 * 4 + 3]).toBe(0x0abc);
    expect(w.pixels[0 * 4 + 2]).toBe(0x1111);
    expect(w.pixels[0 * 4 + 0]).toBe(0x2222);
    const plain = new FilmRun(filmSource({ mask: [1, 0] }), 1, 30, 30, 0);
    expect(plain.circle).toBe(false);
    expect(plain.windowAt(0).pixels[(0 + 4) * 12 + 3 + 4]).toBe(0x1111);
  });

  it("a ring picture sets the margin and blends the scene toward the grey RING_COLOUR by the blue level of its pixels", () => {
    const ring: Image16 = {
      width: 8,
      height: 8,
      kind: "rgb565",
      pixels: new Uint16Array(64).fill(0x1f),
    };
    const run = new FilmRun(filmSource({ ring, mask: [0, 0] }), 2, 30, 30, 0);
    expect(run.margin).toBe(2);
    const w = run.windowAt(0);
    expect(w.width).toBe(8);
    // level 31 of 32 of the way from 0x0abc (r 1, g 21, b 28) to (7, 15, 7)
    expect(w.pixels[0]).toBe(blend565(0x0abc, RING_COLOUR, 31));
    expect(w.pixels[0]).toBe((7 << 11) | (15 << 5) | 8); // 31/32 of the way, blue 28 -> 8
    expect(w.pixels[3 * 8 + 3]).toBe(0x1111); // the background covers the middle
  });

  it("positioned films copy a w x h part of the background at the picture's offset (from the right when mirrored)", () => {
    const bg: Image16 = {
      width: 6,
      height: 4,
      kind: "rgb565",
      pixels: Uint16Array.from({ length: 24 }, (_, i) => 100 + (i % 6)),
    };
    const src = filmSource({
      images: [bg, pic(0x2222, () => true), pic(0x2222, () => true), pic(0x2222, () => true)],
    });
    src.film.positioned = true;
    src.film.frames[1] = { file: "A", x: 1, y: 0 };
    src.film.frames[2] = { file: "B", x: 2, y: 0 };
    const run = new FilmRun(src, 0, 30, 30, 0);
    expect(run.windowAt(0).pixels[4 * 12 + 4]).toBe(101);
    expect(run.windowAt(100).pixels[4 * 12 + 4]).toBe(102);
    const mirrored = new FilmRun(src, 1, 30, 30, 0);
    // mirrored background: columns 5,4,3,2,1,0 -> value at x of the window is 100 + (5 - (6 - 4 - fx + x))
    expect(mirrored.windowAt(0).pixels[4 * 12 + 4]).toBe(100 + (5 - (6 - 4 - 1)));
  });
});

describe("films and overlays", () => {
  it("the file of a film: the script name plus 16; only OUTRO.AVX ends the game", () => {
    expect(movieBase("ONCAR.AVX")).toBe("ONCAR16");
    expect(movieBase("83jc.avx")).toBe("83JC16");
    expect(isOutro("OUTRO.AVX")).toBe(true);
    expect(isOutro("Z38.AVX")).toBe(false);
  });

  it("overlays are keyed blits clipped to the screen", () => {
    const rgba = new Uint8ClampedArray(640 * 480 * 4);
    drawOverlays(rgba, [
      {
        x: -1,
        y: 479,
        image: { width: 2, height: 2, pixels: new Uint16Array([0xf800, 0, 0x07e0, 0x001f]) },
      },
    ]);
    // of the 2x2 image only (0, 479) lies on the screen, and its value 0 is transparent
    const px = (x: number, y: number) => [...rgba.slice((y * 640 + x) * 4, (y * 640 + x) * 4 + 4)];
    expect(px(0, 479)).toEqual([0, 0, 0, 0]); // pixel value 0 stays transparent
    expect(px(0, 478)).toEqual([0, 0, 0, 0]);
    drawOverlays(rgba, [{ x: 5, y: 5, image: { width: 1, height: 1, pixels: new Uint16Array([0xf800]) } }]);
    expect(px(5, 5)[3]).toBe(255);
    expect(px(5, 5)[0]).toBeGreaterThan(200);
  });
});
