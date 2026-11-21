import { describe, expect, it } from "vitest";
import { GameFlow, type FlowCommand, type FlowEvent } from "./flow";

const run = (f: GameFlow, ...events: FlowEvent[]): FlowCommand[] => events.flatMap((e) => f.handle(e));
const types = (c: FlowCommand[]) => c.map((x) => x.type);

function inMenu(): GameFlow {
  const f = new GameFlow();
  run(f, { type: "begin", logos: false, intro: false });
  return f;
}

describe("GameFlow: start", () => {
  it("first run: logos, intro (flag stored), wipe, menu", () => {
    const f = new GameFlow();
    expect(run(f, { type: "begin", logos: true, intro: true })).toEqual([{ type: "playLogos" }]);
    expect(run(f, { type: "logosDone" })).toEqual([{ type: "markIntroShown" }, { type: "playIntro", from: "start" }]);
    expect(f.stage).toBe("intro");
    expect(f.introFrom).toBe("start");
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "wipe" }]);
    expect(f.stage).toBe("wipe");
    expect(run(f, { type: "wipeDone" })).toEqual([{ type: "openMenu", previous: "black" }]);
    expect(f.stage).toBe("menu");
  });

  it("later runs: the logos, then the menu without the intro", () => {
    const f = new GameFlow();
    expect(run(f, { type: "begin", logos: true, intro: false })).toEqual([{ type: "playLogos" }]);
    expect(f.stage).toBe("logos");
    expect(run(f, { type: "logosDone" })).toEqual([{ type: "openMenu", previous: "black" }]);
    expect(f.stage).toBe("menu");
  });

  it("?logos=0: straight to the menu; with ?intro=1 straight to the intro", () => {
    expect(run(new GameFlow(), { type: "begin", logos: false, intro: false })).toEqual([
      { type: "openMenu", previous: "black" },
    ]);
    const f = new GameFlow();
    expect(run(f, { type: "begin", logos: false, intro: true })).toEqual([
      { type: "markIntroShown" },
      { type: "playIntro", from: "start" },
    ]);
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "wipe" }]);
  });

  it("ignores events out of order", () => {
    const f = new GameFlow();
    expect(
      run(
        f,
        { type: "logosDone" },
        { type: "introEnded" },
        { type: "wipeDone" },
        { type: "menuReady" },
        { type: "gameExit" },
      ),
    ).toEqual([]);
    expect(f.stage).toBe("start");
    run(f, { type: "begin", logos: false, intro: false });
    expect(run(f, { type: "begin", logos: true, intro: true })).toEqual([]);
    expect(run(f, { type: "logosDone" })).toEqual([]);
  });

  it("?scene=: direct start in the game, the exit leads to the menu", () => {
    const f = new GameFlow();
    expect(run(f, { type: "direct" })).toEqual([]);
    expect(f.stage).toBe("game");
    expect(run(f, { type: "gameExit" })).toEqual([{ type: "openMenu", previous: "lastFrame" }]);
    expect(f.stage).toBe("menu");
  });
});

