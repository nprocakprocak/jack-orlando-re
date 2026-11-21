// a film paused together with its sound resumes in sync; a film whose sound runs on while the picture
// stands catches up (Media_QueueSound), which is why the pause also suspends the AudioContext.
import { describe, expect, it } from "vitest";
import { Avx } from "../formats/media";
import { FakeMovieSink } from "./audio";
import { MoviePlayer } from "./movie";
import { MODE_SCENE } from "./screen";
import { buildAvx, deltaChunk, paletteChunk } from "./synthetic";
import { BYTES_PER_TICK } from "./timing";

/** 20 fps (10 ticks per frame), 80 frames = 4 s; sound per record = 50 ms of IMA (2208 bytes -> 8832 PCM bytes, a multiple of 8). */
function film(): Avx {
  const frames = Array.from({ length: 80 }, (_, i) => ({
    chunks: i === 0 ? [paletteChunk([0, 0xf800]), deltaChunk(0, [[0, [1, 1, 1, 1]]])] : [deltaChunk(0, [[0, [i & 1]]])],
  }));
  return new Avx(buildAvx([{ width: 4, height: 2, fps: 20, frames }], 2208));
}

/**
 * Runs the film on a 5 ms real-time clock `t`. Between `pauseAt` and `pauseAt + pauseTicks` the game is paused:
 * the movie clock (game time `g`) stands. `soundRunsOn`: the sound card keeps playing meanwhile (no
 * AudioContext.suspend). Returns the game times of the presented frames.
 */
function play(pauseAt: number, pauseTicks: number, soundRunsOn: boolean): number[] {
  const sink = new FakeMovieSink();
  const p = new MoviePlayer(film(), { mode: MODE_SCENE, sound: sink });
  p.start(0);
  const at: number[] = [];
  let g = 0;
  let played = 0;
  for (let t = 0; t < 5000 && !p.isOver; t++) {
    const paused = t >= pauseAt && t < pauseAt + pauseTicks;
    if (paused && !soundRunsOn) continue;
    played += BYTES_PER_TICK;
    if (paused) continue;
    sink.played = played;
    if (p.step(g).presented) at.push(g);
    g++;
  }
  return at;
}

describe("film pause", () => {
  it("paused with its sound: the same frames at the same game times as without a pause", () => {
    const ref = play(0, 0, false);
    expect(ref).toHaveLength(80);
    for (const pauseAt of [3, 137, 401]) expect(play(pauseAt, 600, false)).toEqual(ref);
  });

  it("sound running on during a 1 s picture stop makes the picture catch up afterwards", () => {
    const ref = play(0, 0, false);
    const run = play(200, 200, true);
    expect(run).toHaveLength(80);
    // frames presented in the 0.5 s after the resume: nominal 10, here more (the frame clock is pulled back)
    const inWindow = (xs: number[]) => xs.filter((g) => g >= 200 && g < 300).length;
    expect(inWindow(ref)).toBe(10);
    expect(inWindow(run)).toBeGreaterThan(10);
    // and the film ends earlier in game time: the picture skipped ahead to the sound
    expect(run.at(-1)!).toBeLessThan(ref.at(-1)!);
  });
});
