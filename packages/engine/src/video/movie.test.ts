import { describe, expect, it } from "vitest";
import type { Image16 } from "../formats/bm";
import { Avx, MediaError } from "../formats/media";
import { SubtitleTrack } from "../formats/subtitles";
import type { Subtitle } from "../formats/subtitles";
import { FakeMovieSink } from "./audio";
import { MoviePlayer } from "./movie";
import type { MovieOptions } from "./movie";
import { MODE_INTRO, MODE_OUTRO, MODE_SCENE } from "./screen";
import type { OutroImages } from "./screen";
import { buildAvx, deltaChunk, emptyChunk, paletteChunk } from "./synthetic";
import type { SynthSegment } from "./synthetic";
import { BYTES_PER_TICK, movieFrameTicks, RING_START } from "./timing";

const RED = 0xf800;
const GREEN = 0x07e0;
const BLUE = 0x001f;
const W = 640;

/** 4x2 picture, palette 1/2/3 = red/green/blue. */
function tiny(fps: number, frames: number[][][]): SynthSegment {
  return { width: 4, height: 2, fps, frames: frames.map((chunks) => ({ chunks })) };
}
const PAL = paletteChunk([0, RED, GREEN, BLUE]);
const FULL = deltaChunk(0, [[0, [1, 1, 1, 1, 2, 2, 2, 2]]]);

/** Steps tick by tick (a host that polls every 5 ms) until the movie ends; returns presentation ticks. */
function run(p: MoviePlayer, maxTicks = 100000, escapeAt = -1): number[] {
  const at: number[] = [];
  p.start(0);
  for (let t = 0; t < maxTicks && !p.isOver; t++) {
    if (p.step(t, t === escapeAt).presented) at.push(t);
  }
  return at;
}