describe("GameFlow: menu", () => {
  it("Introduction: waits for both LOADING_MIN_MS and the movie, then plays it and returns to the menu", () => {
    const f = inMenu();
    expect(run(f, { type: "menuResult", result: "intro" })).toEqual([{ type: "prepareIntro" }]);
    expect(f.stage).toBe("loading");
    expect(run(f, { type: "introReady", ok: true })).toEqual([]);
    expect(run(f, { type: "menuReady" })).toEqual([{ type: "playIntro", from: "menu" }]);
    expect(f.stage).toBe("intro");
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "menuReturnFromIntro" }]);
    expect(f.stage).toBe("menu");
  });

  it("Introduction: the order of the two conditions does not matter", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "intro" }, { type: "menuReady" });
    expect(run(f, { type: "introReady", ok: true })).toEqual([{ type: "playIntro", from: "menu" }]);
  });

  it("Introduction with a missing INTRO.AVX returns to the menu", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "intro" }, { type: "introReady", ok: false });
    expect(run(f, { type: "menuReady" })).toEqual([{ type: "menuReturnFromIntro" }]);
    expect(f.stage).toBe("menu");
  });

  it("New game: Loading, INTRO.AVX, then the game prepared meanwhile", () => {
    const f = inMenu();
    expect(run(f, { type: "menuResult", result: "newGame" })).toEqual([
      { type: "prepareIntro" },
      { type: "prepareGame" },
    ]);
    expect(f.stage).toBe("loading");
    expect(run(f, { type: "introReady", ok: true })).toEqual([]);
    expect(run(f, { type: "menuReady" })).toEqual([{ type: "playIntro", from: "newGame" }]);
    expect(f.stage).toBe("intro");
    expect(f.introFrom).toBe("newGame");
    // the game is ready during the movie: it waits for its end (Esc or the last frame)
    expect(run(f, { type: "gameReady", ok: true })).toEqual([]);
    expect(f.stage).toBe("intro");
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "wipe" }]);
    expect(f.stage).toBe("wipe");
    // the game waits for the end of the stripe blackout as well
    expect(run(f, { type: "menuReady" })).toEqual([]);
    expect(run(f, { type: "wipeDone" })).toEqual([{ type: "enterGame", openLoad: false }]);
    expect(f.stage).toBe("game");
  });

  it("New game: the game is ready before the movie and the 1 s", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "newGame" });
    expect(run(f, { type: "gameReady", ok: true }, { type: "menuReady" })).toEqual([]);
    expect(run(f, { type: "introReady", ok: true })).toEqual([{ type: "playIntro", from: "newGame" }]);
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "wipe" }]);
    expect(run(f, { type: "wipeDone" })).toEqual([{ type: "enterGame", openLoad: false }]);
  });

  it("New game: the movie and the blackout end before the game is ready - black screen stays", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "newGame" }, { type: "introReady", ok: true }, { type: "menuReady" });
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "wipe" }]);
    expect(run(f, { type: "gameReady", ok: true })).toEqual([]); // ready during the blackout: still waits
    expect(f.stage).toBe("wipe");
    expect(run(f, { type: "wipeDone" })).toEqual([{ type: "enterGame", openLoad: false }]);
  });

  it("New game: game not ready after the blackout - afterIntro until it is", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "newGame" }, { type: "introReady", ok: true }, { type: "menuReady" });
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "wipe" }]);
    expect(run(f, { type: "wipeDone" })).toEqual([]);
    expect(f.stage).toBe("afterIntro");
    expect(run(f, { type: "menuReady" }, { type: "introEnded" })).toEqual([]);
    expect(run(f, { type: "gameReady", ok: true })).toEqual([{ type: "enterGame", openLoad: false }]);
    expect(f.stage).toBe("game");
  });

  it("New game: without INTRO.AVX the game follows Loading", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "newGame" }, { type: "introReady", ok: false });
    expect(run(f, { type: "menuReady" })).toEqual([]);
    expect(f.stage).toBe("loading");
    expect(run(f, { type: "gameReady", ok: true })).toEqual([{ type: "enterGame", openLoad: false }]);
  });

  it("New game: a failed game reopens the menu (after the movie)", () => {
    const f = inMenu();
    run(
      f,
      { type: "menuResult", result: "newGame" },
      { type: "gameReady", ok: false },
      { type: "introReady", ok: true },
      { type: "menuReady" },
    );
    expect(f.stage).toBe("intro");
    expect(run(f, { type: "introEnded" })).toEqual([{ type: "wipe" }]);
    expect(run(f, { type: "wipeDone" })).toEqual([{ type: "openMenu", previous: "lastFrame" }]);
    expect(f.stage).toBe("menu");
  });

  it("New game: duplicate readiness events are ignored", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "newGame" }, { type: "introReady", ok: true }, { type: "menuReady" });
    expect(run(f, { type: "introReady", ok: false })).toEqual([]);
    expect(f.stage).toBe("intro");
  });

  it("Load a game: SC001 is created like a new game, entered with the load window to open (g_loadOnStart)", () => {
    const f = inMenu();
    expect(run(f, { type: "menuResult", result: "load" })).toEqual([{ type: "prepareGame" }]);
    expect(run(f, { type: "menuReady" })).toEqual([]);
    expect(run(f, { type: "gameReady", ok: true })).toEqual([{ type: "enterGame", openLoad: true }]);
    expect(f.stage).toBe("game");
  });

  it("Load a game: a failed game reopens the menu", () => {
    const f = inMenu();
    run(f, { type: "menuResult", result: "load" }, { type: "gameReady", ok: false });
    expect(run(f, { type: "menuReady" })).toEqual([{ type: "openMenu", previous: "lastFrame" }]);
  });

  it("Exit: closing animation, then the start screen", () => {
    const f = inMenu();
    expect(run(f, { type: "menuResult", result: "quit" })).toEqual([]);
    expect(f.stage).toBe("quitting");
    expect(run(f, { type: "menuDone" })).toEqual([{ type: "showStart" }]);
    expect(f.stage).toBe("start");
  });

  it("menu results outside the menu are ignored", () => {
    const f = new GameFlow();
    expect(run(f, { type: "menuResult", result: "newGame" })).toEqual([]);
    expect(f.stage).toBe("start");
  });
});

describe("GameFlow: game and stop", () => {
  it("the game ends in the menu, which can start the next game", () => {
    const f = inMenu();
    run(
      f,
      { type: "menuResult", result: "newGame" },
      { type: "gameReady", ok: true },
      { type: "introReady", ok: true },
      { type: "menuReady" },
      { type: "introEnded" },
      { type: "wipeDone" },
    );
    expect(f.stage).toBe("game");
    expect(run(f, { type: "gameExit" })).toEqual([{ type: "openMenu", previous: "lastFrame" }]);
    expect(types(run(f, { type: "menuResult", result: "newGame" }))).toEqual(["prepareIntro", "prepareGame"]);
    // the flags of the first round do not leak into the second
    expect(run(f, { type: "menuReady" })).toEqual([]);
  });

  it("a stop event returns to the start screen from every stage", () => {
    for (const events of [
      [],
      [{ type: "begin", logos: true, intro: true }],
      [
        { type: "begin", logos: false, intro: false },
        { type: "menuResult", result: "intro" },
      ],
      [
        { type: "begin", logos: false, intro: false },
        { type: "menuResult", result: "newGame" },
        { type: "introReady", ok: true },
        { type: "menuReady" },
      ],
      [{ type: "direct" }],
    ] as FlowEvent[][]) {
      const f = new GameFlow();
      run(f, ...events);
      expect(run(f, { type: "stop" })).toEqual([{ type: "showStart" }]);
      expect(f.stage).toBe("start");
      expect(run(f, { type: "introReady", ok: true }, { type: "gameReady", ok: true })).toEqual([]);
    }
  });
});
