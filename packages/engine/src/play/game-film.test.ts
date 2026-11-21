// A film fade, and the end of a film. No game files.
import { describe, expect, it } from "vitest";
import { MOVIE_FADE_STEP_MS } from "./game";
import { callPlay, shell } from "./testing";

describe("play: the music fade before a film (synthetic)", () => {
  const audio = (volume: number, playing = true, enabled = true) => {
    const set: number[] = [];
    return { set, enabled, music: { volume, playing }, setMusicFade: (v: number) => set.push(v) };
  };

  it("lasts volume x 10 ms (Timer_Sleep(10) per volume step, Game_Run) and is silent without music", () => {
    expect(MOVIE_FADE_STEP_MS).toBe(10);
    expect(shell({ audio: audio(35) }).beginMovieFade()).toEqual({
      total: 350,
      left: 350,
      volume: 35,
    });
    expect(shell({ audio: audio(64) }).beginMovieFade().total).toBe(640);
    expect(shell({ audio: audio(35, false) }).beginMovieFade().total).toBe(0);
    expect(shell({ audio: audio(0) }).beginMovieFade().total).toBe(0);
    expect(shell({ audio: audio(35, true, false) }).beginMovieFade().total).toBe(0);
  });

  it("the volume falls linearly to 0 as the time runs out", () => {
    const a = audio(40);
    const g = shell({ audio: a });
    g.moviePause = g.beginMovieFade();
    g.advanceMovieFade(100);
    g.advanceMovieFade(100);
    g.advanceMovieFade(1000);
    expect(a.set).toEqual([30, 20, 0]);
    expect(g.moviePause.left).toBe(0);
  });
});

describe("play: a film and a death (synthetic)", () => {
  it("a finished RUNFILMP returns to play and clears the film", () => {
    const g = shell({
      phase: "film",
      film: {
        clockMs: 0,
        name: "CLIP",
        global: false,
        run: { effectsUntil: () => [], finished: (ms: number) => ms >= 20 },
      },
      audio: { enabled: false },
      log: [],
      ticks: 0,
      sceneName: "SC001",
    });
    callPlay(g, "stepFilm", 10);
    expect(g.phase).toBe("film");
    expect(g.film).not.toBeNull();
    callPlay(g, "stepFilm", 10);
    expect(g.phase).toBe("playing");
    expect(g.film).toBeNull();
  });

  it("a finished movie ends the game: the outro finishes, any other film is a death", () => {
    const movie = (film: string, end: string | null) => {
      const g = shell({
        phase: "movie",
        exit: null,
        lastInput: { escape: false },
        log: [],
        ticks: 0,
        sceneName: "SC001",
        opts: {},
        fadeRequested: true,
        movie: {
          clockMs: 0,
          film,
          surface: { width: 1, height: 1, pixels: new Uint16Array(1) },
          player: { step: () => ({ end }) },
        },
      });
      callPlay(g, "stepMovie", 5);
      return g;
    };
    const outro = movie("OUTRO.AVX", "end");
    expect(outro.exit).toBe("finished");
    expect(outro.phase).toBe("finished");
    expect(outro.movie).toBeNull();
    const dead = movie("DEAD.AVX", "end");
    expect(dead.exit).toBe("death");
    expect(dead.phase).toBe("finished");
    const going = movie("DEAD.AVX", null);
    expect(going.phase).toBe("movie");
    expect(going.exit).toBeNull();
    expect(going.movie).not.toBeNull();
  });
});