describe("MoviePlayer without sound", () => {
  it("shows a frame when its clock is due (200 / fps ticks) and ends after the last one", async () => {
    const avx = new Avx(buildAvx([tiny(20, [[PAL, FULL], [deltaChunk(0, [[0, [3]]])], [emptyChunk()]])]));
    const p = new MoviePlayer(avx, { mode: MODE_SCENE });
    p.start(0);
    expect(p.step(0).presented).toBe(true); // clock 0: due at once
    expect(p.screen.pixels[0]).toBe(RED);
    expect(p.screen.pixels[4 * 0 + 1]).toBe(RED);
    expect(p.screen.pixels[W + 0]).toBe(GREEN); // pixel 4 = (0, 1)
    expect(p.frameTicks).toBe(10);
    expect(p.step(5).presented).toBe(false);
    expect(p.step(8).presented).toBe(false); // 2 ticks left: the game still waits (< 2)
    const s = p.step(9); // 1 tick left: due
    expect(s).toMatchObject({ presented: true, number: 1, segment: 0, index: 1, end: null });
    expect(p.screen.pixels[0]).toBe(BLUE);
    expect(p.isOver).toBe(false);
    const last = p.step(19);
    expect(last).toMatchObject({ presented: true, index: 2, end: "finished" });
    await expect(p.ended).resolves.toBe("finished");
    expect(p.step(100)).toMatchObject({ presented: false, end: "finished" });
  });

  it("each segment sets its own frame time; the first frame of a segment already uses it", () => {
    const avx = new Avx(buildAvx([tiny(20, [[PAL, FULL]]), tiny(12, [[PAL, FULL], [emptyChunk()]])]));
    const p = new MoviePlayer(avx, { mode: MODE_SCENE });
    const at = run(p);
    // 10 ticks for the 20 fps frame, then the 12 fps segment: 16 ticks per frame
    expect(at).toEqual([0, 9, 25]);
    expect(p.frameTicks).toBe(movieFrameTicks(12));
  });

  it("ESC is tested after every step: a key that is already down ends the movie after the first frame", async () => {
    const avx = new Avx(buildAvx([tiny(20, [[PAL, FULL], [emptyChunk()], [emptyChunk()]])]));
    const p = new MoviePlayer(avx, { mode: MODE_SCENE });
    p.start(0);
    const s = p.step(0, true);
    expect(s.presented).toBe(true);
    expect(s.end).toBe("aborted");
    await expect(p.ended).resolves.toBe("aborted");
  });

  it("ESC between frames aborts without drawing; abort() is idempotent", async () => {
    const avx = new Avx(buildAvx([tiny(20, [[PAL, FULL], [emptyChunk()], [emptyChunk()]])]));
    const p = new MoviePlayer(avx, { mode: MODE_SCENE });
    const at = run(p, 1000, 4);
    expect(at).toEqual([0]);
    expect(p.isOver).toBe(true);
    p.abort();
    await expect(p.ended).resolves.toBe("aborted");
  });

  it("a long pause restarts the schedule instead of fast-forwarding", () => {
    const avx = new Avx(buildAvx([tiny(20, [[PAL, FULL], [emptyChunk()], [emptyChunk()]])]));
    const p = new MoviePlayer(avx, { mode: MODE_SCENE });
    p.start(0);
    p.step(0);
    const late = p.step(5000); // far past the -600 tick limit of Media_Step
    expect(late.presented).toBe(false);
    expect(p.resyncs).toBe(1);
    expect(p.step(5000).presented).toBe(true);
    expect(p.step(5001).presented).toBe(false);
  });

  it("start() twice and step() before start() are errors", () => {
    const p = new MoviePlayer(new Avx(buildAvx([tiny(20, [[PAL, FULL]])])), { mode: MODE_SCENE });
    expect(() => p.step(0)).toThrow(/not started/);
    p.start(0);
    expect(() => p.start(0)).toThrow(/already started/);
  });

  it("a segment with fps 0 is an error (the game divides by zero)", () => {
    const p = new MoviePlayer(new Avx(buildAvx([tiny(0, [[PAL, FULL]])])), { mode: MODE_SCENE });
    p.start(0);
    expect(() => p.step(0)).toThrow(/fps 0/);
  });

  it("a damaged movie surfaces the decoder's error", () => {
    const bytes = buildAvx([tiny(20, [[PAL, FULL]])]);
    expect(() => new Avx(bytes.subarray(0, bytes.length - 3))).toThrow(MediaError);
  });

  it("the outro mode needs its images", () => {
    expect(() => new MoviePlayer(new Avx(buildAvx([tiny(20, [[PAL, FULL]])])), { mode: MODE_OUTRO })).toThrow(/outro images/);
  });
});

describe("subtitles", () => {
  const sub = (first: number, last: number, x = 100, y = 100): Subtitle => ({
    first,
    last,
    x,
    y,
    width: 2,
    height: 1,
    segment: null,
    color: null,
    pixels: Uint16Array.of(0x1234, 0), // the second pixel is transparent
    unk: 0,
    rawValues: null,
  });
  const frames = [[PAL, FULL], [emptyChunk()], [emptyChunk()], [emptyChunk()]];
  const make = (opts: Partial<MovieOptions>) =>
    new MoviePlayer(new Avx(buildAvx([tiny(20, frames)])), {
      mode: MODE_SCENE,
      subtitles: new SubtitleTrack([sub(2, 4)], false),
      ...opts,
    });
  const at = (p: MoviePlayer, x = 100, y = 100) => p.screen.pixels[y * W + x];

  it("draws from the frame `first` (counter starts at 1) and keeps the pixels the game wrote", () => {
    const p = make({ dialogTextOn: true });
    p.start(0);
    p.step(0); // counter 1
    expect(at(p)).toBe(0);
    p.step(9); // counter 2 = first
    expect(at(p)).toBe(0x1234);
    expect(at(p, 101)).toBe(0); // colour key 0
    p.step(19); // counter 3
    p.step(29); // counter 4 = last: hidden, but nothing erases what was blitted
    expect(at(p)).toBe(0x1234);
  });

  it("is off with DialogOnOff off while there is sound, on when there is no sound", () => {
    const off = make({ dialogTextOn: false, sound: new FakeMovieSink() });
    off.start(0);
    off.step(0);
    off.step(9);
    expect(at(off)).toBe(0);
    const mute = make({ dialogTextOn: false, sound: null });
    mute.start(0);
    mute.step(0);
    mute.step(9);
    expect(at(mute)).toBe(0x1234);
  });

  it("a second subtitle follows the first one", () => {
    const track = new SubtitleTrack([sub(1, 2, 10, 10), sub(3, 4, 20, 20)], false);
    const p = make({ dialogTextOn: true, subtitles: track });
    run(p);
    expect(at(p, 10, 10)).toBe(0x1234);
    expect(at(p, 20, 20)).toBe(0x1234);
    expect(track.position).toBe(2); // both passed: the second one was hidden at its `last`
  });

  it("INTRO subtitles match their segment number", () => {
    const intro = { ...sub(1, 2), segment: 1 };
    const track = new SubtitleTrack([intro], true);
    const p = new MoviePlayer(new Avx(buildAvx([tiny(20, [[PAL, FULL]]), tiny(20, [[PAL, FULL], [emptyChunk()]])])), {
      mode: MODE_INTRO,
      subtitles: track,
      dialogTextOn: true,
    });
    p.start(0);
    p.step(0); // segment 0, counter 1: wrong segment
    expect(at(p)).toBe(0);
    p.step(9); // segment 1, counter 1
    expect(at(p)).toBe(0x1234);
  });
});

describe("sound", () => {
  const avx = () => new Avx(buildAvx([tiny(20, [[PAL, FULL], [emptyChunk()], [emptyChunk()]])], 16));

  it("start() hands over preroll + gap; each frame pushes its own sound", () => {
    const sink = new FakeMovieSink();
    const p = new MoviePlayer(avx(), { mode: MODE_SCENE, sound: sink, level: 90 });
    p.start(0);
    expect(sink.started).toBe(true);
    expect(sink.level).toBe(90);
    expect(sink.written).toBe(RING_START);
    expect(p.written).toBe(RING_START);
    p.step(0);
    expect(sink.written).toBe(RING_START + 16 * 4); // 16 IMA bytes decode to 64 PCM bytes
  });

  it("the clock follows the play cursor: 0xdc units of 2000 bytes ahead is nominal", () => {
    const sink = new FakeMovieSink();
    const p = new MoviePlayer(avx(), { mode: MODE_SCENE, sound: sink });
    p.start(0);
    p.step(0);
    expect(p.clock).toBe(10); // preroll + gap = exactly 2.5 s = lead 220: no adjustment
    p.step(9);
    expect(p.clock).toBe(20);
    // the play cursor is 30 units further than planned: the video is late, the next frame comes sooner
    sink.played = 30 * 2000;
    const before = p.clock;
    p.step(19);
    expect(p.clock).toBe(before - 30 + 10);
  });

  it("a sink that is not playing (suspended audio) leaves the nominal clock", () => {
    const sink = new FakeMovieSink();
    sink.played = null;
    const p = new MoviePlayer(avx(), { mode: MODE_SCENE, sound: sink });
    p.start(0);
    p.step(0);
    p.step(9);
    expect(p.clock).toBe(20);
  });

  it("stops the channel when the movie ends or is aborted (Media_Close)", () => {
    const sink = new FakeMovieSink();
    const p = new MoviePlayer(avx(), { mode: MODE_SCENE, sound: sink });
    run(p);
    expect(sink.stopped).toBe(true);
    const s2 = new FakeMovieSink();
    const p2 = new MoviePlayer(avx(), { mode: MODE_SCENE, sound: s2 });
    p2.start(0);
    p2.abort();
    expect(s2.stopped).toBe(true);
  });

  it("without sound nothing is requested", () => {
    const p = new MoviePlayer(avx(), { mode: MODE_SCENE, sound: null });
    run(p);
    expect(p.written).toBe(0);
  });
});

describe("OUTRO (mode 2)", () => {
  const img = (w: number, h: number, px: number[]): Image16 => ({ width: w, height: h, kind: "rgb565", pixels: Uint16Array.from(px) });
  const outro: OutroImages = {
    background: img(W, 480, new Array(W * 480).fill(0x0011)),
    credits: img(2, 1, [0x2222, 0x3333]),
    cykl: [img(1, 1, [0x4000]), img(1, 1, [0x4001]), img(1, 1, [0x4002])],
  };
  // segment 0..18: one frame; 7 has 3 frames; 19 (fade) has 4. Every first frame: index 0 = background.
  const bgDelta = deltaChunk(0, [[0, [0, 1]]]);
  const segs: SynthSegment[] = [];
  for (let s = 0; s < 20; s++) {
    const n = s === 7 ? 3 : s === 19 ? 4 : 1;
    const frames: number[][][] = [];
    for (let i = 0; i < n; i++) frames.push(i === 0 ? [PAL, bgDelta] : [deltaChunk(1, [[0, [2]]])]);
    segs.push(tiny(20, frames));
  }
  const play = (level = 100) => {
    const sink = new FakeMovieSink();
    const p = new MoviePlayer(new Avx(buildAvx(segs)), { mode: MODE_OUTRO, outro, sound: sink, level });
    const shots: Record<string, number[]> = {};
    p.start(0);
    for (let t = 0; t < 2000 && !p.isOver; t++) {
      sink.played = t * BYTES_PER_TICK; // an ideal sound card keeps the nominal pace
      const s = p.step(t);
      if (s.presented) shots[`${s.segment}.${s.index}`] = [p.screen.pixels[0], p.screen.pixels[1], p.screen.pixels[35]];
    }
    return { p, sink, shots };
  };

  it("index 0 shows the background; the credits picture replaces it in segment 4", () => {
    const { shots } = play();
    expect(shots["0.0"][0]).toBe(0x0011);
    expect(shots["0.0"][1]).toBe(RED);
    expect(shots["3.0"][0]).toBe(0x0011);
    expect(shots["4.0"][0]).toBe(0x2222); // CREDITS.PBM is blitted into the background first
    expect(shots["5.0"][0]).toBe(0x2222);
  });

  it("segments 7..18 draw CYKL1..3 over the picture by frame counter % 3", () => {
    const { shots } = play();
    expect(shots["6.0"][2]).toBe(0); // segment 6: nothing yet
    expect(shots["7.0"][2]).toBe(0x4001); // counter 1
    expect(shots["7.1"][2]).toBe(0x4002); // counter 2
    expect(shots["7.2"][2]).toBe(0x4000); // counter 3
    expect(shots["8.0"][2]).toBe(0x4001);
    expect(shots["18.0"][2]).toBe(0x4001);
  });

  it("segment 7 frames 1..0x4a do not draw their delta", () => {
    const { shots } = play();
    expect(shots["7.0"][1]).toBe(RED);
    expect(shots["7.1"][1]).toBe(RED); // the delta would have made it green
    expect(shots["7.2"][1]).toBe(RED);
    expect(shots["19.1"][1]).toBe(GREEN); // other segments draw
  });

  it("the volume fades to 0 over the last segment and the movie ends with it", async () => {
    const { p, sink } = play(100);
    expect(sink.levels).toEqual([75, 50, 25, 0]); // 100 * (4 - counter) / 4
    await expect(p.ended).resolves.toBe("finished");
    expect(sink.stopped).toBe(true);
  });

  it("other modes never touch the volume", () => {
    const sink = new FakeMovieSink();
    const p = new MoviePlayer(new Avx(buildAvx(segs)), { mode: MODE_SCENE, sound: sink });
    run(p);
    expect(sink.levels).toEqual([]);
  });
});

describe("MovieBuffer runs", () => {
  it("record every run of the delta, in order", () => {
    const avx = new Avx(buildAvx([tiny(20, [[PAL, deltaChunk(1, [[2, [1, 2]], [3, [3]]])]])]));
    const p = new MoviePlayer(avx, { mode: MODE_SCENE });
    p.start(0);
    p.step(0);
    expect(p.buffer.runs).toEqual([3, 2, 8, 1]);
  });
});
